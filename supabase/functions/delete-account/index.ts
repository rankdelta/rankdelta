/**
 * Delete Account Edge Function
 *
 * Permanently deletes the AUTHENTICATED caller's account (Settings → Danger zone):
 *   1. cancels their Stripe subscription immediately (if any is live) — abort if Stripe fails,
 *   2. revokes their personal API keys,
 *   3. deletes the auth user; the `ON DELETE CASCADE` FKs on user_id remove projects/content/etc.
 *
 * Caller identity comes from the verified JWT (getUser) — never from the body. Same CORS
 * origin-echo allowlist and generic-error policy as cancel-subscription. Logs ids only, never emails.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno';
import { publishableKey, secretKey } from '../_shared/supabaseKeys.ts';
import { allowedBrowserOrigins } from '../_shared/appOrigin.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseServiceKey = secretKey();
const supabaseAnonKey = publishableKey();

const allowedOrigins = allowedBrowserOrigins([]);

const corsHeaders = (req: Request) => {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  const origin = req.headers.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Vary'] = 'Origin';
  }
  return h;
};

/** Stripe statuses for which a subscription is still live and must be cancelled first. */
const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due']);

serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    // Authenticate the caller from their JWT — never trust a userId from the body.
    const authHeader = req.headers.get('Authorization') ?? '';
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();

    if (authError || !user) {
      return json({ error: 'Not authenticated' }, 401);
    }
    const userId = user.id;

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Cancel a live Stripe subscription immediately. If Stripe fails we abort WITHOUT deleting,
    //    otherwise the customer keeps being billed for an account that no longer exists.
    const { data: subscription } = await admin
      .from('subscriptions')
      .select('stripe_subscription_id, status')
      .eq('user_id', userId)
      .maybeSingle();

    const stripeSubscriptionId = subscription?.stripe_subscription_id as string | null | undefined;
    if (stripeSubscriptionId && LIVE_SUBSCRIPTION_STATUSES.has(String(subscription?.status ?? ''))) {
      try {
        await stripe.subscriptions.cancel(stripeSubscriptionId, { prorate: true });
        console.log('delete-account: cancelled Stripe subscription', { userId, stripeSubscriptionId });
      } catch (error) {
        console.error(
          'delete-account: Stripe cancel failed, aborting',
          { userId, stripeSubscriptionId },
          error instanceof Error ? error.message : String(error),
        );
        return json({ error: 'Could not cancel subscription', ok: false }, 502);
      }
    }

    // 2. Revoke personal API keys (sk_rankdelta_…) so the hosted MCP / connector stop accepting them.
    const { error: revokeError } = await admin
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('revoked_at', null);
    if (revokeError) {
      console.error('delete-account: api_keys revoke failed', { userId }, revokeError.message);
      return json({ error: 'internal error', ok: false }, 500);
    }

    // content_versions.created_by references auth.users WITHOUT a cascade; detach it so a version
    // authored on someone else's content can't block the delete. Best effort.
    await admin.from('content_versions').update({ created_by: null }).eq('created_by', userId);

    // 3. Delete the auth user — ON DELETE CASCADE on user_id removes projects/content/etc.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error('delete-account: deleteUser failed', { userId }, deleteError.message);
      return json({ error: 'internal error', ok: false }, 500);
    }

    console.log('delete-account: deleted user', { userId });
    return json({ ok: true }, 200);
  } catch (error) {
    console.error('delete-account: unexpected error', error instanceof Error ? error.message : String(error));
    return json({ error: 'internal error', ok: false }, 500);
  }
});

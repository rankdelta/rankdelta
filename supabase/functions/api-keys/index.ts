/**
 * api-keys — create / list / revoke personal Rankdelta API keys (sk_rankdelta_…).
 *
 * Auth: Supabase user JWT (Authorization: Bearer <access_token>).
 * Writes use the service role (RLS denies client INSERT/DELETE on api_keys).
 *
 *   GET    /api-keys          → list metadata (never returns the secret)
 *   POST   /api-keys          → { name? } → { id, name, key, key_prefix, created_at }  (key once)
 *   DELETE /api-keys?id=<uuid> → revoke
 *
 * CORS origin-echo allowlist replaces '*' — consistent with
 * seo-proxy (#65), create-checkout-session, cancel-subscription, create-portal-session,
 * update-subscription. JWT auth already required, so this is defense-in-depth.
 */

import {
  adminClient,
  displayPrefix,
  generateApiKey,
  hashApiKey,
  userIdFromRequest,
} from '../_shared/apiKeys.ts';
import { allowedBrowserOrigins } from '../_shared/appOrigin.ts';

const allowedOrigins = allowedBrowserOrigins([]);

const corsHeaders = (req: Request) => {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  };
  const origin = req.headers.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Vary'] = 'Origin';
  }
  return h;
};

const json = (body: unknown, status = 200, cors?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...(cors ?? {}), 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const userId = await userIdFromRequest(req);
  if (!userId) return json({ error: 'unauthorized' }, 401, cors);

  const admin = adminClient();

  try {
    if (req.method === 'GET') {
      const { data, error } = await admin
        .from('api_keys')
        .select('id, name, key_prefix, created_at, last_used_at, revoked_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return json({ keys: data ?? [] }, 200, cors);
    }

    if (req.method === 'POST') {
      let name = 'Default';
      try {
        const body = await req.json();
        if (body && typeof body.name === 'string' && body.name.trim()) {
          name = body.name.trim().slice(0, 64);
        }
      } catch {
        /* empty body ok */
      }

      // Soft cap: avoid unbounded key sprawl per account.
      const { count, error: countErr } = await admin
        .from('api_keys')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('revoked_at', null);
      if (countErr) throw countErr;
      if ((count ?? 0) >= 10) {
        return json({ error: 'key_limit_reached', message: 'Maximum of 10 active API keys.' }, 400, cors);
      }

      const raw = generateApiKey();
      const keyHash = await hashApiKey(raw);
      const keyPrefix = displayPrefix(raw);

      const { data, error } = await admin
        .from('api_keys')
        .insert({ user_id: userId, name, key_prefix: keyPrefix, key_hash: keyHash })
        .select('id, name, key_prefix, created_at')
        .single();
      if (error) throw error;

      return json({
        id: data.id,
        name: data.name,
        key_prefix: data.key_prefix,
        created_at: data.created_at,
        key: raw, // shown once
      }, 201, cors);
    }

    if (req.method === 'DELETE') {
      const id = new URL(req.url).searchParams.get('id');
      if (!id) return json({ error: 'missing_id' }, 400, cors);

      const { data, error } = await admin
        .from('api_keys')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .is('revoked_at', null)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'not_found' }, 404, cors);
      return json({ ok: true, id: data.id }, 200, cors);
    }

    return json({ error: 'method_not_allowed' }, 405, cors);
  } catch (e) {
    console.error('[api-keys] error', e);
    return json({ error: 'internal_error' }, 500, cors);
  }
});

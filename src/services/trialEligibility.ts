/**
 * Fetch trial eligibility from the server (subscriptions / Stripe state).
 */

import { supabase } from '../lib/supabaseClient';
import { canStartTrial } from '../lib/trialEligibility';
import type { Subscription } from '../types/subscription';

export type TrialEligibilityResult = {
  canTrial: boolean;
  error: string | null;
};

/**
 * Server-backed trial eligibility check via edge function.
 * Falls back to local derivation from the subscription row when the function is unavailable.
 */
export async function fetchTrialEligibility(
  subscription?: Pick<Subscription, 'trial_start' | 'stripe_subscription_id' | 'status'> | null,
): Promise<TrialEligibilityResult> {
  try {
    const { data, error } = await supabase.functions.invoke('trial-eligibility');
    if (!error && typeof data?.can_trial === 'boolean') {
      return { canTrial: data.can_trial, error: null };
    }
  } catch (e) {
    console.warn('[trialEligibility] edge function unavailable, using subscription row:', e);
  }

  return { canTrial: canStartTrial(subscription ?? null), error: null };
}

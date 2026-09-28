/**
 * Trial eligibility — mirrors supabase/functions/_shared/trialEligibility.ts.
 * Used for UI defaults; create-checkout-session enforces the same rules server-side.
 */

import type { Subscription } from '../types/subscription';

/** Statuses that indicate the account has already entered a billing lifecycle. */
const BILLED_STATUSES = new Set(['active', 'trialing', 'canceled', 'past_due', 'paused']);

export type TrialEligibilityInput = Pick<
  Subscription,
  'trial_start' | 'stripe_subscription_id' | 'status'
>;

/** True when the user may start a new card-required free trial. */
export function canStartTrial(sub: TrialEligibilityInput | null | undefined): boolean {
  if (!sub) return true;
  if (sub.trial_start) return false;
  if (sub.stripe_subscription_id) return false;
  if (BILLED_STATUSES.has(sub.status)) return false;
  return true;
}

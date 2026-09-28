import type { PlanConfiguration, Subscription } from '../../types/subscription'
import { requiresSubscription } from '../../config/deployment'

// Self-host (open edition) has no plans: every report feature is unlocked.

export function isProPlusPlan(
  subscription: Subscription | null | undefined,
  currentPlan: PlanConfiguration | null | undefined,
): boolean {
  if (!requiresSubscription()) return true
  const plan = subscription?.plan
  if (plan === 'pro' || plan === 'agency') return true
  return Boolean(currentPlan?.features?.rank_tracking)
}

export function isAgencyPlan(
  subscription: Subscription | null | undefined,
  currentPlan: PlanConfiguration | null | undefined,
): boolean {
  if (!requiresSubscription()) return true
  if (subscription?.plan === 'agency') return true
  return Boolean(currentPlan?.features?.white_label)
}

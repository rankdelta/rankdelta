/**
 * Plan display helpers. Prices and limits shown in checkout UI should come from
 * plan_configurations at runtime (see planCapabilities.displayPriceCents).
 * Constants below are fallbacks for landing/marketing when the DB is not loaded.
 */
import type { SubscriptionPlan } from '../types/subscription';
import type { PlanConfiguration } from '../types/subscription';
import { displayPriceCents as dbDisplayPriceCents } from './planCapabilities';

/** Monthly list prices (USD) — fallback only; DB plan_configurations is canonical. */
export const PLAN_MONTHLY_USD = {
  starter: 29,
  growth: 59,
  pro: 99,
  agency: 997,
} as const satisfies Record<SubscriptionPlan, number>;

/** Monthly-equivalent when billed yearly (~2 months free). Fallback when DB yearly price missing. */
export const PLAN_YEARLY_MONTHLY_EQ_USD = {
  starter: 23,
  growth: 47,
  pro: 79,
  agency: 797,
} as const satisfies Record<SubscriptionPlan, number>;

export const POPULAR_PLAN: SubscriptionPlan = 'growth';
export const TRIAL_DEFAULT_PLAN: SubscriptionPlan = 'growth';

/** Paid tiers shown in trial / upgrade pickers (agency is contact-sales). */
export const CHECKOUT_PLANS: SubscriptionPlan[] = ['starter', 'growth', 'pro'];

/** Prefer plan_configurations cents; fall back to static table for marketing pages. */
export function planPriceCents(
  plan: SubscriptionPlan,
  isYearly = false,
  config?: PlanConfiguration | null,
): number {
  if (config) return dbDisplayPriceCents(config, isYearly);
  return isYearly ? PLAN_YEARLY_MONTHLY_EQ_USD[plan] * 100 : PLAN_MONTHLY_USD[plan] * 100;
}

export function planMonthlyUsd(plan: SubscriptionPlan, isYearly = false): number {
  return planPriceCents(plan, isYearly) / 100;
}

export function planMonthlyCents(plan: SubscriptionPlan, isYearly = false): number {
  return planPriceCents(plan, isYearly);
}

/** Display plan names in product UI (may differ from the Stripe product names). */
export function planDisplayName(plan: SubscriptionPlan): string {
  const names: Record<SubscriptionPlan, string> = {
    starter: 'Rankdelta Starter',
    growth: 'Rankdelta Growth',
    pro: 'Rankdelta Pro',
    agency: 'Rankdelta Agency',
  };
  return names[plan];
}

/** Override DB display_name when rendering plan cards. */
export function resolvePlanLabel(plan: SubscriptionPlan, dbDisplayName?: string | null): string {
  if (dbDisplayName && /astroseo/i.test(dbDisplayName)) {
    return planDisplayName(plan);
  }
  return dbDisplayName?.trim() || planDisplayName(plan);
}

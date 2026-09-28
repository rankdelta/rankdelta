/**
 * Plan capability lines and display prices sourced from plan_configurations (DB).
 * Stripe price_ids still come from the same table — this module is UI-only.
 */
import type { TFunction } from 'i18next';
import type { PlanConfiguration } from '../types/subscription';

/** Monthly-equivalent cents for display (yearly shows /mo when billed annually). */
export function displayPriceCents(plan: PlanConfiguration, isYearly: boolean): number {
  if (isYearly && plan.price_yearly_cents) {
    return Math.round(plan.price_yearly_cents / 12);
  }
  return plan.price_monthly_cents;
}

export function yearlySavingsPercent(plan: PlanConfiguration): number | null {
  if (!plan.price_yearly_cents) return null;
  const monthlyTotal = plan.price_monthly_cents * 12;
  const savings = monthlyTotal - plan.price_yearly_cents;
  return savings > 0 ? Math.round((savings / monthlyTotal) * 100) : null;
}

/** Concrete per-plan limits for pricing cards (no credits headline). */
export function getPlanCapabilityLines(plan: PlanConfiguration, t: TFunction): string[] {
  const lines: string[] = [];

  if (plan.max_projects === -1) {
    lines.push(t('pricing.unlimitedProjects'));
  } else {
    lines.push(t('pricing.projects', { count: plan.max_projects }));
  }

  if (plan.visibility_checks_monthly != null) {
    lines.push(t('pricing.cap.visibilityChecks', { count: plan.visibility_checks_monthly }));
  }
  if (plan.visibility_prompts != null) {
    lines.push(t('pricing.cap.prompts', { count: plan.visibility_prompts }));
  }
  if (plan.visibility_engines != null) {
    lines.push(t('pricing.cap.engines', { count: plan.visibility_engines }));
  }
  if (plan.rank_keywords != null) {
    lines.push(t('pricing.cap.rankKeywords', { count: plan.rank_keywords }));
  }
  if (plan.research_lookups_monthly != null) {
    lines.push(t('pricing.cap.researchLookups', { count: plan.research_lookups_monthly }));
  }
  if (plan.articles_monthly != null) {
    lines.push(
      plan.articles_monthly > 0
        ? t('pricing.cap.articles', { count: plan.articles_monthly })
        : t('pricing.cap.noArticles'),
    );
  }

  return lines;
}

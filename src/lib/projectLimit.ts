/**
 * Effective project cap for an account.
 *
 * `plan_configurations.max_projects` is the source of truth for what a plan allows.
 * `subscriptions.max_projects` is a per-account value that can drift (it is copied at
 * checkout time and never re-synced when the plan is changed by hand), so it may only
 * WIDEN the plan's cap, never narrow it. Internal (staff / test) accounts are never capped.
 *
 * -1 means unlimited everywhere in the app.
 */

export const UNLIMITED_PROJECTS = -1;

export interface ProjectLimitInputs {
  /** subscriptions.max_projects — per-account override, may be stale */
  subscriptionMax?: number | null;
  /** plan_configurations.max_projects for the account's plan */
  planMax?: number | null;
  /** subscriptions.is_internal — staff / test account */
  isInternal?: boolean | null;
}

const isPositiveCap = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

export const resolveProjectLimit = ({
  subscriptionMax,
  planMax,
  isInternal,
}: ProjectLimitInputs): number => {
  if (isInternal) return UNLIMITED_PROJECTS;
  if (subscriptionMax === UNLIMITED_PROJECTS || planMax === UNLIMITED_PROJECTS) {
    return UNLIMITED_PROJECTS;
  }
  const caps = [subscriptionMax, planMax].filter(isPositiveCap);
  return caps.length > 0 ? Math.max(...caps) : 1;
};

import type { Json, Sb } from './shared.ts';
import { monthStartIso, projectSpendExceeded } from '../_shared/projectSpendCap.ts';
import { isSelfHost } from '../_shared/accountBudget.ts';
import { isNeverPaidStatus, ONBOARDING_FREE_ALLOWANCE_CENTS } from '../_shared/apiKeys.ts';

export { monthStartIso, projectSpendExceeded };

/** Per-check ceiling used for cap pre-checks (USD → cents). */
export const VISIBILITY_CHECK_ESTIMATE_CENTS = Math.max(
  1,
  Math.round(Number(Deno.env.get('VISIBILITY_ESTIMATE_MAX_USD_PER_CHECK') ?? '0.03') * 100),
);

/** Default per-project monthly API spend cap (cents) when projects.monthly_api_spend_cap_cents IS NULL. */
const PLAN_DEFAULT_PROJECT_CAP_CENTS: Record<string, number | null> = {
  starter: 1200,
  growth: 800,
  pro: 400,
  agency: null,
  free: 0,
};

/**
 * Effective per-project spend cap in cents. Explicit project column wins; otherwise plan-scaled
 * default from plan_configurations (account_hard_cap / max_projects). Internal accounts get a
 * higher ceiling. Free / no-plan → 0 (scheduled scans skip before spending).
 */
export async function resolveProjectSpendCapCents(
  admin: Sb,
  project: Json,
  userId: string,
): Promise<number | null> {
  const explicit = project['monthly_api_spend_cap_cents'] as number | null | undefined;
  if (explicit != null) return explicit;

  // Self-host (BYOK): no subscription row and the operator pays the providers → unlimited.
  if (isSelfHost()) return null;

  const { data: sub, error: subErr } = await admin
    .from('subscriptions')
    .select('plan, status, is_internal')
    .eq('user_id', userId)
    .maybeSingle();
  if (subErr || !sub) return 0;

  if (sub.is_internal === true) return 20000;

  const plan = String(sub.plan ?? 'free').toLowerCase();
  const status = String(sub.status ?? '').toLowerCase();
  const paying = ['active', 'trialing'].includes(status) && plan !== 'free';

  // Never-paid (onboarding) accounts may spend up to the small free allowance per project.
  if (!paying) return isNeverPaidStatus(status) ? ONBOARDING_FREE_ALLOWANCE_CENTS : 0;

  const tableDefault = PLAN_DEFAULT_PROJECT_CAP_CENTS[plan];
  if (tableDefault !== undefined) return tableDefault;

  const { data: pc } = await admin
    .from('plan_configurations')
    .select('account_hard_cap_cents, max_projects')
    .eq('plan', plan)
    .maybeSingle();

  const accountCap = pc?.account_hard_cap_cents as number | null | undefined;
  const maxProjects = Math.max(1, Number(pc?.max_projects) || 1);
  if (accountCap != null) return Math.max(50, Math.floor(accountCap / maxProjects));

  return 500;
}

/**
 * Month-to-date project spend from visibility_api_spend_events (UTC calendar month).
 * Used for optimistic pre-checks; record_project_spend is the authoritative write path.
 */
export async function projectSpendThisMonthCents(admin: Sb, projectId: string): Promise<number> {
  const { data, error } = await admin
    .from('visibility_api_spend_events')
    .select('cost_cents')
    .eq('project_id', projectId)
    .gte('created_at', monthStartIso());
  if (error) throw new Error(`projectSpend read failed: ${error.message}`);
  let sum = 0;
  for (const row of (data as Array<{ cost_cents: number | null }>) ?? []) {
    sum += Number(row.cost_cents) || 0;
  }
  return sum;
}

/**
 * reserve_account_spend inserts the spend event with project_id NULL (account scope). After the
 * paid call is finalized, attach the project (and richer metadata) so per-project readers —
 * projectSpendThisMonthCents, the cron's "has checks" probe, the spend UI — see it.
 */
export async function attachProjectToSpendEvent(
  admin: Sb,
  eventId: string | undefined,
  projectId: string,
  metadata?: Json,
): Promise<void> {
  if (!eventId) return;
  const patch: Json = { project_id: projectId };
  if (metadata) patch['metadata'] = metadata;
  try {
    const { error } = await admin.from('visibility_api_spend_events').update(patch).eq('id', eventId);
    if (error) console.error('attachProjectToSpendEvent failed:', error.message);
  } catch (e) {
    console.error('attachProjectToSpendEvent threw:', e instanceof Error ? e.message : String(e));
  }
}

export type ProjectSpendRecord = {
  allowed: boolean;
  reason?: string;
  newSpend?: number | null;
};

/** Atomically reserve project spend under the monthly cap (SELECT FOR UPDATE in Postgres). */
export async function recordProjectSpend(
  admin: Sb,
  projectId: string,
  costCents: number,
  capCents: number | null,
): Promise<ProjectSpendRecord> {
  const add = Math.max(0, Math.round(costCents) || 0);
  if (add <= 0) return { allowed: true, newSpend: null };
  try {
    const { data, error } = await admin.rpc('record_project_spend', {
      p_project_id: projectId,
      p_cost_cents: add,
      p_cap_cents: capCents,
    });
    if (error) {
      return { allowed: false, reason: 'project_spend_write_failed' };
    }
    const out = data as { allowed?: boolean; reason?: string; new_spend?: number | null };
    return {
      allowed: out?.allowed === true,
      reason: out?.reason,
      newSpend: out?.new_spend ?? null,
    };
  } catch {
    return { allowed: false, reason: 'project_spend_write_failed' };
  }
}

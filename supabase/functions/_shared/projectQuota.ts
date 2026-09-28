/**
 * Project quota for service-role inserts into `projects`.
 *
 * Migration 044 enforces subscriptions.max_projects with a BEFORE INSERT trigger, but that
 * trigger deliberately returns early for `service_role` (Edge functions). Every Edge path that
 * creates a project on a user's behalf (connector-api, prestashop-connector) must therefore run
 * this check first — same rules as the trigger:
 *   - only paying statuses (active / trialing / past_due) carry a contractual limit;
 *   - max_projects < 0 (agency) or NULL means unlimited;
 *   - SELF_HOST=true never gates.
 */
type QuotaDb = {
  from: (table: string) => any
}

export type ProjectQuotaResult = { ok: true } | { ok: false; max: number; count: number }

const GATED_STATUSES = new Set(['active', 'trialing', 'past_due'])

export async function assertProjectQuota(admin: QuotaDb, userId: string): Promise<ProjectQuotaResult> {
  if ((Deno.env.get('SELF_HOST') ?? '').toLowerCase() === 'true') return { ok: true }
  if (!userId) return { ok: true }
  const { data: sub, error } = await admin
    .from('subscriptions')
    .select('status, max_projects')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!sub) return { ok: true }
  const status = String(sub.status ?? '')
  if (!GATED_STATUSES.has(status)) return { ok: true }
  const max = typeof sub.max_projects === 'number' ? sub.max_projects : Number(sub.max_projects)
  if (!Number.isFinite(max) || max < 0) return { ok: true }
  const { count, error: countErr } = await admin
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (countErr) throw countErr
  const current = count ?? 0
  if (current >= max) return { ok: false, max, count: current }
  return { ok: true }
}

/** Error thrown by callers that cannot return a Response directly; handlers map it to 402. */
export class ProjectLimitError extends Error {
  max: number
  count: number
  constructor(max: number, count: number) {
    super('project_limit_reached')
    this.name = 'ProjectLimitError'
    this.max = max
    this.count = count
  }
}

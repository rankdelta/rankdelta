/**
 * Search Console sync — one implementation, two callers.
 *
 * `gsc-connect` runs it on a user's JWT when someone connects a property or the Rankings page
 * finds the cache stale. `report-schedule-runner` runs the same code unattended on the daily
 * cron, *before* it sends due reports, so a scheduled report carries current numbers instead of
 * whatever the last human visit happened to leave behind (see the freshness note in
 * reportAssemble.ts — `staleAgainstPeriod` exists precisely because nothing refreshed on a
 * schedule).
 *
 * The file has two halves:
 *
 *  - I/O: token refresh, Google calls, and the `gsc_properties` / `gsc_analytics_cache` writes
 *    that both callers share. Every outbound call is bounded by an AbortController timeout so a
 *    hanging Google request cannot eat the caller's whole budget.
 *  - decisions: which projects are due, in which order, how many fit the cap and the time
 *    budget, and what a failure means. These are pure and unit-tested
 *    (`__tests__/gscSync.test.ts`).
 *
 * Unattended runs never write the connection metadata (`connected_at` / `connected_by`): those
 * record a human act, and the cron overwriting them would rewrite "connected on …" in the UI
 * every night. The cron passes `actorId: null` and the upsert leaves those columns alone.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { readGoogleRefreshToken } from './googleOAuthTokens.ts'

// deno-lint-ignore no-explicit-any
type AdminClient = SupabaseClient<any, any, any>

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

export type GscSite = { siteUrl: string; permissionLevel: string }
export type GscRow = { key: string; clicks: number; impressions: number; ctr: number; position: number }
export type GscOverview = {
  totals: { clicks: number; impressions: number; ctr: number; position: number }
  topQueries: GscRow[]
  topPages: GscRow[]
  byDate: Array<{ date: string; clicks: number; impressions: number }>
  periodDays: number
  siteUrl: string
}

const PERIOD_DAYS_OPTIONS = [7, 28, 90] as const

/**
 * The one window that matters unattended: the Rankings page reads it
 * (`DEFAULT_PERIOD_DAYS` in src/services/gscConnection.ts) and a 28-day scheduled report resolves
 * to it through `nearestCachePeriodDays`. The other two rows (7 / 90) only ever exist if someone
 * asked for them explicitly, so the cron does not manufacture them.
 */
export const GSC_DEFAULT_PERIOD_DAYS = 28

/** Per-request ceiling for a Google call. Generous for the user path, tightened by the cron. */
export const GSC_REQUEST_TIMEOUT_MS = 20_000

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Nearest supported analytics window; anything unparsable → 28. */
export function clampPeriodDays(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 28
  let best: number = PERIOD_DAYS_OPTIONS[0]
  for (const opt of PERIOD_DAYS_OPTIONS) {
    if (Math.abs(opt - n) < Math.abs(best - n)) best = opt
  }
  return best
}

export function matchProperty(properties: GscSite[], websiteUrl: string | null | undefined): string | null {
  if (!websiteUrl || properties.length === 0) return properties[0]?.siteUrl ?? null
  let host = websiteUrl
  try {
    host = new URL(websiteUrl.includes('://') ? websiteUrl : `https://${websiteUrl}`).hostname.replace(/^www\./, '')
  } catch {
    /* use raw */
  }
  const exact = properties.find((p) => {
    const ps = p.siteUrl.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
    return ps === host
  })
  return (exact ?? properties[0])?.siteUrl ?? null
}

/**
 * fetch with a hard deadline. An aborted request surfaces as `gsc_timeout`, which
 * `classifyGscSyncFailure` keeps apart from a revoked grant — one is worth retrying tomorrow,
 * the other never is.
 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    if (controller.signal.aborted) throw new Error(`gsc_timeout after ${timeoutMs}ms`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

async function gscFetch<T>(token: string, path: string, init?: RequestInit, timeoutMs = GSC_REQUEST_TIMEOUT_MS): Promise<T> {
  const res = await fetchWithTimeout(
    `https://www.googleapis.com/webmasters/v3${path}`,
    {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    },
    timeoutMs,
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Search Console ${res.status} ${body.slice(0, 180)}`)
  }
  return res.json() as Promise<T>
}

async function queryAnalytics(
  token: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  rowLimit = 10,
  timeoutMs = GSC_REQUEST_TIMEOUT_MS,
) {
  const enc = encodeURIComponent(siteUrl)
  const data = await gscFetch<{
    rows?: Array<{ keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }>
  }>(token, `/sites/${enc}/searchAnalytics/query`, {
    method: 'POST',
    body: JSON.stringify({ startDate, endDate, dimensions, rowLimit }),
  }, timeoutMs)
  return data.rows ?? []
}

export async function fetchOverview(
  token: string,
  siteUrl: string,
  days = 28,
  timeoutMs = GSC_REQUEST_TIMEOUT_MS,
): Promise<GscOverview> {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  const startDate = ymd(start)
  const endDate = ymd(end)
  const [totalsRows, queries, pages, dates] = await Promise.all([
    queryAnalytics(token, siteUrl, startDate, endDate, [], 1, timeoutMs),
    queryAnalytics(token, siteUrl, startDate, endDate, ['query'], 10, timeoutMs),
    queryAnalytics(token, siteUrl, startDate, endDate, ['page'], 10, timeoutMs),
    queryAnalytics(token, siteUrl, startDate, endDate, ['date'], days + 1, timeoutMs),
  ])
  const t = totalsRows[0]
  const toRow = (r: { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }): GscRow => ({
    key: r.keys?.[0] ?? '',
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  })
  return {
    totals: {
      clicks: t?.clicks ?? 0,
      impressions: t?.impressions ?? 0,
      ctr: t?.ctr ?? 0,
      position: t?.position ?? 0,
    },
    topQueries: queries.map(toRow),
    topPages: pages.map(toRow),
    byDate: dates
      .map((r) => ({ date: r.keys?.[0] ?? '', clicks: r.clicks, impressions: r.impressions }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    periodDays: days,
    siteUrl,
  }
}

export async function listSites(token: string, timeoutMs = GSC_REQUEST_TIMEOUT_MS): Promise<GscSite[]> {
  const data = await gscFetch<{ siteEntry?: GscSite[] }>(token, '/sites', undefined, timeoutMs)
  return (data.siteEntry ?? []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
}

/** Exchange the stored refresh token for a short-lived access token. */
export async function refreshAccess(refreshToken: string, timeoutMs = GSC_REQUEST_TIMEOUT_MS): Promise<string> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID') ?? Deno.env.get('VITE_GOOGLE_CLIENT_ID') ?? ''
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  })
  const res = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }, timeoutMs)
  const jsonBody = await res.json()
  if (!res.ok || !jsonBody.access_token) {
    // The body carries `invalid_grant` when the user revoked access — keep it in the message so
    // classifyGscSyncFailure can tell "reconnect" apart from "try again tomorrow".
    throw new Error(`google_refresh ${res.status} ${JSON.stringify(jsonBody).slice(0, 180)}`)
  }
  return jsonBody.access_token as string
}

export type GscSyncResult =
  | { ok: true; property: string; properties: GscSite[]; overview: GscOverview }
  | { ok: false; error: 'no_properties'; properties: GscSite[] }
  | { ok: false; error: 'property_not_accessible'; properties: GscSite[] }

export interface GscSyncOptions {
  projectId: string
  accessToken: string
  /** Project website, used to auto-match a property when none is stored or requested. */
  websiteUrl?: string | null
  /** Caller-chosen property (the UI's dropdown); the stored one is used when absent. */
  requestedSiteUrl?: string | null
  periodDays?: unknown
  /**
   * The user who triggered this. `null` for the cron: unattended runs refresh the numbers but
   * never rewrite who connected the property and when.
   */
  actorId?: string | null
  timeoutMs?: number
}

/**
 * List the account's properties, pick one, pull the overview and write both rows. Shared verbatim
 * by `gsc-connect` (connect + sync) and the scheduled refresh, so the cache the cron writes is
 * byte-for-byte the cache a human sync writes.
 */
export async function syncGscProperty(admin: AdminClient, opts: GscSyncOptions): Promise<GscSyncResult> {
  const timeoutMs = opts.timeoutMs ?? GSC_REQUEST_TIMEOUT_MS
  const properties = await listSites(opts.accessToken, timeoutMs)

  const stored = opts.requestedSiteUrl
    ? null
    : (await admin.from('gsc_properties').select('site_url').eq('project_id', opts.projectId).maybeSingle()).data?.site_url
  const picked = opts.requestedSiteUrl || stored || matchProperty(properties, opts.websiteUrl ?? null)

  if (!picked) return { ok: false, error: 'no_properties', properties: [] }

  // The picked property (caller-supplied, previously stored, or auto-matched) must be one this
  // Google account can actually read — otherwise refuse before anything is persisted.
  const pickedEntry = properties.find((p) => p.siteUrl === picked)
  if (!pickedEntry) return { ok: false, error: 'property_not_accessible', properties }
  const perm = pickedEntry.permissionLevel ?? null

  // period_days is a cache key (onConflict project_id,period_days): clamp to the supported
  // windows (nearest of 7/28/90) BEFORE any Google call or write.
  const days = clampPeriodDays(opts.periodDays)
  const overview = await fetchOverview(opts.accessToken, picked, days, timeoutMs)

  const propertyRow: Record<string, unknown> = {
    project_id: opts.projectId,
    site_url: picked,
    permission_level: perm,
  }
  if (opts.actorId) {
    propertyRow.connected_at = new Date().toISOString()
    propertyRow.connected_by = opts.actorId
  }

  await admin.from('gsc_properties').upsert(propertyRow, { onConflict: 'project_id' })

  await admin.from('gsc_analytics_cache').upsert({
    project_id: opts.projectId,
    site_url: picked,
    period_days: days,
    clicks: overview.totals.clicks,
    impressions: overview.totals.impressions,
    ctr: overview.totals.ctr,
    avg_position: overview.totals.position,
    top_queries: overview.topQueries,
    top_pages: overview.topPages,
    daily_data: overview.byDate,
    fetched_at: new Date().toISOString(),
    fetched_by: opts.actorId ?? null,
  }, { onConflict: 'project_id,period_days' })

  return { ok: true, property: picked, properties, overview }
}

// ── Revoked grants ─────────────────────────────────────────────────────────

/**
 * `gsc_properties.sync_revoked_at` (migration 20260922120000) is how a revoked Google grant
 * reaches the UI: the browser can read `gsc_properties` under RLS but never `gsc_oauth_tokens`,
 * so the mark lives on the property row.
 *
 * Both writes are best-effort on purpose. Merging this PR deploys the functions immediately
 * (#388) while the migration is applied by hand, so the column may not exist for a while — a
 * missing column must degrade to "we retry tomorrow", never to a failed sync.
 */
export async function markGscGrantRevoked(admin: AdminClient, projectId: string, logPrefix = '[gsc-sync]'): Promise<void> {
  try {
    const { error } = await admin
      .from('gsc_properties')
      .update({ sync_revoked_at: new Date().toISOString() })
      .eq('project_id', projectId)
    if (error) console.warn(`${logPrefix} could not mark revoked grant`, projectId, error.message)
  } catch (e) {
    console.warn(`${logPrefix} could not mark revoked grant`, projectId, e instanceof Error ? e.message : String(e))
  }
}

/** A successful sync proves the grant is alive again (the user reconnected). */
export async function clearGscGrantRevoked(admin: AdminClient, projectId: string): Promise<void> {
  try {
    await admin.from('gsc_properties').update({ sync_revoked_at: null }).eq('project_id', projectId)
  } catch {
    /* best-effort; the column may not exist yet */
  }
}

// ── Decisions (pure) ───────────────────────────────────────────────────────

/**
 * Default staleness gate, in days.
 *
 * The UI calls a cache stale after 7 days (`isDataStale`). The cron runs daily and the Search
 * Console API is free — no per-call billing, only quota we are nowhere near — so the default is 1:
 * refresh yesterday's cache today and the 05:00 report send is always current. Setting
 * `GSC_SYNC_MAX_AGE_DAYS=7` reproduces the UI's weekly notion with no code change.
 */
export const GSC_SYNC_DEFAULT_MAX_AGE_DAYS = 1

/** Projects refreshed per run. Keeps one pass bounded however many projects connect. */
export const GSC_SYNC_DEFAULT_CAP = 50

/**
 * Wall-clock share of the invocation the refresh pass may use.
 *
 * Supabase's request idle timeout is 150s (a function that has not responded by then gets a 504;
 * the worker itself may live up to 400s on paid plans). The pass must therefore leave the due
 * schedules — the reason this cron exists — comfortably inside that window, so it takes ~45s and
 * hands back the rest. Tunable with `GSC_SYNC_BUDGET_MS`.
 */
export const GSC_SYNC_DEFAULT_BUDGET_MS = 45_000

/** Per-project ceiling on Google calls, so one hanging request cannot drain the budget. */
export const GSC_SYNC_DEFAULT_PROJECT_TIMEOUT_MS = 8_000

/** Read a positive number out of an env var, falling back when unset or nonsense. */
export function positiveNumberEnv(raw: string | null | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export interface GscRefreshCandidate {
  projectId: string
  /** Stored Search Console property; null when the row has none (then the website is matched). */
  siteUrl: string | null
  websiteUrl: string | null
  /** `gsc_analytics_cache.fetched_at` for the 28-day row; null when never fetched. */
  fetchedAt: string | null
  /** `gsc_properties.sync_revoked_at`; set means the user must reconnect. */
  revokedAt?: string | null
}

/** Cache age in whole ms, treating "never fetched" as infinitely old. */
function cacheAgeMs(fetchedAt: string | null | undefined, now: Date): number {
  if (!fetchedAt) return Number.POSITIVE_INFINITY
  const t = new Date(fetchedAt).getTime()
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY
  return Math.max(0, now.getTime() - t)
}

/** Same notion the UI uses, with the threshold made tunable. */
export function isCacheFresh(fetchedAt: string | null | undefined, maxAgeDays: number, now: Date = new Date()): boolean {
  return cacheAgeMs(fetchedAt, now) < maxAgeDays * 86_400_000
}

export interface GscRefreshPlan {
  due: GscRefreshCandidate[]
  skippedFresh: number
  skippedRevoked: number
  skippedCap: number
}

/**
 * Which projects this run should refresh, oldest cache first.
 *
 * The ordering is the anti-starvation rule: whatever the cap or the time budget drops today is at
 * the head of tomorrow's queue. A static order (by id, by creation) would mean the same tail is
 * never reached — the bug we just fixed in `check_ranks`.
 */
export function planGscRefresh(
  candidates: GscRefreshCandidate[],
  opts: { now?: Date; maxAgeDays?: number; cap?: number } = {},
): GscRefreshPlan {
  const now = opts.now ?? new Date()
  const maxAgeDays = opts.maxAgeDays ?? GSC_SYNC_DEFAULT_MAX_AGE_DAYS
  const cap = opts.cap ?? GSC_SYNC_DEFAULT_CAP

  let skippedRevoked = 0
  let skippedFresh = 0
  const eligible: GscRefreshCandidate[] = []

  for (const c of candidates) {
    if (c.revokedAt) {
      // Revoked at Google: retrying every night would just burn calls until someone reconnects.
      skippedRevoked += 1
      continue
    }
    if (isCacheFresh(c.fetchedAt, maxAgeDays, now)) {
      skippedFresh += 1
      continue
    }
    eligible.push(c)
  }

  eligible.sort((a, b) => {
    // Oldest cache first; "never fetched" (Infinity) sorts ahead of everything. Subtracting
    // would give NaN for two never-fetched rows, so compare rather than subtract.
    const ageA = cacheAgeMs(a.fetchedAt, now)
    const ageB = cacheAgeMs(b.fetchedAt, now)
    if (ageA !== ageB) return ageB > ageA ? 1 : -1
    return a.projectId.localeCompare(b.projectId)
  })

  const due = eligible.slice(0, Math.max(0, Math.floor(cap)))
  return { due, skippedFresh, skippedRevoked, skippedCap: eligible.length - due.length }
}

export type GscSyncFailureKind = 'revoked' | 'timeout' | 'failed'

/**
 * What a per-project failure means:
 *  - `revoked`  — Google answered `invalid_grant`: the user removed access, only a reconnect fixes it.
 *  - `timeout`  — our own deadline fired; the project simply goes back in tomorrow's queue.
 *  - `failed`   — anything else (Google 5xx, network, no property).
 */
export function classifyGscSyncFailure(err: unknown): GscSyncFailureKind {
  const message = err instanceof Error ? err.message : String(err ?? '')
  if (/invalid_grant/i.test(message)) return 'revoked'
  if (/gsc_timeout|timeouterror|aborted|abort/i.test(message)) return 'timeout'
  return 'failed'
}

export interface GscRefreshFailure {
  projectId: string
  kind: GscSyncFailureKind
  reason: string
}

export interface GscRefreshPassResult {
  candidates: number
  refreshed: number
  skipped: number
  failed: number
  revoked: number
  skippedFresh: number
  skippedRevoked: number
  skippedCap: number
  skippedBudget: number
  failures: GscRefreshFailure[]
  durationMs: number
}

export interface GscRefreshPassOptions {
  now?: Date
  maxAgeDays?: number
  cap?: number
  /** Wall-clock budget measured from `startedAt`. */
  budgetMs?: number
  startedAt?: number
  nowMs?: () => number
  onFailure?: (candidate: GscRefreshCandidate, kind: GscSyncFailureKind, reason: string) => void | Promise<void>
  logPrefix?: string
}

/**
 * Run the refresh for a set of candidates, one at a time, inside a time budget.
 *
 * Two invariants the caller depends on, both covered by tests:
 *  1. a project's failure is *its own* — it is recorded and the loop continues, so nothing that
 *     happens to one connection can stop the others or the schedule sending that follows;
 *  2. when the budget runs out the pass stops cleanly and reports `skippedBudget`, so the caller
 *     always reaches the due schedules. Sending reports must never depend on how much refreshing
 *     there was to do.
 */
export async function runGscRefreshPass(
  candidates: GscRefreshCandidate[],
  syncOne: (candidate: GscRefreshCandidate) => Promise<void>,
  opts: GscRefreshPassOptions = {},
): Promise<GscRefreshPassResult> {
  const nowMs = opts.nowMs ?? (() => Date.now())
  const startedAt = opts.startedAt ?? nowMs()
  const budgetMs = opts.budgetMs ?? GSC_SYNC_DEFAULT_BUDGET_MS
  const logPrefix = opts.logPrefix ?? '[gsc-sync]'

  const plan = planGscRefresh(candidates, { now: opts.now, maxAgeDays: opts.maxAgeDays, cap: opts.cap })

  let refreshed = 0
  let failed = 0
  let revoked = 0
  let skippedBudget = 0
  const failures: GscRefreshFailure[] = []

  for (let i = 0; i < plan.due.length; i++) {
    if (nowMs() - startedAt >= budgetMs) {
      // Out of time: the rest keep their old cache and lead tomorrow's oldest-first queue.
      skippedBudget = plan.due.length - i
      break
    }
    const candidate = plan.due[i]
    try {
      await syncOne(candidate)
      refreshed += 1
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      const kind = classifyGscSyncFailure(e)
      failed += 1
      if (kind === 'revoked') revoked += 1
      failures.push({ projectId: candidate.projectId, kind, reason: reason.slice(0, 180) })
      console.error(`${logPrefix} project refresh failed`, candidate.projectId, kind, reason.slice(0, 180))
      if (opts.onFailure) {
        try {
          await opts.onFailure(candidate, kind, reason)
        } catch (hookErr) {
          console.warn(`${logPrefix} failure hook threw`, hookErr instanceof Error ? hookErr.message : String(hookErr))
        }
      }
    }
  }

  return {
    candidates: candidates.length,
    refreshed,
    skipped: plan.skippedFresh + plan.skippedRevoked + plan.skippedCap + skippedBudget,
    failed,
    revoked,
    skippedFresh: plan.skippedFresh,
    skippedRevoked: plan.skippedRevoked,
    skippedCap: plan.skippedCap,
    skippedBudget,
    failures,
    durationMs: nowMs() - startedAt,
  }
}

// ── The unattended pass ────────────────────────────────────────────────────

/**
 * Every project with a stored refresh token *and* a Search Console property row, with the age of
 * its 28-day cache. A token without a property row has nothing to refresh, and a property row
 * without a token cannot be refreshed at all.
 */
export async function loadGscRefreshCandidates(admin: AdminClient, limit = 500): Promise<GscRefreshCandidate[]> {
  const { data: tokens } = await admin.from('gsc_oauth_tokens').select('project_id').limit(limit)
  const tokenIds = new Set((tokens ?? []).map((t: { project_id: string }) => t.project_id))
  if (tokenIds.size === 0) return []

  // sync_revoked_at arrives with the migration; until it is applied, read the row without it.
  type PropertyRow = { project_id: string; site_url: string | null; sync_revoked_at?: string | null }
  const withRevoked = await admin.from('gsc_properties').select('project_id, site_url, sync_revoked_at').limit(limit)
  let propertyRows = (withRevoked.data ?? []) as PropertyRow[]
  if (withRevoked.error) {
    const fallback = await admin.from('gsc_properties').select('project_id, site_url').limit(limit)
    propertyRows = (fallback.data ?? []) as PropertyRow[]
  }

  const rows = propertyRows.filter((p) => tokenIds.has(p.project_id))
  if (rows.length === 0) return []
  const ids = rows.map((p) => p.project_id)

  const [{ data: caches }, { data: projects }] = await Promise.all([
    admin
      .from('gsc_analytics_cache')
      .select('project_id, fetched_at')
      .eq('period_days', GSC_DEFAULT_PERIOD_DAYS)
      .in('project_id', ids),
    admin.from('projects').select('id, website_url').in('id', ids),
  ])

  const fetchedAt = new Map<string, string | null>()
  for (const c of caches ?? []) {
    const prev = fetchedAt.get(c.project_id) ?? null
    const next = (c.fetched_at as string | null) ?? null
    if (!prev || (next && next > prev)) fetchedAt.set(c.project_id, next)
  }
  const websiteUrl = new Map<string, string | null>()
  for (const p of projects ?? []) websiteUrl.set(p.id, (p.website_url as string | null) ?? null)

  return rows.map((p) => ({
    projectId: p.project_id,
    siteUrl: p.site_url ?? null,
    websiteUrl: websiteUrl.get(p.project_id) ?? null,
    fetchedAt: fetchedAt.get(p.project_id) ?? null,
    revokedAt: p.sync_revoked_at ?? null,
  }))
}

export interface ScheduledGscRefreshOptions extends GscRefreshPassOptions {
  projectTimeoutMs?: number
}

/**
 * The daily maintenance step: refresh every stale, connected project's Search Console cache.
 *
 * Runs on the service role, with no user in sight — which is exactly why `gsc-connect` could not
 * do this: it authenticates a user JWT, and a cron has none.
 */
export async function refreshScheduledGscProjects(
  admin: AdminClient,
  opts: ScheduledGscRefreshOptions = {},
): Promise<GscRefreshPassResult> {
  const logPrefix = opts.logPrefix ?? '[report-schedule-runner][gsc]'
  const projectTimeoutMs = opts.projectTimeoutMs ?? GSC_SYNC_DEFAULT_PROJECT_TIMEOUT_MS

  let candidates: GscRefreshCandidate[] = []
  try {
    candidates = await loadGscRefreshCandidates(admin)
  } catch (e) {
    console.error(`${logPrefix} could not load candidates`, e instanceof Error ? e.message : String(e))
    return {
      candidates: 0,
      refreshed: 0,
      skipped: 0,
      failed: 0,
      revoked: 0,
      skippedFresh: 0,
      skippedRevoked: 0,
      skippedCap: 0,
      skippedBudget: 0,
      failures: [],
      durationMs: 0,
    }
  }

  const syncOne = async (candidate: GscRefreshCandidate): Promise<void> => {
    const refreshToken = await readGoogleRefreshToken(admin, 'gsc_oauth_tokens', candidate.projectId)
    if (!refreshToken) throw new Error('not_connected')
    const accessToken = await refreshAccess(refreshToken, projectTimeoutMs)
    const result = await syncGscProperty(admin, {
      projectId: candidate.projectId,
      accessToken,
      websiteUrl: candidate.websiteUrl,
      requestedSiteUrl: candidate.siteUrl,
      periodDays: GSC_DEFAULT_PERIOD_DAYS,
      actorId: null,
      timeoutMs: projectTimeoutMs,
    })
    if (!result.ok) throw new Error(result.error)
    if (candidate.revokedAt) await clearGscGrantRevoked(admin, candidate.projectId)
  }

  const result = await runGscRefreshPass(candidates, syncOne, {
    ...opts,
    logPrefix,
    onFailure: async (candidate, kind) => {
      if (kind === 'revoked') await markGscGrantRevoked(admin, candidate.projectId, logPrefix)
    },
  })

  console.log(
    `${logPrefix} refreshed=${result.refreshed} skipped=${result.skipped} failed=${result.failed}` +
      ` (fresh=${result.skippedFresh} revoked=${result.skippedRevoked} cap=${result.skippedCap} budget=${result.skippedBudget})` +
      ` candidates=${result.candidates} in ${result.durationMs}ms`,
  )
  for (const f of result.failures) console.log(`${logPrefix} failure project=${f.projectId} kind=${f.kind} reason=${f.reason}`)

  return result
}

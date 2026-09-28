/**
 * Scheduled Search Console refresh — the decision logic of the daily pass (deno).
 *
 * Run: deno test --allow-net --allow-env --allow-read --no-check \
 *        supabase/functions/_shared/__tests__/gscSync.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  classifyGscSyncFailure,
  clampPeriodDays,
  GSC_DEFAULT_PERIOD_DAYS,
  GSC_SYNC_DEFAULT_MAX_AGE_DAYS,
  type GscRefreshCandidate,
  isCacheFresh,
  matchProperty,
  planGscRefresh,
  positiveNumberEnv,
  runGscRefreshPass,
} from '../gscSync.ts'

const NOW = new Date('2026-09-22T05:00:00.000Z')

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
}

function candidate(projectId: string, fetchedAt: string | null, extra: Partial<GscRefreshCandidate> = {}): GscRefreshCandidate {
  return { projectId, siteUrl: `sc-domain:${projectId}.com`, websiteUrl: `https://${projectId}.com`, fetchedAt, ...extra }
}

Deno.test('the refreshed window is the one the UI and a 28-day report both read', () => {
  assertEquals(GSC_DEFAULT_PERIOD_DAYS, 28)
  // Mirrors clampPeriodDays in the app: nearest of 7/28/90, 28 for anything unparsable.
  assertEquals(clampPeriodDays(28), 28)
  assertEquals(clampPeriodDays(30), 28)
  assertEquals(clampPeriodDays(8), 7)
  assertEquals(clampPeriodDays(80), 90)
  assertEquals(clampPeriodDays('nonsense'), 28)
  assertEquals(clampPeriodDays(undefined), 28)
})

Deno.test('isCacheFresh reproduces the UI threshold when asked for 7 days, and skips today at 1', () => {
  // The UI calls anything older than 7 days stale (isDataStale).
  assertEquals(isCacheFresh(daysAgo(6), 7, NOW), true)
  assertEquals(isCacheFresh(daysAgo(8), 7, NOW), false)
  // The daily default only spares a cache refreshed within the last day.
  assertEquals(GSC_SYNC_DEFAULT_MAX_AGE_DAYS, 1)
  assertEquals(isCacheFresh(daysAgo(0.5), 1, NOW), true)
  assertEquals(isCacheFresh(daysAgo(2), 1, NOW), false)
  // Never fetched is never fresh.
  assertEquals(isCacheFresh(null, 7, NOW), false)
  assertEquals(isCacheFresh('not-a-date', 7, NOW), false)
})

Deno.test('planGscRefresh: fresh caches and revoked grants are skipped, the rest are due', () => {
  const plan = planGscRefresh(
    [
      candidate('fresh', daysAgo(0.2)),
      candidate('stale', daysAgo(9)),
      candidate('never', null),
      candidate('revoked', daysAgo(40), { revokedAt: daysAgo(3) }),
    ],
    { now: NOW, maxAgeDays: 1, cap: 50 },
  )
  assertEquals(plan.due.map((c) => c.projectId), ['never', 'stale'])
  assertEquals(plan.skippedFresh, 1)
  assertEquals(plan.skippedRevoked, 1)
  assertEquals(plan.skippedCap, 0)
})

Deno.test('planGscRefresh orders oldest cache first so the cap can never starve a project', () => {
  const plan = planGscRefresh(
    [
      candidate('b-recent', daysAgo(2)),
      candidate('a-oldest', daysAgo(30)),
      candidate('c-never', null),
      candidate('d-middle', daysAgo(10)),
    ],
    { now: NOW, maxAgeDays: 1, cap: 50 },
  )
  assertEquals(plan.due.map((c) => c.projectId), ['c-never', 'a-oldest', 'd-middle', 'b-recent'])
})

Deno.test('planGscRefresh caps a run, and the overflow is the freshest — tomorrow it leads', () => {
  const plan = planGscRefresh(
    [candidate('p1', daysAgo(3)), candidate('p2', daysAgo(20)), candidate('p3', daysAgo(9))],
    { now: NOW, maxAgeDays: 1, cap: 2 },
  )
  assertEquals(plan.due.map((c) => c.projectId), ['p2', 'p3'])
  assertEquals(plan.skippedCap, 1)
})

Deno.test('planGscRefresh breaks ties on project id so a run is deterministic', () => {
  const same = daysAgo(5)
  const plan = planGscRefresh([candidate('zeta', same), candidate('alpha', same)], { now: NOW, maxAgeDays: 1 })
  assertEquals(plan.due.map((c) => c.projectId), ['alpha', 'zeta'])
})

Deno.test('classifyGscSyncFailure separates a revoked grant from a timeout from everything else', () => {
  assertEquals(classifyGscSyncFailure(new Error('google_refresh 400 {"error":"invalid_grant"}')), 'revoked')
  assertEquals(classifyGscSyncFailure(new Error('gsc_timeout after 8000ms')), 'timeout')
  assertEquals(classifyGscSyncFailure(new DOMException('signal aborted', 'AbortError')), 'timeout')
  assertEquals(classifyGscSyncFailure(new Error('Search Console 503 backend error')), 'failed')
  assertEquals(classifyGscSyncFailure(new Error('not_connected')), 'failed')
  assertEquals(classifyGscSyncFailure('property_not_accessible'), 'failed')
})

Deno.test('runGscRefreshPass isolates one project: a revoked grant does not stop the others', async () => {
  const seen: string[] = []
  const marked: Array<{ projectId: string; kind: string }> = []
  const result = await runGscRefreshPass(
    [candidate('p1', daysAgo(10)), candidate('p2', daysAgo(20)), candidate('p3', daysAgo(30))],
    (c) => {
      seen.push(c.projectId)
      if (c.projectId === 'p3') return Promise.reject(new Error('google_refresh 400 {"error":"invalid_grant"}'))
      if (c.projectId === 'p2') return Promise.reject(new Error('gsc_timeout after 8000ms'))
      return Promise.resolve()
    },
    { now: NOW, maxAgeDays: 1, onFailure: (c, kind) => { marked.push({ projectId: c.projectId, kind }) } },
  )

  // Every project was attempted, oldest first, despite the first two failing.
  assertEquals(seen, ['p3', 'p2', 'p1'])
  assertEquals(result.refreshed, 1)
  assertEquals(result.failed, 2)
  assertEquals(result.revoked, 1)
  assertEquals(result.failures.map((f) => [f.projectId, f.kind]), [['p3', 'revoked'], ['p2', 'timeout']])
  // The hook sees every failure with its classification; the caller is the one that decides only
  // a revoked grant gets marked "reconnect" — a timeout simply retries tomorrow.
  assertEquals(marked, [{ projectId: 'p3', kind: 'revoked' }, { projectId: 'p2', kind: 'timeout' }])
  assertEquals(marked.filter((m) => m.kind === 'revoked').map((m) => m.projectId), ['p3'])
})

Deno.test('runGscRefreshPass: a hook that throws cannot take the pass down with it', async () => {
  const result = await runGscRefreshPass(
    [candidate('p1', daysAgo(10)), candidate('p2', daysAgo(20))],
    (c) => (c.projectId === 'p2' ? Promise.reject(new Error('invalid_grant')) : Promise.resolve()),
    {
      now: NOW,
      maxAgeDays: 1,
      onFailure: () => {
        throw new Error('database unavailable')
      },
    },
  )
  assertEquals(result.refreshed, 1)
  assertEquals(result.failed, 1)
})

Deno.test('runGscRefreshPass stops when the wall-clock budget is spent and says how many it dropped', async () => {
  let clock = 1_000
  const seen: string[] = []
  const result = await runGscRefreshPass(
    [candidate('p1', daysAgo(40)), candidate('p2', daysAgo(30)), candidate('p3', daysAgo(20)), candidate('p4', daysAgo(10))],
    (c) => {
      seen.push(c.projectId)
      clock += 20_000 // each project costs 20s of the 45s budget
      return Promise.resolve()
    },
    { now: NOW, maxAgeDays: 1, startedAt: 1_000, budgetMs: 45_000, nowMs: () => clock },
  )

  // Two fit (0ms and 20_000ms elapsed); the third starts at 40_000ms and still fits; the fourth
  // would start past the budget, so the pass stops cleanly rather than running over.
  assertEquals(seen, ['p1', 'p2', 'p3'])
  assertEquals(result.refreshed, 3)
  assertEquals(result.skippedBudget, 1)
  assertEquals(result.skipped, 1)
  assertEquals(result.failed, 0)
})

Deno.test('runGscRefreshPass with the budget already gone refreshes nothing — and still returns', async () => {
  let called = 0
  const result = await runGscRefreshPass(
    [candidate('p1', daysAgo(40)), candidate('p2', daysAgo(30))],
    () => {
      called += 1
      return Promise.resolve()
    },
    { now: NOW, maxAgeDays: 1, startedAt: 0, budgetMs: 45_000, nowMs: () => 46_000 },
  )
  // This is the invariant the report send depends on: the pass returns instead of running long,
  // so processDueSchedules is reached on every invocation whatever the refresh backlog is.
  assertEquals(called, 0)
  assertEquals(result.refreshed, 0)
  assertEquals(result.skippedBudget, 2)
})

Deno.test('runGscRefreshPass reports counts a manual invocation can read back', async () => {
  const result = await runGscRefreshPass(
    [
      candidate('fresh', daysAgo(0.1)),
      candidate('revoked', daysAgo(50), { revokedAt: daysAgo(2) }),
      candidate('ok', daysAgo(5)),
      candidate('broken', daysAgo(6)),
    ],
    (c) => (c.projectId === 'broken' ? Promise.reject(new Error('Search Console 503')) : Promise.resolve()),
    { now: NOW, maxAgeDays: 1 },
  )
  assertEquals(result.candidates, 4)
  assertEquals(result.refreshed, 1)
  assertEquals(result.failed, 1)
  assertEquals(result.skipped, 2)
  assertEquals(result.skippedFresh, 1)
  assertEquals(result.skippedRevoked, 1)
  assertEquals(result.failures[0].kind, 'failed')
})

Deno.test('positiveNumberEnv: env tunables fall back on anything that is not a positive number', () => {
  assertEquals(positiveNumberEnv('7', 1), 7)
  assertEquals(positiveNumberEnv('0', 1), 1)
  assertEquals(positiveNumberEnv('-3', 1), 1)
  assertEquals(positiveNumberEnv('', 1), 1)
  assertEquals(positiveNumberEnv(undefined, 1), 1)
  assertEquals(positiveNumberEnv('abc', 45_000), 45_000)
})

Deno.test('matchProperty is unchanged by the move out of gsc-connect', () => {
  const props = [
    { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
    { siteUrl: 'https://www.other.com/', permissionLevel: 'siteFullUser' },
  ]
  assertEquals(matchProperty(props, 'https://www.example.com/pricing'), 'sc-domain:example.com')
  assertEquals(matchProperty(props, 'other.com'), 'https://www.other.com/')
  // No website, or no match: the first readable property.
  assertEquals(matchProperty(props, null), 'sc-domain:example.com')
  assertEquals(matchProperty(props, 'https://unrelated.io'), 'sc-domain:example.com')
  assertEquals(matchProperty([], 'https://example.com'), null)
})

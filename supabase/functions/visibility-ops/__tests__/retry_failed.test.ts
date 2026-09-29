/**
 * Cron retry of engine runs lost to a provider outage (deno).
 *
 * Run: deno test --no-check supabase/functions/visibility-ops/__tests__/retry_failed.test.ts
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { MAX_FAILED_PER_PAIR, pickRunsToRetry, type RunRow } from '../retry_failed.ts'

const run = (query_id: string, status: string, run_at: string, task_code: string | null = '40101'): RunRow => ({
  query_id, provider: 'google_aio', status, run_at, task_code,
})

Deno.test('a transient failure that is the latest run of its prompt is retried', () => {
  const picks = pickRunsToRetry([run('q1', 'failed', '2026-09-26T08:00:00Z')], 4)
  assertEquals(picks, [{ queryId: 'q1', provider: 'google_aio', failedAt: '2026-09-26T08:00:00Z' }])
  assertEquals(pickRunsToRetry([run('q1', 'failed', '2026-09-26T08:00:00Z', '50000')], 4).length, 1)
})

Deno.test('nothing to do once a later run completed, or for a non-transient failure', () => {
  assertEquals(pickRunsToRetry([
    run('q1', 'failed', '2026-09-26T08:00:00Z'),
    run('q1', 'completed', '2026-09-26T09:00:00Z', '20000'),
  ], 4), [])
  // "AI Overview shown but not loaded" (20000) and partial results (40106) are not outages.
  assertEquals(pickRunsToRetry([run('q2', 'failed', '2026-09-26T08:00:00Z', '20000'), run('q3', 'failed', '2026-09-26T08:00:00Z', '40106')], 4), [])
})

Deno.test('a pair that keeps failing is left for its next scheduled scan', () => {
  const rows = Array.from({ length: MAX_FAILED_PER_PAIR }, (_, i) => run('q1', 'failed', `2026-09-26T0${i}:00:00Z`))
  assertEquals(pickRunsToRetry(rows, 4), [])
  assertEquals(pickRunsToRetry(rows.slice(0, MAX_FAILED_PER_PAIR - 1), 4).length, 1)
})

Deno.test('oldest failures first, capped per tick', () => {
  const picks = pickRunsToRetry([
    run('q3', 'failed', '2026-09-26T10:00:00Z'),
    run('q1', 'failed', '2026-09-26T08:00:00Z'),
    run('q2', 'failed', '2026-09-26T09:00:00Z'),
  ], 2)
  assertEquals(picks.map((p) => p.queryId), ['q1', 'q2'])
  assertEquals(pickRunsToRetry([run('q1', 'failed', '2026-09-26T08:00:00Z')], 0), [])
})

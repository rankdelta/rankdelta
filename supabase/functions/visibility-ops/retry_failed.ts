/**
 * Which failed engine runs the cron should try again (pure; tested in __tests__/retry_failed.test.ts).
 *
 * A DataForSEO outage ("Internal SE Server Error", 50000 / 40101) fails both immediate attempts in
 * fetchProviderAnswer, and the prompt is not scanned again until its next cadence — on 26/09/26
 * every Google AI Overview run of the day was lost that way, leaving a hole in the client reports.
 * The cron now re-runs such failures on idle ticks, bounded so an outage cannot become a paid loop.
 */

/** DataForSEO task codes worth another try later (the same set llm_mentions retries at once). */
export const RETRYABLE_TASK_CODES = new Set([40101, 50000])
/** A prompt/engine pair that failed this often in the window is left for its next scheduled scan. */
export const MAX_FAILED_PER_PAIR = 3
export const RETRY_WINDOW_MS = 24 * 3600000

export type RunRow = {
  query_id: string
  provider: string
  status: string
  run_at: string
  /** raw_response->tasks->0->>status_code (DataForSEO), null for other engines. */
  task_code: string | number | null
}

export type RetryPick = { queryId: string; provider: string; failedAt: string }

/**
 * Latest run per (prompt, engine) in the window; keep it when it failed with a transient code and
 * the pair has not failed MAX_FAILED_PER_PAIR times yet. Oldest failures first.
 */
export function pickRunsToRetry(rows: RunRow[], max: number): RetryPick[] {
  const byPair = new Map<string, RunRow[]>()
  for (const r of rows) {
    const key = `${r.query_id}|${r.provider}`
    const list = byPair.get(key)
    if (list) list.push(r)
    else byPair.set(key, [r])
  }
  const picks: RetryPick[] = []
  for (const list of byPair.values()) {
    list.sort((a, b) => b.run_at.localeCompare(a.run_at))
    const latest = list[0]
    if (latest.status !== 'failed') continue
    if (!RETRYABLE_TASK_CODES.has(Number(latest.task_code))) continue
    if (list.filter((r) => r.status === 'failed').length >= MAX_FAILED_PER_PAIR) continue
    picks.push({ queryId: latest.query_id, provider: latest.provider, failedAt: latest.run_at })
  }
  return picks.sort((a, b) => a.failedAt.localeCompare(b.failedAt)).slice(0, Math.max(0, max))
}

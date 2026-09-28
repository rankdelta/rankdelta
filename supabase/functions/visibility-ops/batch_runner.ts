/**
 * Run paid per-item work (one live SERP check per keyword) a few at a time, within a time budget.
 *
 * Supabase ends an edge function at 150 s and MCP clients give up sooner (~60 s). One after the
 * other, 12 live SERP checks took 1.5–3 minutes: the request died with a 504 after the checks
 * that did finish were already paid for, the agent saw only an error, retried, and paid twice.
 * Now items start only while the budget lasts; the rest come back as `deferred` so the caller
 * can run them next time.
 *
 * Pure (no Deno APIs) so it can be unit-tested.
 */

export type BatchOutcome<R> = { results: R[]; deferred: string[] }

export async function runWithBudget<R>(
  ids: readonly string[],
  worker: (id: string) => Promise<R>,
  opts: {
    concurrency: number
    budgetMs: number
    /** Stop starting new items once a result says so (e.g. spend cap reached). */
    shouldStop?: (result: R) => boolean
    now?: () => number
  },
): Promise<BatchOutcome<R>> {
  const now = opts.now ?? (() => Date.now())
  const deadline = now() + opts.budgetMs
  const results: R[] = []
  const deferred: string[] = []
  let next = 0
  let stopped = false

  const lane = async () => {
    while (next < ids.length) {
      if (stopped || now() >= deadline) break
      const id = ids[next++]
      const result = await worker(id)
      results.push(result)
      if (opts.shouldStop?.(result)) stopped = true
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, ids.length)) }, lane))
  for (let i = next; i < ids.length; i++) deferred.push(ids[i])
  return { results, deferred }
}

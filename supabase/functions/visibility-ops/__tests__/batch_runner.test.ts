/**
 * runWithBudget (deno): paid per-keyword checks run a few at a time and stop starting new ones
 * when the time budget or the spend cap runs out, instead of timing out after paying.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { runWithBudget } from '../batch_runner.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

Deno.test('runs everything when there is time, never more than `concurrency` at once', async () => {
  let running = 0
  let peak = 0
  const out = await runWithBudget(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    async (id) => {
      running++
      peak = Math.max(peak, running)
      await sleep(5)
      running--
      return id
    },
    { concurrency: 3, budgetMs: 10_000 },
  )
  assertEquals(out.results.sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  assertEquals(out.deferred, [])
  assertEquals(peak, 3)
})

Deno.test('12 slow checks: parallel lanes finish in about a third of the sequential time', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => `k${i}`)
  const started = Date.now()
  const out = await runWithBudget(ids, async (id) => {
    await sleep(40)
    return id
  }, { concurrency: 4, budgetMs: 10_000 })
  const elapsed = Date.now() - started
  assertEquals(out.results.length, 12)
  assert(elapsed < 12 * 40, `took ${elapsed}ms, sequential would be ${12 * 40}ms`)
})

Deno.test('past the budget, the unstarted items are deferred (and never run)', async () => {
  let clock = 0
  const ran: string[] = []
  const out = await runWithBudget(
    ['a', 'b', 'c', 'd', 'e'],
    async (id) => {
      ran.push(id)
      clock += 30 // each check "takes" 30 s of the budget
      return id
    },
    { concurrency: 1, budgetMs: 45_000, now: () => clock * 1000 },
  )
  assertEquals(ran, ['a', 'b'])
  assertEquals(out.deferred, ['c', 'd', 'e'])
})

Deno.test('stops starting new items once a result says so (spend cap)', async () => {
  const out = await runWithBudget(
    ['a', 'b', 'c', 'd'],
    async (id) => ({ id, capReached: id === 'b' }),
    { concurrency: 1, budgetMs: 10_000, shouldStop: (r) => r.capReached },
  )
  assertEquals(out.results.map((r) => r.id), ['a', 'b'])
  assertEquals(out.deferred, ['c', 'd'])
})

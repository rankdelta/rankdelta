/**
 * Pure helpers behind the rankings story (report section and deck slide): the position buckets
 * in display order and the split of keyword movers into biggest wins / biggest drops.
 */
import type { RankingsSectionData } from './types'

export type RankMover = RankingsSectionData['topMovers'][number]

export type RankBucket = { key: string; label: string; opacity: number; page1: boolean; color?: string }

export const RANK_BUCKETS: RankBucket[] = [
  { key: '1', label: '#1', opacity: 1, page1: true },
  { key: '2-3', label: '#2–3', opacity: 0.75, page1: true },
  { key: '4-10', label: '#4–10', opacity: 0.5, page1: true },
  { key: '11-20', label: '#11–20', opacity: 0.25, page1: false },
  { key: '21+', label: '#21+', opacity: 0.12, page1: false },
]

/**
 * Buckets with counts, plus the keywords checked in the period that rank nowhere in the top 100
 * (rank null in `table`). The stored distribution only counts ranked keywords, so a report with
 * 12 tracked keywords and 2 ranking said "1 of 2 keywords on page 1 (50%)" instead of 1 of 12.
 */
export function rankDistributionCounts(
  rankings: Pick<RankingsSectionData, 'distribution'> & { table?: RankingsSectionData['table'] | null } | null | undefined,
  notInTop100Label: string,
): { buckets: Array<RankBucket & { count: number }>; total: number; page1: number } {
  const buckets = RANK_BUCKETS.map((b) => ({ ...b, count: Math.max(0, Number(rankings?.distribution?.[b.key] ?? 0) || 0) }))
  const table = Array.isArray(rankings?.table) ? rankings.table : []
  const unranked = table.filter((row) => row && (row.rank == null || row.rank <= 0)).length
  if (unranked > 0) buckets.push({ key: 'none', label: notInTop100Label, opacity: 1, page1: false, color: '#d4d4d8', count: unranked })
  const total = buckets.reduce((s, b) => s + b.count, 0)
  const page1 = buckets.filter((b) => b.page1).reduce((s, b) => s + b.count, 0)
  return { buckets, total, page1 }
}

/** Wins (positive delta = rank improved) and drops, each sorted by magnitude. */
export function splitMovers(movers: RankMover[] | null | undefined, limit = 5): { wins: RankMover[]; drops: RankMover[] } {
  const valid = (movers ?? []).filter((m) => m && typeof m.phrase === 'string' && typeof m.delta === 'number' && m.delta !== 0)
  const wins = valid.filter((m) => (m.delta ?? 0) > 0).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)).slice(0, limit)
  const drops = valid.filter((m) => (m.delta ?? 0) < 0).sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, limit)
  return { wins, drops }
}

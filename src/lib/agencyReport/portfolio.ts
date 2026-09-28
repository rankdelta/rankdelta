/** Portfolio triage helpers — which clients need a look first. */

import type { PortfolioClientTile } from '../../services/reportSchedules'

/** Clients whose AI share of voice or Google clicks fell vs the previous period. */
export function tileNeedsAttention(tile: Pick<PortfolioClientTile, 'aiSov' | 'gscClicks'>): boolean {
  return isDrop(tile.aiSov.delta) || isDrop(tile.gscClicks.delta)
}

function isDrop(delta: number | null | undefined): boolean {
  return delta != null && Number.isFinite(delta) && delta < 0
}

/**
 * Severity for the "needs attention" sort: the worst drop across AI share of voice (pp) and
 * clicks (%); null when nothing fell. Lower (more negative) means more urgent.
 */
export function attentionScore(tile: Pick<PortfolioClientTile, 'aiSov' | 'gscClicks'>): number | null {
  const drops = [tile.aiSov.delta, tile.gscClicks.delta].filter(isDrop) as number[]
  if (drops.length === 0) return null
  return Math.min(...drops)
}

/** Sort a portfolio so the biggest drops come first; clients with no drop keep their order after them. */
export function sortByAttention<T extends Pick<PortfolioClientTile, 'aiSov' | 'gscClicks'>>(tiles: T[]): T[] {
  return tiles
    .map((tile, index) => ({ tile, index, score: attentionScore(tile) }))
    .sort((a, b) => {
      if (a.score == null && b.score == null) return a.index - b.index
      if (a.score == null) return 1
      if (b.score == null) return -1
      return a.score - b.score || a.index - b.index
    })
    .map((entry) => entry.tile)
}

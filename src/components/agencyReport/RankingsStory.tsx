import { useTranslation } from 'react-i18next'
import { ArrowTrendingDownIcon, ArrowTrendingUpIcon } from '@heroicons/react/24/outline'
import { fmtDecimals, fmtPct, fmtWholeNumber } from '../../lib/agencyReport/reportUi'
import { rankDistributionCounts, splitMovers, type RankMover as Mover } from '../../lib/agencyReport/rankings'
import type { RankingsSectionData } from '../../lib/agencyReport/types'

export { splitMovers }

function rankLabel(v: number | null): string {
  return v != null ? `#${Number.isInteger(v) ? v : fmtDecimals(v, 1)}` : '—'
}

/**
 * Keyword movers told as a story: "biggest wins" and "biggest drops" side by side, each row with
 * the keyword, the previous → current position and the number of positions moved.
 */
export function RankMovers({ movers, limit = 5, title }: { movers: Mover[]; limit?: number; title?: string }) {
  const { t } = useTranslation()
  const { wins, drops } = splitMovers(movers, limit)
  if (wins.length === 0 && drops.length === 0) return null

  const column = (
    items: Mover[],
    kind: 'wins' | 'drops',
  ) => {
    const Icon = kind === 'wins' ? ArrowTrendingUpIcon : ArrowTrendingDownIcon
    const tone = kind === 'wins' ? 'text-emerald-700 bg-emerald-50' : 'text-red-600 bg-red-50'
    return (
      <div className="min-w-0" data-testid={`movers-${kind}`}>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
          <span className={`flex h-5 w-5 items-center justify-center rounded-md ${tone}`} aria-hidden>
            <Icon className="h-3.5 w-3.5" />
          </span>
          {t(kind === 'wins' ? 'agencyReport.story.biggestWins' : 'agencyReport.story.biggestDrops')}
        </p>
        {items.length === 0 ? (
          <p className="text-xs text-gray-400">{t(kind === 'wins' ? 'agencyReport.story.noWins' : 'agencyReport.story.noDrops')}</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {items.map((m) => {
              const delta = Math.round(Math.abs(m.delta ?? 0))
              return (
                <li key={m.phrase} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium text-gray-800" title={m.phrase}>
                    {m.phrase}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-gray-500">
                    {rankLabel(m.previousRank)} → <span className="font-semibold text-gray-800">{rankLabel(m.currentRank)}</span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${kind === 'wins' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
                    aria-label={t('agencyReport.story.positions', { count: delta })}
                  >
                    {kind === 'wins' ? '▲' : '▼'} {delta}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div>
      {title && <p className="mb-2 text-xs font-semibold text-gray-600">{title}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {column(wins, 'wins')}
        {column(drops, 'drops')}
      </div>
    </div>
  )
}

/**
 * Position distribution as one stacked bar (#1 → #21+) with a legend and the page-1 share —
 * readable at a glance and in print, unlike a donut with five unlabeled slices.
 */
export function RankDistributionBar({
  distribution,
  table,
  accentColor = '#7c3aed',
  title,
}: {
  distribution: Record<string, number>
  /** Every keyword checked in the period: the ones with no rank count as "not in top 100". */
  table?: RankingsSectionData['table'] | null
  accentColor?: string
  title?: string
}) {
  const { t } = useTranslation()
  const { buckets: counts, total, page1 } = rankDistributionCounts({ distribution, table }, t('agencyReport.story.notInTop100'))
  if (total === 0) return null

  return (
    <div data-testid="rank-distribution">
      {title && <p className="mb-2 text-xs font-semibold text-gray-600">{title}</p>}
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-gray-100" role="img" aria-label={t('agencyReport.story.distributionCaption', { page1, total, pct: fmtPct((page1 / total) * 100, 0) })}>
        {counts
          .filter((b) => b.count > 0)
          .map((b) => (
            <div
              key={b.key}
              className="h-full"
              style={{ width: `${(b.count / total) * 100}%`, backgroundColor: b.color ?? accentColor, opacity: b.opacity }}
              title={`${b.label}: ${b.count}`}
            />
          ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {counts.map((b) => (
          <span key={b.key} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: b.color ?? accentColor, opacity: b.opacity }} aria-hidden />
            <span className="font-medium text-gray-700">{b.label}</span>
            <span className="tabular-nums">
              {fmtWholeNumber(b.count)}
              <span className="text-gray-400"> · {fmtPct((b.count / total) * 100, 0)}</span>
            </span>
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {t('agencyReport.story.distributionCaption', { page1, total, pct: fmtPct((page1 / total) * 100, 0) })}
      </p>
    </div>
  )
}

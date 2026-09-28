import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { AppShell } from '../components/layout/AppShell'
import { useSubscription } from '../hooks/useSubscription'
import { useUpgradeModal } from '../components/subscription/UpgradeModal'
import { isAgencyPlan } from '../lib/agencyReport/gating'
import { fetchPortfolioRollup, type PortfolioClientTile } from '../services/reportSchedules'
import { LockClosedIcon } from '@heroicons/react/24/outline'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { DeltaChip } from '../components/agencyReport/reportPrimitives'
import { TableSkeleton } from '../components/ui/Skeletons'
import { fmtCompactNum, fmtPct } from '../lib/agencyReport/reportUi'
import { sortByAttention, tileNeedsAttention } from '../lib/agencyReport/portfolio'

type SortKey = 'projectName' | 'aiSov' | 'avgPosition' | 'gscClicks' | 'ga4Sessions' | 'healthScore' | 'attention'

function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return fmtCompactNum(v)
}

type CellFormat = 'num' | 'pct' | 'position'

function fmtCell(v: number | null | undefined, format: CellFormat): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (format === 'pct') return fmtPct(v)
  if (format === 'position') return `#${v.toFixed(1)}`
  return fmtNum(v)
}

function metricCell(
  metric: { value: number | null; delta: number | null },
  { invertDelta = false, format = 'num' as CellFormat } = {},
) {
  const positiveIsGood = !invertDelta
  // A flat zero on a zero value carries no signal (source not connected / no traffic) — keep the row quiet.
  const showDelta = metric.value != null && metric.delta != null && !(metric.value === 0 && metric.delta === 0)
  return (
    <div className="text-right">
      <div className="text-sm text-white font-medium tabular-nums">{fmtCell(metric.value, format)}</div>
      {showDelta && (
        <div className="mt-0.5 flex justify-end">
          <DeltaChip
            value={metric.delta}
            positiveIsGood={positiveIsGood}
            unit=""
            digits={metric.delta != null && Math.abs(metric.delta) >= 10 ? 0 : 1}
            className="!text-[11px]"
            onDark
          />
        </div>
      )}
    </div>
  )
}

export function PortfolioPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { subscription, currentPlan, isLoading: subscriptionLoading } = useSubscription()
  const { openForLockedFeature, UpgradeModal } = useUpgradeModal()

  const canPortfolio = isAgencyPlan(subscription, currentPlan)

  const [sortKey, setSortKey] = useState<SortKey>('projectName')
  const [sortAsc, setSortAsc] = useState(true)

  const { data: tiles = [], isLoading, error } = useQuery({
    queryKey: ['portfolio-rollup'],
    queryFn: fetchPortfolioRollup,
    enabled: canPortfolio,
  })

  const sorted = useMemo(() => {
    if (sortKey === 'attention') return sortByAttention(tiles)
    const copy = [...tiles]
    copy.sort((a, b) => {
      let av: string | number | null
      let bv: string | number | null
      if (sortKey === 'projectName') {
        av = a.projectName
        bv = b.projectName
      } else {
        av = a[sortKey]?.value ?? null
        bv = b[sortKey]?.value ?? null
      }
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      const na = Number(av)
      const nb = Number(bv)
      return sortAsc ? na - nb : nb - na
    })
    return copy
  }, [tiles, sortKey, sortAsc])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(key === 'projectName')
    }
  }

  const handleDrillThrough = (tile: PortfolioClientTile) => {
    if (tile.latestReportId) {
      navigate({ to: '/reports/portal/$reportId' as any, params: { reportId: tile.latestReportId } as any })
    } else {
      navigate({ to: '/reports/portal' as any, search: { project: tile.projectId } as any })
    }
  }

  if (subscriptionLoading) {
    return (
      <AppShell>
        <div className="max-w-4xl mx-auto px-4 py-16 flex justify-center">
          <LoadingSpinner text={t('agencyReport.portfolio.loading')} />
        </div>
      </AppShell>
    )
  }

  if (!canPortfolio) {
    return (
      <AppShell>
        <div className="max-w-4xl mx-auto px-4 py-8">
          <header className="mb-8">
            <h1 className="text-2xl font-bold text-white">{t('agencyReport.portfolio.title')}</h1>
            <p className="text-sm text-white/60 mt-1">{t('agencyReport.portfolio.subtitle')}</p>
          </header>
          <div className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/[0.12] to-fuchsia-500/[0.05] p-8 text-center">
            <LockClosedIcon className="mx-auto mb-4 h-10 w-10 text-violet-300" strokeWidth={1.5} aria-hidden />
            <p className="mx-auto mb-6 max-w-md text-base text-white/80">{t('agencyReport.portfolio.upsell')}</p>
            <button
              type="button"
              onClick={() => openForLockedFeature(t('agencyReport.portfolio.title'))}
              className="rounded-full bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              {t('agencyReport.portfolio.upgrade')}
            </button>
          </div>
        </div>
        <UpgradeModal />
      </AppShell>
    )
  }

  const attentionCount = tiles.filter(tileNeedsAttention).length

  const columns: Array<[SortKey, string]> = [
    ['projectName', t('agencyReport.portfolio.client')],
    ['aiSov', t('resultsPage.shareOfVoice')],
    ['avgPosition', t('resultsPage.avgPosition')],
    ['gscClicks', t('agencyReport.gscClicks')],
    ['ga4Sessions', t('agencyReport.ga4Sessions')],
    ['healthScore', t('resultsPage.healthLabel')],
  ]

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        <header className="mb-6 sm:mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-400/90 mb-1">
              {t('agencyReport.title')}
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('agencyReport.portfolio.title')}</h1>
            <p className="text-sm text-white/60 mt-1 max-w-xl">{t('agencyReport.portfolio.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tiles.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (sortKey === 'attention') {
                    setSortKey('projectName')
                    setSortAsc(true)
                  } else {
                    setSortKey('attention')
                    setSortAsc(true)
                  }
                }}
                aria-pressed={sortKey === 'attention'}
                title={t('agencyReport.portfolio.attentionHint')}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                  sortKey === 'attention'
                    ? 'border-amber-400/60 bg-amber-500/15 text-amber-100'
                    : 'border-white/15 text-white/80 hover:bg-white/10'
                }`}
              >
                <span aria-hidden className="h-2 w-2 rounded-full bg-amber-400" />
                {t('agencyReport.portfolio.attentionSort')}
                {attentionCount > 0 && (
                  <span className="rounded-full bg-white/10 px-1.5 text-xs tabular-nums text-white/80">{attentionCount}</span>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate({ to: '/reports/portal' as any })}
              className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              {t('agencyReport.backToBuilder')}
            </button>
          </div>
        </header>

        {isLoading ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6" aria-busy="true" aria-label={t('agencyReport.portfolio.loading')}>
            <TableSkeleton rows={8} cols={6} />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-6 py-8 text-center" role="alert">
            <p className="text-sm text-red-300">{t('agencyReport.portfolio.error')}</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-12 text-center">
            <p className="text-sm text-white/50">{t('agencyReport.portfolio.empty')}</p>
            <button
              type="button"
              onClick={() => navigate({ to: '/reports/portal' as any })}
              className="mt-4 rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              {t('agencyReport.buildReport')}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10 shadow-lg shadow-black/20">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.04]">
                  {columns.map(([key, label]) => (
                    <th key={key} className="px-3 sm:px-4 py-3" aria-sort={sortKey === key ? (sortAsc ? 'ascending' : 'descending') : 'none'}>
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        className="text-xs font-semibold uppercase tracking-wide text-white/60 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded px-1 -mx-1"
                      >
                        {label}
                        {sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((tile, i) => {
                  const attention = tileNeedsAttention(tile)
                  return (
                  <tr
                    key={tile.projectId}
                    title={attention ? t('agencyReport.portfolio.attentionRow') : undefined}
                    className={`border-b border-white/5 hover:bg-white/[0.05] cursor-pointer focus-within:bg-white/[0.06] ${
                      attention
                        ? 'bg-amber-500/[0.06] shadow-[inset_3px_0_0_0_theme(colors.amber.400)]'
                        : i % 2 === 1
                          ? 'bg-white/[0.015]'
                          : ''
                    }`}
                    onClick={() => handleDrillThrough(tile)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleDrillThrough(tile)
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={tile.projectName}
                  >
                    <td className="px-3 sm:px-4 py-3 sm:py-4">
                      <div className="text-sm font-medium text-white">{tile.projectName}</div>
                      {tile.websiteUrl && (
                        <div className="text-xs text-white/40 truncate max-w-[180px] sm:max-w-[220px]">
                          {tile.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </div>
                      )}
                    </td>
                    <td className="px-3 sm:px-4 py-3 sm:py-4">{metricCell(tile.aiSov, { format: 'pct' })}</td>
                    <td className="px-3 sm:px-4 py-3 sm:py-4">{metricCell(tile.avgPosition, { invertDelta: true, format: 'position' })}</td>
                    <td className="px-3 sm:px-4 py-3 sm:py-4">{metricCell(tile.gscClicks)}</td>
                    <td className="px-3 sm:px-4 py-3 sm:py-4">{metricCell(tile.ga4Sessions)}</td>
                    <td className="px-3 sm:px-4 py-3 sm:py-4">{metricCell(tile.healthScore)}</td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <UpgradeModal />
    </AppShell>
  )
}

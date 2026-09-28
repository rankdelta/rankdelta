import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeftIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import {
  HISTORY_FAMILIES,
  HISTORY_TABLE_KEYS,
  historyMovement,
  historyNeighbours,
  type HistoryMetricKey,
  type ReportHistoryPoint,
} from '../../lib/agencyReport/history'
import { fmtAxisDate, fmtPct, fmtPeriodRange, fmtPosition, fmtWholeNumber } from '../../lib/agencyReport/reportUi'
import { DeltaChip } from './reportPrimitives'
import { NivoLineChart } from './lazyCharts'

const METRIC_LABEL_KEYS: Record<HistoryMetricKey, string> = {
  aiSov: 'agencyReport.shareOfVoice',
  citationRate: 'agencyReport.citationRate',
  gscClicks: 'agencyReport.gscClicks',
  gscImpressions: 'agencyReport.impressions',
  avgPosition: 'resultsPage.avgPosition',
  ga4Sessions: 'agencyReport.ga4Sessions',
  aiSessions: 'agencyReport.aiSessions',
  healthScore: 'resultsPage.healthLabel',
  referringDomains: 'agencyReport.referringDomains',
}

const POSITIVE_IS_GOOD: Record<HistoryMetricKey, boolean> = {
  aiSov: true,
  citationRate: true,
  gscClicks: true,
  gscImpressions: true,
  avgPosition: false,
  ga4Sessions: true,
  aiSessions: true,
  healthScore: true,
  referringDomains: true,
}

/** Locale-aware value for one history metric ("14,3%", "#8,5", "1.530"). */
export function fmtHistoryValue(key: HistoryMetricKey, v: number | null): string {
  if (v == null) return '—'
  if (key === 'aiSov' || key === 'citationRate') return fmtPct(v)
  if (key === 'avgPosition') return fmtPosition(v)
  return fmtWholeNumber(v)
}

/** Decimals on a movement chip: percentages and positions keep one, counts none. */
export function historyChipDigits(key: HistoryMetricKey): number {
  return key === 'aiSov' || key === 'citationRate' || key === 'avgPosition' ? 1 : 0
}

function reportLocale(language: string): string {
  return language.startsWith('it') ? 'it-IT' : 'en-US'
}

interface ReportPeriodNavigatorProps {
  history: ReportHistoryPoint[] | null | undefined
  currentReportId: string
  compareWithPrevious: boolean
  onCompareChange: (next: boolean) => void
  onNavigate: (reportId: string) => void
}

/**
 * "← Previous report · 17 Aug – 15 Sep 2026 · Next report →" — jumps between the reports of the
 * same client, plus the switch that re-bases the scorecard on the previous report. In-app only
 * (dark chrome); with a single report it says when the history will appear.
 */
export function ReportPeriodNavigator({ history, currentReportId, compareWithPrevious, onCompareChange, onNavigate }: ReportPeriodNavigatorProps) {
  const { t, i18n } = useTranslation()
  const locale = reportLocale(i18n.language)
  if (!history) return null

  if (history.length < 2) {
    return (
      <p data-testid="report-period-navigator" className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/60">
        {t('agencyReport.history.single')}
      </p>
    )
  }

  const { index, previous, next } = historyNeighbours(history, currentReportId)
  const current = history[index]
  if (!current) return null
  const period = (p: ReportHistoryPoint) => fmtPeriodRange(p.periodStart, p.periodEnd, locale)
  const buttonClass =
    'inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent'

  return (
    <nav
      aria-label={t('agencyReport.history.navigatorLabel')}
      data-testid="report-period-navigator"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 sm:px-4"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
        <button
          type="button"
          className={buttonClass}
          disabled={!previous}
          onClick={() => previous && onNavigate(previous.reportId)}
          title={previous ? period(previous) : undefined}
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" aria-hidden /> {t('agencyReport.history.previousReport')}
        </button>
        <p className="min-w-0 text-sm text-white/80">
          <span className="font-semibold text-white">{period(current)}</span>
          <span className="text-white/60"> · {t('agencyReport.history.position', { index: index + 1, count: history.length })}</span>
        </p>
        <button
          type="button"
          className={buttonClass}
          disabled={!next}
          onClick={() => next && onNavigate(next.reportId)}
          title={next ? period(next) : undefined}
        >
          {t('agencyReport.history.nextReport')} <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <label className={`flex items-center gap-2 text-xs ${previous ? 'cursor-pointer text-white/70' : 'text-white/60'}`}>
        <input
          type="checkbox"
          role="switch"
          className="h-3.5 w-3.5 accent-violet-500"
          checked={compareWithPrevious && !!previous}
          disabled={!previous}
          onChange={(e) => onCompareChange(e.target.checked)}
        />
        <span>{t('agencyReport.history.compareToggle')}</span>
        {!previous && <span className="text-white/60">· {t('agencyReport.history.firstReport')}</span>}
      </label>
    </nav>
  )
}

interface ReportHistoryBlockProps {
  history: ReportHistoryPoint[]
  currentReportId: string
  accentColor?: string
  /** Override the default title (widget rename). */
  title?: string
}

/**
 * "Trend across reports": one point per report for each KPI family (AI share of voice, clicks,
 * sessions, site health) and a compact report-by-report table with movement chips. A trend needs
 * two reports: with fewer the block renders nothing (callers hide it through `widgetDataState`,
 * this is the last line of defence so the client never sees an empty "trend" card).
 */
export function ReportHistoryBlock({ history, currentReportId, accentColor, title }: ReportHistoryBlockProps) {
  const { t, i18n } = useTranslation()
  const locale = reportLocale(i18n.language)
  const heading = title ?? t('agencyReport.history.title')
  const label = (key: HistoryMetricKey) => t(METRIC_LABEL_KEYS[key])

  // Client-side range focus (3 / 6 / 12 / all). Default = all so first paint and PDF show the
  // full history; the control is hidden in print. Only offer a threshold that actually trims.
  const [rangeN, setRangeN] = useState<number | null>(null)
  const availableRanges = [3, 6, 12].filter((n) => history.length > n)
  const shown = useMemo(() => (rangeN ? history.slice(-rangeN) : history), [history, rangeN])

  const families = useMemo(() => {
    const count = (key: HistoryMetricKey) => shown.filter((p) => p[key] != null).length
    return HISTORY_FAMILIES.flatMap((family) => {
      const lead = family.keys[0]!
      if (count(lead) < 2) return []
      const keys = family.keys.filter((key, i) => i === 0 || count(key) >= 2)
      const rows = shown
        .filter((p) => p[lead] != null)
        .map((p) => {
          const row: Record<string, unknown> = { date: fmtAxisDate(p.periodEnd, locale) }
          for (const key of keys) row[key] = p[key]
          return row
        })
      return [{ id: family.id, lead, keys, rows, movement: historyMovement(shown, lead) }]
    })
  }, [shown, locale])

  const summary = useMemo(() => {
    const first = families.find((f) => f.movement)
    if (!first?.movement) return null
    const mv = first.movement
    // "from 27.4% to 27.4%; best period …" reads like a glitch when nothing moved.
    if (mv.direction === 'flat') {
      return t('agencyReport.history.summaryFlat', {
        label: label(mv.key),
        value: fmtHistoryValue(mv.key, mv.last[mv.key]),
        first: fmtPeriodRange(mv.first.periodStart, mv.first.periodEnd, locale),
      })
    }
    return t('agencyReport.history.summary', {
      label: label(mv.key),
      from: fmtHistoryValue(mv.key, mv.first[mv.key]),
      to: fmtHistoryValue(mv.key, mv.last[mv.key]),
      first: fmtPeriodRange(mv.first.periodStart, mv.first.periodEnd, locale),
      best: fmtPeriodRange(mv.best.periodStart, mv.best.periodEnd, locale),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [families, locale, t])

  const seriesLabels = useMemo(
    () => Object.fromEntries((Object.keys(METRIC_LABEL_KEYS) as HistoryMetricKey[]).map((key) => [key, label(key)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  )

  if (history.length < 2) return null

  return (
    <section
      aria-label={heading}
      data-testid="report-history"
      className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 print:border-gray-300 break-inside-avoid-page"
      style={{ borderTopWidth: 4, borderTopColor: accentColor ?? 'var(--report-accent, #7c3aed)' }}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900">{heading}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{t('agencyReport.history.subtitle', { count: shown.length })}</p>
        </div>
        {availableRanges.length > 0 && (
          <div
            className="print:hidden flex shrink-0 items-center gap-1 rounded-full border border-gray-200 p-0.5"
            role="group"
            aria-label={t('agencyReport.history.rangeLabel')}
          >
            {availableRanges.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRangeN(n)}
                aria-pressed={rangeN === n}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${rangeN === n ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'}`}
              >
                {t('agencyReport.history.rangeLast', { count: n })}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setRangeN(null)}
              aria-pressed={rangeN === null}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${rangeN === null ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'}`}
            >
              {t('agencyReport.history.rangeAll')}
            </button>
          </div>
        )}
      </div>

      {summary && <p className="mb-4 text-sm leading-relaxed text-gray-700">{summary}</p>}

      {families.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {families.map((family) => (
            <div key={family.id} className="rounded-xl border border-gray-100 p-3" data-testid={`history-chart-${family.id}`}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold text-gray-600">{t(`agencyReport.history.families.${family.id}`)}</p>
                {family.movement && (
                  <DeltaChip
                    value={family.movement.delta}
                    positiveIsGood={family.movement.positiveIsGood}
                    unit=""
                    digits={historyChipDigits(family.lead)}
                  />
                )}
              </div>
              <NivoLineChart
                data={family.rows}
                indexKey="date"
                valueKeys={family.keys}
                seriesLabels={seriesLabels}
                height={140}
                maxBottomTicks={6}
                showPoints
              />
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 overflow-x-auto">
        <p className="mb-2 text-xs font-semibold text-gray-600">{t('agencyReport.history.tableTitle')}</p>
        <table className="w-full text-sm" data-testid="history-table">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="py-1 pr-2 font-medium">{t('agencyReport.history.period')}</th>
              {HISTORY_TABLE_KEYS.map((key) => (
                <th key={key} className="py-1 pl-2 text-right font-medium">{label(key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((point, i) => {
              const previous = shown[i - 1]
              const isCurrent = point.reportId === currentReportId
              return (
                <tr key={point.reportId} className={`border-t border-gray-100 ${isCurrent ? 'bg-gray-50 font-semibold' : ''}`} data-current={isCurrent || undefined}>
                  <td className="whitespace-nowrap py-2 pr-2 text-gray-800">
                    {fmtPeriodRange(point.periodStart, point.periodEnd, locale)}
                    {isCurrent && (
                      <span className="ml-1.5 rounded-full bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white">{t('agencyReport.history.current')}</span>
                    )}
                  </td>
                  {HISTORY_TABLE_KEYS.map((key) => {
                    const value = point[key]
                    const prev = previous?.[key]
                    const delta = value != null && prev != null ? value - prev : null
                    return (
                      <td key={key} className="whitespace-nowrap py-2 pl-2 text-right tabular-nums text-gray-800">
                        <span>{fmtHistoryValue(key, value)}</span>
                        {delta != null && (
                          <DeltaChip value={delta} positiveIsGood={POSITIVE_IS_GOOD[key]} unit="" digits={historyChipDigits(key)} className="ml-1.5" />
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

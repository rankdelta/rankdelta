import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { SectionKey } from '../../lib/agencyReport/sections'
import { evaluateGoalRag, goalProgressRatio } from '../../lib/agencyReport/goals'
import { fmtDecimals, hasBaseline } from '../../lib/agencyReport/reportUi'
import { Sparkline } from './Sparkline'
import {
  ChartBarIcon,
  ChartPieIcon,
  CursorArrowRaysIcon,
  GlobeAltIcon,
  InformationCircleIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  PresentationChartLineIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'

export function DeltaChip({
  value,
  positiveIsGood = true,
  unit = 'pp',
  digits = 1,
  className = '',
  onDark = false,
}: {
  value: number | null | undefined
  positiveIsGood?: boolean
  unit?: string
  digits?: number
  className?: string
  onDark?: boolean
}) {
  if (value == null) return <span className={`text-xs tabular-nums ${onDark ? 'text-white/40' : 'text-gray-400'}`} aria-hidden>—</span>
  const flat = Math.abs(value) < (digits === 0 ? 0.5 : 0.05)
  const good = positiveIsGood ? value > 0 : value < 0
  // A flat reading is "±0", not a mystery glyph next to a zero.
  const arrow = flat ? '±' : good ? '▲' : '▼'
  const cls = flat
    ? onDark ? 'text-white/40' : 'text-gray-400'
    : good
      ? onDark ? 'text-emerald-400' : 'text-emerald-600'
      : onDark ? 'text-red-400' : 'text-red-500'
  const mag = fmtDecimals(Math.abs(value), digits)
  const sign = flat ? '' : value > 0 ? '+' : value < 0 ? '-' : ''
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${cls} ${className}`}
      aria-label={`${sign}${mag}${unit ? ` ${unit}` : ''}`}
    >
      <span aria-hidden>{arrow}</span>
      <span>{sign}{mag}{unit ? `\u00a0${unit}` : ''}</span>
    </span>
  )
}

export function GoalRagBadge({
  rag,
  target,
  label,
}: {
  rag: 'green' | 'amber' | 'red' | 'none'
  target?: number | null
  label: string
}) {
  if (rag === 'none' || target == null) return null
  const cls =
    rag === 'green'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : rag === 'amber'
        ? 'bg-amber-100 text-amber-800 border-amber-200'
        : 'bg-red-100 text-red-800 border-red-200'
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
      title={`${label}: ${target}`}
    >
      {label}
    </span>
  )
}

/**
 * Slim progress bar toward a KPI target, coloured by the same RAG status as the badge.
 * `caption` is the already-localised "72% of 80" text shown at the end of the bar.
 */
export function GoalProgressBar({
  rag,
  ratio,
  caption,
  className = '',
}: {
  rag: 'green' | 'amber' | 'red' | 'none'
  ratio: number | null
  caption: string
  className?: string
}) {
  if (rag === 'none' || ratio == null) return null
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100)
  const fill = rag === 'green' ? 'bg-emerald-500' : rag === 'amber' ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={caption}
      data-testid="goal-progress"
    >
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 print:bg-gray-200">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-[10px] font-medium tabular-nums text-gray-500">{caption}</span>
    </div>
  )
}

export function ConnectPrompt({
  message,
  actionLabel,
  onAction,
  compact = false,
}: {
  message: string
  actionLabel?: string
  onAction?: () => void
  /** Subtle single-line note (connected source, nothing to show this period). */
  compact?: boolean
}) {
  return (
    <div
      className={`rounded-xl border border-dashed border-gray-200 bg-gray-50/80 text-center ${compact ? 'px-3 py-3' : 'px-4 py-5'}`}
      role="status"
    >
      <p className={compact ? 'text-xs text-gray-400' : 'text-sm text-gray-500'}>{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-3 inline-flex rounded-full border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-violet-500"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

/**
 * Guidance for a source that is connected but produced nothing this period — replaces a row of
 * bare zeros with a sentence the client can act on, plus the timestamp the data was checked.
 */
export function EmptyStateNote({ message, meta }: { message: string; meta?: string | null }) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3 print:bg-gray-50"
      role="status"
      data-testid="empty-state-note"
    >
      <InformationCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm leading-relaxed text-gray-600">{message}</p>
        {meta && <p className="mt-0.5 text-xs text-gray-400">{meta}</p>}
      </div>
    </div>
  )
}

export function NarrativeBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 break-inside-avoid-page">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <div className="mt-2 text-sm leading-relaxed text-gray-700">{children}</div>
    </div>
  )
}

export const SECTION_ICONS: Record<SectionKey | 'next-actions', typeof ChartBarIcon> = {
  summary: PresentationChartLineIcon,
  geo: SparklesIcon,
  ai_attribution: CursorArrowRaysIcon,
  rankings: MagnifyingGlassIcon,
  gsc: GlobeAltIcon,
  ga4: ChartBarIcon,
  site_health: ShieldCheckIcon,
  backlinks: LinkIcon,
  'next-actions': ChartPieIcon,
}

/** Divider-style section heading used by `section_header` layout widgets. */
export function SectionHeaderRow({ section, title }: { section: SectionKey; title: string }) {
  const Icon = SECTION_ICONS[section]
  return (
    <div className="flex items-center gap-2.5 pt-2 pb-1">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 print:bg-gray-50" aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <div className="h-px flex-1 bg-gray-200" />
    </div>
  )
}

export function SectionShell({
  id,
  title,
  description,
  children,
  iconKey,
}: {
  id: string
  title: string
  description?: string | null
  children: ReactNode
  iconKey?: SectionKey | 'next-actions'
}) {
  const Icon = iconKey ? SECTION_ICONS[iconKey] : null
  return (
    <section
      id={id}
      className="agency-report-section pdf-export-group mt-8 break-inside-avoid-page print:break-after-auto"
      aria-labelledby={`${id}-heading`}
    >
      <div className="mb-4 border-b border-gray-200 pb-3">
        <div className="flex items-start gap-2.5">
          {Icon && (
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 print:bg-gray-50" aria-hidden>
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-heading`} className="text-sm font-semibold text-gray-900">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{description}</p>}
          </div>
        </div>
      </div>
      {children}
    </section>
  )
}

export function ReportDataTable<T>({
  columns,
  rows,
  getRowKey,
}: {
  columns: Array<{
    key: string
    header: string
    align?: 'left' | 'right'
    render: (row: T, index: number) => ReactNode
  }>
  rows: T[]
  getRowKey: (row: T, index: number) => string
}) {
  if (rows.length === 0) return null
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50/80 text-xs text-gray-500">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`px-3 py-2 font-semibold ${col.align === 'right' ? 'text-right' : 'text-left'}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={getRowKey(row, i)}
              className={`border-t border-gray-100 ${i % 2 === 1 ? 'bg-gray-50/50' : 'bg-white'}`}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 py-2 ${col.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}
                >
                  {col.render(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ScorecardKpi({
  label,
  value,
  metric,
  positiveIsGood = true,
  target,
  targetLabel,
  targetDisplay,
  accentColor,
  trend,
  vsReport,
}: {
  label: string
  value: string
  metric: { delta: number | null; value: number | null; deltaPct?: number | null }
  positiveIsGood?: boolean
  target?: number | null
  targetLabel?: string
  /** Target formatted like `value` (e.g. "1.5k", "#5"); falls back to the raw number. */
  targetDisplay?: string
  accentColor?: string
  /** Daily values behind the KPI; drawn as an inline sparkline when there are at least two points. */
  trend?: ReadonlyArray<number | null | undefined> | null
  /** Movement against the previous *report* (not the previous period), shown as a second chip row. */
  vsReport?: { delta: number; label: string; digits?: number } | null
}) {
  const { t } = useTranslation()
  const rag = evaluateGoalRag({ value: metric.value, target, higherIsBetter: positiveIsGood })
  const progress = goalProgressRatio({ value: metric.value, target, higherIsBetter: positiveIsGood })
  const showDelta = hasBaseline({ value: metric.value, delta: metric.delta, deltaPct: metric.deltaPct ?? null })

  return (
    <div
      className="h-full rounded-xl border border-gray-200 bg-white p-3 shadow-sm print:shadow-none focus-within:ring-2 focus-within:ring-offset-1 focus-within:ring-violet-400"
      style={{ borderTopColor: accentColor, borderTopWidth: 3 }}
      tabIndex={0}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 truncate">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900 tabular-nums">{value}</p>
      {metric.value != null && (showDelta || (rag !== 'none' && target != null)) && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {showDelta && metric.delta != null && (
            <DeltaChip value={metric.delta} positiveIsGood={positiveIsGood} unit="" digits={Math.abs(metric.delta) >= 10 ? 0 : 1} />
          )}
          <GoalRagBadge rag={rag} target={target} label={targetLabel ?? 'Goal'} />
        </div>
      )}
      {target != null && (
        <GoalProgressBar
          rag={rag}
          ratio={progress}
          caption={t('agencyReport.goalProgress', {
            pct: Math.round((progress ?? 0) * 100),
            target: targetDisplay ?? String(target),
          })}
          className="mt-2"
        />
      )}
      {metric.value != null && vsReport && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5" data-testid="scorecard-vs-report">
          <DeltaChip value={vsReport.delta} positiveIsGood={positiveIsGood} unit="" digits={vsReport.digits ?? (Math.abs(vsReport.delta) >= 10 ? 0 : 1)} />
          <span className="text-[10px] text-gray-500">{vsReport.label}</span>
        </div>
      )}
      {metric.value != null && <Sparkline values={trend} className="mt-2 h-8 w-full" color={accentColor} />}
    </div>
  )
}

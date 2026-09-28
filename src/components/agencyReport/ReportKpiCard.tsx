import { Card, Metric, Text } from '@tremor/react'
import { useTranslation } from 'react-i18next'
import type { MetricWithDelta } from '../../lib/reportBuild/math'
import { evaluateGoalRag, goalProgressRatio } from '../../lib/agencyReport/goals'
import { hasBaseline } from '../../lib/agencyReport/reportUi'
import { DeltaChip, GoalProgressBar, GoalRagBadge } from './reportPrimitives'
import { Sparkline } from './Sparkline'

export function ReportKpiCard({
  label,
  metric,
  format,
  positiveIsGood = true,
  target,
  targetLabel,
  trend,
  vsReport,
  deltaUnit,
  deltaDigits,
  note,
}: {
  label: string
  metric: MetricWithDelta
  format?: (v: number | null) => string
  positiveIsGood?: boolean
  target?: number | null
  targetLabel?: string
  /**
   * Unit of the period-over-period chip: 'pt' for percentages (share of voice, CTR), '' for counts
   * and positions. Defaults to '' — a "+1,234 pp" chip next to a click count is wrong.
   */
  deltaUnit?: 'pt' | ''
  /** Decimals on the chip; defaults to none for large moves, one otherwise. */
  deltaDigits?: number
  /** Daily values behind the KPI; drawn as an inline sparkline when there are at least two points. */
  trend?: ReadonlyArray<number | null | undefined> | null
  /** Movement against the previous *report* (not the previous period), shown as a second chip row. */
  vsReport?: { delta: number; label: string; digits?: number } | null
  /** Small print under the value, e.g. the date of the audit a score comes from. */
  note?: string | null
}) {
  const { t } = useTranslation()
  const display = format ? format(metric.value) : metric.value != null ? String(metric.value) : '—'
  const rag = evaluateGoalRag({ value: metric.value, target, higherIsBetter: positiveIsGood })
  const progress = goalProgressRatio({ value: metric.value, target, higherIsBetter: positiveIsGood })
  const showDelta = hasBaseline(metric)
  const showMeta = metric.value != null && (showDelta || (rag !== 'none' && target != null))

  return (
    <Card className="h-full rounded-xl ring-1 ring-gray-200 shadow-none">
      <Text className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</Text>
      <Metric className="mt-1 text-2xl font-bold text-gray-900 tabular-nums">{display}</Metric>
      {showMeta && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {showDelta && (
            <DeltaChip
              value={metric.delta}
              positiveIsGood={positiveIsGood}
              unit={deltaUnit ?? ''}
              digits={deltaDigits ?? (Math.abs(metric.delta ?? 0) >= 10 ? 0 : 1)}
            />
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
            target: format ? format(target) : String(target),
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
      {metric.value != null && <Sparkline values={trend} className="mt-2 h-10 w-full" />}
      {note && <Text className="mt-1.5 text-[11px] text-gray-400">{note}</Text>}
    </Card>
  )
}

/**
 * Stored report snapshots, read as the build writes them today.
 *
 * Reports built before 15/09/26 stored `summary.aiSov` and `summary.avgPosition` with `delta: 0`
 * on a first reading, while the geo and rankings sections carried the first-reading shape: the
 * scorecard showed "±0.0" next to a hero saying "first reading — comparison from the next report".
 * The build now copies the section metrics into the summary (buildCorrectedReportSummary in
 * supabase/functions/_shared/reportSummary.ts); this applies the same rule when an old snapshot
 * is loaded, so every view, the deck and the PDF agree.
 */
import type { MetricWithDelta } from '../reportBuild/math'
import { cleanStoredNarrative } from '../../../supabase/functions/_shared/reportBuild'

function sectionMetric(section: unknown, field: string): MetricWithDelta | null {
  if (!section || typeof section !== 'object') return null
  const m = (section as Record<string, unknown>)[field]
  if (!m || typeof m !== 'object' || !('value' in m)) return null
  const metric = m as MetricWithDelta
  return metric.value == null ? null : metric
}

export function withSectionSummary<T extends { data?: unknown }>(report: T): T {
  const data = report.data
  if (!data || typeof data !== 'object') return report
  const d = data as Record<string, unknown>
  const summary = d['summary']
  if (!summary || typeof summary !== 'object') return report
  const aiSov = sectionMetric(d['geo'], 'sovOverall')
  const avgPosition = sectionMetric(d['rankings'], 'avgPosition')
  if (!aiSov && !avgPosition) return report
  return {
    ...report,
    data: {
      ...d,
      summary: {
        ...(summary as Record<string, unknown>),
        ...(aiSov ? { aiSov } : {}),
        ...(avgPosition ? { avgPosition } : {}),
      },
    },
  }
}

/**
 * The stored AI narrative, as the build would write it today. Reports built before the build-side
 * fixes still carry (a) the model's raw ```json { "executiveSummary": … } ``` completion as the
 * summary, shown verbatim to the client, and (b) sentences about the reporting tool ("request AI
 * Overviews tracking", "this engine shows null data"). Same parser and filter as the build.
 */
export function withCleanNarrative<T extends { narrative?: unknown }>(report: T): T {
  const stored = report.narrative
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return report
  return { ...report, narrative: cleanStoredNarrative(stored as Record<string, unknown>) }
}

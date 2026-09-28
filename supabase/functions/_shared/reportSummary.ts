/**
 * Summary rollup corrections for assembled report data.
 * Workaround for buildReportSummary passing metric deltas as previous values.
 * Root fix belongs in reportBuild.ts when editable.
 */

import { buildReportSummary, readMetric } from './reportBuild.ts'

/** Apply buildReportSummary then correct aiSov/avgPosition from source sections. */
export function buildCorrectedReportSummary(
  data: Record<string, unknown>,
  geoSection: Record<string, unknown> | null,
): Record<string, unknown> {
  const raw = buildReportSummary(data, geoSection)
  const geoSov = geoSection ? readMetric(geoSection, 'sovOverall') : null
  const rankingsAvg = readMetric(data['rankings'], 'avgPosition')
  return {
    ...raw,
    ...(geoSov ? { aiSov: geoSov } : {}),
    ...(rankingsAvg ? { avgPosition: rankingsAvg } : {}),
  }
}

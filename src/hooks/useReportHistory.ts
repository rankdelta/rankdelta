import { useQuery } from '@tanstack/react-query'
import { buildReportHistory, type ReportHistoryPoint } from '../lib/agencyReport/history'
import { fetchClientReportHistoryRows } from '../services/reportBuild'

export const REPORT_HISTORY_QUERY_KEY = 'report-history'

/**
 * Headline numbers of every report of a project, one point per period (latest build wins),
 * oldest first, at most 12. Fetches only the summary block and three section fields — never the
 * full data blobs — so a client with a year of reports costs one small request.
 */
export function useReportHistory(projectId: string | null | undefined) {
  return useQuery<ReportHistoryPoint[]>({
    queryKey: [REPORT_HISTORY_QUERY_KEY, projectId],
    queryFn: async () => buildReportHistory(await fetchClientReportHistoryRows(projectId!)),
    enabled: !!projectId,
    staleTime: 60_000,
  })
}

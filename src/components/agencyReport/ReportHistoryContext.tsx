import { createContext, useContext, type ReactNode } from 'react'
import type { ReportHistoryPoint } from '../../lib/agencyReport/history'

export interface ReportHistoryContextValue {
  /** History points fetched in-app for the report's project; null = unknown (public page). */
  history: ReportHistoryPoint[] | null
  /** Scorecard tiles also show the movement against the previous report. */
  compareWithPrevious: boolean
}

const ReportHistoryContext = createContext<ReportHistoryContextValue>({ history: null, compareWithPrevious: false })

export function ReportHistoryProvider({ value, children }: { value: ReportHistoryContextValue; children: ReactNode }) {
  return <ReportHistoryContext.Provider value={value}>{children}</ReportHistoryContext.Provider>
}

export function useReportHistoryContext(): ReportHistoryContextValue {
  return useContext(ReportHistoryContext)
}

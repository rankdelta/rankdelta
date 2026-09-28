import type { MetricWithDelta } from '../reportBuild/math'
import type { ReportNarrative } from '../reportBuild/narrative'
import type { WhiteLabelReportBranding } from '../whiteLabelReport'
import type { ReportLayout } from './layout'
import type { ReportHistoryPoint } from './history'
import type { SectionKey, NullSectionShape } from './sections'

export interface ReportGoals {
  healthScore?: number | null
  aiSov?: number | null
  avgPosition?: number | null
  gscClicks?: number | null
  ga4Sessions?: number | null
  ga4AiAssistantSessions?: number | null
}

export interface GscAiOverviewRow {
  query: string
  impressions?: number | null
  clicks?: number | null
  ctr?: number | null
  position?: number | null
}

export interface ReportAnnotation {
  section: SectionKey | 'summary'
  text: string
}

export interface ClientReportSnapshot {
  id: string
  project_id: string
  period_start: string
  period_end: string
  sections: SectionKey[]
  data: ReportData
  narrative: ReportNarrative | null
  branding: WhiteLabelReportBranding | null
  goals: ReportGoals | null
  layout?: ReportLayout | null
  created_at: string
  share_token?: string | null
  project_name?: string | null
  website_url?: string | null
}

export interface ReportSummaryKpis {
  healthScore: MetricWithDelta
  aiSov: MetricWithDelta
  avgPosition: MetricWithDelta
  gscClicks: MetricWithDelta
  ga4Sessions: MetricWithDelta
  ga4AiAssistantSessions: MetricWithDelta
  keyEvents: MetricWithDelta
}

export interface ReportData {
  meta?: {
    periodStart?: string
    periodEnd?: string
    builtAt?: string
    locale?: string
    annotations?: ReportAnnotation[]
    gscAiOverviews?: GscAiOverviewRow[]
    /** Compact history of the previous reports, written by report-build (share page + PDF). */
    history?: ReportHistoryPoint[]
  }
  summary?: ReportSummaryKpis
  geo?: GeoSectionData | NullSectionShape
  ai_attribution?: AiAttributionSectionData | NullSectionShape
  rankings?: RankingsSectionData | NullSectionShape
  gsc?: GscSectionData | NullSectionShape
  ga4?: Ga4SectionData | NullSectionShape
  site_health?: SiteHealthSectionData | NullSectionShape
  backlinks?: BacklinksSectionData | NullSectionShape
}

export interface GeoSectionData {
  sovOverall: MetricWithDelta
  sovByEngine: Array<{ engine: string; sovPercent: number | null }>
  trend: Array<{ date: string; yours: number; competitors: number; sovPercent: number | null }>
  topPromptsMentioned: string[]
  topPromptsNotMentioned: string[]
  /** Prompts that name the brand, kept out of SoV and won/missing (reports built after 27/09/26). */
  brandedPrompts?: Array<{ text: string; mentioned: boolean }>
  promptCounts?: { discovery: number; branded: number }
  /** 'discovery': SoV and won/missing exclude branded prompts; 'all': the period had none to exclude. */
  sovScope?: 'discovery' | 'all'
  competitorLeaderboard: Array<{ id: string; name: string; mentions: number }>
  citationRate: MetricWithDelta
  /** Answers linking the site, out of the answers that cite any source (reports built after 27/09/26). */
  citationCounts?: { cited: number; withSources: number } | null
  topCitedSources: Array<{ domain: string; count: number }>
}

export interface AiAttributionEngineRow {
  engine: string
  sovPercent: number | null
  /** Legacy field name; the assembler writes `aiAssistantSessions`. Read via `engineSessions()`. */
  ga4Sessions?: number | null
  /** GA4 sessions referred by this engine; null when GA4 is not connected. */
  aiAssistantSessions?: number | null
  keyEvents?: number | null
  conversionRate?: number | null
}

export interface AiAttributionSectionData {
  byEngine: AiAttributionEngineRow[]
  topAiReferredLandingPages: Array<{ page: string; sessions: number }>
}

/** Sessions an engine referred, whichever field name the snapshot carries. */
export function engineSessions(row: AiAttributionEngineRow): number | null {
  const v = row.aiAssistantSessions ?? row.ga4Sessions
  return typeof v === 'number' ? v : null
}

export interface SiteHealthIssue {
  code: string
  label: string
  why?: string | null
  count?: number | null
  /**
   * The specific pages the issue was found on, when it is page-level. Absent for site-wide checks
   * (robots.txt, llms.txt, crawler access) — those are fixed site-side and have no page list.
   */
  urls?: string[] | null
  severity?: 'critical' | 'error' | 'warning' | 'opportunity' | 'info' | string
  dimension?: 'seo' | 'geo' | string
}

export function isSiteHealthIssue(raw: unknown): raw is SiteHealthIssue {
  return !!raw && typeof raw === 'object' && typeof (raw as { label?: unknown }).label === 'string'
}

export interface RankingsSectionData {
  avgPosition: MetricWithDelta
  distribution: Record<string, number>
  topMovers: Array<{
    phrase: string
    currentRank: number | null
    previousRank: number | null
    delta: number | null
    url: string | null
  }>
  table: Array<{ phrase: string; rank: number | null; url: string | null }>
}

export interface GscSectionData {
  clicks: MetricWithDelta
  impressions: MetricWithDelta
  ctr: MetricWithDelta
  avgPosition: MetricWithDelta
  trend: Array<{ date: string; clicks: number; impressions: number }>
  topQueries: unknown[]
  topPages: unknown[]
}

export interface Ga4SectionData {
  sessions: MetricWithDelta
  users: MetricWithDelta
  engagedSessions: MetricWithDelta
  keyEvents: MetricWithDelta
  organicShare: MetricWithDelta
  aiAssistantSessions: MetricWithDelta
  trend: Array<{ date: string; sessions: number; users?: number }>
  topLandingPages: unknown[]
  topSources: Array<{ source: string; sessions: number }>
}

export interface SiteHealthSectionData {
  auditScore: number | null
  topIssues: Array<SiteHealthIssue | unknown>
  auditedAt: string | null
}

export interface BacklinksSectionData {
  referringDomains: number
  new: number
  lost: number | null
}

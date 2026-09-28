import type { SectionKey } from './sections'

/** Widget visual types available on the report canvas. */
export type WidgetType =
  | 'kpi'
  | 'line_chart'
  | 'bar_chart'
  | 'pie_chart'
  | 'table'
  | 'narrative'
  | 'executive_summary'
  | 'executive_briefing'
  | 'report_history'
  | 'ai_visibility_hero'
  | 'next_actions'
  | 'section_header'

/** Binds a widget to a slice of client_reports.data (or narrative). */
export interface DataBinding {
  section: SectionKey | 'narrative' | 'meta'
  metric: string
}

export interface ReportWidget {
  id: string
  type: WidgetType
  binding: DataBinding
  title?: string
  /** Optional display overrides (Looker-style widget config). */
  config?: {
    tableRowLimit?: number
    narrativeSection?: SectionKey
  }
  grid: {
    col: number
    row: number
    colSpan: number
    rowSpan: number
  }
}

export interface ReportLayout {
  version: 1
  columns: 12
  widgets: ReportWidget[]
  /**
   * How the computed insight blocks (executive briefing, AI visibility hero) are handled:
   * - undefined / 'auto' → added at render time when missing (legacy layouts saved before they existed)
   * - 'manual'           → the layout is rendered exactly as saved by the editor
   */
  insightBlocks?: 'auto' | 'manual'
}

export interface WidgetCatalogEntry {
  type: WidgetType
  binding: DataBinding
  defaultTitleKey: string
  defaultColSpan: number
  defaultRowSpan: number
  section: SectionKey | 'narrative' | 'meta'
}

/** All bindable widgets grouped by data source — mirrors the 8 assembled sections. */
export const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  // Summary
  { type: 'kpi', binding: { section: 'summary', metric: 'healthScore' }, defaultTitleKey: 'resultsPage.healthLabel', defaultColSpan: 3, defaultRowSpan: 1, section: 'summary' },
  { type: 'kpi', binding: { section: 'summary', metric: 'aiSov' }, defaultTitleKey: 'agencyReport.shareOfVoice', defaultColSpan: 3, defaultRowSpan: 1, section: 'summary' },
  { type: 'kpi', binding: { section: 'summary', metric: 'avgPosition' }, defaultTitleKey: 'resultsPage.avgPosition', defaultColSpan: 3, defaultRowSpan: 1, section: 'summary' },
  { type: 'kpi', binding: { section: 'summary', metric: 'gscClicks' }, defaultTitleKey: 'agencyReport.gscClicks', defaultColSpan: 3, defaultRowSpan: 1, section: 'summary' },
  { type: 'kpi', binding: { section: 'summary', metric: 'ga4Sessions' }, defaultTitleKey: 'agencyReport.ga4Sessions', defaultColSpan: 3, defaultRowSpan: 1, section: 'summary' },
  { type: 'kpi', binding: { section: 'summary', metric: 'ga4AiAssistantSessions' }, defaultTitleKey: 'agencyReport.aiSessions', defaultColSpan: 3, defaultRowSpan: 1, section: 'summary' },
  // GEO
  { type: 'ai_visibility_hero', binding: { section: 'geo', metric: 'hero' }, defaultTitleKey: 'agencyReport.hero.title', defaultColSpan: 12, defaultRowSpan: 3, section: 'geo' },
  { type: 'kpi', binding: { section: 'geo', metric: 'sovOverall' }, defaultTitleKey: 'agencyReport.shareOfVoice', defaultColSpan: 4, defaultRowSpan: 1, section: 'geo' },
  { type: 'kpi', binding: { section: 'geo', metric: 'citationRate' }, defaultTitleKey: 'agencyReport.citationRate', defaultColSpan: 4, defaultRowSpan: 1, section: 'geo' },
  { type: 'line_chart', binding: { section: 'geo', metric: 'trend' }, defaultTitleKey: 'agencyReport.builder.geoTrend', defaultColSpan: 8, defaultRowSpan: 2, section: 'geo' },
  { type: 'bar_chart', binding: { section: 'geo', metric: 'sovByEngine' }, defaultTitleKey: 'agencyReport.builder.sovByEngine', defaultColSpan: 6, defaultRowSpan: 2, section: 'geo' },
  { type: 'table', binding: { section: 'geo', metric: 'competitorLeaderboard' }, defaultTitleKey: 'agencyReport.builder.competitors', defaultColSpan: 6, defaultRowSpan: 2, section: 'geo' },
  // AI attribution
  { type: 'bar_chart', binding: { section: 'ai_attribution', metric: 'byEngine' }, defaultTitleKey: 'agencyReport.sections.ai_attribution', defaultColSpan: 8, defaultRowSpan: 2, section: 'ai_attribution' },
  { type: 'table', binding: { section: 'ai_attribution', metric: 'topAiReferredLandingPages' }, defaultTitleKey: 'agencyReport.builder.aiLandingPages', defaultColSpan: 6, defaultRowSpan: 2, section: 'ai_attribution' },
  // Rankings
  { type: 'kpi', binding: { section: 'rankings', metric: 'avgPosition' }, defaultTitleKey: 'resultsPage.avgPosition', defaultColSpan: 4, defaultRowSpan: 1, section: 'rankings' },
  { type: 'pie_chart', binding: { section: 'rankings', metric: 'distribution' }, defaultTitleKey: 'agencyReport.builder.rankDistribution', defaultColSpan: 6, defaultRowSpan: 2, section: 'rankings' },
  { type: 'table', binding: { section: 'rankings', metric: 'topMovers' }, defaultTitleKey: 'agencyReport.builder.topMovers', defaultColSpan: 6, defaultRowSpan: 2, section: 'rankings' },
  // GSC
  { type: 'kpi', binding: { section: 'gsc', metric: 'clicks' }, defaultTitleKey: 'agencyReport.gscClicks', defaultColSpan: 3, defaultRowSpan: 1, section: 'gsc' },
  { type: 'kpi', binding: { section: 'gsc', metric: 'impressions' }, defaultTitleKey: 'agencyReport.impressions', defaultColSpan: 3, defaultRowSpan: 1, section: 'gsc' },
  { type: 'kpi', binding: { section: 'gsc', metric: 'ctr' }, defaultTitleKey: 'agencyReport.ctr', defaultColSpan: 3, defaultRowSpan: 1, section: 'gsc' },
  { type: 'kpi', binding: { section: 'gsc', metric: 'avgPosition' }, defaultTitleKey: 'resultsPage.avgPosition', defaultColSpan: 3, defaultRowSpan: 1, section: 'gsc' },
  { type: 'line_chart', binding: { section: 'gsc', metric: 'trend' }, defaultTitleKey: 'agencyReport.builder.gscTrend', defaultColSpan: 8, defaultRowSpan: 2, section: 'gsc' },
  { type: 'table', binding: { section: 'gsc', metric: 'topQueries' }, defaultTitleKey: 'agencyReport.story.topQueries', defaultColSpan: 6, defaultRowSpan: 2, section: 'gsc' },
  { type: 'table', binding: { section: 'gsc', metric: 'topPages' }, defaultTitleKey: 'agencyReport.story.topPages', defaultColSpan: 6, defaultRowSpan: 2, section: 'gsc' },
  { type: 'table', binding: { section: 'gsc', metric: 'gscAiOverviews' }, defaultTitleKey: 'agencyReport.gscAiTableTitle', defaultColSpan: 6, defaultRowSpan: 2, section: 'meta' },
  // GA4
  { type: 'kpi', binding: { section: 'ga4', metric: 'sessions' }, defaultTitleKey: 'agencyReport.ga4Sessions', defaultColSpan: 4, defaultRowSpan: 1, section: 'ga4' },
  { type: 'kpi', binding: { section: 'ga4', metric: 'users' }, defaultTitleKey: 'agencyReport.users', defaultColSpan: 4, defaultRowSpan: 1, section: 'ga4' },
  { type: 'kpi', binding: { section: 'ga4', metric: 'aiAssistantSessions' }, defaultTitleKey: 'agencyReport.aiSessions', defaultColSpan: 4, defaultRowSpan: 1, section: 'ga4' },
  { type: 'line_chart', binding: { section: 'ga4', metric: 'trend' }, defaultTitleKey: 'agencyReport.builder.ga4Trend', defaultColSpan: 8, defaultRowSpan: 2, section: 'ga4' },
  { type: 'table', binding: { section: 'ga4', metric: 'topLandingPages' }, defaultTitleKey: 'agencyReport.story.topLandingPages', defaultColSpan: 6, defaultRowSpan: 2, section: 'ga4' },
  { type: 'table', binding: { section: 'ga4', metric: 'topSources' }, defaultTitleKey: 'agencyReport.builder.topSources', defaultColSpan: 6, defaultRowSpan: 2, section: 'ga4' },
  // Site health
  { type: 'kpi', binding: { section: 'site_health', metric: 'auditScore' }, defaultTitleKey: 'agencyReport.auditScore', defaultColSpan: 4, defaultRowSpan: 1, section: 'site_health' },
  { type: 'table', binding: { section: 'site_health', metric: 'topIssues' }, defaultTitleKey: 'agencyReport.siteIssues.title', defaultColSpan: 8, defaultRowSpan: 2, section: 'site_health' },
  // Backlinks
  { type: 'kpi', binding: { section: 'backlinks', metric: 'referringDomains' }, defaultTitleKey: 'agencyReport.referringDomains', defaultColSpan: 4, defaultRowSpan: 1, section: 'backlinks' },
  { type: 'kpi', binding: { section: 'backlinks', metric: 'new' }, defaultTitleKey: 'agencyReport.newBacklinks', defaultColSpan: 4, defaultRowSpan: 1, section: 'backlinks' },
  { type: 'kpi', binding: { section: 'backlinks', metric: 'lost' }, defaultTitleKey: 'agencyReport.lostBacklinks', defaultColSpan: 4, defaultRowSpan: 1, section: 'backlinks' },
  // Computed insight blocks (no data binding beyond the whole snapshot)
  { type: 'executive_briefing', binding: { section: 'meta', metric: 'briefing' }, defaultTitleKey: 'agencyReport.briefing.title', defaultColSpan: 12, defaultRowSpan: 2, section: 'narrative' },
  { type: 'report_history', binding: { section: 'meta', metric: 'history' }, defaultTitleKey: 'agencyReport.history.title', defaultColSpan: 12, defaultRowSpan: 3, section: 'narrative' },
  // Narrative blocks
  { type: 'executive_summary', binding: { section: 'narrative', metric: 'executiveSummary' }, defaultTitleKey: 'agencyReport.executiveSummary', defaultColSpan: 12, defaultRowSpan: 2, section: 'narrative' },
  { type: 'narrative', binding: { section: 'narrative', metric: 'section' }, defaultTitleKey: 'agencyReport.builder.sectionNarrative', defaultColSpan: 12, defaultRowSpan: 2, section: 'narrative' },
  { type: 'next_actions', binding: { section: 'narrative', metric: 'nextActions' }, defaultTitleKey: 'agencyReport.nextActions', defaultColSpan: 12, defaultRowSpan: 2, section: 'narrative' },
  // Section headers (agency-style dividers)
  { type: 'section_header', binding: { section: 'summary', metric: 'header' }, defaultTitleKey: 'agencyReport.sections.summary', defaultColSpan: 12, defaultRowSpan: 1, section: 'summary' },
  { type: 'section_header', binding: { section: 'geo', metric: 'header' }, defaultTitleKey: 'agencyReport.sections.geo', defaultColSpan: 12, defaultRowSpan: 1, section: 'geo' },
  { type: 'section_header', binding: { section: 'ai_attribution', metric: 'header' }, defaultTitleKey: 'agencyReport.sections.ai_attribution', defaultColSpan: 12, defaultRowSpan: 1, section: 'ai_attribution' },
  { type: 'section_header', binding: { section: 'rankings', metric: 'header' }, defaultTitleKey: 'agencyReport.sections.rankings', defaultColSpan: 12, defaultRowSpan: 1, section: 'rankings' },
  { type: 'section_header', binding: { section: 'gsc', metric: 'header' }, defaultTitleKey: 'agencyReport.sections.gsc', defaultColSpan: 12, defaultRowSpan: 1, section: 'gsc' },
  { type: 'section_header', binding: { section: 'ga4', metric: 'header' }, defaultTitleKey: 'agencyReport.sections.ga4', defaultColSpan: 12, defaultRowSpan: 1, section: 'ga4' },
  { type: 'section_header', binding: { section: 'site_health', metric: 'header' }, defaultTitleKey: 'agencyReport.sections.site_health', defaultColSpan: 12, defaultRowSpan: 1, section: 'site_health' },
  { type: 'section_header', binding: { section: 'backlinks', metric: 'header' }, defaultTitleKey: 'agencyReport.sections.backlinks', defaultColSpan: 12, defaultRowSpan: 1, section: 'backlinks' },
]

export function bindingKey(binding: DataBinding): string {
  return `${binding.section}:${binding.metric}`
}

export function createWidgetId(): string {
  return `w_${crypto.randomUUID().slice(0, 8)}`
}

export function catalogEntryFor(binding: DataBinding): WidgetCatalogEntry | undefined {
  return WIDGET_CATALOG.find(
    (e) => e.binding.section === binding.section && e.binding.metric === binding.metric,
  )
}

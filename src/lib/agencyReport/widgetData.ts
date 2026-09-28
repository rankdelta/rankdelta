/**
 * Widget data-state resolution — the single source of truth for "does this widget have something
 * to show?". Used by the layout renderer (to hide dead widgets instead of printing a wall of
 * "not connected" tiles to the client) and by the widget renderer (to pick the right empty state).
 */
import { connectedButEmpty, EMPTY_GUIDANCE_PRIMARY_METRIC, isEmptyGuidanceSection } from './emptyStates'
import { briefingIsEmpty, deriveBriefing } from './insights'
import { resolveReportHistory, type ReportHistoryPoint } from './history'
import { splitMovers } from './rankings'
import { ga4PageRows, gscTopRows } from './tables'
import { ALL_SECTION_KEYS, isConnectedSection, isNullSection, type SectionKey } from './sections'
import {
  engineSessions,
  isSiteHealthIssue,
  type AiAttributionSectionData,
  type BacklinksSectionData,
  type ClientReportSnapshot,
  type Ga4SectionData,
  type GeoSectionData,
  type GscSectionData,
  type RankingsSectionData,
  type ReportData,
  type SiteHealthSectionData,
} from './types'
import type { ReportWidget } from './widgets'

/**
 * - `ok`            → renderable data present
 * - `not_connected` → the bound data source is disconnected for this project
 * - `empty`         → source connected, but nothing to show for this period (null KPI, no rows)
 * - `guidance`      → source connected but the whole section is empty; this widget is the section's
 *                     primary KPI and renders the "nothing found yet" note in place of a bare zero
 * - `narrative`     → narrative/header widgets (rendered by their own rules)
 */
export type WidgetDataState = 'ok' | 'not_connected' | 'empty' | 'guidance' | 'narrative'

/** Data that lives outside the snapshot (sibling reports fetched in-app). */
export interface WidgetDataContext {
  /** History points of the project's reports; null/undefined = fall back to what the snapshot stores. */
  history?: ReportHistoryPoint[] | null
}

function metricHasValue(m: unknown): boolean {
  return !!m && typeof m === 'object' && 'value' in m && (m as { value: unknown }).value != null
}

/**
 * Backlinks come from Site Explorer crawls of the client's domain. A connected section with no
 * referring-domain rows at all means the domain was never analysed, not that it has no backlinks —
 * so it must read as "not connected" (owner sees the connect callout, the client sees nothing)
 * rather than tell the client "no referring domains found".
 */
export function backlinksNeverAnalysed(data: ReportData | null | undefined): boolean {
  const b = data?.backlinks
  if (!isConnectedSection<BacklinksSectionData>(b)) return false
  return !(b.referringDomains > 0) && !(b.new > 0) && b.lost == null
}

/** GA4 is the only source of "visits from AI"; without it the attribution chart is share of voice again. */
export function aiAttributionHasVisits(data: ReportData | null | undefined): boolean {
  const a = data?.ai_attribution
  if (!isConnectedSection<AiAttributionSectionData>(a)) return false
  // The assembler writes `aiAssistantSessions: 0` even when GA4 was never connected, so a
  // numeric reading alone proves nothing: attribution exists when GA4 is connected, or when some
  // engine actually referred visits.
  const ga4Connected = isConnectedSection<Ga4SectionData>(data?.ga4)
  return ga4Connected || (a.byEngine ?? []).some((e) => (engineSessions(e) ?? 0) > 0)
}

/**
 * Sections whose data source is disconnected for this project.
 *
 * The build persists `sections` already stripped of null-sections, so the requested list alone
 * never reveals what could not be included. The saved layout does: every section it binds a widget
 * to was wanted. A section the agency wanted whose data is a null-section (or backlinks never
 * analysed, see above) is disconnected. Without a layout, fall back to every section in the data.
 */
export function disconnectedSections(
  report: Pick<ClientReportSnapshot, 'data' | 'sections'> & { layout?: { widgets: ReportWidget[] } | null },
): SectionKey[] {
  const data = (report.data ?? {}) as ReportData
  const wanted = new Set<string>(report.sections ?? [])
  for (const w of report.layout?.widgets ?? []) wanted.add(w.binding.section)
  const fromLayout = (report.layout?.widgets?.length ?? 0) > 0
  return ALL_SECTION_KEYS.filter((key) => {
    if (key === 'summary') return false
    const section = (data as Record<string, unknown>)[key]
    if (fromLayout ? !wanted.has(key) : section === undefined) return false
    if (key === 'backlinks' && backlinksNeverAnalysed(data)) return true
    return section == null || isNullSection(section)
  })
}

/**
 * Sections missing from a report *row* (history list): the saved layout says what was wanted,
 * `sections` what built; backlinks 0/0/null counts as missing. Without a layout nothing is known
 * about what was wanted, so nothing is reported.
 */
export function missingSectionsFromRow(row: {
  sections: SectionKey[] | null | undefined
  layout?: { widgets: ReportWidget[] } | null
  backlinks?: unknown
}): SectionKey[] {
  const built = new Set<string>(row.sections ?? [])
  const wanted = new Set<string>()
  for (const w of row.layout?.widgets ?? []) {
    if (w.binding.section !== 'narrative' && w.binding.section !== 'meta' && w.binding.section !== 'summary') wanted.add(w.binding.section)
  }
  if (wanted.size === 0) return []
  const data = { backlinks: row.backlinks } as ReportData
  return ALL_SECTION_KEYS.filter((key) => {
    if (key === 'summary' || !wanted.has(key)) return false
    if (!built.has(key)) return true
    return key === 'backlinks' && backlinksNeverAnalysed(data)
  })
}

/** Data-source section a widget ultimately depends on (meta widgets depend on nothing). */
export function widgetSourceSection(widget: ReportWidget): SectionKey | null {
  const sec = widget.binding.section
  if (sec === 'narrative' || sec === 'meta') return null
  return sec
}

export function widgetDataState(widget: ReportWidget, report: ClientReportSnapshot, ctx?: WidgetDataContext): WidgetDataState {
  const data = (report.data ?? {}) as ReportData
  const { section, metric } = widget.binding

  switch (widget.type) {
    case 'executive_briefing':
      // Always rendered: with sparse data it prints one honest line instead of disappearing.
      return briefingIsEmpty(deriveBriefing(data)) ? 'narrative' : 'ok'
    case 'report_history': {
      // A trend needs two reports. With one report (or nothing known about sibling reports, e.g. a
      // public page without a stored history) the block disappears instead of printing a card that
      // only says "history appears from the second report".
      const history = resolveReportHistory(report, ctx?.history)
      return history && history.length >= 2 ? 'narrative' : 'empty'
    }
    case 'executive_summary':
      return report.narrative?.executiveSummary ? 'narrative' : 'empty'
    case 'next_actions':
      return (report.narrative?.nextActions?.length ?? 0) > 0 ? 'narrative' : 'empty'
    case 'narrative': {
      const sec = widget.config?.narrativeSection ?? metric
      const sections = report.narrative?.sections
      const text = sections && typeof sections === 'object' ? (sections as Record<string, unknown>)[sec] : null
      return typeof text === 'string' && text.trim() ? 'narrative' : 'empty'
    }
    case 'section_header':
      return 'narrative'
    default:
      break
  }

  if (section === 'meta') {
    if (metric === 'gscAiOverviews') return (data.meta?.gscAiOverviews?.length ?? 0) > 0 ? 'ok' : 'empty'
    return 'empty'
  }
  if (section === 'narrative') return 'empty'

  if (section === 'summary') {
    if (!data.summary) return 'empty'
    const m = data.summary[metric as keyof typeof data.summary]
    return metricHasValue(m) ? 'ok' : 'empty'
  }

  const raw = (data as Record<string, unknown>)[section]
  if (raw == null || isNullSection(raw)) return 'not_connected'
  if (section === 'backlinks' && backlinksNeverAnalysed(data)) return 'not_connected'

  // Connected-but-empty section: one KPI carries the guidance note, its siblings stay hidden.
  if (widget.type === 'kpi' && isEmptyGuidanceSection(section) && connectedButEmpty(data, section)) {
    return metric === EMPTY_GUIDANCE_PRIMARY_METRIC[section] ? 'guidance' : 'empty'
  }

  if (section === 'geo' && isConnectedSection<GeoSectionData>(data.geo)) {
    const geo = data.geo
    if (metric === 'hero') return connectedButEmpty(data, 'geo') ? 'empty' : 'ok'
    if (metric === 'sovOverall') return metricHasValue(geo.sovOverall) ? 'ok' : 'empty'
    if (metric === 'citationRate') return metricHasValue(geo.citationRate) ? 'ok' : 'empty'
    if (metric === 'trend') return (geo.trend?.length ?? 0) > 1 ? 'ok' : 'empty'
    if (metric === 'sovByEngine') return (geo.sovByEngine?.length ?? 0) > 0 ? 'ok' : 'empty'
    if (metric === 'competitorLeaderboard') return (geo.competitorLeaderboard?.length ?? 0) > 0 ? 'ok' : 'empty'
    return 'empty'
  }

  if (section === 'ai_attribution' && isConnectedSection<AiAttributionSectionData>(data.ai_attribution)) {
    const a = data.ai_attribution
    // Without GA4 the per-engine chart would only repeat share of voice under an "attribution" title.
    if (metric === 'byEngine') return (a.byEngine?.length ?? 0) > 0 && aiAttributionHasVisits(data) ? 'ok' : 'empty'
    if (metric === 'topAiReferredLandingPages') return (a.topAiReferredLandingPages?.length ?? 0) > 0 ? 'ok' : 'empty'
    return 'empty'
  }

  if (section === 'rankings' && isConnectedSection<RankingsSectionData>(data.rankings)) {
    const r = data.rankings
    if (metric === 'avgPosition') return metricHasValue(r.avgPosition) ? 'ok' : 'empty'
    // Buckets that are all zero draw nothing; movers that did not move tell nothing.
    if (metric === 'distribution') return Object.values(r.distribution ?? {}).some((v) => (Number(v) || 0) > 0) ? 'ok' : 'empty'
    if (metric === 'topMovers') {
      const { wins, drops } = splitMovers(r.topMovers)
      return wins.length > 0 || drops.length > 0 ? 'ok' : 'empty'
    }
    return 'empty'
  }

  if (section === 'gsc' && isConnectedSection<GscSectionData>(data.gsc)) {
    const g = data.gsc
    if (metric === 'trend') return (g.trend?.length ?? 0) > 1 ? 'ok' : 'empty'
    if (metric === 'topQueries') return gscTopRows(g.topQueries).length > 0 ? 'ok' : 'empty'
    if (metric === 'topPages') return gscTopRows(g.topPages).length > 0 ? 'ok' : 'empty'
    const m = g[metric as keyof GscSectionData]
    return metricHasValue(m) ? 'ok' : 'empty'
  }

  if (section === 'ga4' && isConnectedSection<Ga4SectionData>(data.ga4)) {
    const g = data.ga4
    if (metric === 'trend') return (g.trend?.length ?? 0) > 1 ? 'ok' : 'empty'
    if (metric === 'topSources') return (g.topSources?.length ?? 0) > 0 ? 'ok' : 'empty'
    if (metric === 'topLandingPages') return ga4PageRows(g.topLandingPages).length > 0 ? 'ok' : 'empty'
    const m = g[metric as keyof Ga4SectionData]
    return metricHasValue(m) ? 'ok' : 'empty'
  }

  if (section === 'site_health' && isConnectedSection<SiteHealthSectionData>(data.site_health)) {
    if (metric === 'auditScore') return data.site_health.auditScore != null ? 'ok' : 'empty'
    if (metric === 'topIssues') return (data.site_health.topIssues ?? []).some(isSiteHealthIssue) ? 'ok' : 'empty'
    return 'empty'
  }

  if (section === 'backlinks' && isConnectedSection<BacklinksSectionData>(data.backlinks)) {
    const v = data.backlinks[metric as keyof BacklinksSectionData]
    return typeof v === 'number' ? 'ok' : 'empty'
  }

  return 'empty'
}

/**
 * Widgets worth rendering for a given report. Drops widgets bound to disconnected sources,
 * KPI/chart/table widgets with nothing to show, narrative blocks with no text, and section headers
 * whose section has no surviving widget — so a sparse report reads as a short report, not a broken one.
 */
export function visibleWidgets(widgets: ReportWidget[], report: ClientReportSnapshot, ctx?: WidgetDataContext): ReportWidget[] {
  const states = new Map<string, WidgetDataState>()
  for (const w of widgets) states.set(w.id, widgetDataState(w, report, ctx))

  const sectionsWithData = new Set<string>()
  for (const w of widgets) {
    if (w.type === 'section_header') continue
    const state = states.get(w.id)
    if (state === 'ok' || state === 'guidance') sectionsWithData.add(w.binding.section)
  }

  return widgets.filter((w) => {
    const state = states.get(w.id)
    if (w.type === 'section_header') return sectionsWithData.has(w.binding.section)
    // Per-section commentary is only worth reading under a section that made it into the report;
    // an orphan "AI attribution — zero sessions" paragraph with no section is a leak to the client.
    if (w.type === 'narrative') {
      const sec = w.config?.narrativeSection ?? w.binding.metric
      if (sec !== 'summary' && ALL_SECTION_KEYS.includes(sec as SectionKey)) return state === 'narrative' && sectionsWithData.has(sec)
    }
    return state === 'ok' || state === 'guidance' || state === 'narrative'
  })
}

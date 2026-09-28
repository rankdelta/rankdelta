/**
 * Realistic report snapshots for the agency-report tests.
 *
 * Shapes mirror what report-build actually stores today: most projects have GEO only or GSC only,
 * the GEO mart has 1–2 scan days per period (so trends rarely render), `mentioned_brands` is NULL
 * on every run, `topAiReferredLandingPages` is always `[]`, and the build strips disconnected
 * sections from `sections` while the saved layout still says what was wanted.
 */
import { layoutFromSections } from '../layout'
import type { ClientReportSnapshot, ReportData } from '../types'

export const metric = (value: number | null, delta: number | null = null, deltaPct: number | null = null) => ({ value, delta, deltaPct })

/** Layout saved by the builder before the issues table existed (all 8 sections requested). */
export function legacyFullLayout() {
  const layout = layoutFromSections(['summary', 'geo', 'ai_attribution', 'rankings', 'gsc', 'ga4', 'site_health', 'backlinks'])
  layout.widgets = layout.widgets.filter((w) => !(w.binding.section === 'site_health' && w.binding.metric === 'topIssues'))
  return layout
}

/** GEO-only project (fictional "Harborstay"): GEO + audit connected, GA4/GSC/rankings not. */
export function harborstayData(): ReportData {
  return {
    meta: { periodStart: '2026-08-23', periodEnd: '2026-09-21', builtAt: '2026-09-21T13:00:00Z', locale: 'it' },
    summary: {
      healthScore: metric(86),
      aiSov: metric(27.4),
      avgPosition: metric(null),
      gscClicks: metric(null),
      ga4Sessions: metric(null),
      ga4AiAssistantSessions: metric(null),
      keyEvents: metric(null),
    },
    geo: {
      sovOverall: metric(27.4),
      citationRate: metric(0),
      sovByEngine: [
        { engine: 'perplexity', sovPercent: 29.5 },
        { engine: 'chatgpt', sovPercent: 24.8 },
      ],
      trend: [],
      competitorLeaderboard: [
        { id: 'c1', name: 'Staynest', mentions: 9 },
        { id: 'c2', name: 'Casalibera', mentions: 0 },
      ],
      topPromptsMentioned: ['Harborstay vs Staynest'],
      topPromptsNotMentioned: ['migliori software per gestire case vacanza'],
      topCitedSources: [],
    },
    ai_attribution: {
      byEngine: [
        { engine: 'chatgpt', sovPercent: 24.8, aiAssistantSessions: 0, keyEvents: 0, conversionRate: null },
        { engine: 'google_aio', sovPercent: null, aiAssistantSessions: 0, keyEvents: 0, conversionRate: null },
        { engine: 'perplexity', sovPercent: 29.5, aiAssistantSessions: 0, keyEvents: 0, conversionRate: null },
      ],
      topAiReferredLandingPages: [],
    },
    site_health: {
      auditScore: 86,
      auditedAt: '2026-09-15T09:00:00.000+00:00',
      topIssues: [
        { code: 'low_content_rate', label: 'Poco testo rispetto al codice', why: 'Contenuto sottile: poco materiale citabile dall’AI.', count: 4, severity: 'warning', dimension: 'geo' },
        { code: 'canonical', label: 'Canonical assente su alcune pagine', why: 'Aiuta a consolidare i segnali.', count: 5, severity: 'opportunity', dimension: 'seo' },
      ],
    },
    backlinks: { referringDomains: 0, new: 0, lost: null },
  }
}

export function harborstayReport(overrides: Partial<ClientReportSnapshot> = {}): ClientReportSnapshot {
  return {
    id: 'rpt-geo-1',
    project_id: 'p1',
    period_start: '2026-08-23',
    period_end: '2026-09-21',
    // The build strips disconnected sections from `sections` — only these five survived.
    sections: ['summary', 'geo', 'ai_attribution', 'site_health', 'backlinks'],
    layout: legacyFullLayout(),
    data: harborstayData(),
    narrative: { executiveSummary: 'Harborstay detiene una share of voice del 27,4%.', sections: {}, nextActions: ['Ampliare le pagine con poco testo.'] },
    branding: { agencyName: 'Northwind Agency', logoUrl: null, primaryColor: '#7c3aed', hideAstroSeoFooter: true, enabled: true },
    goals: null,
    created_at: '2026-09-21T13:00:00Z',
    ...overrides,
  }
}

/** GSC-only client on its second report: Search Console connected with a prior period, nothing else. */
export function gscOnlyData(): ReportData {
  const trend = Array.from({ length: 28 }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    clicks: 40 + (i % 7) * 5,
    impressions: 1800 + i * 20,
  }))
  return {
    meta: { periodStart: '2026-08-01', periodEnd: '2026-08-28', builtAt: '2026-08-29T08:00:00Z', locale: 'it' },
    summary: {
      healthScore: metric(null),
      aiSov: metric(null),
      avgPosition: metric(null),
      gscClicks: metric(1234, 234, 23.4),
      ga4Sessions: metric(null),
      ga4AiAssistantSessions: metric(null),
      keyEvents: metric(null),
    },
    geo: { data: null, reason: 'not_connected' },
    ai_attribution: { data: null, reason: 'not_connected' },
    rankings: { data: null, reason: 'not_connected' },
    gsc: {
      clicks: metric(1234, 234, 23.4),
      impressions: metric(52340, -1200, -2.2),
      ctr: metric(2.4, 0.5, 26.3),
      avgPosition: metric(14.7, -1.3, -8.1),
      trend,
      topQueries: [
        { key: 'gestione case vacanza', clicks: 320, impressions: 9800, ctr: 0.0327, position: 4.2 },
        { key: 'software host airbnb', clicks: 140, impressions: 12000, ctr: 0.0117, position: 8.9 },
        { key: 'check in automatico', clicks: 60, impressions: 4100, ctr: 0.0146, position: 12.4 },
      ],
      topPages: [
        { key: 'https://cliente.it/', clicks: 500, impressions: 15000, ctr: 0.033, position: 6.1 },
        { key: 'https://cliente.it/blog/affitti-brevi-guida', clicks: 210, impressions: 8000, ctr: 0.026, position: 9.4 },
      ],
    },
    ga4: { data: null, reason: 'not_connected' },
    site_health: { data: null, reason: 'not_connected' },
    backlinks: { data: null, reason: 'not_connected' },
  }
}

export function gscOnlyReport(overrides: Partial<ClientReportSnapshot> = {}): ClientReportSnapshot {
  return {
    id: 'gsc-2',
    project_id: 'p2',
    period_start: '2026-08-01',
    period_end: '2026-08-28',
    sections: ['summary', 'gsc'],
    layout: layoutFromSections(['summary', 'geo', 'ai_attribution', 'rankings', 'gsc', 'ga4', 'site_health', 'backlinks']),
    data: gscOnlyData(),
    narrative: { executiveSummary: 'I click organici sono cresciuti del 23% nel periodo.', sections: {}, nextActions: ['Riscrivere title e description della pagina prezzi.'] },
    branding: { agencyName: 'Studio Nord', logoUrl: null, primaryColor: '#0f766e', hideAstroSeoFooter: true, enabled: true },
    goals: { gscClicks: 2000 },
    created_at: '2026-08-29T08:00:00Z',
    ...overrides,
  }
}

/**
 * English words that must never appear on an Italian report. "Share of voice", "Competitor",
 * "Keyword", "CTR", "Query" and the singular "Click" are accepted Italian marketing usage and are
 * deliberately absent.
 */
export const ENGLISH_LEAK_RE =
  /\b([Hh]ealth score|Clicks|Impressions?|Sessions?|Users|Pages?|Position|not mentioned yet|Prior period|Goal|first reading|Wins|Watch|Next actions|Next steps|Issue|Priority|Opportunity|Medium|Critical|Prepared by|Powered by|this report|Report by report|Trend across reports|At a glance|Executive (summary|briefing)|Snapshot taken|Generated (on|by)|vs previous|by AI engine|over time|Tracked prompts|Prompts (won|where)|Citation rate|By AI engine|Sources AI|Competitors|Most-mentioned|Mentions|What is holding|Last audit|Data as of|Biggest (wins|drops)|Which (queries|pages)|Where visitors|Search clicks|Technical health|Referring domains|not connected|No data|Section commentary)\b/

import { describe, it, expect } from 'vitest'
import { disconnectedSections, missingSectionsFromRow, visibleWidgets, widgetDataState } from './widgetData'
import { layoutFromSections } from './layout'
import type { ClientReportSnapshot } from './types'
import type { ReportWidget } from './widgets'
import type { SectionKey } from './sections'
import type { ReportHistoryPoint } from './history'

const report: ClientReportSnapshot = {
  id: 'r1',
  project_id: 'p1',
  period_start: '2026-01-01',
  period_end: '2026-01-31',
  sections: ['summary', 'geo', 'gsc', 'site_health', 'backlinks'],
  data: {
    summary: {
      healthScore: { value: 72, delta: 2, deltaPct: 2.8 },
      aiSov: { value: null, delta: null, deltaPct: null },
      avgPosition: { value: null, delta: null, deltaPct: null },
      gscClicks: { value: null, delta: null, deltaPct: null },
      ga4Sessions: { value: null, delta: null, deltaPct: null },
      ga4AiAssistantSessions: { value: null, delta: null, deltaPct: null },
      keyEvents: { value: null, delta: null, deltaPct: null },
    },
    geo: { data: null, reason: 'not_connected' },
    gsc: { data: null, reason: 'not_connected' },
    site_health: { auditScore: 72, topIssues: [], auditedAt: null },
    backlinks: { referringDomains: 0, new: 0, lost: null },
  },
  narrative: { executiveSummary: 'Summary text', sections: {}, nextActions: [] },
  branding: null,
  goals: null,
  created_at: '2026-02-01T00:00:00Z',
}

function w(partial: Partial<ReportWidget> & Pick<ReportWidget, 'type' | 'binding'>): ReportWidget {
  return { id: partial.id ?? 'w', grid: { col: 0, row: 0, colSpan: 4, rowSpan: 1 }, ...partial }
}

describe('widgetDataState', () => {
  it('flags widgets bound to disconnected sections', () => {
    expect(widgetDataState(w({ type: 'kpi', binding: { section: 'gsc', metric: 'clicks' } }), report)).toBe('not_connected')
    expect(widgetDataState(w({ type: 'line_chart', binding: { section: 'geo', metric: 'trend' } }), report)).toBe('not_connected')
  })

  it('distinguishes empty from ok on connected sources', () => {
    expect(widgetDataState(w({ type: 'kpi', binding: { section: 'summary', metric: 'healthScore' } }), report)).toBe('ok')
    expect(widgetDataState(w({ type: 'kpi', binding: { section: 'summary', metric: 'aiSov' } }), report)).toBe('empty')
    // backlinks 0/0/null = the domain was never analysed, never "no backlinks" (see backlinksNeverAnalysed)
    expect(widgetDataState(w({ type: 'kpi', binding: { section: 'backlinks', metric: 'lost' } }), report)).toBe('not_connected')
    expect(widgetDataState(w({ type: 'kpi', binding: { section: 'backlinks', metric: 'referringDomains' } }), report)).toBe('not_connected')
  })

  it('collapses a connected-but-empty section to one guidance widget', () => {
    expect(widgetDataState(w({ type: 'kpi', binding: { section: 'backlinks', metric: 'new' } }), report)).toBe('not_connected')
    const withLinks = { ...report, data: { ...report.data, backlinks: { referringDomains: 12, new: 3, lost: null } } }
    expect(widgetDataState(w({ type: 'kpi', binding: { section: 'backlinks', metric: 'referringDomains' } }), withLinks)).toBe('ok')
    expect(widgetDataState(w({ type: 'kpi', binding: { section: 'backlinks', metric: 'new' } }), withLinks)).toBe('ok')
    const noScore = { ...report, data: { ...report.data, site_health: { auditScore: null, topIssues: [], auditedAt: '2026-01-10T00:00:00Z' } } }
    expect(widgetDataState(w({ type: 'kpi', binding: { section: 'site_health', metric: 'auditScore' } }), noScore)).toBe('guidance')
  })

  it('treats narrative widgets by their text presence', () => {
    expect(widgetDataState(w({ type: 'executive_summary', binding: { section: 'narrative', metric: 'executiveSummary' } }), report)).toBe('narrative')
    expect(widgetDataState(w({ type: 'next_actions', binding: { section: 'narrative', metric: 'nextActions' } }), report)).toBe('empty')
  })
})

describe('widgetDataState: attribution and site health', () => {
  // What the assembler writes without GA4: sessions are 0, never null.
  const engines = [
    { engine: 'chatgpt', sovPercent: 24.8, aiAssistantSessions: 0, keyEvents: 0 },
    { engine: 'perplexity', sovPercent: 33.3, aiAssistantSessions: 0, keyEvents: 0 },
  ]
  const byEngine = w({ type: 'bar_chart', binding: { section: 'ai_attribution', metric: 'byEngine' } })

  it('hides the attribution chart without GA4 (it would only repeat share of voice)', () => {
    const noGa4 = { ...report, data: { ...report.data, ai_attribution: { byEngine: engines, topAiReferredLandingPages: [] } } }
    expect(widgetDataState(byEngine, noGa4)).toBe('empty')
  })

  it('shows the attribution chart when GA4 is connected or an engine referred visits (either field name)', () => {
    const legacyVisits = { ...report, data: { ...report.data, ai_attribution: { byEngine: [{ engine: 'chatgpt', sovPercent: 20, ga4Sessions: 3 }], topAiReferredLandingPages: [] } } }
    expect(widgetDataState(byEngine, legacyVisits)).toBe('ok')
    const visits = { ...report, data: { ...report.data, ai_attribution: { byEngine: [{ ...engines[0]!, aiAssistantSessions: 4 }], topAiReferredLandingPages: [] } } }
    expect(widgetDataState(byEngine, visits)).toBe('ok')
    const m = (value: number) => ({ value, delta: null, deltaPct: null })
    const ga4 = { sessions: m(120), users: m(90), engagedSessions: m(60), keyEvents: m(0), organicShare: m(40), aiAssistantSessions: m(0), trend: [], topSources: [], topLandingPages: [] }
    const ga4Connected: ClientReportSnapshot = { ...report, data: { ...report.data, ga4, ai_attribution: { byEngine: engines, topAiReferredLandingPages: [] } } }
    expect(widgetDataState(byEngine, ga4Connected)).toBe('ok')
  })

  it('drops per-section commentary whose section did not make it into the report', () => {
    const noGa4 = {
      ...report,
      data: { ...report.data, ai_attribution: { byEngine: engines, topAiReferredLandingPages: [] } },
      narrative: { ...report.narrative!, sections: { ai_attribution: 'Zero AI assistant sessions across all engines.', site_health: 'Solid score.' } },
    }
    const commentary = (sec: SectionKey) => w({ id: `n-${sec}`, type: 'narrative', binding: { section: 'narrative', metric: sec }, config: { narrativeSection: sec } })
    const layout = [
      w({ id: 'h-attr', type: 'section_header', binding: { section: 'ai_attribution', metric: 'header' } }),
      commentary('ai_attribution'),
      byEngine,
      w({ id: 'h-sh', type: 'section_header', binding: { section: 'site_health', metric: 'header' } }),
      commentary('site_health'),
      w({ id: 'k-sh', type: 'kpi', binding: { section: 'site_health', metric: 'auditScore' } }),
    ]
    const keys = visibleWidgets(layout, noGa4).map((x) => x.id)
    expect(keys).not.toContain('n-ai_attribution')
    expect(keys).not.toContain('h-attr')
    expect(keys).toContain('n-site_health')
    expect(keys).toContain('k-sh')
  })

  it('renders the audit top issues only when the audit produced labelled issues', () => {
    const issues = w({ type: 'table', binding: { section: 'site_health', metric: 'topIssues' } })
    expect(widgetDataState(issues, report)).toBe('empty')
    const withIssues = {
      ...report,
      data: { ...report.data, site_health: { auditScore: 86, auditedAt: null, topIssues: [{ code: 'canonical', label: 'Canonical missing', count: 5, severity: 'opportunity' }] } },
    }
    expect(widgetDataState(issues, withIssues)).toBe('ok')
  })
})

describe('visibleWidgets', () => {
  it('drops disconnected + empty widgets and orphan section headers, keeps live ones', () => {
    const layout = layoutFromSections(['summary', 'geo', 'gsc', 'site_health', 'backlinks'])
    const visible = visibleWidgets(layout.widgets, report)
    const keys = visible.map((x) => `${x.type}:${x.binding.section}:${x.binding.metric}`)

    expect(keys).toContain('executive_summary:narrative:executiveSummary')
    expect(keys).toContain('kpi:summary:healthScore')
    expect(keys).toContain('kpi:site_health:auditScore')
    expect(keys).toContain('section_header:site_health:header')
    // never-analysed backlinks read as disconnected: nothing of the section reaches the client
    expect(keys.some((k) => k.includes(':backlinks:'))).toBe(false)

    expect(keys).not.toContain('kpi:summary:aiSov')
    expect(keys.some((k) => k.includes(':gsc:'))).toBe(false)
    expect(keys.some((k) => k.includes(':geo:'))).toBe(false)
    expect(keys).not.toContain('next_actions:narrative:nextActions')
  })

  it('puts the section header before its widgets in generated layouts', () => {
    const layout = layoutFromSections(['site_health'])
    const idx = (metric: string) => layout.widgets.findIndex((x) => x.binding.metric === metric)
    expect(idx('header')).toBeGreaterThanOrEqual(0)
    expect(idx('header')).toBeLessThan(idx('auditScore'))
  })
})

describe('widgetDataState — report_history needs two reports', () => {
  const layout = layoutFromSections(['summary', 'site_health'])
  const widget = layout.widgets.find((x) => x.type === 'report_history')!
  const point = (reportId: string, periodStart: string, periodEnd: string): ReportHistoryPoint => ({
    reportId,
    periodStart,
    periodEnd,
    aiSov: null,
    citationRate: null,
    gscClicks: null,
    gscImpressions: null,
    avgPosition: null,
    ga4Sessions: null,
    aiSessions: null,
    healthScore: 70,
    referringDomains: null,
  })
  const hasHistory = (widgets: Array<ReportWidget>): boolean => widgets.some((x) => x.type === 'report_history')

  it('is empty (hidden) with the report on screen alone — fetched, stored or unknown history', () => {
    // Nothing known about sibling reports.
    expect(widgetDataState(widget, report)).toBe('empty')
    // Fetched in-app: the only row is the report itself.
    expect(widgetDataState(widget, report, { history: [point('r1', '2026-01-01', '2026-01-31')] })).toBe('empty')
    expect(widgetDataState(widget, report, { history: [] })).toBe('empty')
    // Stored in the snapshot: an empty previous-reports list (the first build writes `history: []`).
    const stored: ClientReportSnapshot = { ...report, data: { ...report.data, meta: { history: [] } } }
    expect(widgetDataState(widget, stored)).toBe('empty')
    expect(hasHistory(visibleWidgets(layout.widgets, report, { history: [point('r1', '2026-01-01', '2026-01-31')] }))).toBe(false)
    expect(hasHistory(visibleWidgets(layout.widgets, stored))).toBe(false)
  })

  it('renders once a second report exists', () => {
    const previous = point('r0', '2025-12-01', '2025-12-31')
    expect(widgetDataState(widget, report, { history: [previous] })).toBe('narrative')
    expect(hasHistory(visibleWidgets(layout.widgets, report, { history: [previous] }))).toBe(true)
    const stored: ClientReportSnapshot = { ...report, data: { ...report.data, meta: { history: [previous] } } }
    expect(widgetDataState(widget, stored)).toBe('narrative')
    expect(hasHistory(visibleWidgets(layout.widgets, stored))).toBe(true)
  })
})

describe('disconnectedSections', () => {
  it('lists requested sections whose data is a null-section (plus never-analysed backlinks)', () => {
    expect(disconnectedSections(report)).toEqual(['geo', 'gsc', 'backlinks'])
  })

  it('reads what was wanted from the saved layout, since the build strips null-sections from `sections`', () => {
    const stripped = { ...report, sections: ['summary', 'site_health'] as ClientReportSnapshot['sections'] }
    // No layout → every section the data knows about is a candidate.
    expect(disconnectedSections(stripped)).toEqual(['geo', 'gsc', 'backlinks'])
    // Layout that only wanted GSC → only GSC is reported missing.
    const layout = layoutFromSections(['summary', 'gsc', 'site_health'])
    expect(disconnectedSections({ ...stripped, layout })).toEqual(['gsc'])
  })

  it('does not treat a domain with backlinks as disconnected', () => {
    const withLinks = { ...report, data: { ...report.data, backlinks: { referringDomains: 12, new: 3, lost: null } } }
    expect(disconnectedSections(withLinks)).toEqual(['geo', 'gsc'])
  })
})

describe('missingSectionsFromRow (history list)', () => {
  const fullLayout = layoutFromSections(['summary', 'geo', 'ai_attribution', 'rankings', 'gsc', 'ga4', 'site_health', 'backlinks'])

  it('is the wanted-but-not-built sections, plus backlinks never analysed', () => {
    expect(
      missingSectionsFromRow({
        sections: ['summary', 'geo', 'ai_attribution', 'site_health', 'backlinks'],
        layout: fullLayout,
        backlinks: { referringDomains: 0, new: 0, lost: null },
      }),
    ).toEqual(['rankings', 'gsc', 'ga4', 'backlinks'])
  })

  it('reports nothing without a layout (what was wanted is unknown) or when everything built', () => {
    expect(missingSectionsFromRow({ sections: ['summary', 'geo'], layout: null })).toEqual([])
    expect(
      missingSectionsFromRow({
        sections: ['summary', 'geo', 'ai_attribution', 'rankings', 'gsc', 'ga4', 'site_health', 'backlinks'],
        layout: fullLayout,
        backlinks: { referringDomains: 40, new: 2, lost: 1 },
      }),
    ).toEqual([])
  })
})

describe('widgetDataState — rankings that carry no information', () => {
  const rankingsReport = (rankings: NonNullable<ClientReportSnapshot['data']['rankings']>): ClientReportSnapshot => ({
    ...report,
    sections: ['summary', 'rankings'],
    data: { ...report.data, rankings },
  })

  it('treats an all-zero distribution and movers that did not move as empty (no blank widget boxes)', () => {
    const r = rankingsReport({
      avgPosition: { value: null, delta: null, deltaPct: null },
      distribution: { '1': 0, '2-3': 0, '4-10': 0, '11-20': 0, '21+': 0 },
      topMovers: [
        { phrase: 'seo tools', currentRank: 4, previousRank: 4, delta: 0, url: null },
        { phrase: 'rank tracker', currentRank: null, previousRank: null, delta: null, url: null },
      ],
      table: [],
    })
    expect(widgetDataState(w({ type: 'pie_chart', binding: { section: 'rankings', metric: 'distribution' } }), r)).toBe('empty')
    expect(widgetDataState(w({ type: 'table', binding: { section: 'rankings', metric: 'topMovers' } }), r)).toBe('empty')
    // …so the section header disappears with them.
    const layout = layoutFromSections(['rankings'])
    expect(visibleWidgets(layout.widgets, r).filter((x) => x.binding.section === 'rankings')).toEqual([])
  })

  it('keeps them once a bucket or a mover has a value', () => {
    const r = rankingsReport({
      avgPosition: { value: 8, delta: null, deltaPct: null },
      distribution: { '1': 0, '2-3': 2, '4-10': 0, '11-20': 0, '21+': 0 },
      topMovers: [{ phrase: 'seo tools', currentRank: 4, previousRank: 9, delta: 5, url: null }],
      table: [],
    })
    expect(widgetDataState(w({ type: 'pie_chart', binding: { section: 'rankings', metric: 'distribution' } }), r)).toBe('ok')
    expect(widgetDataState(w({ type: 'table', binding: { section: 'rankings', metric: 'topMovers' } }), r)).toBe('ok')
  })
})

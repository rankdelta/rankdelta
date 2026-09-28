import { describe, it, expect } from 'vitest'
import { withInsightBlocks, type ReportLayout } from './layout'
import {
  addWidgetFromCatalog,
  duplicateWidget,
  layoutFromSections,
  normalizeLayout,
  reorderWidgets,
  removeWidget,
  resizeWidget,
} from './layout'
import { WIDGET_CATALOG } from './widgets'

describe('report layout utilities', () => {
  it('builds a default layout from enabled sections', () => {
    const layout = layoutFromSections(['summary', 'gsc'])
    expect(layout.widgets.length).toBeGreaterThan(0)
    expect(layout.widgets.some((w) => w.binding.section === 'summary')).toBe(true)
    expect(layout.widgets.some((w) => w.binding.section === 'gsc')).toBe(true)
    expect(layout.widgets.some((w) => w.binding.section === 'geo')).toBe(false)
  })

  it('reorders widgets via drag indices', () => {
    const entry = WIDGET_CATALOG.find((e) => e.binding.section === 'gsc' && e.binding.metric === 'clicks')!
    const entry2 = WIDGET_CATALOG.find((e) => e.binding.section === 'gsc' && e.binding.metric === 'impressions')!
    let layout = addWidgetFromCatalog(normalizeLayout({ version: 1, columns: 12, widgets: [] }), entry)
    layout = addWidgetFromCatalog(layout, entry2)
    const [first, second] = layout.widgets
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    const reordered = reorderWidgets(layout, second!.id, first!.id)
    expect(reordered.widgets[0]?.id).toBe(second!.id)
  })

  it('resizes widget colSpan within bounds', () => {
    const entry = WIDGET_CATALOG.find((e) => e.binding.section === 'gsc' && e.binding.metric === 'clicks')!
    const layout = addWidgetFromCatalog(normalizeLayout({ version: 1, columns: 12, widgets: [] }), entry)
    const target = layout.widgets[0]!
    const wider = resizeWidget(layout, target.id, { colSpan: 1 })
    const widget = wider.widgets.find((w) => w.id === target.id)!
    expect(widget.grid.colSpan).toBeGreaterThanOrEqual(target.grid.colSpan)
  })

  it('duplicates a widget after the original', () => {
    const entry = WIDGET_CATALOG.find((e) => e.binding.section === 'gsc' && e.binding.metric === 'clicks')!
    const layout = addWidgetFromCatalog(normalizeLayout({ version: 1, columns: 12, widgets: [] }), entry)
    const id = layout.widgets[0]!.id
    const duped = duplicateWidget(layout, id)
    expect(duped.widgets.length).toBe(2)
    expect(duped.widgets[1]?.binding).toEqual(layout.widgets[0]?.binding)
    expect(duped.widgets[1]?.id).not.toBe(id)
  })

  it('adds and removes widgets from catalog', () => {
    const entry = WIDGET_CATALOG.find((e) => e.binding.section === 'gsc' && e.binding.metric === 'clicks')!
    let layout = normalizeLayout({ version: 1, columns: 12, widgets: [] })
    layout = addWidgetFromCatalog(layout, entry)
    expect(layout.widgets).toHaveLength(1)
    layout = removeWidget(layout, layout.widgets[0]!.id)
    expect(layout.widgets).toHaveLength(0)
  })
})

describe('insight blocks', () => {
  it('layoutFromSections opens with the briefing, then the AI visibility hero when geo is enabled', () => {
    const layout = layoutFromSections(['summary', 'geo', 'gsc'])
    expect(layout.widgets[0]?.type).toBe('executive_briefing')
    expect(layout.widgets[1]?.type).toBe('report_history')
    expect(layout.widgets[2]?.type).toBe('ai_visibility_hero')
    // The hero replaces the old default GEO row; the individual GEO widgets stay available in the palette.
    expect(layout.widgets.some((w) => w.type === 'line_chart' && w.binding.section === 'geo')).toBe(false)
    const noGeo = layoutFromSections(['summary', 'gsc'])
    expect(noGeo.widgets.some((w) => w.type === 'ai_visibility_hero')).toBe(false)
  })

  it('withInsightBlocks upgrades a legacy layout idempotently and respects a manual layout', () => {
    const legacy: ReportLayout = {
      version: 1,
      columns: 12,
      widgets: [
        { id: 'a', type: 'kpi', binding: { section: 'summary', metric: 'healthScore' }, grid: { col: 0, row: 0, colSpan: 3, rowSpan: 1 } },
      ],
    }
    const upgraded = withInsightBlocks(legacy, ['summary', 'geo'])
    expect(upgraded.widgets.map((w) => w.type)).toEqual(['executive_briefing', 'report_history', 'ai_visibility_hero', 'kpi'])
    expect(upgraded.widgets[1]?.id).toBe('w_auto_history')

    // GSC/GA4 story tables land right after their section's last widget; a section with no widgets gets none.
    const withGsc: ReportLayout = {
      ...legacy,
      widgets: [
        ...legacy.widgets,
        { id: 'g1', type: 'kpi', binding: { section: 'gsc', metric: 'clicks' }, grid: { col: 0, row: 1, colSpan: 3, rowSpan: 1 } },
        { id: 'g2', type: 'line_chart', binding: { section: 'gsc', metric: 'trend' }, grid: { col: 0, row: 2, colSpan: 8, rowSpan: 2 } },
        { id: 'b1', type: 'kpi', binding: { section: 'backlinks', metric: 'new' }, grid: { col: 0, row: 4, colSpan: 4, rowSpan: 1 } },
      ],
    }
    const keys = withInsightBlocks(withGsc, ['summary', 'gsc', 'ga4', 'backlinks']).widgets.map((w) => `${w.binding.section}:${w.binding.metric}`)
    expect(keys.indexOf('gsc:topQueries')).toBe(keys.indexOf('gsc:trend') + 1)
    expect(keys.indexOf('gsc:topPages')).toBe(keys.indexOf('gsc:topQueries') + 1)
    expect(keys.indexOf('backlinks:new')).toBeGreaterThan(keys.indexOf('gsc:topPages'))
    expect(keys).not.toContain('ga4:topLandingPages')
    expect(withInsightBlocks(upgraded, ['summary', 'geo'])).toEqual(upgraded)
    expect(upgraded.widgets[0]?.id).toBe('w_auto_briefing')

    // A layout saved with the briefing (but before the trend block) gets the trend right after it.
    const withBriefing: ReportLayout = {
      ...legacy,
      widgets: [
        { id: 'b', type: 'executive_briefing', binding: { section: 'meta', metric: 'briefing' }, grid: { col: 0, row: 0, colSpan: 12, rowSpan: 2 } },
        { id: 'h', type: 'ai_visibility_hero', binding: { section: 'geo', metric: 'hero' }, grid: { col: 0, row: 2, colSpan: 12, rowSpan: 3 } },
        { ...legacy.widgets[0]!, grid: { ...legacy.widgets[0]!.grid, row: 5 } },
      ],
    }
    expect(withInsightBlocks(withBriefing, ['summary', 'geo']).widgets.map((w) => w.id)).toEqual(['b', 'w_auto_history', 'h', 'a'])

    // The written summary is read first: pulled up under the briefing, above the trend and the hero.
    const withSummary: ReportLayout = {
      ...legacy,
      widgets: [
        ...legacy.widgets,
        { id: 's', type: 'executive_summary', binding: { section: 'narrative', metric: 'executiveSummary' }, grid: { col: 0, row: 1, colSpan: 12, rowSpan: 2 } },
      ],
    }
    const summaryFirst = withInsightBlocks(withSummary, ['summary', 'geo'])
    expect(summaryFirst.widgets.map((w) => w.type)).toEqual(['executive_briefing', 'executive_summary', 'report_history', 'ai_visibility_hero', 'kpi'])
    expect(withInsightBlocks(summaryFirst, ['summary', 'geo'])).toEqual(summaryFirst)
    const manualSummary: ReportLayout = { ...withSummary, insightBlocks: 'manual' }
    expect(withInsightBlocks(manualSummary, ['summary', 'geo'])).toBe(manualSummary)

    const manual: ReportLayout = { ...legacy, insightBlocks: 'manual' }
    expect(withInsightBlocks(manual, ['summary', 'geo'])).toBe(manual)
    expect(normalizeLayout(manual).insightBlocks).toBe('manual')
  })
})

describe('section commentary (narrative.sections.<key>)', () => {
  const key = (w: ReportLayout['widgets'][number]) => `${w.type}:${w.binding.section}:${w.config?.narrativeSection ?? w.binding.metric}`

  it('layoutFromSections places one commentary widget right under every data section header', () => {
    const keys = layoutFromSections(['summary', 'gsc', 'site_health']).widgets.map(key)
    expect(keys.indexOf('narrative:narrative:gsc')).toBe(keys.indexOf('section_header:gsc:header') + 1)
    expect(keys.indexOf('narrative:narrative:site_health')).toBe(keys.indexOf('section_header:site_health:header') + 1)
    // The summary's commentary is the executive summary itself: no extra block.
    expect(keys).not.toContain('narrative:narrative:summary')
    expect(keys.filter((k) => k.startsWith('narrative:'))).toHaveLength(2)
  })

  it('withInsightBlocks back-fills the commentary under existing headers only, idempotently', () => {
    const saved: ReportLayout = {
      version: 1,
      columns: 12,
      widgets: [
        { id: 'hg', type: 'section_header', binding: { section: 'gsc', metric: 'header' }, grid: { col: 0, row: 0, colSpan: 12, rowSpan: 1 } },
        { id: 'g1', type: 'kpi', binding: { section: 'gsc', metric: 'clicks' }, grid: { col: 0, row: 1, colSpan: 3, rowSpan: 1 } },
        // GA4 laid out by hand without a header: left alone.
        { id: 'a1', type: 'kpi', binding: { section: 'ga4', metric: 'sessions' }, grid: { col: 0, row: 2, colSpan: 3, rowSpan: 1 } },
      ],
    }
    const upgraded = withInsightBlocks(saved, ['summary', 'gsc', 'ga4'])
    const keys = upgraded.widgets.map(key)
    expect(keys.indexOf('narrative:narrative:gsc')).toBe(keys.indexOf('section_header:gsc:header') + 1)
    expect(upgraded.widgets.find((w) => w.type === 'narrative')?.id).toBe('w_auto_commentary_gsc')
    expect(keys).not.toContain('narrative:narrative:ga4')
    expect(withInsightBlocks(upgraded, ['summary', 'gsc', 'ga4'])).toEqual(upgraded)
  })
})

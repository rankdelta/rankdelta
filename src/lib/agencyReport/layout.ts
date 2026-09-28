import type { SectionKey } from './sections'
import {
  WIDGET_CATALOG,
  bindingKey,
  createWidgetId,
  type DataBinding,
  type ReportLayout,
  type ReportWidget,
  type WidgetCatalogEntry,
  type WidgetType,
} from './widgets'

export const GRID_COLUMNS = 12
export const MIN_COL_SPAN = 2
export const MAX_COL_SPAN = 12
export const MIN_ROW_SPAN = 1
export const MAX_ROW_SPAN = 4

export function createEmptyLayout(): ReportLayout {
  return { version: 1, columns: GRID_COLUMNS, widgets: [] }
}

export function sortWidgets(widgets: ReportWidget[]): ReportWidget[] {
  return [...widgets].sort((a, b) => a.grid.row - b.grid.row || a.grid.col - b.grid.col)
}

export function normalizeLayout(layout: ReportLayout, preserveOrder = false): ReportLayout {
  const ordered = preserveOrder ? layout.widgets : sortWidgets(layout.widgets)
  const widgets = ordered.map((w) => ({
    ...w,
    grid: {
      ...w.grid,
      col: Math.max(0, Math.min(GRID_COLUMNS - 1, w.grid.col)),
      colSpan: Math.max(MIN_COL_SPAN, Math.min(MAX_COL_SPAN, w.grid.colSpan)),
      rowSpan: Math.max(MIN_ROW_SPAN, Math.min(MAX_ROW_SPAN, w.grid.rowSpan)),
    },
  }))
  return { version: 1, columns: GRID_COLUMNS, widgets: reflowRows(widgets), ...(layout.insightBlocks ? { insightBlocks: layout.insightBlocks } : {}) }
}

/** Pack widgets into rows without overlap — 12-column grid (uses array order). */
export function reflowRows(widgets: ReportWidget[]): ReportWidget[] {
  let currentRow = 0
  let colCursor = 0
  const placed: ReportWidget[] = []

  for (const widget of widgets) {
    const span = Math.min(widget.grid.colSpan, GRID_COLUMNS)
    if (colCursor + span > GRID_COLUMNS) {
      currentRow += 1
      colCursor = 0
    }
    placed.push({
      ...widget,
      grid: { ...widget.grid, row: currentRow, col: colCursor, colSpan: span },
    })
    colCursor += span
    if (colCursor >= GRID_COLUMNS) {
      currentRow += 1
      colCursor = 0
    }
  }
  return placed
}

export function reorderWidgets(layout: ReportLayout, activeId: string, overId: string): ReportLayout {
  const widgets = sortWidgets(layout.widgets)
  const oldIndex = widgets.findIndex((w) => w.id === activeId)
  const newIndex = widgets.findIndex((w) => w.id === overId)
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return layout

  const next = [...widgets]
  const [moved] = next.splice(oldIndex, 1)
  if (!moved) return layout
  next.splice(newIndex, 0, moved)
  return normalizeLayout({ ...layout, widgets: next }, true)
}

export function resizeWidget(
  layout: ReportLayout,
  widgetId: string,
  delta: { colSpan?: number; rowSpan?: number },
): ReportLayout {
  const widgets = layout.widgets.map((w) => {
    if (w.id !== widgetId) return w
    return {
      ...w,
      grid: {
        ...w.grid,
        colSpan: delta.colSpan != null
          ? Math.max(MIN_COL_SPAN, Math.min(MAX_COL_SPAN, w.grid.colSpan + delta.colSpan))
          : w.grid.colSpan,
        rowSpan: delta.rowSpan != null
          ? Math.max(MIN_ROW_SPAN, Math.min(MAX_ROW_SPAN, w.grid.rowSpan + delta.rowSpan))
          : w.grid.rowSpan,
      },
    }
  })
  return normalizeLayout({ ...layout, widgets })
}

export function removeWidget(layout: ReportLayout, widgetId: string): ReportLayout {
  return normalizeLayout({
    ...layout,
    widgets: layout.widgets.filter((w) => w.id !== widgetId),
  })
}

export function duplicateWidget(layout: ReportLayout, widgetId: string): ReportLayout {
  const widgets = sortWidgets(layout.widgets)
  const index = widgets.findIndex((w) => w.id === widgetId)
  if (index < 0) return layout
  const source = widgets[index]!
  const clone: ReportWidget = {
    ...source,
    id: createWidgetId(),
    title: source.title ? `${source.title} (copy)` : source.title,
  }
  const next = [...widgets]
  next.splice(index + 1, 0, clone)
  return normalizeLayout({ ...layout, widgets: next }, true)
}

export function addWidgetFromCatalog(
  layout: ReportLayout,
  entry: WidgetCatalogEntry,
  overrides?: Partial<Pick<ReportWidget, 'title' | 'binding'>>,
): ReportLayout {
  const maxRow = layout.widgets.reduce((m, w) => Math.max(m, w.grid.row), -1)
  const widget: ReportWidget = {
    id: createWidgetId(),
    type: entry.type,
    binding: overrides?.binding ?? entry.binding,
    title: overrides?.title,
    grid: {
      col: 0,
      row: maxRow + 1,
      colSpan: entry.defaultColSpan,
      rowSpan: entry.defaultRowSpan,
    },
  }
  return normalizeLayout({ ...layout, widgets: [...layout.widgets, widget] })
}

export function updateWidget(
  layout: ReportLayout,
  widgetId: string,
  patch: Partial<Pick<ReportWidget, 'title' | 'binding' | 'type' | 'config'>>,
): ReportLayout {
  return {
    ...layout,
    widgets: layout.widgets.map((w) => (w.id === widgetId ? { ...w, ...patch } : w)),
  }
}

/** Sections whose written commentary a layout can place (the summary's lives in the executive summary). */
const COMMENTARY_SECTIONS: ReadonlyArray<SectionKey> = ['geo', 'ai_attribution', 'rankings', 'gsc', 'ga4', 'site_health', 'backlinks']

function isCommentarySection(section: string): section is SectionKey {
  return (COMMENTARY_SECTIONS as ReadonlyArray<string>).includes(section)
}

function sectionCommentaryWidget(id: string, section: SectionKey, entry: WidgetCatalogEntry, row: number): ReportWidget {
  return {
    id,
    type: entry.type,
    binding: entry.binding,
    config: { narrativeSection: section },
    grid: { col: 0, row, colSpan: GRID_COLUMNS, rowSpan: 1 },
  }
}

export function layoutFromSections(sections: SectionKey[]): ReportLayout {
  const widgets: ReportWidget[] = []
  let row = 0

  // Section header first (it is listed last in the catalog), then the section's data widgets.
  const headerFirst = (entries: WidgetCatalogEntry[]) =>
    [...entries].sort((a, b) => Number(b.type === 'section_header') - Number(a.type === 'section_header'))

  const commentary = WIDGET_CATALOG.find((e) => e.type === 'narrative')

  const pushRow = (rawEntries: WidgetCatalogEntry[]) => {
    const entries = headerFirst(rawEntries)
    let col = 0
    for (const entry of entries) {
      if (!sections.includes(entry.section as SectionKey) && entry.section !== 'narrative' && entry.section !== 'meta') {
        continue
      }
      const span = Math.min(entry.defaultColSpan, GRID_COLUMNS)
      if (col + span > GRID_COLUMNS) {
        row += 1
        col = 0
      }
      widgets.push({
        id: createWidgetId(),
        type: entry.type,
        binding: entry.binding,
        grid: { col, row, colSpan: span, rowSpan: entry.defaultRowSpan },
      })
      col += span
      if (col >= GRID_COLUMNS) {
        row += 1
        col = 0
      }
      // The written commentary for the section (narrative.sections.<key>) sits right under its
      // header; it renders only when the narrative has text for that section.
      if (entry.type === 'section_header' && commentary && isCommentarySection(entry.section)) {
        widgets.push(sectionCommentaryWidget(createWidgetId(), entry.section, commentary, row))
        row += 1
        col = 0
      }
    }
    row += 1
  }

  // Computed briefing first — the one block an agency owner reads before anything else.
  const briefing = WIDGET_CATALOG.find((e) => e.type === 'executive_briefing')
  if (briefing) {
    widgets.push({
      id: createWidgetId(),
      type: briefing.type,
      binding: briefing.binding,
      grid: { col: 0, row, colSpan: 12, rowSpan: 2 },
    })
    row += 2
  }

  // Trend across reports: where the client is going, one point per report (hidden until report #2).
  const history = WIDGET_CATALOG.find((e) => e.type === 'report_history')
  if (history) {
    widgets.push({
      id: createWidgetId(),
      type: history.type,
      binding: history.binding,
      grid: { col: 0, row, colSpan: 12, rowSpan: history.defaultRowSpan },
    })
    row += history.defaultRowSpan
  }

  // AI visibility hero after the briefing and the trend: the section no Google-only report can show.
  const hero = WIDGET_CATALOG.find((e) => e.type === 'ai_visibility_hero')
  if (hero && sections.includes('geo')) {
    widgets.push({
      id: createWidgetId(),
      type: hero.type,
      binding: hero.binding,
      grid: { col: 0, row, colSpan: 12, rowSpan: hero.defaultRowSpan },
    })
    row += hero.defaultRowSpan
  }

  if (sections.includes('summary')) {
    pushRow(WIDGET_CATALOG.filter((e) => e.section === 'summary' && e.type === 'kpi'))
  }

  // The LLM executive summary sits under the numbers it comments on.
  const exec = WIDGET_CATALOG.find((e) => e.type === 'executive_summary')
  if (exec) {
    widgets.push({
      id: createWidgetId(),
      type: exec.type,
      binding: exec.binding,
      grid: { col: 0, row, colSpan: 12, rowSpan: 2 },
    })
    row += 2
  }

  if (sections.includes('ai_attribution')) {
    pushRow(WIDGET_CATALOG.filter((e) => e.section === 'ai_attribution'))
  }
  if (sections.includes('rankings')) {
    pushRow(WIDGET_CATALOG.filter((e) => e.section === 'rankings'))
  }
  if (sections.includes('gsc')) {
    pushRow(WIDGET_CATALOG.filter((e) => e.section === 'gsc' && e.binding.metric !== 'gscAiOverviews'))
  }
  if (sections.includes('ga4')) {
    pushRow(WIDGET_CATALOG.filter((e) => e.section === 'ga4'))
  }
  if (sections.includes('site_health')) {
    pushRow(WIDGET_CATALOG.filter((e) => e.section === 'site_health'))
  }
  if (sections.includes('backlinks')) {
    pushRow(WIDGET_CATALOG.filter((e) => e.section === 'backlinks'))
  }

  const nextActions = WIDGET_CATALOG.find((e) => e.type === 'next_actions')
  if (nextActions) {
    widgets.push({
      id: createWidgetId(),
      type: nextActions.type,
      binding: nextActions.binding,
      grid: { col: 0, row, colSpan: 12, rowSpan: 2 },
    })
  }

  return normalizeLayout({ version: 1, columns: GRID_COLUMNS, widgets })
}

/**
 * Upgrade a layout that predates the insight blocks / story tables: prepend the briefing, the
 * trend across reports and the hero,
 * add the GSC/GA4 tables and the section commentary after their header. Idempotent and stable
 * (fixed widget ids, so React does not remount on every render); a layout the editor saved
 * (`insightBlocks: 'manual'`) is returned untouched so a deliberate removal sticks.
 */
export function withInsightBlocks(layout: ReportLayout, sections: SectionKey[]): ReportLayout {
  if (layout.insightBlocks === 'manual') return layout
  const has = (type: WidgetType) => layout.widgets.some((w) => w.type === type)
  const prepend: ReportWidget[] = []
  const briefing = WIDGET_CATALOG.find((e) => e.type === 'executive_briefing')
  if (briefing && !has('executive_briefing')) {
    prepend.push({ id: 'w_auto_briefing', type: briefing.type, binding: briefing.binding, grid: { col: 0, row: 0, colSpan: 12, rowSpan: 2 } })
  }
  const hero = WIDGET_CATALOG.find((e) => e.type === 'ai_visibility_hero')
  if (hero && sections.includes('geo') && !has('ai_visibility_hero')) {
    prepend.push({ id: 'w_auto_hero', type: hero.type, binding: hero.binding, grid: { col: 0, row: 0, colSpan: 12, rowSpan: hero.defaultRowSpan } })
  }
  const ordered = [...prepend, ...sortWidgets(layout.widgets)]

  // Trend across reports goes right after the briefing — the one already saved or the one just added.
  const history = WIDGET_CATALOG.find((e) => e.type === 'report_history')
  if (history && !has('report_history')) {
    const afterBriefing = ordered.findIndex((w) => w.type === 'executive_briefing') + 1
    ordered.splice(afterBriefing, 0, {
      id: 'w_auto_history',
      type: history.type,
      binding: history.binding,
      grid: { col: 0, row: 0, colSpan: 12, rowSpan: history.defaultRowSpan },
    })
    prepend.push(ordered[afterBriefing]!)
  }

  // "Which queries / which pages / which issues" tables, added after the last widget of their section.
  const tables: Array<{ id: string; section: SectionKey; metric: string }> = [
    { id: 'w_auto_gsc_queries', section: 'gsc', metric: 'topQueries' },
    { id: 'w_auto_gsc_pages', section: 'gsc', metric: 'topPages' },
    { id: 'w_auto_ga4_landing', section: 'ga4', metric: 'topLandingPages' },
    { id: 'w_auto_site_issues', section: 'site_health', metric: 'topIssues' },
  ]
  let changed = prepend.length > 0

  // The written summary is what the client reads first: right after the briefing, not below the
  // hero and the scorecard that were prepended above it.
  const briefingAt = ordered.findIndex((w) => w.type === 'executive_briefing')
  const summaryAt = ordered.findIndex((w) => w.type === 'executive_summary')
  if (summaryAt > briefingAt + 1) {
    const [summary] = ordered.splice(summaryAt, 1)
    ordered.splice(briefingAt + 1, 0, summary!)
    changed = true
  }

  for (const table of tables) {
    if (!sections.includes(table.section)) continue
    if (ordered.some((w) => w.binding.section === table.section && w.binding.metric === table.metric)) continue
    const entry = WIDGET_CATALOG.find((e) => e.binding.section === table.section && e.binding.metric === table.metric)
    if (!entry) continue
    const lastOfSection = ordered.map((w) => w.binding.section).lastIndexOf(table.section)
    if (lastOfSection < 0) continue // section has no widgets at all: the author removed it on purpose
    ordered.splice(lastOfSection + 1, 0, {
      id: table.id,
      type: entry.type,
      binding: entry.binding,
      grid: { col: 0, row: 0, colSpan: entry.defaultColSpan, rowSpan: entry.defaultRowSpan },
    })
    changed = true
  }

  // Section commentary under each header (layouts saved before the widget was placed by default).
  const commentary = WIDGET_CATALOG.find((e) => e.type === 'narrative')
  if (commentary) {
    for (const section of COMMENTARY_SECTIONS) {
      if (!sections.includes(section)) continue
      if (ordered.some((w) => w.type === 'narrative' && (w.config?.narrativeSection ?? w.binding.metric) === section)) continue
      const header = ordered.findIndex((w) => w.type === 'section_header' && w.binding.section === section)
      if (header < 0) continue // no header: the author laid the section out by hand, leave it alone
      ordered.splice(header + 1, 0, sectionCommentaryWidget(`w_auto_commentary_${section}`, section, commentary, 0))
      changed = true
    }
  }

  if (!changed) return layout
  return normalizeLayout({ ...layout, widgets: ordered }, true)
}

export function bindingsForSection(section: SectionKey | 'narrative' | 'meta'): WidgetCatalogEntry[] {
  return WIDGET_CATALOG.filter((e) => e.section === section)
}

export function isValidLayout(raw: unknown): raw is ReportLayout {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as ReportLayout
  return o.version === 1 && Array.isArray(o.widgets)
}

export function layoutWidgetKeys(layout: ReportLayout): Set<string> {
  return new Set(layout.widgets.map((w) => bindingKey(w.binding)))
}

export function mergeLayoutWithSections(layout: ReportLayout, sections: SectionKey[]): ReportLayout {
  const allowed = new Set(sections)
  const filtered = layout.widgets.filter((w) => {
    const sec = w.binding.section
    if (sec === 'narrative' || sec === 'meta') return true
    return allowed.has(sec)
  })
  return normalizeLayout({ ...layout, widgets: filtered })
}

export type { DataBinding, ReportLayout, ReportWidget, WidgetType }

type LayoutWidget = ReportLayout['widgets'][number]

/**
 * A print chunk: `keep` (a section header + the first row under it) never splits across pages —
 * unless that first row holds a table (`splittable`), which may run longer than a page: then the
 * wrapper must be allowed to break, or the whole block jumps to the next page and the table is cut.
 */
export type PrintChunk = { keep: LayoutWidget[]; rest: LayoutWidget[]; splittable?: boolean }

/**
 * Split an ordered widget list so each section header stays glued to the first row below it.
 * CSS `break-after: avoid` on a grid item is ignored by Chrome, so the header and its first row
 * are rendered inside one `break-inside: avoid` wrapper instead; everything else flows freely.
 */
export function chunkWidgetsForPrint(widgets: LayoutWidget[]): PrintChunk[] {
  const chunks: PrintChunk[] = []
  let current: PrintChunk = { keep: [], rest: [] }
  let firstRowAfterHeader: number | null = null
  const flush = () => {
    if (current.keep.length > 0 || current.rest.length > 0) chunks.push(current)
  }
  for (const w of widgets) {
    if (w.type === 'section_header') {
      flush()
      current = { keep: [w], rest: [] }
      firstRowAfterHeader = null
      continue
    }
    if (current.keep.length > 0 && current.rest.length === 0) {
      if (firstRowAfterHeader === null) firstRowAfterHeader = w.grid.row
      if (w.grid.row === firstRowAfterHeader) {
        current.keep.push(w)
        if (w.type === 'table') current.splittable = true
        continue
      }
    }
    current.rest.push(w)
  }
  flush()
  return chunks
}

/** One grid of the rendered report body, kept whole on a page unless it holds a table. */
export type PrintBlock = { widgets: LayoutWidget[]; splittable: boolean }

/**
 * The report body as print blocks: a section header glued to the row under it, then every further
 * row on its own (rows come from reflowRows, so this is exactly how one big grid would place them).
 * Each block is rendered as its own grid because Chrome ignores `break-inside: avoid` on grid
 * items: in a single grid, KPI tiles split across two PDF pages.
 */
export function printBlocks(widgets: LayoutWidget[]): PrintBlock[] {
  const blocks: PrintBlock[] = []
  for (const chunk of chunkWidgetsForPrint(widgets)) {
    if (chunk.keep.length > 0) blocks.push({ widgets: chunk.keep, splittable: chunk.splittable === true })
    let row: PrintBlock | null = null
    for (const w of chunk.rest) {
      if (!row || row.widgets[0]!.grid.row !== w.grid.row) {
        row = { widgets: [], splittable: false }
        blocks.push(row)
      }
      row.widgets.push(w)
      if (w.type === 'table') row.splittable = true
    }
  }
  return blocks
}

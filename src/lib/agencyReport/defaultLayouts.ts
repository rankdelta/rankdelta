import { ALL_SECTION_KEYS, type SectionKey } from './sections'
import { layoutFromSections, normalizeLayout, type ReportLayout } from './layout'
import { createWidgetId, type ReportWidget } from './widgets'

export interface ReportTemplatePreset {
  id: string
  nameKey: string
  descriptionKey: string
  build: (sections?: SectionKey[]) => ReportLayout
}

function kpiRow(section: SectionKey, metrics: string[], row: number): ReportWidget[] {
  const span = Math.floor(12 / metrics.length)
  return metrics.map((metric, i) => {
    return {
      id: createWidgetId(),
      type: 'kpi' as const,
      binding: { section, metric },
      grid: { col: i * span, row, colSpan: span, rowSpan: 1 },
    }
  })
}

export const BUILTIN_TEMPLATE_PRESETS: ReportTemplatePreset[] = [
  {
    id: 'full',
    nameKey: 'agencyReport.builder.templates.full',
    descriptionKey: 'agencyReport.builder.templates.fullDesc',
    build: (sections = ALL_SECTION_KEYS) => layoutFromSections(sections),
  },
  {
    id: 'executive',
    nameKey: 'agencyReport.builder.templates.executive',
    descriptionKey: 'agencyReport.builder.templates.executiveDesc',
    build: () =>
      normalizeLayout({
        version: 1,
        columns: 12,
        widgets: [
          {
            id: createWidgetId(),
            type: 'executive_summary',
            binding: { section: 'narrative', metric: 'executiveSummary' },
            grid: { col: 0, row: 0, colSpan: 12, rowSpan: 2 },
          },
          ...kpiRow('summary', ['healthScore', 'aiSov', 'gscClicks', 'ga4Sessions'], 2),
          {
            id: createWidgetId(),
            type: 'line_chart',
            binding: { section: 'geo', metric: 'trend' },
            grid: { col: 0, row: 3, colSpan: 8, rowSpan: 2 },
          },
          {
            id: createWidgetId(),
            type: 'bar_chart',
            binding: { section: 'ai_attribution', metric: 'byEngine' },
            grid: { col: 0, row: 5, colSpan: 8, rowSpan: 2 },
          },
          {
            id: createWidgetId(),
            type: 'next_actions',
            binding: { section: 'narrative', metric: 'nextActions' },
            grid: { col: 0, row: 7, colSpan: 12, rowSpan: 2 },
          },
        ],
      }),
  },
  {
    id: 'seo',
    nameKey: 'agencyReport.builder.templates.seo',
    descriptionKey: 'agencyReport.builder.templates.seoDesc',
    build: () =>
      normalizeLayout({
        version: 1,
        columns: 12,
        widgets: [
          ...kpiRow('gsc', ['clicks', 'impressions', 'ctr', 'avgPosition'], 0),
          {
            id: createWidgetId(),
            type: 'line_chart',
            binding: { section: 'gsc', metric: 'trend' },
            grid: { col: 0, row: 1, colSpan: 12, rowSpan: 2 },
          },
          {
            id: createWidgetId(),
            type: 'kpi',
            binding: { section: 'rankings', metric: 'avgPosition' },
            grid: { col: 0, row: 3, colSpan: 4, rowSpan: 1 },
          },
          {
            id: createWidgetId(),
            type: 'pie_chart',
            binding: { section: 'rankings', metric: 'distribution' },
            grid: { col: 0, row: 4, colSpan: 6, rowSpan: 2 },
          },
          {
            id: createWidgetId(),
            type: 'table',
            binding: { section: 'rankings', metric: 'topMovers' },
            grid: { col: 6, row: 4, colSpan: 6, rowSpan: 2 },
          },
        ],
      }),
  },
  {
    id: 'geo_focus',
    nameKey: 'agencyReport.builder.templates.geo',
    descriptionKey: 'agencyReport.builder.templates.geoDesc',
    build: () =>
      normalizeLayout({
        version: 1,
        columns: 12,
        widgets: [
          {
            id: createWidgetId(),
            type: 'ai_visibility_hero',
            binding: { section: 'geo', metric: 'hero' },
            grid: { col: 0, row: 0, colSpan: 12, rowSpan: 3 },
          },
          {
            id: createWidgetId(),
            type: 'bar_chart',
            binding: { section: 'ai_attribution', metric: 'byEngine' },
            grid: { col: 0, row: 3, colSpan: 6, rowSpan: 2 },
          },
          {
            id: createWidgetId(),
            type: 'table',
            binding: { section: 'ai_attribution', metric: 'topAiReferredLandingPages' },
            grid: { col: 6, row: 3, colSpan: 6, rowSpan: 2 },
          },
        ],
      }),
  },
]

export function getBuiltinTemplate(id: string): ReportTemplatePreset | undefined {
  return BUILTIN_TEMPLATE_PRESETS.find((t) => t.id === id)
}

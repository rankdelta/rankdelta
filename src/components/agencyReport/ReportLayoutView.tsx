import { useMemo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientReportSnapshot, ReportData } from '../../lib/agencyReport/types'
import { GRID_COLUMNS, printBlocks, reflowRows, sortWidgets, type PrintBlock, type ReportLayout } from '../../lib/agencyReport/layout'
import { auditDateBeforePeriod, derivePeriodHeadline } from '../../lib/agencyReport/reportUi'
import { visibleWidgets, widgetDataState } from '../../lib/agencyReport/widgetData'
import { getWhiteLabelBranding, type WhiteLabelReportBranding } from '../../lib/whiteLabelReport'
import { resolveReportHistory } from '../../lib/agencyReport/history'
import { useReportHistoryContext } from './ReportHistoryContext'
import { ReportWidgetRenderer } from './widgets/ReportWidgetRenderer'

function resolveBranding(raw: ClientReportSnapshot['branding'], isAgency: boolean): WhiteLabelReportBranding {
  if (raw && typeof raw === 'object') {
    return getWhiteLabelBranding({ metadata: { white_label_report: raw } }, isAgency)
  }
  return getWhiteLabelBranding(null, isAgency)
}

interface ReportLayoutViewProps {
  report: ClientReportSnapshot
  layout: ReportLayout
  projectName?: string | null
  websiteUrl?: string | null
  isAgency?: boolean
  readOnly?: boolean
}

export function ReportLayoutView({
  report,
  layout,
  projectName,
  websiteUrl,
  isAgency = false,
  readOnly = false,
}: ReportLayoutViewProps) {
  const { t, i18n } = useTranslation()
  const branding = resolveBranding(report.branding, isAgency)
  const locale = i18n.language.startsWith('it') ? 'it-IT' : 'en-US'
  const historyCtx = useReportHistoryContext()
  const history = useMemo(() => resolveReportHistory(report, historyCtx.history), [report, historyCtx.history])

  // Only widgets with something to show: a sparse report reads as a short report, never as a
  // wall of "not connected" tiles in front of the client.
  // Re-pack after filtering so hidden widgets leave no gaps in the grid. A connected-but-empty
  // section collapses to one guidance note, which reads best on a full-width row.
  const widgets = useMemo(
    () =>
      reflowRows(
        visibleWidgets(sortWidgets(layout.widgets), report, { history }).map((w) =>
          widgetDataState(w, report, { history }) === 'guidance' ? { ...w, grid: { ...w.grid, colSpan: GRID_COLUMNS } } : w,
        ),
      ),
    [layout.widgets, report, history],
  )

  const periodLabel = useMemo(() => {
    const fmt = (d: string) =>
      new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
    return `${fmt(report.period_start)} – ${fmt(report.period_end)}`
  }, [report.period_start, report.period_end, locale])

  const createdLabel = useMemo(() => {
    return new Date(report.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  }, [report.created_at, locale])

  const headlineLabels = useMemo(
    () => ({
      healthScore: t('resultsPage.healthLabel'),
      aiSov: t('agencyReport.shareOfVoice'),
      avgPosition: t('resultsPage.avgPosition'),
      gscClicks: t('agencyReport.gscClicks'),
      ga4Sessions: t('agencyReport.ga4Sessions'),
      aiSessions: t('agencyReport.aiSessions'),
    }),
    [t],
  )
  const periodHeadline = useMemo(
    () =>
      derivePeriodHeadline(
        (report.data as ReportData | undefined)?.summary,
        headlineLabels,
        t,
        locale,
        auditDateBeforePeriod((report.data as ReportData | undefined)?.site_health, report.period_start, locale),
      ),
    [report.data, report.period_start, headlineLabels, t, locale],
  )

  const displayUrl = (websiteUrl ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
    gridAutoRows: 'auto',
    gap: '12px',
  }
  const renderWidget = (widget: (typeof widgets)[number]) => (
    <div
      key={widget.id}
      className={
        widget.type === 'section_header' || widget.type === 'kpi' || widget.type === 'executive_briefing' || widget.type === 'report_history' || widget.type === 'ai_visibility_hero' || widget.type === 'executive_summary' || widget.type === 'next_actions' || widget.type === 'narrative'
          ? 'pdf-export-group break-inside-avoid-page'
          : widget.type === 'table'
            ? 'pdf-export-group pdf-export-splittable rounded-xl border border-gray-100 bg-white p-3'
            : 'pdf-export-group rounded-xl border border-gray-100 bg-white p-3 break-inside-avoid-page'
      }
      style={{ gridColumn: `${widget.grid.col + 1} / span ${widget.grid.colSpan}` }}
    >
      <ReportWidgetRenderer widget={widget} report={report} />
    </div>
  )

  // Each block is its own grid, kept whole in print (see printBlocks); a block holding a table may continue.
  const blocks = printBlocks(widgets)
  const lastBlock = blocks[blocks.length - 1]
  const renderBlock = (block: PrintBlock, index: number) => (
    <div
      key={block.widgets[0]!.id}
      data-testid="report-print-block"
      className={block.splittable ? 'pdf-keep-together pdf-keep-together-splittable' : 'pdf-keep-together'}
      style={{ ...gridStyle, marginTop: index === 0 ? 0 : 12 }}
    >
      {block.widgets.map(renderWidget)}
    </div>
  )

  return (
    <div
      className="agency-report-view mx-auto max-w-[900px] bg-white text-gray-900 rounded-2xl print:my-0 print:rounded-none shadow-xl print:shadow-none p-4 sm:p-10"
      style={{ '--report-accent': branding.primaryColor } as CSSProperties}
    >
      <header
        className="agency-report-cover pdf-export-group pdf-export-cover rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-5 sm:p-8 print:border-gray-300"
        style={{ borderLeftWidth: 4, borderLeftColor: branding.primaryColor }}
      >
        {branding.logoUrl && (
          <img
            src={branding.logoUrl}
            alt={branding.agencyName ?? ''}
            className="h-10 mb-3 object-contain max-w-[200px] print:max-h-12"
          />
        )}
        <p className="text-xs font-semibold tracking-[0.18em] uppercase" style={{ color: branding.primaryColor }}>
          {branding.agencyName ?? t('agencyReport.reportEyebrow')}
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold mt-2 leading-tight">
          {projectName ?? t('resultsPage.yourSiteFallback')}
        </h1>
        {displayUrl && <p className="text-base font-medium text-gray-700 mt-1">{displayUrl}</p>}
        <p className="text-sm text-gray-500 mt-2 font-medium">{periodLabel}</p>
        {periodHeadline && (
          <p className="mt-4 text-sm text-gray-600 leading-relaxed border-t border-gray-200 pt-4">{periodHeadline}</p>
        )}
        {readOnly && (
          <p className="text-[11px] text-gray-500 mt-2">{t('agencyReport.readOnlyHint', { date: createdLabel })}</p>
        )}
      </header>

      <div className="mt-6">
        {blocks.slice(0, -1).map(renderBlock)}
        {/* The last block and the closing line share one box, so the line never sits alone on a page. */}
        <div className={lastBlock?.splittable ? undefined : 'pdf-keep-together'}>
          {lastBlock && renderBlock(lastBlock, blocks.length - 1)}
          <footer className="agency-report-endnote pdf-export-group mt-8 pt-4 border-t border-gray-200 text-[11px] text-gray-500 flex flex-wrap justify-between gap-2 print:mt-3 print:pt-2">
            <span>{t(branding.hideAstroSeoFooter ? 'resultsPage.generatedOn' : 'resultsPage.generatedBy', { date: createdLabel })}</span>
            <span className="font-medium" style={{ color: branding.primaryColor }}>
              {[branding.hideAstroSeoFooter ? branding.agencyName : branding.agencyName ?? t('agencyReport.poweredBy'), periodLabel]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </footer>
        </div>
      </div>
    </div>
  )
}

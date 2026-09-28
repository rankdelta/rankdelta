import { useMemo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { AreaChart, BarChart } from '@tremor/react'
import { isConnectedSection, type SectionKey } from '../../lib/agencyReport/sections'
import { engineLabel } from '../../lib/agencyReport/insights'
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
} from '../../lib/agencyReport/types'
import {
  chartColors,
  auditDateBeforePeriod,
  derivePeriodHeadline,
  fmtAxisDate,
  fmtCompactNum,
  fmtPct,
  formatScorecardValue,
  kpiSparklineSeries,
  priorPeriodOverlay,
  SCORECARD_KPIS,
  SECTION_CONNECT_KEYS,
  SECTION_DESC_KEYS,
  fmtDecimals,
  fmtPosition,
  fmtWholeNumber,
} from '../../lib/agencyReport/reportUi'
import { getWhiteLabelBranding, type WhiteLabelReportBranding } from '../../lib/whiteLabelReport'
import { isValidLayout, withInsightBlocks } from '../../lib/agencyReport/layout'
import { resolveReportHistory, scorecardVsReport } from '../../lib/agencyReport/history'
import {
  connectedButEmpty,
  emptyStateTimestamp,
  fmtGuidanceDate,
  SECTION_EMPTY_KEYS,
  type EmptyGuidanceSection,
} from '../../lib/agencyReport/emptyStates'
import { AiVisibilityHero } from './AiVisibilityHero'
import { ExecutiveBriefing } from './ExecutiveBriefing'
import { historyChipDigits, ReportHistoryBlock } from './ReportHistory'
import { useReportHistoryContext } from './ReportHistoryContext'
import { aiAttributionHasVisits, backlinksNeverAnalysed } from '../../lib/agencyReport/widgetData'
import { SiteHealthIssuesTable } from './widgets/ReportWidgetRenderer'
import { RankDistributionBar, RankMovers } from './RankingsStory'
import { ReportLayoutView } from './ReportLayoutView'
import { Ga4LandingPagesTable, GscTopTable } from './SearchTables'
import { ReportKpiCard } from './ReportKpiCard'
import {
  ConnectPrompt,
  EmptyStateNote,
  NarrativeBlock,
  ReportDataTable,
  ScorecardKpi,
  SectionShell,
} from './reportPrimitives'

function fmtNum(v: number | null | undefined) {
  return fmtWholeNumber(v)
}

function resolveBranding(raw: ClientReportSnapshot['branding'], isAgency: boolean): WhiteLabelReportBranding {
  if (raw && typeof raw === 'object') {
    return getWhiteLabelBranding({ metadata: { white_label_report: raw } }, isAgency)
  }
  return getWhiteLabelBranding(null, isAgency)
}

function sectionNarrative(report: ClientReportSnapshot, key: string): string | null {
  const sections = report.narrative?.sections
  if (!sections || typeof sections !== 'object') return null
  const text = (sections as Record<string, unknown>)[key]
  return typeof text === 'string' && text.trim() ? text : null
}

function annotationFor(report: ClientReportSnapshot, section: SectionKey | 'summary'): string | null {
  const items = report.data?.meta?.annotations ?? []
  const hit = items.find((a) => a.section === section)
  return hit?.text ?? null
}

interface ClientReportViewProps {
  report: ClientReportSnapshot
  projectName?: string | null
  websiteUrl?: string | null
  isAgency?: boolean
  readOnly?: boolean
}

export function ClientReportView({
  report,
  projectName,
  websiteUrl,
  isAgency = false,
  readOnly = false,
}: ClientReportViewProps) {
  const { t, i18n } = useTranslation()
  const branding = resolveBranding(report.branding, isAgency)
  // Layouts saved before the insight blocks existed get them prepended at render time.
  const layout = useMemo(
    () => (report.layout && isValidLayout(report.layout) ? withInsightBlocks(report.layout, report.sections ?? []) : null),
    [report.layout, report.sections],
  )
  // Sibling reports: fetched in-app, or the compact history the snapshot carries (share page, PDF).
  const historyCtx = useReportHistoryContext()
  const history = useMemo(() => resolveReportHistory(report, historyCtx.history), [report, historyCtx.history])

  const data = (report.data ?? {}) as ReportData
  const goals = report.goals ?? {}
  const enabled = new Set(report.sections ?? [])
  const geo = isConnectedSection<GeoSectionData>(data.geo) ? data.geo : null
  // Without GA4 the per-engine "attribution" chart would only repeat share of voice under another title.
  const aiAttr = isConnectedSection<AiAttributionSectionData>(data.ai_attribution) && aiAttributionHasVisits(data) ? data.ai_attribution : null
  const rankingsRaw = isConnectedSection<RankingsSectionData>(data.rankings) ? data.rankings : null
  const rankingsHaveData =
    !!rankingsRaw &&
    (rankingsRaw.avgPosition?.value != null ||
      Object.values(rankingsRaw.distribution ?? {}).some((v) => (Number(v) || 0) > 0) ||
      (rankingsRaw.topMovers ?? []).some((m) => typeof m.delta === 'number' && m.delta !== 0))
  const rankings = rankingsHaveData ? rankingsRaw : null
  const gsc = isConnectedSection<GscSectionData>(data.gsc) ? data.gsc : null
  const ga4 = isConnectedSection<Ga4SectionData>(data.ga4) ? data.ga4 : null
  const siteHealth = isConnectedSection<SiteHealthSectionData>(data.site_health) ? data.site_health : null
  // 0/0/null = the domain was never analysed in Site Explorer → same treatment as a disconnected source.
  const backlinks = isConnectedSection<BacklinksSectionData>(data.backlinks) && !backlinksNeverAnalysed(data) ? data.backlinks : null

  const locale = i18n.language.startsWith('it') ? 'it-IT' : 'en-US'
  const [chartPrimary, chartMuted, chartAccent] = chartColors(branding.primaryColor)
  const priorLabel = t('agencyReport.priorPeriod')
  const sovLabel = t('agencyReport.series.sov')
  const clicksLabel = t('agencyReport.series.clicks')
  const impressionsLabel = t('agencyReport.series.impressions')
  const sessionsLabel = t('agencyReport.series.sessions')

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
    () => derivePeriodHeadline(data.summary, headlineLabels, t, locale, auditDateBeforePeriod(data.site_health, report.period_start, locale)),
    [data.summary, data.site_health, report.period_start, headlineLabels, t, locale],
  )

  // Every hook above runs on both paths: a report can gain a layout while mounted (editor).
  if (layout && layout.widgets.length > 0) {
    return (
      <ReportLayoutView
        report={report}
        layout={layout}
        projectName={projectName}
        websiteUrl={websiteUrl}
        isAgency={isAgency}
        readOnly={readOnly}
      />
    )
  }

  const displayUrl = (websiteUrl ?? '').replace(/^https?:\/\//, '')

  const renderConnect = (section: SectionKey) => (
    <ConnectPrompt message={t(SECTION_CONNECT_KEYS[section])} />
  )
  const auditedOn = (iso: string | null | undefined) => {
    const date = fmtGuidanceDate(iso, locale)
    return date ? t('agencyReport.auditedOn', { date }) : null
  }
  // Connected source, nothing this period: a dated note instead of a row of zeros.
  const renderEmpty = (section: EmptyGuidanceSection) => {
    const date = fmtGuidanceDate(emptyStateTimestamp(data, section), locale)
    const meta = date ? (section === 'site_health' ? t('agencyReport.auditedOn', { date }) : t('agencyReport.emptyState.asOf', { date })) : null
    return <EmptyStateNote message={t(SECTION_EMPTY_KEYS[section])} meta={meta} />
  }
  // Client-facing (read-only) view: a disconnected source is simply absent, never a "connect" nag.
  const showSection = (section: SectionKey, connected: boolean) => enabled.has(section) && (connected || !readOnly)

  const valueFormatter = (v: number) => fmtCompactNum(v)
  const showHero = enabled.has('geo') && !!geo && !connectedButEmpty(data, 'geo')

  return (
    <div
      className="agency-report-view relative mx-auto max-w-[820px] bg-white text-gray-900 rounded-2xl print:my-0 print:rounded-none shadow-xl print:shadow-none"
      style={{ '--report-accent': branding.primaryColor } as CSSProperties}
    >
      {/* Cover / hero — own print page */}
      <header className="agency-report-cover pdf-export-group pdf-export-cover px-4 sm:px-10 pt-4 sm:pt-10 pb-8 print:break-after-page">
        <div
          className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-5 sm:p-8 print:border-gray-300"
          style={{ borderLeftWidth: 4, borderLeftColor: branding.primaryColor }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {branding.logoUrl && (
                <img
                  src={branding.logoUrl}
                  alt={branding.agencyName ?? ''}
                  className="h-10 mb-3 object-contain max-w-[200px] print:max-h-12"
                />
              )}
              <p
                className="text-xs font-semibold tracking-[0.18em] uppercase"
                style={{ color: branding.primaryColor }}
              >
                {branding.agencyName ?? t('agencyReport.reportEyebrow')}
              </p>
              <h1 className="text-2xl sm:text-3xl font-bold mt-2 text-gray-900 leading-tight">
                {projectName ?? t('resultsPage.yourSiteFallback')}
              </h1>
              {displayUrl && (
                <p className="text-base font-medium text-gray-700 mt-1">{displayUrl}</p>
              )}
              <p className="text-sm text-gray-500 mt-2 font-medium">{periodLabel}</p>
              {periodHeadline && (
                <p className="mt-4 text-sm text-gray-600 leading-relaxed border-t border-gray-200 pt-4">
                  {periodHeadline}
                </p>
              )}
              {readOnly && (
                <p className="text-[11px] text-gray-400 mt-2">{t('agencyReport.readOnlyHint', { date: createdLabel })}</p>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="agency-report-body px-4 sm:px-10 pb-4 sm:pb-10">
        {/* Executive briefing — wins, watch, next actions computed from the data */}
        <div className="pdf-export-group mb-8">
          <ExecutiveBriefing data={data} accentColor={branding.primaryColor} />
        </div>

        {/* The written summary right after the briefing: it is what the client reads first, not after the charts */}
        {report.narrative?.executiveSummary && (
          <div className="pdf-export-group mb-8">
            <NarrativeBlock title={t('agencyReport.executiveSummary')}>
              <p>{report.narrative.executiveSummary}</p>
            </NarrativeBlock>
          </div>
        )}

        {/* Trend across reports — where the client is going, one point per report (needs two) */}
        {history && history.length >= 2 && (
          <div className="pdf-export-group mb-8">
            <ReportHistoryBlock history={history} currentReportId={report.id} accentColor={branding.primaryColor} />
          </div>
        )}

        {/* AI visibility hero — the section no Google-only report can show */}
        {showHero && (
          <div className="pdf-export-group mb-8">
            <AiVisibilityHero data={data} accentColor={branding.primaryColor} />
          </div>
        )}

        {/* At-a-glance scorecard */}
        {enabled.has('summary') && data.summary && (
          <section aria-label={t('agencyReport.scorecardTitle')} className="pdf-export-group mb-8 print:break-inside-avoid">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
              {t('agencyReport.scorecardTitle')}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              {SCORECARD_KPIS.map(({ key, goalKey, labelKey, positiveIsGood, format }) => {
                const metric = data.summary![key]
                if (!metric || typeof metric !== 'object' || !('value' in metric)) return null
                const vs = historyCtx.compareWithPrevious ? scorecardVsReport(history, report.id, key, metric) : null
                return (
                  <ScorecardKpi
                    key={key}
                    label={t(labelKey)}
                    value={formatScorecardValue(metric.value, format)}
                    metric={metric}
                    positiveIsGood={positiveIsGood}
                    target={goals[goalKey]}
                    targetLabel={t('agencyReport.goal')}
                    targetDisplay={goals[goalKey] != null ? formatScorecardValue(goals[goalKey]!, format) : undefined}
                    accentColor={branding.primaryColor}
                    trend={kpiSparklineSeries(data, 'summary', key)}
                    vsReport={vs ? { delta: vs.delta, label: t('agencyReport.history.vsPreviousReport'), digits: historyChipDigits(vs.key) } : null}
                  />
                )
              })}
            </div>
          </section>
        )}

        {enabled.has('summary') && data.summary && (sectionNarrative(report, 'summary') || annotationFor(report, 'summary')) && (
          <SectionShell
            id="summary"
            title={t('agencyReport.sections.summary')}
            description={t(SECTION_DESC_KEYS.summary)}
            iconKey="summary"
          >
            {sectionNarrative(report, 'summary') && (
              <p className="text-sm text-gray-600 mb-3">{sectionNarrative(report, 'summary')}</p>
            )}
            {annotationFor(report, 'summary') && (
              <p className="text-xs italic text-gray-500">{annotationFor(report, 'summary')}</p>
            )}
          </SectionShell>
        )}

        {showSection('geo', !!geo) && !showHero && (
          <SectionShell
            id="geo"
            title={t('agencyReport.sections.geo')}
            description={t(SECTION_DESC_KEYS.geo)}
            iconKey="geo"
          >
            {!geo ? (
              renderConnect('geo')
            ) : connectedButEmpty(data, 'geo') ? (
              renderEmpty('geo')
            ) : (
              <>
                {sectionNarrative(report, 'geo') && (
                  <p className="text-sm text-gray-600 mb-4">{sectionNarrative(report, 'geo')}</p>
                )}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <ReportKpiCard label={t('agencyReport.shareOfVoice')} metric={geo.sovOverall} format={(v) => fmtPct(v)} trend={kpiSparklineSeries(data, 'geo', 'sovOverall')} deltaUnit="pt" deltaDigits={1} />
                  <ReportKpiCard label={t('agencyReport.citationRate')} metric={geo.citationRate} format={(v) => fmtPct(v)} deltaUnit="pt" deltaDigits={1} />
                </div>
                {geo.trend.length > 1 && (
                  <div className="mt-2" role="img" aria-label={t('agencyReport.chart.sovTrend')}>
                    <p className="text-xs font-medium text-gray-500 mb-1">{t('agencyReport.chart.sovTrend')}</p>
                    <AreaChart
                      className="h-40 print:h-36"
                      data={priorPeriodOverlay(
                        geo.trend.map((d) => ({
                          date: fmtAxisDate(d.date, locale),
                          [sovLabel]: d.sovPercent ?? 0,
                        })),
                        geo.sovOverall,
                        sovLabel,
                        priorLabel,
                      )}
                      index="date"
                      categories={
                        geo.sovOverall.delta != null ? [sovLabel, priorLabel] : [sovLabel]
                      }
                      colors={[chartPrimary, chartMuted]}
                      showLegend={geo.sovOverall.delta != null}
                      showYAxis
                      showGridLines
                      valueFormatter={valueFormatter}
                      yAxisWidth={48}
                    />
                  </div>
                )}
                {geo.sovByEngine.length > 0 && (
                  <div className="mt-4" role="img" aria-label={t('agencyReport.chart.sovByEngine')}>
                    <p className="text-xs font-medium text-gray-500 mb-1">{t('agencyReport.chart.sovByEngine')}</p>
                    <BarChart
                      className="h-44 print:h-40"
                      data={geo.sovByEngine.map((e) => ({ engine: engineLabel(e.engine), [sovLabel]: e.sovPercent ?? 0 }))}
                      index="engine"
                      categories={[sovLabel]}
                      colors={[chartPrimary]}
                      showLegend={false}
                      valueFormatter={(v) => fmtPct(v)}
                    />
                  </div>
                )}
              </>
            )}
          </SectionShell>
        )}

        {showSection('ai_attribution', !!aiAttr) && (
          <SectionShell
            id="ai_attribution"
            title={t('agencyReport.sections.ai_attribution')}
            description={t(SECTION_DESC_KEYS.ai_attribution)}
            iconKey="ai_attribution"
          >
            {!aiAttr ? (
              renderConnect('ai_attribution')
            ) : (
              <>
                {sectionNarrative(report, 'ai_attribution') && (
                  <p className="text-sm text-gray-600 mb-4">{sectionNarrative(report, 'ai_attribution')}</p>
                )}
                <div role="img" aria-label={t('agencyReport.chart.aiAttribution')}>
                  <p className="text-xs font-medium text-gray-500 mb-1">{t('agencyReport.chart.aiAttribution')}</p>
                  <BarChart
                    className="h-44 print:h-40"
                    data={(aiAttr.byEngine ?? [])
                      .filter((e) => e.sovPercent != null || (engineSessions(e) ?? 0) > 0)
                      .map((e) => ({
                        engine: engineLabel(e.engine),
                        [sovLabel]: e.sovPercent ?? 0,
                        [sessionsLabel]: engineSessions(e) ?? 0,
                      }))}
                    index="engine"
                    categories={[sovLabel, sessionsLabel]}
                    colors={[chartPrimary, chartAccent]}
                    valueFormatter={valueFormatter}
                  />
                </div>
              </>
            )}
          </SectionShell>
        )}

        {showSection('rankings', !!rankings) && (
          <SectionShell
            id="rankings"
            title={t('agencyReport.sections.rankings')}
            description={t(SECTION_DESC_KEYS.rankings)}
            iconKey="rankings"
          >
            {!rankings ? (
              renderConnect('rankings')
            ) : (
              <>
                {sectionNarrative(report, 'rankings') && (
                  <p className="text-sm text-gray-600 mb-4">{sectionNarrative(report, 'rankings')}</p>
                )}
                <ReportKpiCard
                  label={t('resultsPage.avgPosition')}
                  metric={rankings.avgPosition}
                  format={fmtPosition}
                  positiveIsGood={false}
                  target={goals.avgPosition}
                  targetLabel={t('agencyReport.goal')}
                  deltaDigits={1}
                />
                <div className="mt-4">
                  <RankDistributionBar
                    distribution={rankings.distribution}
                    table={rankings.table}
                    accentColor={branding.primaryColor}
                    title={t('agencyReport.chart.rankDistribution')}
                  />
                </div>
                {rankings.topMovers.length > 0 && (
                  <div className="mt-5">
                    <RankMovers movers={rankings.topMovers} title={t('agencyReport.topMovers')} />
                  </div>
                )}
              </>
            )}
          </SectionShell>
        )}

        {showSection('gsc', !!gsc) && (
          <SectionShell
            id="gsc"
            title={t('agencyReport.sections.gsc')}
            description={t(SECTION_DESC_KEYS.gsc)}
            iconKey="gsc"
          >
            {!gsc ? (
              renderConnect('gsc')
            ) : connectedButEmpty(data, 'gsc') ? (
              renderEmpty('gsc')
            ) : (
              <>
                {sectionNarrative(report, 'gsc') && (
                  <p className="text-sm text-gray-600 mb-4">{sectionNarrative(report, 'gsc')}</p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <ReportKpiCard label={t('agencyReport.gscClicks')} metric={gsc.clicks} format={fmtNum} target={goals.gscClicks} targetLabel={t('agencyReport.goal')} trend={kpiSparklineSeries(data, 'gsc', 'clicks')} deltaDigits={0} />
                  <ReportKpiCard label={t('agencyReport.impressions')} metric={gsc.impressions} format={fmtNum} trend={kpiSparklineSeries(data, 'gsc', 'impressions')} deltaDigits={0} />
                  <ReportKpiCard label={t('agencyReport.ctr')} metric={gsc.ctr} format={(v) => fmtPct(v)} deltaUnit="pt" deltaDigits={1} />
                  <ReportKpiCard label={t('resultsPage.avgPosition')} metric={gsc.avgPosition} format={(v) => (v != null ? fmtDecimals(v, 1) : '—')} positiveIsGood={false} deltaDigits={1} />
                </div>
                {gsc.trend.length > 1 && (
                  <div className="mt-4" role="img" aria-label={t('agencyReport.chart.gscTrend')}>
                    <p className="text-xs font-medium text-gray-500 mb-1">{t('agencyReport.chart.gscTrend')}</p>
                    <AreaChart
                      className="h-40 print:h-36"
                      data={priorPeriodOverlay(
                        gsc.trend.map((d) => ({
                          date: fmtAxisDate(d.date, locale),
                          [clicksLabel]: d.clicks,
                          [impressionsLabel]: d.impressions,
                        })),
                        gsc.clicks,
                        clicksLabel,
                        priorLabel,
                      )}
                      index="date"
                      categories={gsc.clicks.delta != null ? [clicksLabel, priorLabel] : [clicksLabel, impressionsLabel]}
                      colors={[chartPrimary, gsc.clicks.delta != null ? chartMuted : chartAccent]}
                      showLegend
                      valueFormatter={valueFormatter}
                      yAxisWidth={48}
                    />
                  </div>
                )}
                <div className="mt-5 grid grid-cols-1 gap-4">
                  <GscTopTable rows={gsc.topQueries} kind="queries" title={t('agencyReport.story.topQueries')} />
                  <GscTopTable rows={gsc.topPages} kind="pages" title={t('agencyReport.story.topPages')} />
                </div>
                {(data.meta?.gscAiOverviews?.length ?? 0) > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-gray-600 mb-2">{t('agencyReport.gscAiTableTitle')}</p>
                    <ReportDataTable
                      rows={data.meta!.gscAiOverviews!.slice(0, 15)}
                      getRowKey={(row) => row.query}
                      columns={[
                        { key: 'query', header: t('agencyReport.keyword'), render: (row) => row.query },
                        {
                          key: 'impressions',
                          header: t('agencyReport.impressions'),
                          align: 'right',
                          render: (row) => (row.impressions != null ? fmtNum(row.impressions) : '—'),
                        },
                        {
                          key: 'clicks',
                          header: t('agencyReport.gscClicks'),
                          align: 'right',
                          render: (row) => (row.clicks != null ? fmtNum(row.clicks) : '—'),
                        },
                      ]}
                    />
                  </div>
                )}
              </>
            )}
          </SectionShell>
        )}

        {showSection('ga4', !!ga4) && (
          <SectionShell
            id="ga4"
            title={t('agencyReport.sections.ga4')}
            description={t(SECTION_DESC_KEYS.ga4)}
            iconKey="ga4"
          >
            {!ga4 ? (
              renderConnect('ga4')
            ) : connectedButEmpty(data, 'ga4') ? (
              renderEmpty('ga4')
            ) : (
              <>
                {sectionNarrative(report, 'ga4') && (
                  <p className="text-sm text-gray-600 mb-4">{sectionNarrative(report, 'ga4')}</p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <ReportKpiCard label={t('agencyReport.ga4Sessions')} metric={ga4.sessions} format={fmtNum} target={goals.ga4Sessions} targetLabel={t('agencyReport.goal')} trend={kpiSparklineSeries(data, 'ga4', 'sessions')} deltaDigits={0} />
                  <ReportKpiCard label={t('agencyReport.users')} metric={ga4.users} format={fmtNum} trend={kpiSparklineSeries(data, 'ga4', 'users')} deltaDigits={0} />
                  <ReportKpiCard label={t('agencyReport.aiSessions')} metric={ga4.aiAssistantSessions} format={fmtNum} target={goals.ga4AiAssistantSessions} targetLabel={t('agencyReport.goal')} deltaDigits={0} />
                </div>
                {ga4.trend.length > 1 && (
                  <div className="mt-4" role="img" aria-label={t('agencyReport.chart.ga4Trend')}>
                    <p className="text-xs font-medium text-gray-500 mb-1">{t('agencyReport.chart.ga4Trend')}</p>
                    <AreaChart
                      className="h-40 print:h-36"
                      data={priorPeriodOverlay(
                        ga4.trend.map((d) => ({
                          date: fmtAxisDate(d.date, locale),
                          [sessionsLabel]: d.sessions,
                        })),
                        ga4.sessions,
                        sessionsLabel,
                        priorLabel,
                      )}
                      index="date"
                      categories={ga4.sessions.delta != null ? [sessionsLabel, priorLabel] : [sessionsLabel]}
                      colors={[chartPrimary, chartMuted]}
                      showLegend={ga4.sessions.delta != null}
                      valueFormatter={valueFormatter}
                      yAxisWidth={48}
                    />
                  </div>
                )}
                <div className="mt-5">
                  <Ga4LandingPagesTable rows={ga4.topLandingPages} title={t('agencyReport.story.topLandingPages')} />
                </div>
              </>
            )}
          </SectionShell>
        )}

        {showSection('site_health', !!siteHealth) && (
          <SectionShell
            id="site_health"
            title={t('agencyReport.sections.site_health')}
            description={t(SECTION_DESC_KEYS.site_health)}
            iconKey="site_health"
          >
            {!siteHealth ? (
              renderConnect('site_health')
            ) : connectedButEmpty(data, 'site_health') ? (
              renderEmpty('site_health')
            ) : (
              <>
                {sectionNarrative(report, 'site_health') && (
                  <p className="text-sm text-gray-600 mb-4">{sectionNarrative(report, 'site_health')}</p>
                )}
                <ReportKpiCard
                  label={t('resultsPage.healthLabel')}
                  metric={{ value: siteHealth.auditScore, delta: null, deltaPct: null }}
                  target={goals.healthScore}
                  targetLabel={t('agencyReport.goal')}
                />
                {auditedOn(siteHealth.auditedAt) && (
                  <p className="mt-2 text-xs text-gray-400">{auditedOn(siteHealth.auditedAt)}</p>
                )}
                {(siteHealth.topIssues ?? []).some(isSiteHealthIssue) && (
                  <div className="mt-5">
                    <SiteHealthIssuesTable
                      issues={(siteHealth.topIssues ?? []).filter(isSiteHealthIssue)}
                      limit={8}
                      title={t('agencyReport.siteIssues.title')}
                      t={t as (key: string, opts?: Record<string, unknown>) => string}
                    />
                  </div>
                )}
              </>
            )}
          </SectionShell>
        )}

        {showSection('backlinks', !!backlinks) && (
          <SectionShell
            id="backlinks"
            title={t('agencyReport.sections.backlinks')}
            description={t(SECTION_DESC_KEYS.backlinks)}
            iconKey="backlinks"
          >
            {!backlinks ? (
              renderConnect('backlinks')
            ) : connectedButEmpty(data, 'backlinks') ? (
              renderEmpty('backlinks')
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <ReportKpiCard
                  label={t('agencyReport.referringDomains')}
                  metric={{ value: backlinks.referringDomains, delta: null, deltaPct: null }}
                />
                <ReportKpiCard
                  label={t('agencyReport.newBacklinks')}
                  metric={{ value: backlinks.new, delta: null, deltaPct: null }}
                />
                <ReportKpiCard
                  label={t('agencyReport.lostBacklinks')}
                  metric={{ value: backlinks.lost, delta: null, deltaPct: null }}
                />
              </div>
            )}
          </SectionShell>
        )}

        {report.narrative?.nextActions && report.narrative.nextActions.length > 0 && (
          <SectionShell
            id="next-actions"
            title={t('agencyReport.nextActions')}
            description={t('agencyReport.sectionDesc.nextActions')}
            iconKey="next-actions"
          >
            <ol className="space-y-2.5">
              {report.narrative.nextActions.map((a, i) => (
                <li key={i} className="flex gap-3 text-sm text-gray-700">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: branding.primaryColor }}
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{a}</span>
                </li>
              ))}
            </ol>
          </SectionShell>
        )}

        <footer className="agency-report-footer mt-10 pt-4 border-t border-gray-200 text-[11px] text-gray-400 flex flex-wrap justify-between gap-2 print:fixed print:bottom-0 print:left-0 print:right-0 print:px-10 print:pb-4 print:bg-white">
          <span>{t(branding.hideAstroSeoFooter ? 'resultsPage.generatedOn' : 'resultsPage.generatedBy', { date: createdLabel })}</span>
          <span className="font-medium" style={{ color: branding.primaryColor }}>
            {branding.hideAstroSeoFooter ? branding.agencyName ?? '' : branding.agencyName ?? t('agencyReport.poweredBy')}
            {periodLabel ? ` · ${periodLabel}` : ''}
          </span>
        </footer>
      </div>
    </div>
  )
}

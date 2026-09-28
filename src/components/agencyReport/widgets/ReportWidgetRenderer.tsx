import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { isConnectedSection, type SectionKey } from '../../../lib/agencyReport/sections'
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
  type ReportGoals,
  type SiteHealthIssue,
  type SiteHealthSectionData,
} from '../../../lib/agencyReport/types'
import { competitorCountsReliable, engineLabel } from '../../../lib/agencyReport/insights'
import type { ReportWidget } from '../../../lib/agencyReport/widgets'
import { catalogEntryFor } from '../../../lib/agencyReport/widgets'
import { AiVisibilityHero } from '../AiVisibilityHero'
import { ExecutiveBriefing } from '../ExecutiveBriefing'
import { historyChipDigits, ReportHistoryBlock } from '../ReportHistory'
import { useReportHistoryContext } from '../ReportHistoryContext'
import { resolveReportHistory, scorecardVsReport, type ReportHistoryPoint } from '../../../lib/agencyReport/history'
import { RankDistributionBar, RankMovers } from '../RankingsStory'
import { Ga4LandingPagesTable, GscTopTable } from '../SearchTables'
import { pagePath } from '../../../lib/agencyReport/tables'
import { ReportKpiCard } from '../ReportKpiCard'
import { ConnectPrompt, EmptyStateNote, NarrativeBlock, SectionHeaderRow } from '../reportPrimitives'
import { fmtAxisDate, fmtDecimals, fmtPosition, fmtWholeNumber, kpiSparklineSeries, SECTION_CONNECT_KEYS } from '../../../lib/agencyReport/reportUi'
import { emptyStateTimestamp, fmtGuidanceDate, isEmptyGuidanceSection, SECTION_EMPTY_KEYS } from '../../../lib/agencyReport/emptyStates'
import { widgetDataState } from '../../../lib/agencyReport/widgetData'
import { NivoBarChart, NivoLineChart } from './ReportCharts'

function fmtPct(v: number | null | undefined, digits = 1) {
  return v != null ? `${fmtDecimals(v, digits)}%` : '—'
}

function fmtNum(v: number | null | undefined) {
  return fmtWholeNumber(v)
}

interface ReportWidgetRendererProps {
  widget: ReportWidget
  report: ClientReportSnapshot
  goals?: ReportGoals | null
  title?: string
}

export function ReportWidgetRenderer({ widget, report, goals, title }: ReportWidgetRendererProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith('it') ? 'it-IT' : 'en-US'
  const data = report.data as ReportData
  const g = goals ?? report.goals ?? {}
  const entry = catalogEntryFor(widget.binding)
  const label =
    title ??
    widget.title ??
    (entry ? t(entry.defaultTitleKey as never) : widget.binding.metric)

  const historyCtx = useReportHistoryContext()
  const history = useMemo(() => resolveReportHistory(report, historyCtx.history), [report, historyCtx.history])
  const state = widgetDataState(widget, report, { history })
  const src = widget.binding.section
  const connectMessage =
    src !== 'narrative' && src !== 'meta' && src !== 'summary'
      ? t(SECTION_CONNECT_KEYS[src])
      : t('agencyReport.sectionNotConnected')
  const notConnected =
    state === 'empty' ? (
      <ConnectPrompt message={t('agencyReport.widgetEmpty')} compact />
    ) : (
      <ConnectPrompt message={connectMessage} />
    )

  switch (widget.type) {
    case 'executive_briefing':
      return <ExecutiveBriefing data={data} title={title ?? widget.title} />

    case 'report_history':
      if (state !== 'narrative' || !history) return null
      return <ReportHistoryBlock history={history} currentReportId={report.id} title={title ?? widget.title} />

    case 'ai_visibility_hero':
      if (state !== 'ok') return notConnected
      return <AiVisibilityHero data={data} title={title ?? widget.title} />

    case 'executive_summary': {
      const text = report.narrative?.executiveSummary
      if (!text) return null
      return (
        <NarrativeBlock title={label}>
          <p>{text}</p>
        </NarrativeBlock>
      )
    }

    case 'next_actions': {
      const actions = report.narrative?.nextActions ?? []
      if (!actions.length) return null
      return (
        <NarrativeBlock title={label}>
          <ol className="list-decimal pl-5 space-y-1">
            {actions.map((a, i) => <li key={i}>{a}</li>)}
          </ol>
        </NarrativeBlock>
      )
    }

    case 'narrative': {
      const sec = widget.config?.narrativeSection ?? widget.binding.metric
      const text =
        report.narrative?.sections && typeof report.narrative.sections === 'object'
          ? (report.narrative.sections as Record<string, string>)[sec]
          : null
      if (!text) return null
      // Titled "Section commentary", not the section name: it sits right under that header already.
      return (
        <NarrativeBlock title={widget.title ?? t('agencyReport.builder.sectionNarrative')}>
          <p>{text}</p>
        </NarrativeBlock>
      )
    }

    case 'section_header': {
      const sec = widget.binding.section
      if (sec === 'narrative' || sec === 'meta') return null
      const headerLabel = widget.title ?? t(`agencyReport.sections.${sec}` as const)
      return <SectionHeaderRow section={sec} title={headerLabel} />
    }

    case 'kpi':
      if (state === 'guidance' && isEmptyGuidanceSection(src)) {
        const date = fmtGuidanceDate(emptyStateTimestamp(data, src), locale)
        const meta = date ? (src === 'site_health' ? t('agencyReport.auditedOn', { date }) : t('agencyReport.emptyState.asOf', { date })) : null
        return <EmptyStateNote message={t(SECTION_EMPTY_KEYS[src])} meta={meta} />
      }
      if (state !== 'ok') return notConnected
      {
        // A health score is the last audit's, which can predate the period: always say which audit.
        const auditDate = src === 'site_health' ? fmtGuidanceDate(emptyStateTimestamp(data, 'site_health'), locale) : null
        const note = auditDate ? t('agencyReport.auditedOn', { date: auditDate }) : null
        return renderKpi(widget, data, g, label, notConnected, t, historyCtx.compareWithPrevious ? { history, reportId: report.id } : null, note)
      }

    case 'line_chart':
      if (state !== 'ok') return notConnected
      return renderLineChart(widget, data, label, notConnected, locale, t)

    case 'bar_chart':
      if (state !== 'ok') return notConnected
      return renderBarChart(widget, data, label, notConnected, t)

    case 'pie_chart':
      if (state !== 'ok') return notConnected
      return renderPieChart(widget, data, label, notConnected)

    case 'table':
      if (state !== 'ok') return notConnected
      return renderTable(widget, data, label, notConnected, t)

    default:
      return null
  }
}

function renderKpi(
  widget: ReportWidget,
  data: ReportData,
  goals: ReportGoals,
  label: string,
  notConnected: React.ReactNode,
  t: (key: string) => string,
  compare: { history: ReportHistoryPoint[] | null; reportId: string } | null,
  note: string | null = null,
) {
  const { section, metric } = widget.binding
  const trend = kpiSparklineSeries(data, section as SectionKey, metric)

  if (section === 'summary' && data.summary) {
    const m = data.summary[metric as keyof typeof data.summary]
    if (!m || typeof m !== 'object' || !('value' in m)) return notConnected
    const vs = compare ? scorecardVsReport(compare.history, compare.reportId, metric, m) : null
    const goalKey = metric as keyof ReportGoals
    const formats: Record<string, (v: number | null) => string> = {
      healthScore: fmtNum,
      aiSov: (v) => fmtPct(v),
      avgPosition: fmtPosition,
      gscClicks: fmtNum,
      ga4Sessions: fmtNum,
      ga4AiAssistantSessions: fmtNum,
    }
    return (
      <ReportKpiCard
        label={label}
        metric={m}
        format={formats[metric]}
        positiveIsGood={metric !== 'avgPosition'}
        target={goals[goalKey]}
        targetLabel={t('agencyReport.goal')}
        trend={trend}
        deltaUnit={metric === 'aiSov' ? 'pt' : ''}
        deltaDigits={metric === 'aiSov' || metric === 'avgPosition' ? 1 : 0}
        vsReport={vs ? { delta: vs.delta, label: t('agencyReport.history.vsPreviousReport'), digits: historyChipDigits(vs.key) } : null}
      />
    )
  }

  if (section === 'geo' && isConnectedSection<GeoSectionData>(data.geo)) {
    if (metric === 'sovOverall') return <ReportKpiCard label={label} metric={data.geo.sovOverall} format={(v) => fmtPct(v)} trend={trend} deltaUnit="pt" deltaDigits={1} />
    if (metric === 'citationRate') return <ReportKpiCard label={label} metric={data.geo.citationRate} format={(v) => fmtPct(v)} deltaUnit="pt" deltaDigits={1} />
  }

  if (section === 'rankings' && isConnectedSection<RankingsSectionData>(data.rankings)) {
    if (metric === 'avgPosition') {
      return (
        <ReportKpiCard
          label={label}
          metric={data.rankings.avgPosition}
          format={fmtPosition}
          positiveIsGood={false}
          target={goals.avgPosition}
          targetLabel={t('agencyReport.goal')}
          deltaDigits={1}
        />
      )
    }
  }

  if (section === 'gsc' && isConnectedSection<GscSectionData>(data.gsc)) {
    const m = data.gsc[metric as keyof GscSectionData]
    if (m && typeof m === 'object' && 'value' in m) {
      const formats: Record<string, (v: number | null) => string> = {
        clicks: fmtNum,
        impressions: fmtNum,
        ctr: (v) => fmtPct(v),
        avgPosition: (v) => (v != null ? fmtDecimals(v, 1) : '—'),
      }
      return (
        <ReportKpiCard
          label={label}
          metric={m}
          format={formats[metric]}
          positiveIsGood={metric !== 'avgPosition'}
          target={metric === 'clicks' ? goals.gscClicks : undefined}
          targetLabel={t('agencyReport.goal')}
          trend={trend}
          deltaUnit={metric === 'ctr' ? 'pt' : ''}
          deltaDigits={metric === 'ctr' || metric === 'avgPosition' ? 1 : 0}
        />
      )
    }
  }

  if (section === 'ga4' && isConnectedSection<Ga4SectionData>(data.ga4)) {
    const m = data.ga4[metric as keyof Ga4SectionData]
    if (m && typeof m === 'object' && 'value' in m) {
      return (
        <ReportKpiCard
          label={label}
          metric={m}
          format={fmtNum}
          target={metric === 'sessions' ? goals.ga4Sessions : metric === 'aiAssistantSessions' ? goals.ga4AiAssistantSessions : undefined}
          targetLabel={t('agencyReport.goal')}
          trend={trend}
          deltaDigits={0}
        />
      )
    }
  }

  if (section === 'site_health' && isConnectedSection<SiteHealthSectionData>(data.site_health)) {
    if (metric === 'auditScore') {
      return (
        <ReportKpiCard
          label={label}
          metric={{ value: data.site_health.auditScore, delta: null, deltaPct: null }}
          target={goals.healthScore}
          targetLabel={t('agencyReport.goal')}
          note={note}
        />
      )
    }
  }

  if (section === 'backlinks' && isConnectedSection<BacklinksSectionData>(data.backlinks)) {
    const val = data.backlinks[metric as keyof BacklinksSectionData]
    if (typeof val === 'number' || val === null) {
      return <ReportKpiCard label={label} metric={{ value: val, delta: null, deltaPct: null }} />
    }
  }

  return notConnected
}

function renderLineChart(
  widget: ReportWidget,
  data: ReportData,
  label: string,
  notConnected: React.ReactNode,
  locale: string,
  t: (key: string) => string,
) {
  const { section, metric } = widget.binding
  const byDay = <T extends { date: string }>(rows: T[]) => rows.map((d) => ({ ...d, date: fmtAxisDate(d.date, locale) }))
  const seriesLabels = {
    SoV: t('agencyReport.series.sov'),
    clicks: t('agencyReport.series.clicks'),
    impressions: t('agencyReport.series.impressions'),
    sessions: t('agencyReport.series.sessions'),
  }

  if (section === 'geo' && metric === 'trend' && isConnectedSection<GeoSectionData>(data.geo)) {
    const rows = data.geo.trend.map((d) => ({ date: d.date, SoV: d.sovPercent ?? 0 }))
    if (rows.length < 2) return notConnected
    return (
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2">{label}</p>
        <NivoLineChart data={byDay(rows)} indexKey="date" valueKeys={['SoV']} seriesLabels={seriesLabels} />
      </div>
    )
  }

  if (section === 'gsc' && metric === 'trend' && isConnectedSection<GscSectionData>(data.gsc)) {
    if (data.gsc.trend.length < 2) return notConnected
    return (
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2">{label}</p>
        <NivoLineChart data={byDay(data.gsc.trend)} indexKey="date" valueKeys={['clicks', 'impressions']} seriesLabels={seriesLabels} />
      </div>
    )
  }

  if (section === 'ga4' && metric === 'trend' && isConnectedSection<Ga4SectionData>(data.ga4)) {
    if (data.ga4.trend.length < 2) return notConnected
    return (
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2">{label}</p>
        <NivoLineChart data={byDay(data.ga4.trend)} indexKey="date" valueKeys={['sessions']} seriesLabels={seriesLabels} />
      </div>
    )
  }

  return notConnected
}

function renderBarChart(
  widget: ReportWidget,
  data: ReportData,
  label: string,
  notConnected: React.ReactNode,
  t: (key: string) => string,
) {
  const { section, metric } = widget.binding
  const sovKey = t('agencyReport.shareOfVoice')
  const sessionsKey = t('agencyReport.ga4Sessions')

  if (section === 'geo' && metric === 'sovByEngine' && isConnectedSection<GeoSectionData>(data.geo)) {
    const rows = data.geo.sovByEngine.map((e) => ({ engine: engineLabel(e.engine), [sovKey]: e.sovPercent ?? 0 }))
    if (!rows.length) return notConnected
    return (
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2">{label}</p>
        <NivoBarChart data={rows} indexKey="engine" keys={[sovKey]} />
      </div>
    )
  }

  if (section === 'ai_attribution' && metric === 'byEngine' && isConnectedSection<AiAttributionSectionData>(data.ai_attribution)) {
    // Attribution = visits the engine sent (GA4). Engines with no share-of-voice reading and no
    // visits (a tracker that never ran) would only add empty bars.
    const rows = data.ai_attribution.byEngine
      .filter((e) => e.sovPercent != null || (engineSessions(e) ?? 0) > 0)
      .map((e) => ({
        engine: engineLabel(e.engine),
        [sovKey]: e.sovPercent ?? 0,
        [sessionsKey]: engineSessions(e) ?? 0,
      }))
    if (!rows.length) return notConnected
    return (
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2">{label}</p>
        <NivoBarChart data={rows} indexKey="engine" keys={[sovKey, sessionsKey]} />
      </div>
    )
  }

  return notConnected
}

/**
 * Checks that are fixed once, in the site's configuration, and genuinely have no page list.
 *
 * This must be an explicit list of codes, never "the issue has no urls": every audit stored
 * before `urls` existed has no urls on ANY issue, so inferring site-wide from their absence
 * would tell the client that "Canonical missing on some pages" is a site-wide setting — wrong,
 * and wrong on every report already built. An unknown code with no urls simply says nothing.
 */
const SITE_WIDE_ISSUE_CODES = new Set([
  'geo_no_llms_txt',
  'geo_search_blocked_chatgpt',
  'geo_search_blocked_claude',
  'geo_search_blocked_google',
  'geo_search_blocked_perplexity',
])

const ISSUE_SEVERITY_CLASS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  error: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-800',
  opportunity: 'bg-sky-100 text-sky-800',
  info: 'bg-gray-100 text-gray-600',
}

/** The audit's top issues: what is holding the site back, with the fix rationale the audit gives. */
export function SiteHealthIssuesTable({
  issues,
  limit,
  title,
  t,
}: {
  issues: SiteHealthIssue[]
  limit: number
  title: string
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  /** How many page URLs to print per issue before collapsing into "+N other pages". */
  const MAX_URLS_PER_ISSUE = 5
  return (
    <div>
      <p className="text-xs font-semibold text-gray-600 mb-2">{title}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 text-xs">
            <th className="py-1">{t('agencyReport.siteIssues.issue')}</th>
            <th className="py-1 text-right">{t('agencyReport.siteIssues.pages')}</th>
            <th className="py-1 pl-3">{t('agencyReport.siteIssues.severity')}</th>
          </tr>
        </thead>
        <tbody>
          {issues.slice(0, limit).map((issue, i) => {
            const severity = String(issue.severity ?? 'info').toLowerCase()
            const urls = issue.urls ?? []
            // A page-level finding must say WHERE. "H1 mancante ×12" is a number the user cannot
            // act on; naming the pages is the difference between a diagnosis and a to-do list.
            // Site-wide checks (robots.txt, llms.txt, crawler access) carry no list by nature, so
            // they get an explicit note instead — never a misleading "0 pages".
            const shown = urls.slice(0, MAX_URLS_PER_ISSUE)
            const hidden = urls.length - shown.length
            const isSiteWide = SITE_WIDE_ISSUE_CODES.has(issue.code)
            return (
              <tr key={`${issue.code}-${i}`} className="border-t border-gray-100 align-top">
                <td className="py-2 pr-2">
                  <div className="font-medium text-gray-800">{issue.label}</div>
                  {issue.why ? <div className="text-xs text-gray-500 mt-0.5">{issue.why}</div> : null}
                  {shown.length > 0 ? (
                    <div className="mt-1.5">
                      <div className="text-[11px] font-medium text-gray-500">
                        {t('agencyReport.siteIssues.affectedPages')}
                      </div>
                      <ul className="mt-0.5 space-y-0.5">
                        {shown.map((u) => (
                          <li key={u} className="text-[11px] text-gray-600 break-all font-mono">
                            {u}
                          </li>
                        ))}
                      </ul>
                      {hidden > 0 ? (
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          {t('agencyReport.siteIssues.morePages', { count: hidden })}
                        </div>
                      ) : null}
                    </div>
                  ) : isSiteWide ? (
                    <div className="text-[11px] text-gray-400 mt-1.5 italic">
                      {t('agencyReport.siteIssues.siteWide')}
                    </div>
                  ) : null}
                </td>
                <td className="py-2 tabular-nums text-right whitespace-nowrap">
                  {typeof issue.count === 'number' ? fmtWholeNumber(issue.count) : '—'}
                </td>
                <td className="py-2 pl-3 whitespace-nowrap">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${ISSUE_SEVERITY_CLASS[severity] ?? ISSUE_SEVERITY_CLASS['info']}`}>
                    {t(`agencyReport.siteIssues.severity_${severity}`, { defaultValue: severity })}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function renderPieChart(
  widget: ReportWidget,
  data: ReportData,
  label: string,
  notConnected: React.ReactNode,
) {
  if (
    widget.binding.section === 'rankings' &&
    widget.binding.metric === 'distribution' &&
    isConnectedSection<RankingsSectionData>(data.rankings)
  ) {
    const total = Object.values(data.rankings.distribution).reduce((s, v) => s + (Number(v) || 0), 0)
    if (total === 0) return notConnected
    return <RankDistributionBar distribution={data.rankings.distribution} table={data.rankings.table} title={label} />
  }
  return notConnected
}

function renderTable(
  widget: ReportWidget,
  data: ReportData,
  label: string,
  notConnected: React.ReactNode,
  t: (key: string) => string,
) {
  const { section, metric } = widget.binding
  const rowLimit = widget.config?.tableRowLimit ?? 15

  if (section === 'rankings' && metric === 'topMovers' && isConnectedSection<RankingsSectionData>(data.rankings)) {
    if (!data.rankings.topMovers.length) return notConnected
    return <RankMovers movers={data.rankings.topMovers} limit={Math.max(3, Math.ceil(rowLimit / 2))} title={label} />
  }

  if (section === 'gsc' && (metric === 'topQueries' || metric === 'topPages') && isConnectedSection<GscSectionData>(data.gsc)) {
    const rows = metric === 'topQueries' ? data.gsc.topQueries : data.gsc.topPages
    return <GscTopTable rows={rows} kind={metric === 'topQueries' ? 'queries' : 'pages'} limit={rowLimit} title={label} />
  }

  if (section === 'ga4' && metric === 'topLandingPages' && isConnectedSection<Ga4SectionData>(data.ga4)) {
    return <Ga4LandingPagesTable rows={data.ga4.topLandingPages} limit={rowLimit} title={label} />
  }

  if (section === 'site_health' && metric === 'topIssues' && isConnectedSection<SiteHealthSectionData>(data.site_health)) {
    const issues = (data.site_health.topIssues ?? []).filter(isSiteHealthIssue)
    if (!issues.length) return notConnected
    return <SiteHealthIssuesTable issues={issues} limit={rowLimit} title={label} t={t as (key: string, opts?: Record<string, unknown>) => string} />
  }

  if (section === 'geo' && metric === 'competitorLeaderboard' && isConnectedSection<GeoSectionData>(data.geo)) {
    if (!data.geo.competitorLeaderboard.length) return notConnected
    // Counts that contradict share of voice (old snapshots): names only, never "not mentioned yet".
    const countsOk = competitorCountsReliable(data.geo)
    return (
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2">{label}</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs">
              <th className="py-1">{t('agencyReport.builder.competitor')}</th>
              <th className="py-1">{t('agencyReport.builder.mentions')}</th>
            </tr>
          </thead>
          <tbody>
            {data.geo.competitorLeaderboard.slice(0, rowLimit).map((c, i) => (
              <tr key={c.id ?? `${c.name}-${i}`} className="border-t border-gray-100">
                <td className="py-2">{c.name}</td>
                <td className="py-2 tabular-nums">
                  {!countsOk ? '—' : c.mentions > 0 ? fmtWholeNumber(c.mentions) : <span className="text-gray-400">{t('agencyReport.hero.noMentions')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (section === 'ai_attribution' && metric === 'topAiReferredLandingPages' && isConnectedSection<AiAttributionSectionData>(data.ai_attribution)) {
    if (!data.ai_attribution.topAiReferredLandingPages.length) return notConnected
    return (
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2">{label}</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs">
              <th className="py-1">{t('agencyReport.builder.page')}</th>
              <th className="py-1">{t('agencyReport.ga4Sessions')}</th>
            </tr>
          </thead>
          <tbody>
            {data.ai_attribution.topAiReferredLandingPages.slice(0, rowLimit).map((p) => (
              <tr key={p.page} className="border-t border-gray-100">
                <td className="py-2 pr-2 truncate max-w-[200px]" title={p.page}>{pagePath(p.page)}</td>
                <td className="py-2 tabular-nums">{fmtWholeNumber(p.sessions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (section === 'ga4' && metric === 'topSources' && isConnectedSection<Ga4SectionData>(data.ga4)) {
    if (!data.ga4.topSources.length) return notConnected
    return (
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2">{label}</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs">
              <th className="py-1">{t('agencyReport.builder.source')}</th>
              <th className="py-1">{t('agencyReport.ga4Sessions')}</th>
            </tr>
          </thead>
          <tbody>
            {data.ga4.topSources.slice(0, rowLimit).map((s) => (
              <tr key={s.source} className="border-t border-gray-100">
                <td className="py-2">{s.source}</td>
                <td className="py-2 tabular-nums">{fmtWholeNumber(s.sessions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (metric === 'gscAiOverviews' && (data.meta?.gscAiOverviews?.length ?? 0) > 0) {
    return (
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2">{label}</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs">
              <th className="py-1">{t('agencyReport.keyword')}</th>
              <th className="py-1">{t('agencyReport.impressions')}</th>
              <th className="py-1">{t('agencyReport.gscClicks')}</th>
            </tr>
          </thead>
          <tbody>
            {data.meta!.gscAiOverviews!.slice(0, rowLimit).map((r) => (
              <tr key={r.query} className="border-t border-gray-100">
                <td className="py-2 pr-2">{r.query}</td>
                <td className="py-2 tabular-nums">{fmtWholeNumber(r.impressions)}</td>
                <td className="py-2 tabular-nums">{fmtWholeNumber(r.clicks)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return notConnected
}

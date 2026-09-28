/**
 * Agency report → presentation (.pptx) export, built in the browser with pptxgenjs.
 *
 * Two layers so the content is testable without a zip:
 *  - `planReportDeck()` is pure: it turns a report snapshot into a list of typed slides
 *    (strings already translated and locale-formatted, charts as label/value arrays).
 *    It mirrors the report's own "hide what is not connected" rule — a section with no
 *    data produces no slide.
 *  - `renderReportDeck()` draws a plan with pptxgenjs (widescreen 16:9, white slides, one
 *    accent color, native charts and tables, narrative in the speaker notes).
 *
 * Nothing here re-derives report logic: insights come from `insights.ts`, the AI model from
 * `heroModel.ts`, movers from `rankings.ts`, tables from `tables.ts`, numbers from `reportUi.ts`.
 * This module is meant to be `import()`ed lazily — it pulls pptxgenjs into its own chunk.
 */
import PptxGenJS from 'pptxgenjs'
import type { TFunction } from 'i18next'
import type { MetricWithDelta } from '../reportBuild/math'
import type { ReportNarrative } from '../reportBuild/narrative'
import type { WhiteLabelReportBranding } from '../whiteLabelReport'
import { connectedButEmpty } from './emptyStates'
import { buildHeroModel, HERO_MAX_PROMPTS } from './heroModel'
import { deriveBriefing, briefingIsEmpty, movementPct } from './insights'
import { buildReportPdfBasename } from './pdfExport'
import { rankDistributionCounts, splitMovers } from './rankings'
import {
  derivePeriodHeadline,
  fmtAxisDate,
  fmtDecimals,
  fmtPct,
  fmtPeriodRange,
  fmtPosition,
  fmtWholeNumber,
  formatScorecardValue,
  hasBaseline,
  SCORECARD_KPIS,
} from './reportUi'
import { isConnectedSection, type SectionKey } from './sections'
import { ga4PageRows, gscTopRows, pagePath } from './tables'
import {
  isSiteHealthIssue,
  type BacklinksSectionData,
  type Ga4SectionData,
  type GscSectionData,
  type RankingsSectionData,
  type ReportData,
  type ReportGoals,
  type SiteHealthSectionData,
} from './types'

// ---------------------------------------------------------------------------------------------
// Input / plan types

/** `t` from react-i18next / i18next.getFixedT — only `(key, params) => string` is used. */
export type DeckTranslate = (key: string, options?: Record<string, unknown>) => string

export interface ReportDeckInput {
  data: ReportData
  narrative: ReportNarrative | null
  /** Resolved branding (see getWhiteLabelBranding); null = Rankdelta defaults. */
  branding: WhiteLabelReportBranding | null
  goals: ReportGoals | null
  period: { start: string; end: string }
  projectName?: string | null
  websiteUrl?: string | null
  /** BCP-47 tag the numbers and dates follow: 'it-IT' → 14,3%, 'en-US' → 14.3%. */
  locale: string
  /** Sections the report enabled; undefined = every connected section. */
  sections?: SectionKey[] | null
  /** Cover logo as a base64 data string (`image/png;base64,…`); resolved by buildReportDeck. */
  logoData?: string | null
}

export type DeckTone = 'good' | 'bad' | 'flat' | 'muted' | 'accent'

export interface DeckMovement {
  text: string
  tone: DeckTone
}

export interface DeckTile {
  label: string
  value: string
  movement?: DeckMovement | null
  goal?: string | null
  caption?: string | null
}

export interface DeckChart {
  kind: 'line' | 'bar' | 'hbar'
  title: string
  labels: string[]
  series: Array<{ name: string; values: number[] }>
  /** Excel-style number format for data labels / axis. */
  format?: string
  max?: number
  showValues?: boolean
}

export interface DeckTable {
  title: string | null
  columns: Array<{ label: string; align: 'left' | 'right'; width: number }>
  rows: string[][]
}

export interface DeckListColumn {
  label: string
  tone: DeckTone
  items: string[]
  numbered?: boolean
  note?: string | null
  more?: string | null
}

export type DeckSlide =
  | { kind: 'cover'; eyebrow: string; title: string; subtitle: string | null; period: string; headline: string | null; logo: string | null; notes: string | null }
  | { kind: 'briefing'; title: string; subtitle: string; lead: string | null; columns: DeckListColumn[]; notes: string | null }
  | {
      kind: 'ai'
      eyebrow: string
      title: string
      headline: { label: string; value: string; movement: DeckMovement | null }
      caption: string
      tiles: DeckTile[]
      chart: DeckChart | null
      chartCaption: string | null
      competitors: string | null
      notes: string | null
    }
  | { kind: 'prompts'; title: string; subtitle: string | null; columns: DeckListColumn[]; footnote: string | null; notes: string | null }
  | { kind: 'scorecard'; title: string; subtitle: string; tiles: DeckTile[]; notes: string | null }
  | { kind: 'metrics'; title: string; subtitle: string; tiles: DeckTile[]; charts: DeckChart[]; table: DeckTable | null; notes: string | null }
  | { kind: 'table'; title: string; subtitle: string | null; table: DeckTable; notes: string | null }
  | { kind: 'rankings'; title: string; subtitle: string; tile: DeckTile; chart: DeckChart | null; chartCaption: string | null; movers: DeckTable[]; notes: string | null }
  | { kind: 'list'; title: string; subtitle: string; items: string[]; notes: string | null }
  | { kind: 'closing'; title: string; client: string; period: string; lines: string[] }

export interface DeckPlan {
  slides: DeckSlide[]
  /** Accent hex without '#'. */
  accent: string
  /** Running footer: "Prepared by Agency · Client · Period". */
  footer: string
  title: string
  author: string
  locale: string
}

// ---------------------------------------------------------------------------------------------
// Plan (pure)

const MAX_TABLE_ROWS = 8
const MAX_MOVERS = 4
const DEFAULT_ACCENT = '#7c3aed'

function clip(s: string, max: number): string {
  const v = s.trim()
  return v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v
}

function narrativeFor(narrative: ReportNarrative | null, key: string): string | null {
  const sections = narrative?.sections
  if (!sections || typeof sections !== 'object') return null
  const text = (sections as Record<string, unknown>)[key]
  return typeof text === 'string' && text.trim() ? text.trim() : null
}

function annotationFor(data: ReportData, section: SectionKey | 'summary'): string | null {
  const hit = (data.meta?.annotations ?? []).find((a) => a.section === section)
  return hit?.text?.trim() || null
}

/** Speaker notes for a section: the narrative paragraph plus the agency's annotation. */
function notesFor(data: ReportData, narrative: ReportNarrative | null, section: SectionKey | 'summary'): string | null {
  const parts = [narrativeFor(narrative, section), annotationFor(data, section)].filter(Boolean)
  return parts.length > 0 ? parts.join('\n\n') : null
}

function signed(v: number, digits: number, locale: string, unit = ''): string {
  const mag = fmtDecimals(Math.abs(v), digits, locale)
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  // Non-breaking space before the unit, like DeltaChip: "+3,2 pt" never wraps.
  return `${sign}${mag}${unit ? `\u00a0${unit}` : ''}`
}

/**
 * "▲ +290 (+23,4%) vs periodo precedente" for a metric with a prior period, the "first reading"
 * note when computeDelta had no baseline, null when the metric carries no comparison at all.
 */
function movementFor(
  metric: MetricWithDelta | null | undefined,
  t: DeckTranslate,
  locale: string,
  opts: { positiveIsGood?: boolean; unit?: 'pt' | '' ; digits?: number; withPct?: boolean } = {},
): DeckMovement | null {
  if (!metric || metric.value == null) return null
  if (!hasBaseline(metric) || metric.delta == null) {
    return metric.delta == null && metric.deltaPct == null ? null : { text: t('agencyReport.hero.firstReading'), tone: 'muted' }
  }
  const positiveIsGood = opts.positiveIsGood ?? true
  const digits = opts.digits ?? (Math.abs(metric.delta) >= 10 ? 0 : 1)
  const flat = Math.abs(metric.delta) < (digits === 0 ? 0.5 : 0.05)
  const good = positiveIsGood ? metric.delta > 0 : metric.delta < 0
  const arrow = flat ? '■' : good ? '▲' : '▼'
  let text = `${arrow} ${signed(metric.delta, digits, locale, opts.unit ?? '')}`
  const pct = opts.withPct ? movementPct(metric) : null
  if (pct != null && !flat) text += ` (${signed(pct, Math.abs(pct) >= 10 ? 0 : 1, locale, '')}%)`
  text += ` ${t('agencyReport.hero.vsPrevious')}`
  return { text, tone: flat ? 'flat' : good ? 'good' : 'bad' }
}

function goalText(t: DeckTranslate, display: string | null | undefined): string | null {
  return display ? `${t('agencyReport.goal')}: ${display}` : null
}

function displayUrl(websiteUrl: string | null | undefined): string | null {
  const v = (websiteUrl ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')
  return v || null
}

interface Ctx {
  t: DeckTranslate
  locale: string
  data: ReportData
  narrative: ReportNarrative | null
  goals: ReportGoals
  enabled: Set<SectionKey>
}

function coverSlide(ctx: Ctx, input: ReportDeckInput, branding: WhiteLabelReportBranding | null, client: string, period: string): DeckSlide {
  const { t, locale, data } = ctx
  const labels = {
    healthScore: t('resultsPage.healthLabel'),
    aiSov: t('agencyReport.shareOfVoice'),
    avgPosition: t('resultsPage.avgPosition'),
    gscClicks: t('agencyReport.gscClicks'),
    ga4Sessions: t('agencyReport.ga4Sessions'),
    aiSessions: t('agencyReport.aiSessions'),
  }
  const headline = ctx.enabled.has('summary') ? derivePeriodHeadline(data.summary, labels, t as unknown as TFunction, locale) : null
  return {
    kind: 'cover',
    eyebrow: branding?.agencyName ?? t('agencyReport.reportEyebrow'),
    title: client,
    subtitle: displayUrl(input.websiteUrl),
    period,
    headline,
    logo: input.logoData ?? null,
    notes: ctx.narrative?.executiveSummary?.trim() || null,
  }
}

function briefingSlide(ctx: Ctx): DeckSlide | null {
  const { t, locale, data, narrative } = ctx
  const briefing = deriveBriefing(data, { locale, maxPerGroup: 3 })
  const lead = narrative?.executiveSummary?.trim() || null
  if (briefingIsEmpty(briefing) && !lead) return null
  const items = (list: typeof briefing.wins) => list.map((i) => t(`agencyReport.briefing.items.${i.key}`, i.params))
  const columns: DeckListColumn[] = briefingIsEmpty(briefing)
    ? []
    : [
        { label: t('agencyReport.briefing.wins'), tone: 'good', items: items(briefing.wins), note: briefing.wins.length ? null : t('agencyReport.briefing.noWins') },
        { label: t('agencyReport.briefing.watch'), tone: 'bad', items: items(briefing.watch), note: briefing.watch.length ? null : t('agencyReport.briefing.noWatch') },
        { label: t('agencyReport.briefing.actions'), tone: 'accent', items: items(briefing.actions), numbered: true, note: briefing.actions.length ? null : t('agencyReport.briefing.noActions') },
      ]
  return {
    kind: 'briefing',
    title: t('agencyReport.briefing.title'),
    subtitle: t('agencyReport.briefing.subtitle'),
    lead: lead ? clip(lead, columns.length ? 720 : 1400) : null,
    columns,
    notes: notesFor(data, narrative, 'summary'),
  }
}

function aiSlides(ctx: Ctx): DeckSlide[] {
  const { t, locale, data, narrative } = ctx
  if (!ctx.enabled.has('geo') || connectedButEmpty(data, 'geo')) return []
  const model = buildHeroModel(data)
  if (!model) return []

  const sovMetric: MetricWithDelta = { value: model.sovPct, delta: model.sovDelta, deltaPct: null }
  const headlineMovement: DeckMovement | null =
    model.sovPct == null
      ? null
      : model.sovHasBaseline && model.sovDelta != null
        ? movementFor({ ...sovMetric, deltaPct: 0 }, t, locale, { unit: 'pt', digits: 1 })
        : { text: t('agencyReport.hero.firstReading'), tone: 'muted' }

  const caption =
    model.promptsTotal > 0 && model.promptSplitOk
      ? t('agencyReport.hero.sovCaptionPrompts', { count: model.promptsWon.length, total: model.promptsTotal, competitors: model.competitors.length })
      : model.promptsTotal > 0
        ? t('agencyReport.hero.sovCaptionTracked', { total: model.promptsTotal, competitors: model.competitors.length })
        : t('agencyReport.hero.sovCaptionNoPrompts', { competitors: model.competitors.length })

  const tiles: DeckTile[] = [
    model.promptSplitOk
      ? { label: t('agencyReport.hero.promptsWonShort'), value: `${model.promptsWon.length}/${model.promptsTotal}` }
      : { label: t('agencyReport.hero.trackedPrompts'), value: String(model.promptsTotal) },
    {
      label: t('agencyReport.hero.citationRate'),
      value: model.citationPct != null ? fmtPct(model.citationPct, model.citationPct >= 10 ? 0 : 1, locale) : '—',
      movement:
        model.citationPct != null && model.citationHasBaseline && model.citationDelta != null
          ? movementFor({ value: model.citationPct, delta: model.citationDelta, deltaPct: 0 }, t, locale, { unit: 'pt', digits: 1 })
          : null,
    },
    { label: t('agencyReport.hero.competitorsTitle'), value: String(model.competitors.length) },
  ]

  const chart: DeckChart | null =
    model.engines.length > 0
      ? {
          kind: 'hbar',
          title: t('agencyReport.hero.engines'),
          // Horizontal bars draw the first category at the bottom: feed ascending so the leader sits on top.
          labels: [...model.engines].reverse().map((e) => e.engine),
          series: [{ name: t('agencyReport.hero.sovLabel'), values: [...model.engines].reverse().map((e) => Math.round(e.pct * 10) / 10) }],
          format: '0"%"',
          max: 100,
          showValues: true,
        }
      : null

  const competitors =
    model.competitors.length > 0
      ? model.competitors
          .slice(0, 6)
          .map((c) =>
            model.competitorCountsOk
              ? `${c.name} (${c.mentions > 0 ? t('agencyReport.hero.mentions', { count: c.mentions }) : t('agencyReport.hero.noMentions')})`
              : c.name,
          )
          .join(' · ')
      : null

  const slides: DeckSlide[] = [
    {
      kind: 'ai',
      eyebrow: t('agencyReport.hero.eyebrow'),
      title: t('agencyReport.hero.title'),
      headline: { label: t('agencyReport.hero.sovLabel'), value: model.sovPct != null ? fmtPct(model.sovPct, 1, locale) : '—', movement: headlineMovement },
      caption,
      tiles,
      chart,
      chartCaption: chart ? t('agencyReport.hero.enginesCaption') : null,
      competitors,
      notes: notesFor(data, narrative, 'geo'),
    },
  ]

  if (model.promptsTotal > 0) {
    const more = (n: number) => (n > HERO_MAX_PROMPTS ? t('agencyReport.hero.morePrompts', { count: n - HERO_MAX_PROMPTS }) : null)
    const quote = (p: string) => `“${clip(p, 90)}”`
    const columns: DeckListColumn[] = model.promptSplitOk
      ? [
          {
            label: `${t('agencyReport.hero.promptsWon')} · ${t('agencyReport.hero.promptsCount', { count: model.promptsWon.length, total: model.promptsTotal })}`,
            tone: 'good',
            items: model.promptsWon.slice(0, HERO_MAX_PROMPTS).map(quote),
            note: model.promptsWon.length === 0 ? t('agencyReport.hero.noPromptsWon') : null,
            more: more(model.promptsWon.length),
          },
          {
            label: `${t('agencyReport.hero.promptsMissing')} · ${t('agencyReport.hero.promptsCount', { count: model.promptsMissing.length, total: model.promptsTotal })}`,
            tone: 'bad',
            items: model.promptsMissing.slice(0, HERO_MAX_PROMPTS).map(quote),
            note:
              model.promptsMissing.length === 0
                ? t('agencyReport.hero.noPromptsMissing')
                : model.leader
                  ? t('agencyReport.hero.promptsMissingLed', { competitor: model.leader })
                  : null,
            more: more(model.promptsMissing.length),
          },
        ]
      : [
          {
            label: t('agencyReport.hero.trackedPrompts'),
            tone: 'muted',
            items: [...model.promptsWon, ...model.promptsMissing].slice(0, HERO_MAX_PROMPTS * 2).map(quote),
            more: model.promptsTotal > HERO_MAX_PROMPTS * 2 ? t('agencyReport.hero.morePrompts', { count: model.promptsTotal - HERO_MAX_PROMPTS * 2 }) : null,
          },
        ]
    slides.push({
      kind: 'prompts',
      title: t('agencyReport.hero.trackedPrompts'),
      subtitle: t('agencyReport.hero.eyebrow'),
      columns,
      footnote: model.promptSplitOk ? null : t('agencyReport.hero.promptSplitUnavailable'),
      notes: null,
    })
  }
  return slides
}

function scorecardSlide(ctx: Ctx): DeckSlide | null {
  const { t, locale, data, goals, narrative } = ctx
  if (!ctx.enabled.has('summary') || !data.summary) return null
  const tiles: DeckTile[] = []
  for (const { key, goalKey, labelKey, positiveIsGood, format } of SCORECARD_KPIS) {
    const metric = data.summary[key]
    if (!metric || typeof metric !== 'object' || metric.value == null) continue
    tiles.push({
      label: t(labelKey),
      value: formatScorecardValue(metric.value, format, locale),
      movement: movementFor(metric, t, locale, { positiveIsGood, unit: format === 'pct' ? 'pt' : '', withPct: format === 'num' }),
      goal: goalText(t, goals[goalKey] != null ? formatScorecardValue(goals[goalKey]!, format, locale) : null),
    })
  }
  if (tiles.length === 0) return null
  return {
    kind: 'scorecard',
    title: t('agencyReport.scorecardTitle'),
    subtitle: t('agencyReport.sectionDesc.summary'),
    tiles: tiles.slice(0, 6),
    notes: notesFor(data, narrative, 'summary'),
  }
}

function gscSlides(ctx: Ctx): DeckSlide[] {
  const { t, locale, data, goals, narrative } = ctx
  if (!ctx.enabled.has('gsc') || !isConnectedSection<GscSectionData>(data.gsc) || connectedButEmpty(data, 'gsc')) return []
  const gsc = data.gsc
  const tiles: DeckTile[] = [
    { label: t('agencyReport.gscClicks'), value: fmtWholeNumber(gsc.clicks?.value, locale), movement: movementFor(gsc.clicks, t, locale, { withPct: true }), goal: goalText(t, goals.gscClicks != null ? fmtWholeNumber(goals.gscClicks, locale) : null) },
    { label: t('agencyReport.impressions'), value: fmtWholeNumber(gsc.impressions?.value, locale), movement: movementFor(gsc.impressions, t, locale, { withPct: true }) },
    { label: t('agencyReport.ctr'), value: fmtPct(gsc.ctr?.value, 1, locale), movement: movementFor(gsc.ctr, t, locale, { unit: 'pt', digits: 1 }) },
    { label: t('resultsPage.avgPosition'), value: gsc.avgPosition?.value != null ? fmtDecimals(gsc.avgPosition.value, 1, locale) : '—', movement: movementFor(gsc.avgPosition, t, locale, { positiveIsGood: false, digits: 1 }) },
  ].filter((tile) => tile.value !== '—')

  const charts: DeckChart[] = []
  const trend = (gsc.trend ?? []).filter((d) => d && typeof d.date === 'string')
  if (trend.length > 1) {
    const labels = trend.map((d) => fmtAxisDate(d.date, locale))
    const clicks = trend.map((d) => d.clicks ?? 0)
    const impressions = trend.map((d) => d.impressions ?? 0)
    const maxClicks = Math.max(0, ...clicks)
    const maxImp = Math.max(0, ...impressions)
    const separate = maxImp > 0 && (maxClicks === 0 || maxImp / maxClicks > 10)
    charts.push({
      kind: 'line',
      title: t('agencyReport.chart.gscTrend'),
      labels,
      series: separate || maxImp === 0 ? [{ name: t('agencyReport.series.clicks'), values: clicks }] : [{ name: t('agencyReport.series.clicks'), values: clicks }, { name: t('agencyReport.series.impressions'), values: impressions }],
      format: '#,##0',
    })
    if (separate) {
      charts.push({ kind: 'line', title: t('agencyReport.impressions'), labels, series: [{ name: t('agencyReport.series.impressions'), values: impressions }], format: '#,##0' })
    }
  }

  const slides: DeckSlide[] = [
    { kind: 'metrics', title: t('agencyReport.sections.gsc'), subtitle: t('agencyReport.sectionDesc.gsc'), tiles, charts, table: null, notes: notesFor(data, narrative, 'gsc') },
  ]

  const gscTable = (rows: unknown[], kind: 'queries' | 'pages', title: string): DeckTable | null => {
    const typed = gscTopRows(rows).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, MAX_TABLE_ROWS)
    if (typed.length === 0) return null
    return {
      title,
      columns: [
        { label: t(kind === 'queries' ? 'agencyReport.story.query' : 'agencyReport.builder.page'), align: 'left', width: 6.1 },
        { label: t('agencyReport.story.clicks'), align: 'right', width: 1.5 },
        { label: t('agencyReport.impressions'), align: 'right', width: 1.7 },
        { label: t('agencyReport.ctr'), align: 'right', width: 1.3 },
        { label: t('agencyReport.story.position'), align: 'right', width: 1.5 },
      ],
      rows: typed.map((r) => [
        clip(kind === 'pages' ? pagePath(r.key) : r.key, 80),
        fmtWholeNumber(r.clicks, locale),
        fmtWholeNumber(r.impressions, locale),
        `${fmtDecimals(r.ctr * 100, 1, locale)}%`,
        r.position != null ? fmtDecimals(r.position, 1, locale) : '—',
      ]),
    }
  }
  const queries = gscTable(gsc.topQueries, 'queries', t('agencyReport.story.topQueries'))
  if (queries) slides.push({ kind: 'table', title: queries.title!, subtitle: t('agencyReport.sections.gsc'), table: queries, notes: null })
  const pages = gscTable(gsc.topPages, 'pages', t('agencyReport.story.topPages'))
  if (pages) slides.push({ kind: 'table', title: pages.title!, subtitle: t('agencyReport.sections.gsc'), table: pages, notes: null })
  return slides
}

function ga4Slide(ctx: Ctx): DeckSlide | null {
  const { t, locale, data, goals, narrative } = ctx
  if (!ctx.enabled.has('ga4') || !isConnectedSection<Ga4SectionData>(data.ga4) || connectedButEmpty(data, 'ga4')) return null
  const ga4 = data.ga4
  const tiles: DeckTile[] = [
    { label: t('agencyReport.ga4Sessions'), value: fmtWholeNumber(ga4.sessions?.value, locale), movement: movementFor(ga4.sessions, t, locale, { withPct: true }), goal: goalText(t, goals.ga4Sessions != null ? fmtWholeNumber(goals.ga4Sessions, locale) : null) },
    { label: t('agencyReport.users'), value: fmtWholeNumber(ga4.users?.value, locale), movement: movementFor(ga4.users, t, locale, { withPct: true }) },
    { label: t('agencyReport.aiSessions'), value: fmtWholeNumber(ga4.aiAssistantSessions?.value, locale), movement: movementFor(ga4.aiAssistantSessions, t, locale, { withPct: true }), goal: goalText(t, goals.ga4AiAssistantSessions != null ? fmtWholeNumber(goals.ga4AiAssistantSessions, locale) : null) },
  ].filter((tile) => tile.value !== '—')

  const charts: DeckChart[] = []
  const trend = (ga4.trend ?? []).filter((d) => d && typeof d.date === 'string')
  if (trend.length > 1) {
    charts.push({
      kind: 'line',
      title: t('agencyReport.chart.ga4Trend'),
      labels: trend.map((d) => fmtAxisDate(d.date, locale)),
      series: [{ name: t('agencyReport.series.sessions'), values: trend.map((d) => d.sessions ?? 0) }],
      format: '#,##0',
    })
  }

  const landing = ga4PageRows(ga4.topLandingPages).sort((a, b) => b.sessions - a.sessions).slice(0, MAX_TABLE_ROWS)
  const hasUsers = landing.some((r) => r.users != null)
  const table: DeckTable | null =
    landing.length > 0
      ? {
          title: t('agencyReport.story.topLandingPages'),
          columns: [
            { label: t('agencyReport.builder.page'), align: 'left', width: hasUsers ? 3.1 : 4.0 },
            { label: t('agencyReport.ga4Sessions'), align: 'right', width: 1.2 },
            ...(hasUsers ? [{ label: t('agencyReport.users'), align: 'right' as const, width: 1.1 }] : []),
          ],
          rows: landing.map((r) => [clip(pagePath(r.key), 42), fmtWholeNumber(r.sessions, locale), ...(hasUsers ? [fmtWholeNumber(r.users, locale)] : [])]),
        }
      : null

  if (tiles.length === 0 && charts.length === 0 && !table) return null
  return { kind: 'metrics', title: t('agencyReport.sections.ga4'), subtitle: t('agencyReport.sectionDesc.ga4'), tiles, charts, table, notes: notesFor(data, narrative, 'ga4') }
}

function rankingsSlide(ctx: Ctx): DeckSlide | null {
  const { t, locale, data, goals, narrative } = ctx
  if (!ctx.enabled.has('rankings') || !isConnectedSection<RankingsSectionData>(data.rankings)) return null
  const r = data.rankings
  const { buckets: counts, total, page1 } = rankDistributionCounts(r, t('agencyReport.story.notInTop100'))
  const { wins, drops } = splitMovers(r.topMovers, MAX_MOVERS)
  const hasAvg = r.avgPosition?.value != null
  if (!hasAvg && total === 0 && wins.length === 0 && drops.length === 0) return null

  const chart: DeckChart | null =
    total > 0
      ? { kind: 'bar', title: t('agencyReport.chart.rankDistribution'), labels: counts.map((b) => b.label), series: [{ name: t('agencyReport.keyword'), values: counts.map((b) => b.count) }], format: '0', showValues: true }
      : null
  const rank = (v: number | null) => fmtPosition(v, locale)
  const moverTable = (items: typeof wins, title: string): DeckTable => ({
    title,
    columns: [
      { label: t('agencyReport.keyword'), align: 'left', width: 3.5 },
      { label: t('agencyReport.rank'), align: 'right', width: 1.5 },
      { label: t('agencyReport.change'), align: 'right', width: 0.8 },
    ],
    rows: items.map((m) => [clip(m.phrase, 40), `${rank(m.previousRank)} → ${rank(m.currentRank)}`, `${(m.delta ?? 0) > 0 ? '▲' : '▼'} ${Math.round(Math.abs(m.delta ?? 0))}`]),
  })
  const movers: DeckTable[] = []
  if (wins.length > 0) movers.push(moverTable(wins, t('agencyReport.story.biggestWins')))
  if (drops.length > 0) movers.push(moverTable(drops, t('agencyReport.story.biggestDrops')))

  return {
    kind: 'rankings',
    title: t('agencyReport.sections.rankings'),
    subtitle: t('agencyReport.sectionDesc.rankings'),
    tile: {
      label: t('resultsPage.avgPosition'),
      value: hasAvg ? fmtPosition(r.avgPosition.value, locale) : '—',
      movement: movementFor(r.avgPosition, t, locale, { positiveIsGood: false, digits: 1 }),
      goal: goalText(t, goals.avgPosition != null ? fmtPosition(goals.avgPosition, locale) : null),
    },
    chart,
    chartCaption: total > 0 ? t('agencyReport.story.distributionCaption', { page1, total, pct: fmtPct((page1 / total) * 100, 0, locale) }) : null,
    movers,
    notes: notesFor(data, narrative, 'rankings'),
  }
}

/** "What is holding the site back": the audit's top issues, the same table the report shows under the score. */
function siteIssuesSlide(ctx: Ctx): DeckSlide | null {
  const { t, locale, data } = ctx
  if (!ctx.enabled.has('site_health') || !isConnectedSection<SiteHealthSectionData>(data.site_health) || connectedButEmpty(data, 'site_health')) return null
  const issues = (data.site_health.topIssues ?? []).filter(isSiteHealthIssue).slice(0, MAX_TABLE_ROWS)
  if (issues.length === 0) return null
  const severityLabel = (raw: unknown): string => {
    const severity = typeof raw === 'string' && raw.trim() ? raw.trim().toLowerCase() : 'info'
    return t(`agencyReport.siteIssues.severity_${severity}`, { defaultValue: severity })
  }
  const table: DeckTable = {
    title: null,
    columns: [
      { label: t('agencyReport.siteIssues.issue'), align: 'left', width: 7.4 },
      { label: t('agencyReport.siteIssues.pages'), align: 'right', width: 1.3 },
      { label: t('agencyReport.siteIssues.severity'), align: 'left', width: 1.9 },
    ],
    rows: issues.map((issue) => [
      issue.why ? `${clip(issue.label, 70)} — ${clip(issue.why, 110)}` : clip(issue.label, 120),
      typeof issue.count === 'number' ? fmtWholeNumber(issue.count, locale) : '—',
      severityLabel(issue.severity),
    ]),
  }
  return { kind: 'table', title: t('agencyReport.siteIssues.title'), subtitle: t('agencyReport.sections.site_health'), table, notes: null }
}

function healthSlide(ctx: Ctx): DeckSlide | null {
  const { t, locale, data, goals, narrative } = ctx
  const tiles: DeckTile[] = []
  const subtitles: string[] = []
  const notes: string[] = []
  if (ctx.enabled.has('site_health') && isConnectedSection<SiteHealthSectionData>(data.site_health) && !connectedButEmpty(data, 'site_health')) {
    const s = data.site_health
    const audited = s.auditedAt ? new Date(s.auditedAt) : null
    const auditedLabel = audited && !Number.isNaN(audited.getTime()) ? audited.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : null
    tiles.push({
      label: t('resultsPage.healthLabel'),
      value: `${Math.round(s.auditScore ?? 0)}/100`,
      goal: goalText(t, goals.healthScore != null ? String(Math.round(goals.healthScore)) : null),
      caption: auditedLabel ? t('agencyReport.auditedOn', { date: auditedLabel }) : null,
    })
    subtitles.push(t('agencyReport.sectionDesc.site_health'))
    const n = notesFor(data, narrative, 'site_health')
    if (n) notes.push(n)
  }
  if (ctx.enabled.has('backlinks') && isConnectedSection<BacklinksSectionData>(data.backlinks) && !connectedButEmpty(data, 'backlinks')) {
    const b = data.backlinks
    tiles.push({ label: t('agencyReport.referringDomains'), value: fmtWholeNumber(b.referringDomains, locale) })
    tiles.push({ label: `${t('agencyReport.sections.backlinks')} · ${t('agencyReport.newBacklinks')}`, value: fmtWholeNumber(b.new, locale) })
    if (typeof b.lost === 'number') tiles.push({ label: `${t('agencyReport.sections.backlinks')} · ${t('agencyReport.lostBacklinks')}`, value: fmtWholeNumber(b.lost, locale) })
    subtitles.push(t('agencyReport.sectionDesc.backlinks'))
    const n = notesFor(data, narrative, 'backlinks')
    if (n) notes.push(n)
  }
  if (tiles.length === 0) return null
  const titles: string[] = []
  if (tiles.some((x) => x.label === t('resultsPage.healthLabel'))) titles.push(t('agencyReport.sections.site_health'))
  if (tiles.length > titles.length) titles.push(t('agencyReport.sections.backlinks'))
  return { kind: 'scorecard', title: titles.join(' · '), subtitle: subtitles.join(' '), tiles, notes: notes.length ? notes.join('\n\n') : null }
}

function nextStepsSlide(ctx: Ctx): DeckSlide | null {
  const { t, narrative } = ctx
  // Real next actions run 250-350 characters: keep the sentence, let the renderer pick the size.
  const items = (narrative?.nextActions ?? []).filter((a) => typeof a === 'string' && a.trim()).map((a) => clip(a, 420))
  if (items.length === 0) return null
  return { kind: 'list', title: t('agencyReport.nextActions'), subtitle: t('agencyReport.sectionDesc.nextActions'), items: items.slice(0, 8), notes: null }
}

/** Footer identical to the PDF: "Prepared by Agency · Client · Period" (Rankdelta only without white label). */
export function deckFooterText(t: DeckTranslate, branding: WhiteLabelReportBranding | null, client: string, period: string): string {
  const preparedBy = branding?.agencyName ? t('agencyReport.print.preparedBy', { agency: branding.agencyName }) : branding?.hideAstroSeoFooter ? '' : t('agencyReport.poweredBy')
  return [preparedBy, client, period].filter(Boolean).join(' · ')
}

/** Pure: report snapshot → typed slide list. Sections without data produce no slide. */
export function planReportDeck(input: ReportDeckInput, t: DeckTranslate): DeckPlan {
  const locale = input.locale || 'en-US'
  const branding = input.branding
  const data = input.data ?? {}
  const client = input.projectName?.trim() || t('resultsPage.yourSiteFallback')
  const period = fmtPeriodRange(input.period.start, input.period.end, locale)
  const ctx: Ctx = {
    t,
    locale,
    data,
    narrative: input.narrative,
    goals: input.goals ?? {},
    enabled: new Set(input.sections && input.sections.length > 0 ? input.sections : (['summary', 'geo', 'ai_attribution', 'rankings', 'gsc', 'ga4', 'site_health', 'backlinks'] as SectionKey[])),
  }

  const slides: DeckSlide[] = [coverSlide(ctx, input, branding, client, period)]
  const push = (s: DeckSlide | DeckSlide[] | null) => {
    if (!s) return
    for (const x of Array.isArray(s) ? s : [s]) slides.push(x)
  }
  push(briefingSlide(ctx))
  push(aiSlides(ctx))
  push(scorecardSlide(ctx))
  push(gscSlides(ctx))
  push(ga4Slide(ctx))
  push(rankingsSlide(ctx))
  push(healthSlide(ctx))
  push(siteIssuesSlide(ctx))
  push(nextStepsSlide(ctx))

  const lines: string[] = []
  if (branding?.agencyName) lines.push(t('agencyReport.print.preparedBy', { agency: branding.agencyName }))
  if (!branding?.hideAstroSeoFooter) lines.push(t('agencyReport.poweredBy'))
  slides.push({ kind: 'closing', title: t('agencyReport.deck.closingTitle'), client, period, lines })

  return {
    slides,
    accent: (branding?.primaryColor ?? DEFAULT_ACCENT).replace('#', '').slice(0, 6).toUpperCase(),
    footer: deckFooterText(t, branding, client, period),
    title: `${client} · ${period}`,
    author: branding?.agencyName ?? (branding?.hideAstroSeoFooter ? client : 'Rankdelta'),
    locale,
  }
}

/** Every string a viewer could read on the slides (titles, bullets, tiles, table cells) — for tests. */
export function deckVisibleText(plan: DeckPlan): string {
  const out: string[] = [plan.footer]
  const tile = (x: DeckTile) => out.push(x.label, x.value, x.movement?.text ?? '', x.goal ?? '', x.caption ?? '')
  const table = (x: DeckTable) => out.push(x.title ?? '', ...x.columns.map((c) => c.label), ...x.rows.flat())
  const chart = (x: DeckChart) => out.push(x.title, ...x.labels, ...x.series.map((s) => s.name))
  const cols = (c: DeckListColumn[]) => c.forEach((x) => out.push(x.label, ...x.items, x.note ?? '', x.more ?? ''))
  for (const s of plan.slides) {
    switch (s.kind) {
      case 'cover':
        out.push(s.eyebrow, s.title, s.subtitle ?? '', s.period, s.headline ?? '')
        break
      case 'briefing':
        out.push(s.title, s.subtitle, s.lead ?? '')
        cols(s.columns)
        break
      case 'ai':
        out.push(s.eyebrow, s.title, s.headline.label, s.headline.value, s.headline.movement?.text ?? '', s.caption, s.chartCaption ?? '', s.competitors ?? '')
        s.tiles.forEach(tile)
        if (s.chart) chart(s.chart)
        break
      case 'prompts':
        out.push(s.title, s.subtitle ?? '', s.footnote ?? '')
        cols(s.columns)
        break
      case 'scorecard':
        out.push(s.title, s.subtitle)
        s.tiles.forEach(tile)
        break
      case 'metrics':
        out.push(s.title, s.subtitle)
        s.tiles.forEach(tile)
        s.charts.forEach(chart)
        if (s.table) table(s.table)
        break
      case 'table':
        out.push(s.title, s.subtitle ?? '')
        table(s.table)
        break
      case 'rankings':
        out.push(s.title, s.subtitle, s.chartCaption ?? '')
        tile(s.tile)
        if (s.chart) chart(s.chart)
        s.movers.forEach(table)
        break
      case 'list':
        out.push(s.title, s.subtitle, ...s.items)
        break
      case 'closing':
        out.push(s.title, s.client, s.period, ...s.lines)
        break
    }
  }
  return out.filter(Boolean).join('\n')
}

// ---------------------------------------------------------------------------------------------
// Render (pptxgenjs)

const W = 13.333
const H = 7.5
const M = 0.6
const CW = W - 2 * M
const BODY_Y = 1.75
const BODY_BOTTOM = 6.75
const FONT = 'Arial'
const INK = '111827'
const INK_SOFT = '374151'
const MUTED = '6B7280'
const FAINT = '9CA3AF'
const LINE = 'E5E7EB'
const PANEL = 'F9FAFB'
const GOOD = '059669'
const BAD = 'DC2626'

type Slide = PptxGenJS.Slide

function toneColor(tone: DeckTone | undefined, accent: string): string {
  switch (tone) {
    case 'good':
      return GOOD
    case 'bad':
      return BAD
    case 'accent':
      return accent
    case 'flat':
    case 'muted':
      return FAINT
    default:
      return INK_SOFT
  }
}

function header(slide: Slide, accent: string, eyebrow: string | null, title: string, subtitle?: string | null) {
  slide.addShape('rect', { x: M, y: 0.55, w: 0.55, h: 0.07, fill: { color: accent }, line: { color: accent, width: 0 } })
  if (eyebrow) {
    slide.addText(eyebrow.toUpperCase(), { x: M, y: 0.68, w: CW, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: accent, charSpacing: 2, margin: 0 })
  }
  slide.addText(title, { x: M, y: eyebrow ? 0.95 : 0.7, w: CW, h: 0.55, fontFace: FONT, fontSize: 26, bold: true, color: INK, margin: 0, valign: 'top' })
  if (subtitle) {
    slide.addText(subtitle, { x: M, y: eyebrow ? 1.42 : 1.2, w: CW, h: 0.32, fontFace: FONT, fontSize: 12, color: MUTED, margin: 0, valign: 'top' })
  }
}

function footer(slide: Slide, text: string, index: number) {
  slide.addShape('line', { x: M, y: 6.98, w: CW, h: 0, line: { color: LINE, width: 0.75 } })
  slide.addText(text, { x: M, y: 7.02, w: CW - 0.8, h: 0.28, fontFace: FONT, fontSize: 9, color: FAINT, margin: 0, valign: 'middle' })
  slide.addText(String(index), { x: W - M - 0.8, y: 7.02, w: 0.8, h: 0.28, fontFace: FONT, fontSize: 9, color: FAINT, align: 'right', margin: 0, valign: 'middle' })
}

function tile(slide: Slide, accent: string, x: number, y: number, w: number, h: number, data: DeckTile) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: LINE, width: 1 } })
  slide.addShape('rect', { x: x + 0.22, y: y + 0.22, w: 0.3, h: 0.05, fill: { color: accent }, line: { color: accent, width: 0 } })
  const big = h >= 2
  slide.addText(data.label.toUpperCase(), { x: x + 0.22, y: y + 0.32, w: w - 0.44, h: 0.3, fontFace: FONT, fontSize: 9, bold: true, color: MUTED, charSpacing: 1, margin: 0, valign: 'top' })
  const valueSize = big ? (data.value.length > 7 ? 30 : 36) : data.value.length > 7 ? 22 : 26
  slide.addText(data.value, { x: x + 0.22, y: y + 0.62, w: w - 0.44, h: big ? 0.75 : 0.5, fontFace: FONT, fontSize: valueSize, bold: true, color: INK, margin: 0, valign: 'top' })
  let cy = y + (big ? 1.42 : 1.12)
  if (data.movement) {
    // Narrow tiles (4 per row) wrap the movement line: give it two lines at a smaller size.
    const narrow = w < 3.2
    const mh = narrow ? 0.42 : 0.28
    slide.addText(data.movement.text, { x: x + 0.22, y: cy, w: w - 0.44, h: mh, fontFace: FONT, fontSize: narrow ? 10 : 11, bold: true, color: toneColor(data.movement.tone, accent), margin: 0, valign: 'top' })
    cy += mh
  }
  for (const extra of [data.goal, data.caption]) {
    if (!extra || cy + 0.25 > y + h - 0.1) continue
    slide.addText(extra, { x: x + 0.22, y: cy, w: w - 0.44, h: 0.25, fontFace: FONT, fontSize: 10, color: FAINT, margin: 0, valign: 'top' })
    cy += 0.25
  }
}

function tileRow(slide: Slide, accent: string, tiles: DeckTile[], y: number, h: number, gap = 0.3) {
  if (tiles.length === 0) return
  const w = (CW - gap * (tiles.length - 1)) / tiles.length
  tiles.forEach((tl, i) => tile(slide, accent, M + i * (w + gap), y, w, h, tl))
}

function chart(pptx: PptxGenJS, slide: Slide, accent: string, spec: DeckChart, x: number, y: number, w: number, h: number) {
  const data = spec.series.map((s) => ({ name: s.name, labels: spec.labels, values: s.values }))
  const type: PptxGenJS.CHART_NAME = spec.kind === 'line' ? 'line' : 'bar'
  const base: PptxGenJS.IChartOpts = {
    x,
    y,
    w,
    h,
    // Line series cycle through the palette; a single-series bar chart would colour each bar
    // differently with more than one entry, so bars get the accent only.
    chartColors: spec.kind === 'line' ? [accent, 'A3A3A3', '60A5FA'] : [accent],
    showTitle: true,
    title: spec.title,
    titleFontFace: FONT,
    titleFontSize: 12,
    titleColor: INK_SOFT,
    titleAlign: 'left',
    catAxisLabelFontFace: FONT,
    catAxisLabelFontSize: 9,
    catAxisLabelColor: MUTED,
    catAxisLineShow: false,
    valAxisLabelFontFace: FONT,
    valAxisLabelFontSize: 9,
    valAxisLabelColor: MUTED,
    valAxisLineShow: false,
    valGridLine: { color: LINE, style: 'solid', size: 0.5 },
    catGridLine: { style: 'none' },
    showLegend: spec.series.length > 1,
    legendPos: 'b',
    legendFontFace: FONT,
    legendFontSize: 10,
    legendColor: MUTED,
    plotArea: { fill: { color: 'FFFFFF' } },
    chartArea: { fill: { color: 'FFFFFF' } },
  }
  if (spec.format) base.valAxisLabelFormatCode = spec.format
  if (spec.max != null) {
    base.valAxisMaxVal = spec.max
    base.valAxisMinVal = 0
  }
  if (spec.kind === 'line') {
    Object.assign(base, { lineSize: 2.25, lineDataSymbol: 'none', lineSmooth: false, catAxisLabelRotate: spec.labels.length > 12 ? -45 : 0 })
  } else {
    Object.assign(base, {
      barDir: spec.kind === 'hbar' ? 'bar' : 'col',
      barGapWidthPct: spec.kind === 'hbar' ? 60 : 80,
      showValue: !!spec.showValues,
      dataLabelFontFace: FONT,
      dataLabelFontSize: 10,
      dataLabelColor: INK_SOFT,
      dataLabelPosition: 'outEnd',
      dataLabelFormatCode: spec.format ?? '0',
      valAxisHidden: spec.kind === 'hbar',
      valGridLine: spec.kind === 'hbar' ? { style: 'none' } : base.valGridLine,
    })
  }
  slide.addChart(type, data, base)
  void pptx
}

function table(slide: Slide, accent: string, spec: DeckTable, x: number, y: number, w: number, opts: { fontSize?: number; rowH?: number; maxRows?: number } = {}) {
  const fontSize = opts.fontSize ?? 12
  const rowH = opts.rowH ?? 0.38
  let cy = y
  if (spec.title) {
    slide.addText(spec.title, { x, y: cy, w, h: 0.3, fontFace: FONT, fontSize: 12, bold: true, color: INK_SOFT, margin: 0, valign: 'top' })
    cy += 0.34
  }
  const totalW = spec.columns.reduce((s, c) => s + c.width, 0)
  const colW = spec.columns.map((c) => (c.width / totalW) * w)
  const head: PptxGenJS.TableRow = spec.columns.map((c) => ({
    text: c.label,
    options: { bold: true, color: MUTED, fill: { color: PANEL }, align: c.align, fontSize: fontSize - 1, fontFace: FONT },
  }))
  const rows: PptxGenJS.TableRow[] = spec.rows.slice(0, opts.maxRows ?? MAX_TABLE_ROWS).map((r) =>
    r.map((cell, i) => ({
      text: cell,
      options: { align: spec.columns[i]?.align ?? 'left', color: i === 0 ? INK : INK_SOFT, bold: i === 0, fontSize, fontFace: FONT },
    })),
  )
  slide.addTable([head, ...rows], {
    x,
    y: cy,
    w,
    colW,
    rowH,
    fontFace: FONT,
    fontSize,
    border: { type: 'solid', pt: 0.5, color: LINE },
    margin: 0.06,
    valign: 'middle',
    autoPage: false,
  })
  void accent
}

function listColumn(slide: Slide, accent: string, col: DeckListColumn, x: number, y: number, w: number, h: number, fontSize: number) {
  const color = toneColor(col.tone, accent)
  slide.addText(col.label.toUpperCase(), { x, y, w, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color, charSpacing: 1, margin: 0, valign: 'top' })
  slide.addShape('line', { x, y: y + 0.34, w, h: 0, line: { color, width: 1.25 } })
  const runs: PptxGenJS.TextProps[] = []
  if (col.items.length === 0 && col.note) {
    runs.push({ text: col.note, options: { fontSize: fontSize - 1, color: FAINT, italic: true } })
  } else {
    col.items.forEach((item, i) => {
      runs.push({
        text: item,
        options: {
          // Explicit start per paragraph: Keynote / Google Slides / LibreOffice restart auto-numbering otherwise.
          bullet: col.numbered ? { type: 'number', numberStartAt: i + 1, indent: 18 } : { indent: 14, characterCode: '25AA' },
          paraSpaceAfter: 8,
          color: INK_SOFT,
          fontSize,
          breakLine: i < col.items.length - 1,
        },
      })
    })
  }
  if (runs.length > 0) {
    slide.addText(runs, { x, y: y + 0.45, w, h: h - 0.45, fontFace: FONT, fontSize, color: INK_SOFT, valign: 'top', margin: 0, paraSpaceAfter: 8 })
  }
  const tail = [col.items.length > 0 ? col.note : null, col.more].filter(Boolean).join(' ')
  if (tail) {
    slide.addText(tail, { x, y: y + h - 0.3, w, h: 0.3, fontFace: FONT, fontSize: 10, color: FAINT, italic: true, margin: 0, valign: 'bottom' })
  }
}

function renderCover(slide: Slide, plan: DeckPlan, s: Extract<DeckSlide, { kind: 'cover' }>) {
  slide.addShape('rect', { x: 0, y: 0, w: 0.32, h: H, fill: { color: plan.accent }, line: { color: plan.accent, width: 0 } })
  if (s.logo) {
    slide.addImage({ data: s.logo, x: W - M - 2.4, y: 0.6, w: 2.4, h: 1.0, sizing: { type: 'contain', w: 2.4, h: 1.0 } })
  }
  const x = 1.1
  const w = W - x - 3.4
  slide.addText(s.eyebrow.toUpperCase(), { x, y: 2.15, w, h: 0.35, fontFace: FONT, fontSize: 12, bold: true, color: plan.accent, charSpacing: 3, margin: 0 })
  slide.addText(s.title, { x, y: 2.55, w, h: 1.1, fontFace: FONT, fontSize: s.title.length > 28 ? 36 : 44, bold: true, color: INK, margin: 0, valign: 'top' })
  let y = 3.75
  if (s.subtitle) {
    slide.addText(s.subtitle, { x, y, w, h: 0.4, fontFace: FONT, fontSize: 18, color: INK_SOFT, margin: 0 })
    y += 0.45
  }
  slide.addText(s.period, { x, y, w, h: 0.4, fontFace: FONT, fontSize: 16, color: MUTED, margin: 0 })
  y += 0.55
  if (s.headline) {
    slide.addShape('line', { x, y: y + 0.05, w: 1.2, h: 0, line: { color: LINE, width: 1 } })
    slide.addText(s.headline, { x, y: y + 0.2, w, h: 0.8, fontFace: FONT, fontSize: 14, color: INK_SOFT, margin: 0, valign: 'top' })
  }
}

function renderBriefing(slide: Slide, plan: DeckPlan, s: Extract<DeckSlide, { kind: 'briefing' }>) {
  header(slide, plan.accent, null, s.title, s.subtitle)
  let y = BODY_Y
  if (s.lead) {
    const leadH = s.columns.length ? (s.lead.length > 520 ? 1.35 : 1.15) : BODY_BOTTOM - y
    const leadSize = s.columns.length ? (s.lead.length > 520 ? 12 : 13) : 18
    slide.addText(s.lead, { x: M, y, w: CW, h: leadH, fontFace: FONT, fontSize: leadSize, color: INK_SOFT, italic: !!s.columns.length, margin: 0, valign: 'top', fit: 'shrink' })
    y += leadH + 0.2
  }
  if (s.columns.length === 0) return
  const gap = 0.4
  const w = (CW - gap * (s.columns.length - 1)) / s.columns.length
  const h = BODY_BOTTOM - y
  const longest = Math.max(0, ...s.columns.flatMap((c) => c.items.map((i) => i.length)))
  const fontSize = h < 3.9 ? 12 : longest > 150 ? 12 : longest > 110 ? 13 : 14
  s.columns.forEach((col, i) => listColumn(slide, plan.accent, col, M + i * (w + gap), y, w, h, fontSize))
}

function renderAi(pptx: PptxGenJS, slide: Slide, plan: DeckPlan, s: Extract<DeckSlide, { kind: 'ai' }>) {
  header(slide, plan.accent, s.eyebrow, s.title)
  const leftW = s.chart ? 5.9 : CW
  const x = M
  slide.addText(s.headline.label.toUpperCase(), { x, y: 1.7, w: leftW, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: MUTED, charSpacing: 1, margin: 0 })
  slide.addText(s.headline.value, { x, y: 1.95, w: leftW, h: 1.2, fontFace: FONT, fontSize: 66, bold: true, color: INK, margin: 0, valign: 'top' })
  let y = 3.2
  if (s.headline.movement) {
    slide.addText(s.headline.movement.text, { x, y, w: leftW, h: 0.32, fontFace: FONT, fontSize: 13, bold: true, color: toneColor(s.headline.movement.tone, plan.accent), margin: 0 })
    y += 0.38
  }
  slide.addText(s.caption, { x, y, w: leftW, h: 0.95, fontFace: FONT, fontSize: 12, color: MUTED, margin: 0, valign: 'top' })
  y += 1.0
  const gap = 0.2
  const tw = (leftW - gap * (s.tiles.length - 1)) / s.tiles.length
  s.tiles.forEach((tl, i) => tile(slide, plan.accent, x + i * (tw + gap), y, tw, 1.4, tl))
  y += 1.5
  if (s.competitors) {
    slide.addText(`${s.tiles[s.tiles.length - 1]?.label ?? ''}: ${s.competitors}`, { x, y, w: leftW, h: Math.max(0.3, BODY_BOTTOM - y), fontFace: FONT, fontSize: 10, color: FAINT, margin: 0, valign: 'top' })
  }
  if (s.chart) {
    const cx = M + leftW + 0.5
    const cw = CW - leftW - 0.5
    chart(pptx, slide, plan.accent, s.chart, cx, 1.65, cw, 4.4)
    if (s.chartCaption) slide.addText(s.chartCaption, { x: cx, y: 6.1, w: cw, h: 0.5, fontFace: FONT, fontSize: 10, color: FAINT, margin: 0, valign: 'top' })
  }
}

function renderPrompts(slide: Slide, plan: DeckPlan, s: Extract<DeckSlide, { kind: 'prompts' }>) {
  header(slide, plan.accent, s.subtitle, s.title)
  const gap = 0.5
  const bottom = s.footnote ? BODY_BOTTOM - 0.45 : BODY_BOTTOM
  const w = (CW - gap * (s.columns.length - 1)) / s.columns.length
  s.columns.forEach((col, i) => listColumn(slide, plan.accent, col, M + i * (w + gap), BODY_Y, w, bottom - BODY_Y, 14))
  if (s.footnote) {
    slide.addText(s.footnote, { x: M, y: BODY_BOTTOM - 0.4, w: CW, h: 0.4, fontFace: FONT, fontSize: 10, color: FAINT, italic: true, margin: 0, valign: 'bottom' })
  }
}

function renderScorecard(slide: Slide, plan: DeckPlan, s: Extract<DeckSlide, { kind: 'scorecard' }>) {
  header(slide, plan.accent, null, s.title, s.subtitle)
  const n = s.tiles.length
  const cols = n <= 4 ? n : 3
  const rows = Math.ceil(n / cols)
  const gap = 0.3
  const w = (CW - gap * (cols - 1)) / cols
  const h = rows === 1 ? 2.6 : (BODY_BOTTOM - BODY_Y - gap) / 2
  const y0 = rows === 1 ? BODY_Y + 0.6 : BODY_Y
  s.tiles.forEach((tl, i) => {
    const r = Math.floor(i / cols)
    const c = i % cols
    tile(slide, plan.accent, M + c * (w + gap), y0 + r * (h + gap), w, h, tl)
  })
}

function renderMetrics(pptx: PptxGenJS, slide: Slide, plan: DeckPlan, s: Extract<DeckSlide, { kind: 'metrics' }>) {
  header(slide, plan.accent, null, s.title, s.subtitle)
  let y = BODY_Y
  if (s.tiles.length > 0) {
    tileRow(slide, plan.accent, s.tiles, y, 1.5)
    y += 1.7
  }
  const h = BODY_BOTTOM - y
  const blocks: Array<'chart' | 'table'> = [...s.charts.map(() => 'chart' as const), ...(s.table ? ['table' as const] : [])]
  if (blocks.length === 0) return
  const gap = 0.4
  const w = (CW - gap * (blocks.length - 1)) / blocks.length
  let ci = 0
  blocks.forEach((b, i) => {
    const x = M + i * (w + gap)
    if (b === 'chart') chart(pptx, slide, plan.accent, s.charts[ci++]!, x, y, w, h)
    else if (s.table) table(slide, plan.accent, s.table, x, y, w, { fontSize: 11, rowH: 0.33 })
  })
}

function renderTable(slide: Slide, plan: DeckPlan, s: Extract<DeckSlide, { kind: 'table' }>) {
  header(slide, plan.accent, s.subtitle, s.title)
  table(slide, plan.accent, { ...s.table, title: null }, M, BODY_Y, CW, { fontSize: 13, rowH: 0.5 })
}

function renderRankings(pptx: PptxGenJS, slide: Slide, plan: DeckPlan, s: Extract<DeckSlide, { kind: 'rankings' }>) {
  header(slide, plan.accent, null, s.title, s.subtitle)
  const leftW = s.movers.length > 0 ? 5.6 : CW
  tile(slide, plan.accent, M, BODY_Y, leftW, 1.5, s.tile)
  if (s.chart) {
    chart(pptx, slide, plan.accent, s.chart, M, BODY_Y + 1.65, leftW, s.chartCaption ? 2.95 : 3.3)
    if (s.chartCaption) slide.addText(s.chartCaption, { x: M, y: BODY_BOTTOM - 0.35, w: leftW, h: 0.35, fontFace: FONT, fontSize: 10, color: FAINT, margin: 0, valign: 'bottom' })
  }
  if (s.movers.length > 0) {
    const x = M + leftW + 0.5
    const w = CW - leftW - 0.5
    const each = (BODY_BOTTOM - BODY_Y) / s.movers.length
    s.movers.forEach((mv, i) => table(slide, plan.accent, mv, x, BODY_Y + i * each, w, { fontSize: 11, rowH: 0.32, maxRows: MAX_MOVERS }))
  }
}

function renderList(slide: Slide, plan: DeckPlan, s: Extract<DeckSlide, { kind: 'list' }>) {
  header(slide, plan.accent, null, s.title, s.subtitle)
  // ~150 characters per line at 14pt on a 12" box: size by total text so five long actions still fit.
  const chars = s.items.reduce((n, item) => n + item.length, 0)
  const fontSize = chars > 1500 || s.items.length > 6 ? 13 : chars > 1000 ? 14 : chars > 600 || s.items.length > 4 ? 16 : 19
  const runs: PptxGenJS.TextProps[] = s.items.map((item, i) => ({
    text: item,
    options: { bullet: { type: 'number', numberStartAt: i + 1, indent: 26 }, paraSpaceAfter: 12, breakLine: i < s.items.length - 1 },
  }))
  slide.addText(runs, { x: M, y: BODY_Y, w: CW, h: BODY_BOTTOM - BODY_Y, fontFace: FONT, fontSize, color: INK_SOFT, valign: 'top', margin: 0, paraSpaceAfter: 12 })
}

function renderClosing(slide: Slide, plan: DeckPlan, s: Extract<DeckSlide, { kind: 'closing' }>) {
  slide.addShape('rect', { x: 0, y: 0, w: 0.32, h: H, fill: { color: plan.accent }, line: { color: plan.accent, width: 0 } })
  const x = 1.1
  const w = W - x - M
  slide.addText(s.title, { x, y: 2.3, w, h: 1.0, fontFace: FONT, fontSize: 44, bold: true, color: INK, margin: 0, valign: 'top' })
  slide.addText(s.client, { x, y: 3.35, w, h: 0.45, fontFace: FONT, fontSize: 20, bold: true, color: INK_SOFT, margin: 0 })
  slide.addText(s.period, { x, y: 3.8, w, h: 0.4, fontFace: FONT, fontSize: 14, color: MUTED, margin: 0 })
  let y = 4.6
  s.lines.forEach((line, i) => {
    slide.addText(line, { x, y, w, h: 0.4, fontFace: FONT, fontSize: i === 0 && s.lines.length > 1 ? 16 : 13, bold: i === 0 && s.lines.length > 1, color: i === 0 && s.lines.length > 1 ? plan.accent : MUTED, margin: 0 })
    y += 0.42
  })
}

/** Draw a plan into a fresh pptxgenjs presentation (widescreen). */
export function renderReportDeck(plan: DeckPlan, Ctor: typeof PptxGenJS = PptxGenJS): PptxGenJS {
  const pptx = new Ctor()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = plan.title
  pptx.author = plan.author
  pptx.company = plan.author

  plan.slides.forEach((s, i) => {
    const slide = pptx.addSlide()
    slide.background = { color: 'FFFFFF' }
    switch (s.kind) {
      case 'cover':
        renderCover(slide, plan, s)
        break
      case 'briefing':
        renderBriefing(slide, plan, s)
        break
      case 'ai':
        renderAi(pptx, slide, plan, s)
        break
      case 'prompts':
        renderPrompts(slide, plan, s)
        break
      case 'scorecard':
        renderScorecard(slide, plan, s)
        break
      case 'metrics':
        renderMetrics(pptx, slide, plan, s)
        break
      case 'table':
        renderTable(slide, plan, s)
        break
      case 'rankings':
        renderRankings(pptx, slide, plan, s)
        break
      case 'list':
        renderList(slide, plan, s)
        break
      case 'closing':
        renderClosing(slide, plan, s)
        break
    }
    if (s.kind !== 'cover' && s.kind !== 'closing') footer(slide, plan.footer, i + 1)
    if ('notes' in s && s.notes) slide.addNotes(s.notes)
  })
  return pptx
}

// ---------------------------------------------------------------------------------------------
// Entry points

/**
 * Fetch the agency logo as a base64 data string for the cover. Any failure (CORS, 404, not an
 * image, timeout) resolves to null so the deck is still produced — just without the logo.
 */
export async function loadLogoData(url: string | null | undefined, timeoutMs = 6000): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url) || typeof fetch !== 'function') return null
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
    const res = await fetch(url, { mode: 'cors', signal: ctrl?.signal ?? undefined })
    if (timer) clearTimeout(timer)
    if (!res.ok) return null
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/gif'].includes(type)) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length === 0 || bytes.length > 4_000_000) return null
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return `${type};base64,${btoa(bin)}`
  } catch {
    return null
  }
}

/** `<client>-<period>-<agency|rankdelta>.pptx`, same slug rules as the PDF. */
export function buildReportDeckFilename(clientName: string, periodStart: string, periodEnd: string, branding: WhiteLabelReportBranding | null): string {
  const suffix = branding?.hideAstroSeoFooter && branding.agencyName ? branding.agencyName : 'rankdelta'
  return `${buildReportPdfBasename(clientName, periodStart, periodEnd, suffix)}.pptx`
}

/** Build the .pptx as a Blob (browser and node). The logo is fetched here and skipped on failure. */
export async function buildReportDeck(input: ReportDeckInput, t: DeckTranslate): Promise<Blob> {
  const logoData = input.logoData === undefined ? await loadLogoData(input.branding?.logoUrl) : input.logoData
  const plan = planReportDeck({ ...input, logoData }, t)
  const pptx = renderReportDeck(plan)
  const out = await pptx.write({ outputType: 'blob', compression: true })
  if (out instanceof Blob) return out
  const bytes = typeof out === 'string' ? Uint8Array.from(atob(out), (c) => c.charCodeAt(0)) : new Uint8Array(out as ArrayBuffer)
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
}

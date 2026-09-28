import i18n from '../../common/i18n'
import type { TFunction } from 'i18next'
import type { MetricWithDelta } from '../reportBuild/math'
import type { Ga4SectionData, GeoSectionData, GscSectionData, ReportData, ReportGoals, ReportSummaryKpis } from './types'
import { isConnectedSection, type SectionKey } from './sections'
import { fmtGuidanceDate } from './emptyStates'

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only its element type is used
const TREMOR_PALETTE = [
  'violet',
  'indigo',
  'blue',
  'cyan',
  'teal',
  'emerald',
  'amber',
  'orange',
  'red',
  'pink',
  'rose',
] as const

const DEFAULT_ACCENT = '#7c3aed'

/** Map a hex brand color to the nearest Tremor palette name. */
export function hexToTremorColor(hex: string | null | undefined): (typeof TREMOR_PALETTE)[number] {
  const h = (hex ?? DEFAULT_ACCENT).replace('#', '')
  if (h.length < 6) return 'violet'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const anchors: Array<{ name: (typeof TREMOR_PALETTE)[number]; rgb: [number, number, number] }> = [
    { name: 'violet', rgb: [124, 58, 237] },
    { name: 'indigo', rgb: [99, 102, 241] },
    { name: 'blue', rgb: [59, 130, 246] },
    { name: 'cyan', rgb: [6, 182, 212] },
    { name: 'teal', rgb: [20, 184, 166] },
    { name: 'emerald', rgb: [16, 185, 129] },
    { name: 'amber', rgb: [245, 158, 11] },
    { name: 'orange', rgb: [249, 115, 22] },
    { name: 'red', rgb: [239, 68, 68] },
    { name: 'pink', rgb: [236, 72, 153] },
    { name: 'rose', rgb: [244, 63, 94] },
  ]
  let best = anchors[0]!
  let bestDist = Infinity
  for (const a of anchors) {
    const d = (r - a.rgb[0]) ** 2 + (g - a.rgb[1]) ** 2 + (b - a.rgb[2]) ** 2
    if (d < bestDist) {
      bestDist = d
      best = a
    }
  }
  return best.name
}

export function chartColors(primaryHex: string | null | undefined): [string, string, string] {
  const primary = hexToTremorColor(primaryHex)
  const muted = primary === 'violet' ? 'indigo' : 'gray'
  return [primary, muted, 'cyan']
}

/** Report numbers follow the UI language: 14.3% in EN, 14,3% in IT (same rule as the briefing). */
export function reportNumberLocale(): string {
  return (i18n.language ?? 'en').startsWith('it') ? 'it-IT' : 'en-US'
}

/** `locale` overrides the UI language (deck/PDF builders that format for a given report locale). */
export function fmtDecimals(v: number, digits: number, locale: string = reportNumberLocale()): string {
  return v.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** "#7" / "#18,5" — rank positions keep one decimal only when needed. */
export function fmtPosition(v: number | null | undefined, locale?: string): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `#${Number.isInteger(v) ? v : fmtDecimals(v, 1, locale)}`
}

/** Whole numbers with the report locale's thousands separator (15.994 in IT, 15,994 in EN). */
export function fmtWholeNumber(v: number | null | undefined, locale: string = reportNumberLocale()): string {
  return v != null && Number.isFinite(v) ? Math.round(v).toLocaleString(locale) : '—'
}

export function fmtCompactNum(v: number | null | undefined, locale?: string): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${fmtDecimals(v / 1_000_000, 1, locale)}M`
  if (abs >= 1_000) return `${fmtDecimals(v / 1_000, 1, locale)}k`
  return Number.isInteger(v) ? String(v) : fmtDecimals(v, 1, locale)
}

export function fmtPct(v: number | null | undefined, digits = 1, locale?: string): string {
  return v != null && Number.isFinite(v) ? `${fmtDecimals(v, digits, locale)}%` : '—'
}

export function fmtAxisDate(date: string, locale: string): string {
  try {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  } catch {
    return date
  }
}

/** "16 Aug – 14 Sep 2026" style range (year shown once when both dates share it). */
export function fmtPeriodRange(start: string, end: string, locale: string): string {
  try {
    const s = new Date(`${start}T12:00:00Z`)
    const e = new Date(`${end}T12:00:00Z`)
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return `${start} – ${end}`
    const sameYear = s.getUTCFullYear() === e.getUTCFullYear()
    const startLabel = s.toLocaleDateString(locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
    const endLabel = e.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
    return `${startLabel} – ${endLabel}`
  } catch {
    return `${start} – ${end}`
  }
}

/** "2 hours ago" / "3 giorni fa" for report timestamps; falls back to the date past 30 days. */
export function fmtRelativeTime(iso: string, locale: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return iso
  const diffSec = Math.round((then.getTime() - now.getTime()) / 1000)
  const abs = Math.abs(diffSec)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (abs < 60) return rtf.format(0, 'minute').replace(/^in /, '')
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour')
  if (abs < 30 * 86_400) return rtf.format(Math.round(diffSec / 86_400), 'day')
  return then.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * computeDelta() treats a missing prior as 0, which yields delta === value and deltaPct === 100.
 * That is a "first reading", not a real movement — callers hide the delta chip in that case.
 */
export function hasBaseline(metric: MetricWithDelta | null | undefined): boolean {
  if (!metric || metric.value == null || metric.delta == null) return false
  return !(metric.delta === metric.value && metric.deltaPct === 100)
}

/** Flat prior-period reference series when KPI delta is available. */
export function priorPeriodOverlay<T extends Record<string, unknown>>(
  rows: T[],
  metric: MetricWithDelta | undefined,
  _valueKey: string,
  priorLabel: string,
): T[] {
  if (!metric || metric.delta == null || metric.value == null || rows.length === 0) return rows
  const prior = metric.value - metric.delta
  return rows.map((row) => ({ ...row, [priorLabel]: prior }))
}

export interface SummaryMovement {
  label: string
  delta: number
  positiveIsGood: boolean
}

export function biggestPositiveMovement(
  summary: ReportSummaryKpis,
  labels: {
    healthScore: string
    aiSov: string
    avgPosition: string
    gscClicks: string
    ga4Sessions: string
    aiSessions: string
  },
): SummaryMovement | null {
  const candidates: SummaryMovement[] = []
  const push = (label: string, metric: MetricWithDelta, positiveIsGood: boolean) => {
    // A first reading (no prior period) is not a movement worth headlining.
    if (metric.delta == null || !hasBaseline(metric)) return
    const improvement = positiveIsGood ? metric.delta : -metric.delta
    if (improvement > 0) candidates.push({ label, delta: metric.delta, positiveIsGood })
  }
  push(labels.healthScore, summary.healthScore, true)
  push(labels.aiSov, summary.aiSov, true)
  push(labels.avgPosition, summary.avgPosition, false)
  push(labels.gscClicks, summary.gscClicks, true)
  push(labels.ga4Sessions, summary.ga4Sessions, true)
  push(labels.aiSessions, summary.ga4AiAssistantSessions, true)
  if (candidates.length === 0) return null
  return candidates.reduce((best, c) => {
    const score = c.positiveIsGood ? c.delta : -c.delta
    const bestScore = best.positiveIsGood ? best.delta : -best.delta
    return score > bestScore ? c : best
  })
}

export function derivePeriodHeadline(
  summary: ReportSummaryKpis | undefined,
  labels: {
    healthScore: string
    aiSov: string
    avgPosition: string
    gscClicks: string
    ga4Sessions: string
    aiSessions: string
  },
  t: TFunction,
  locale?: string,
  /** Date of the audit behind the score when it predates the period (see auditDateBeforePeriod). */
  auditDate?: string | null,
): string | null {
  if (!summary) return null
  const health = summary.healthScore.value
  const movement = biggestPositiveMovement(summary, labels)
  if (health == null) return null
  if (!movement) {
    return auditDate
      ? t('agencyReport.periodHeadlineHealthOnlyAudit', { health: Math.round(health), date: auditDate })
      : t('agencyReport.periodHeadlineHealthOnly', { health: Math.round(health) })
  }
  const changeLabel = movement.positiveIsGood
    ? t('agencyReport.periodHeadlineUp', { label: movement.label, value: fmtDecimals(Math.abs(movement.delta), 1, locale) })
    : t('agencyReport.periodHeadlineDown', { label: movement.label, value: fmtDecimals(Math.abs(movement.delta), 1, locale) })
  return auditDate
    ? t('agencyReport.periodHeadlineAudit', { health: Math.round(health), date: auditDate, change: changeLabel })
    : t('agencyReport.periodHeadline', { health: Math.round(health), change: changeLabel })
}

/**
 * The health score is the last site audit's, which can be older than the report period (an audit
 * of 30 Jun in a 16 Aug – 14 Sep report said "Health score 51 this period"). Its formatted date
 * when it predates the period, else null.
 */
export function auditDateBeforePeriod(siteHealth: unknown, periodStart: string | null | undefined, locale: string): string | null {
  if (!periodStart || !siteHealth || typeof siteHealth !== 'object') return null
  const auditedAt = (siteHealth as { auditedAt?: unknown }).auditedAt
  if (typeof auditedAt !== 'string') return null
  const audited = new Date(auditedAt).getTime()
  const start = new Date(`${periodStart}T00:00:00Z`).getTime()
  if (!Number.isFinite(audited) || !Number.isFinite(start) || audited >= start) return null
  return fmtGuidanceDate(auditedAt, locale)
}

export const SECTION_CONNECT_KEYS: Record<SectionKey, string> = {
  summary: 'agencyReport.connect.summary',
  geo: 'agencyReport.connect.geo',
  ai_attribution: 'agencyReport.connect.ai_attribution',
  rankings: 'agencyReport.connect.rankings',
  gsc: 'agencyReport.connect.gsc',
  ga4: 'agencyReport.connect.ga4',
  site_health: 'agencyReport.connect.site_health',
  backlinks: 'agencyReport.connect.backlinks',
}

export const SECTION_DESC_KEYS: Record<SectionKey, string> = {
  summary: 'agencyReport.sectionDesc.summary',
  geo: 'agencyReport.sectionDesc.geo',
  ai_attribution: 'agencyReport.sectionDesc.ai_attribution',
  rankings: 'agencyReport.sectionDesc.rankings',
  gsc: 'agencyReport.sectionDesc.gsc',
  ga4: 'agencyReport.sectionDesc.ga4',
  site_health: 'agencyReport.sectionDesc.site_health',
  backlinks: 'agencyReport.sectionDesc.backlinks',
}

export const SCORECARD_KPIS: Array<{
  key: keyof ReportSummaryKpis
  goalKey: keyof ReportGoals
  labelKey: string
  positiveIsGood: boolean
  format: 'pct' | 'position' | 'num'
}> = [
  { key: 'healthScore', goalKey: 'healthScore', labelKey: 'resultsPage.healthLabel', positiveIsGood: true, format: 'num' },
  { key: 'aiSov', goalKey: 'aiSov', labelKey: 'agencyReport.shareOfVoice', positiveIsGood: true, format: 'pct' },
  { key: 'avgPosition', goalKey: 'avgPosition', labelKey: 'resultsPage.avgPosition', positiveIsGood: false, format: 'position' },
  { key: 'gscClicks', goalKey: 'gscClicks', labelKey: 'agencyReport.gscClicks', positiveIsGood: true, format: 'num' },
  { key: 'ga4Sessions', goalKey: 'ga4Sessions', labelKey: 'agencyReport.ga4Sessions', positiveIsGood: true, format: 'num' },
  { key: 'ga4AiAssistantSessions', goalKey: 'ga4AiAssistantSessions', labelKey: 'agencyReport.aiSessions', positiveIsGood: true, format: 'num' },
]

export function formatScorecardValue(v: number | null, format: 'pct' | 'position' | 'num', locale?: string): string {
  if (v == null) return '—'
  if (format === 'pct') return fmtPct(v, 1, locale)
  if (format === 'position') return fmtPosition(v, locale)
  return fmtCompactNum(v, locale)
}

/**
 * Daily series behind a KPI card, for the inline sparkline. Only KPIs with a trend array in
 * `report.data` get one (GEO share of voice, GSC clicks/impressions, GA4 sessions/users); everything
 * else — and any series with fewer than two points — returns null so the card renders no chart.
 */
export function kpiSparklineSeries(
  data: ReportData | null | undefined,
  section: SectionKey,
  metric: string,
): number[] | null {
  if (!data) return null
  const pick = <T,>(rows: T[] | undefined, get: (row: T) => number | null | undefined): number[] | null => {
    if (!Array.isArray(rows) || rows.length < 2) return null
    const values: number[] = []
    for (const row of rows) {
      const v = get(row)
      if (typeof v !== 'number' || !Number.isFinite(v)) return null
      values.push(v)
    }
    return values
  }
  const geo = isConnectedSection<GeoSectionData>(data.geo) ? data.geo : null
  const gsc = isConnectedSection<GscSectionData>(data.gsc) ? data.gsc : null
  const ga4 = isConnectedSection<Ga4SectionData>(data.ga4) ? data.ga4 : null

  if (section === 'summary') {
    if (metric === 'aiSov') return pick(geo?.trend, (r) => r.sovPercent)
    if (metric === 'gscClicks') return pick(gsc?.trend, (r) => r.clicks)
    if (metric === 'ga4Sessions') return pick(ga4?.trend, (r) => r.sessions)
    return null
  }
  if (section === 'geo' && metric === 'sovOverall') return pick(geo?.trend, (r) => r.sovPercent)
  if (section === 'gsc') {
    if (metric === 'clicks') return pick(gsc?.trend, (r) => r.clicks)
    if (metric === 'impressions') return pick(gsc?.trend, (r) => r.impressions)
    return null
  }
  if (section === 'ga4') {
    if (metric === 'sessions') return pick(ga4?.trend, (r) => r.sessions)
    if (metric === 'users') return pick(ga4?.trend, (r) => r.users)
    return null
  }
  return null
}

export function sortMoversByAbsChange<T extends { delta: number | null }>(movers: T[]): T[] {
  return [...movers].sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
}

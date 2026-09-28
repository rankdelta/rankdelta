/**
 * Transactional email for scheduled agency reports (Resend — same path as ai-visibility-check).
 *
 * This is the one thing the client opens every month, so it reads like a short note from the
 * agency: one headline from the written summary, five numbers with how they moved, one button.
 */

import { readMetric } from './reportBuild.ts'

// Quotes too: esc() also fills attributes (logo src, share href), where a `"` in an agency's logo
// URL would otherwise open a new attribute on the email's <img>.
const esc = (s: string) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Normalize and validate schedule recipient emails (mirrors report-schedule-runner). */
export function parseReportEmailRecipients(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
    .filter((e) => EMAIL_RE.test(e))
}

export interface ReportEmailSummary {
  projectName: string
  periodStart: string
  periodEnd: string
  aiSov?: number | null
  avgPosition?: number | null
  gscClicks?: number | null
  ga4Sessions?: number | null
  healthScore?: number | null
  /** Movement vs the previous period; null on a first reading. */
  aiSovDelta?: number | null
  /** Positions; negative means the site moved up. */
  avgPositionDelta?: number | null
  gscClicksDeltaPct?: number | null
  ga4SessionsDeltaPct?: number | null
  healthScoreDelta?: number | null
  /** Date of the site audit behind the health score, only when it predates the period (ISO). */
  healthAuditedAt?: string | null
  /** First sentence of the written summary, already in the report language. */
  headline?: string | null
  /** First recommended next step. */
  nextAction?: string | null
  /** True when at least one KPI has a value but none has a prior period: the client's first report. */
  firstReading?: boolean
}

/**
 * First sentence of a block of prose, at most `max` characters. A longer sentence is cut at its
 * last clause break (", ", " — ", "; ", ": ") or else at a word boundary, never mid-word: the
 * client read "… against Cleanbnb (12 mentions), Italianway (8), an…" in the email.
 */
export function firstSentence(text: unknown, max = 260): string | null {
  if (typeof text !== 'string') return null
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return null
  const m = t.match(/^.+?[.!?](?=\s|$)/)
  const s = (m ? m[0] : t).trim()
  if (s.length <= max) return s
  const head = s.slice(0, max - 1)
  let clause = -1
  for (const sep of [', ', ' — ', ' – ', '; ', ': ']) clause = Math.max(clause, head.lastIndexOf(sep))
  const space = head.lastIndexOf(' ')
  const cut = clause >= max * 0.5 ? clause : space >= max * 0.6 ? space : head.length
  return `${head.slice(0, cut).replace(/[\s,;:—–-]+$/, '')}…`
}

function firstNextAction(narrative: Record<string, unknown> | null | undefined): string | null {
  const list = narrative?.nextActions
  if (!Array.isArray(list)) return null
  for (const item of list) {
    if (typeof item === 'string' && item.trim()) return firstSentence(item, 220)
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      const text = o.title ?? o.action ?? o.text
      if (typeof text === 'string' && text.trim()) return firstSentence(text, 220)
    }
  }
  return null
}

type EmailMetric = { value: number | null; delta: number | null; deltaPct: number | null }

/**
 * Snapshots built before computeDelta learned about first readings store a missing prior period
 * as `delta === value, deltaPct === 100` (mirrors `hasBaseline` in src/lib/agencyReport/reportUi.ts).
 * That is not a movement — an email saying "▲ 100%" on the first report is what this prevents.
 */
function withBaseline(m: ReturnType<typeof readMetric>): EmailMetric {
  if (!m) return { value: null, delta: null, deltaPct: null }
  const firstReading = m.value != null && m.delta != null && m.delta === m.value && m.deltaPct === 100
  return firstReading ? { value: m.value, delta: null, deltaPct: null } : { value: m.value, delta: m.delta, deltaPct: m.deltaPct }
}

function metricValue(section: unknown, field: string): number | null {
  return readMetric(section, field)?.value ?? null
}

/** Source connected, nothing recorded this period: the report shows a note, the email says nothing. */
function sourceIsEmpty(data: Record<string, unknown>, source: 'gsc' | 'ga4'): boolean {
  const section = data[source]
  if (!section || typeof section !== 'object' || (section as { data?: unknown }).data === null) return false
  if (source === 'gsc') return !(metricValue(section, 'clicks') ?? 0) && !(metricValue(section, 'impressions') ?? 0)
  return !(metricValue(section, 'sessions') ?? 0) && !(metricValue(section, 'users') ?? 0)
}

/** The audit date when the health score comes from an audit older than the period, else null. */
function auditBeforePeriod(siteHealth: unknown, periodStart: string): string | null {
  if (!siteHealth || typeof siteHealth !== 'object') return null
  const auditedAt = (siteHealth as { auditedAt?: unknown }).auditedAt
  if (typeof auditedAt !== 'string') return null
  const audited = new Date(auditedAt).getTime()
  const start = new Date(`${periodStart}T00:00:00Z`).getTime()
  return Number.isFinite(audited) && Number.isFinite(start) && audited < start ? auditedAt : null
}

/** "16 set" / "Sep 16" (ISO date on any formatting failure). */
export function formatEmailDay(iso: string, locale: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d).replace(/\./g, '')
  } catch {
    return iso.slice(0, 10)
  }
}

/** Build the email summary from assembled report data (+ the written narrative when available). */
export function extractReportEmailSummary(
  data: Record<string, unknown>,
  projectName: string,
  periodStart: string,
  periodEnd: string,
  narrative?: Record<string, unknown> | null,
): ReportEmailSummary {
  const summary = data.summary
  const m = (field: string) => withBaseline(readMetric(summary, field))
  const aiSov = m('aiSov')
  const avgPosition = m('avgPosition')
  const gscClicks = sourceIsEmpty(data, 'gsc') ? withBaseline(null) : m('gscClicks')
  const ga4Sessions = sourceIsEmpty(data, 'ga4') ? withBaseline(null) : m('ga4Sessions')
  const healthScore = m('healthScore')
  const metrics = [aiSov, avgPosition, gscClicks, ga4Sessions, healthScore]
  const firstReading = metrics.some((x) => x.value != null) && metrics.every((x) => x.delta == null && x.deltaPct == null)
  return {
    projectName,
    periodStart,
    periodEnd,
    aiSov: aiSov.value,
    aiSovDelta: aiSov.delta,
    avgPosition: avgPosition.value,
    avgPositionDelta: avgPosition.delta,
    gscClicks: gscClicks.value,
    gscClicksDeltaPct: gscClicks.deltaPct,
    ga4Sessions: ga4Sessions.value,
    ga4SessionsDeltaPct: ga4Sessions.deltaPct,
    healthScore: healthScore.value,
    healthScoreDelta: healthScore.delta,
    healthAuditedAt: auditBeforePeriod(data.site_health, periodStart),
    headline: firstSentence(narrative?.executiveSummary),
    nextAction: firstNextAction(narrative),
    firstReading,
  }
}

export interface ReportEmailBranding {
  agencyName?: string | null
  logoUrl?: string | null
  primaryColor?: string | null
  hideAstroSeoFooter?: boolean
}

const HEX_COLOR_RE = /^#[0-9a-f]{3,8}$/i
const HTTP_URL_RE = /^https?:\/\//i

/** Sanitize branding for HTML email (mirrors src/lib/whiteLabelReport.ts). */
export function sanitizeReportEmailBranding(branding: ReportEmailBranding | null): {
  agencyName: string | null
  logoUrl: string | null
  primaryColor: string
  hideAstroSeoFooter: boolean
} {
  const logoRaw = branding?.logoUrl?.trim() ?? ''
  const colorRaw = branding?.primaryColor?.trim() ?? ''
  return {
    agencyName: branding?.agencyName?.trim() || null,
    logoUrl: HTTP_URL_RE.test(logoRaw) ? logoRaw : null,
    primaryColor: HEX_COLOR_RE.test(colorRaw) ? colorRaw : '#7c3aed',
    hideAstroSeoFooter: branding?.hideAstroSeoFooter === true,
  }
}

// ── Locale formatting (Intl with a plain fallback: the edge runtime may ship without full ICU) ──

function intlLocale(locale: string): string {
  return locale.startsWith('it') ? 'it-IT' : 'en-US'
}

export function formatEmailNumber(n: number, locale: string, maxFractionDigits = 0): string {
  try {
    return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: maxFractionDigits }).format(n)
  } catch {
    return String(Math.round(n * 10 ** maxFractionDigits) / 10 ** maxFractionDigits)
  }
}

/** "16 ago – 14 set 2026" / "Aug 16 – Sep 14, 2026" (ISO dates on any formatting failure). */
export function formatEmailPeriod(periodStart: string, periodEnd: string, locale: string): string {
  const start = new Date(`${periodStart}T00:00:00Z`)
  const end = new Date(`${periodEnd}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${periodStart} – ${periodEnd}`
  try {
    const it = locale.startsWith('it')
    const dm = new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short', timeZone: 'UTC' })
    const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
    const clean = (s: string) => s.replace(/\./g, '')
    if (sameYear) {
      return it
        ? `${clean(dm.format(start))} – ${clean(dm.format(end))} ${end.getUTCFullYear()}`
        : `${clean(dm.format(start))} – ${clean(dm.format(end))}, ${end.getUTCFullYear()}`
    }
    const dmy = new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    return `${clean(dmy.format(start))} – ${clean(dmy.format(end))}`
  } catch {
    return `${periodStart} – ${periodEnd}`
  }
}

type Movement = { text: string; tone: 'up' | 'down' | 'flat' }

/** Movement chip; `betterWhenLower` flips the tone for positions. */
function movement(
  delta: number | null | undefined,
  locale: string,
  unit: 'pt' | 'pct' | 'pos' | 'raw',
  betterWhenLower = false,
): Movement | null {
  if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 0.05) return null
  const improved = betterWhenLower ? delta < 0 : delta > 0
  const abs = Math.abs(delta)
  const it = locale.startsWith('it')
  let text: string
  if (unit === 'pct') text = `${formatEmailNumber(abs, locale, 1)}%`
  else if (unit === 'pt') text = `${formatEmailNumber(abs, locale, 1)} ${it ? 'pt' : 'pts'}`
  else if (unit === 'pos') text = `${formatEmailNumber(abs, locale, 1)} ${it ? 'posizioni' : 'positions'}`
  else text = formatEmailNumber(abs, locale, 0)
  return { text: `${improved ? '▲' : '▼'} ${text}`, tone: improved ? 'up' : 'down' }
}

const TONE_COLOR: Record<Movement['tone'], string> = { up: '#15803d', down: '#b91c1c', flat: '#71717a' }

export function buildScheduledReportEmail(
  locale: string,
  summary: ReportEmailSummary,
  shareUrl: string,
  branding: ReportEmailBranding | null,
): { subject: string; html: string } {
  const it = locale.startsWith('it')
  const safe = sanitizeReportEmailBranding(branding)
  const senderName = safe.agencyName || 'Rankdelta'
  const color = safe.primaryColor
  const safeShareUrl = HTTP_URL_RE.test(shareUrl) ? shareUrl : '#'
  const period = formatEmailPeriod(summary.periodStart, summary.periodEnd, locale)
  const client = esc(summary.projectName)

  const subject = it
    ? `${summary.projectName} · Report SEO e visibilità AI · ${period}`
    : `${summary.projectName} · SEO & AI visibility report · ${period}`

  const intro = safe.agencyName
    ? it
      ? `Ecco il report <b>${esc(period)}</b> per <b>${client}</b>, preparato da ${esc(safe.agencyName)}.`
      : `Here is the <b>${esc(period)}</b> report for <b>${client}</b>, prepared by ${esc(safe.agencyName)}.`
    : it
      ? `Ecco il report <b>${esc(period)}</b> per <b>${client}</b>.`
      : `Here is the <b>${esc(period)}</b> report for <b>${client}</b>.`

  // KPI rows: label · value · movement chip (only when there is a previous period)
  type Row = { label: string; value: string; move: Movement | null }
  const rows: Row[] = []
  if (summary.aiSov != null) {
    rows.push({
      label: it ? 'Share of voice AI' : 'AI share of voice',
      value: `${formatEmailNumber(summary.aiSov, locale, 1)}%`,
      move: movement(summary.aiSovDelta, locale, 'pt'),
    })
  }
  if (summary.avgPosition != null) {
    rows.push({
      label: it ? 'Posizione media su Google' : 'Average Google position',
      value: `#${formatEmailNumber(summary.avgPosition, locale, 1)}`,
      move: movement(summary.avgPositionDelta, locale, 'pos', true),
    })
  }
  if (summary.gscClicks != null) {
    rows.push({
      label: it ? 'Click da Google' : 'Clicks from Google',
      value: formatEmailNumber(summary.gscClicks, locale),
      move: movement(summary.gscClicksDeltaPct, locale, 'pct'),
    })
  }
  if (summary.ga4Sessions != null) {
    rows.push({
      label: it ? 'Sessioni sul sito' : 'Website sessions',
      value: formatEmailNumber(summary.ga4Sessions, locale),
      move: movement(summary.ga4SessionsDeltaPct, locale, 'pct'),
    })
  }
  if (summary.healthScore != null) {
    rows.push({
      // An audit older than the period is dated, and nothing "moved" this period.
      label: summary.healthAuditedAt
        ? `${it ? 'Salute del sito' : 'Site health'} (${it ? 'audit del' : 'audit of'} ${formatEmailDay(summary.healthAuditedAt, locale)})`
        : it ? 'Salute del sito' : 'Site health',
      value: `${formatEmailNumber(summary.healthScore, locale)}/100`,
      move: summary.healthAuditedAt ? null : movement(summary.healthScoreDelta, locale, 'raw'),
    })
  }

  const kpiHtml = rows
    .map(
      (r) =>
        `<tr>` +
        `<td style="padding:9px 0;border-top:1px solid #f1f1f3;color:#52525b;font-size:14px;">${esc(r.label)}</td>` +
        `<td style="padding:9px 0;border-top:1px solid #f1f1f3;color:#111;font-size:15px;font-weight:600;text-align:right;white-space:nowrap;">${esc(r.value)}</td>` +
        `<td style="padding:9px 0 9px 12px;border-top:1px solid #f1f1f3;font-size:12px;font-weight:600;text-align:right;white-space:nowrap;color:${r.move ? TONE_COLOR[r.move.tone] : '#a1a1aa'};">${r.move ? esc(r.move.text) : ''}</td>` +
        `</tr>`,
    )
    .join('')

  const headline = summary.headline?.trim()
  const nextAction = summary.nextAction?.trim()
  const headlineHtml = headline
    ? `<div style="border-left:3px solid ${esc(color)};padding:2px 0 2px 14px;margin:0 0 20px;">` +
      `<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a1a1aa;margin-bottom:4px;">${it ? 'In breve' : 'In short'}</div>` +
      `<div style="font-size:15px;line-height:1.5;color:#18181b;">${esc(headline)}</div>` +
      `</div>`
    : ''
  const nextHtml = nextAction
    ? `<div style="background:#fafafa;border-radius:10px;padding:12px 14px;margin:0 0 22px;">` +
      `<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a1a1aa;margin-bottom:4px;">${it ? 'Prossimo passo' : 'Next step'}</div>` +
      `<div style="font-size:14px;line-height:1.5;color:#3f3f46;">${esc(nextAction)}</div>` +
      `</div>`
    : ''

  // First report: say why there are no movement chips instead of leaving the column blank.
  const firstReadingHtml =
    summary.firstReading && rows.length
      ? `<p style="color:#a1a1aa;font-size:12px;line-height:1.5;margin:-12px 0 22px;">${
          it ? 'Primo report: i confronti con il periodo precedente compaiono dal prossimo.' : 'First report: comparisons with the previous period appear from the next one.'
        }</p>`
      : ''

  const preheader = esc(headline || rows.map((r) => `${r.label} ${r.value}`).join(' · ') || period)
  const cta = it ? 'Apri il report completo' : 'Open the full report'
  const logo = safe.logoUrl
    ? `<img src="${esc(safe.logoUrl)}" alt="" style="max-height:36px;margin-bottom:12px;" />`
    : ''
  const preparedBy = safe.agencyName
    ? `<p style="color:#a1a1aa;font-size:12px;margin:18px 0 0;text-align:center;">${it ? 'Report preparato da' : 'Report prepared by'} ${esc(safe.agencyName)}</p>`
    : ''
  const poweredBy = safe.hideAstroSeoFooter
    ? ''
    : `<p style="color:#a1a1aa;font-size:11px;margin:${preparedBy ? '6px' : '16px'} 0 0;text-align:center;">Powered by Rankdelta</p>`

  const html =
    `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">` +
    `<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</span>` +
    `<div style="max-width:560px;margin:0 auto;padding:32px 24px;">` +
    `${logo}<div style="font-weight:700;font-size:18px;color:#111;margin-bottom:24px;">${esc(senderName)}</div>` +
    `<div style="background:#fff;border:1px solid #e4e4e7;border-radius:16px;padding:28px;">` +
    `<p style="color:#3f3f46;font-size:15px;line-height:1.5;margin:0 0 20px;">${intro}</p>` +
    headlineHtml +
    (rows.length ? `<table style="width:100%;border-collapse:collapse;margin:0 0 22px;">${kpiHtml}</table>` : '') +
    firstReadingHtml +
    nextHtml +
    `<a href="${esc(safeShareUrl)}" style="display:inline-block;background:${esc(color)};color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px;">${cta}</a>` +
    `</div>${preparedBy}${poweredBy}</div></body></html>`

  return { subject, html }
}

/**
 * The From header of a client email: the agency's name in the inbox, Rankdelta's verified address.
 * "Northwind Agency via Rankdelta" <reports@…>, or the agency alone when the report is white-label.
 * Branding reaches here only on the agency plan (scheduledEmailBranding); without it, `from` as is.
 */
export function reportFromHeader(from: string, branding: ReportEmailBranding | null): string {
  const safe = sanitizeReportEmailBranding(branding)
  if (!safe.agencyName) return from
  const address = from.match(/<([^<>\s]+)>\s*$/)?.[1] ?? from.trim()
  if (!EMAIL_RE.test(address)) return from
  // Header injection: no line breaks or control characters, nothing that closes the quoted name.
  // deno-lint-ignore no-control-regex
  const name = safe.agencyName.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/["<>\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!name) return from
  return `"${safe.hideAstroSeoFooter ? name : `${name} via Rankdelta`}" <${address}>`
}

export async function sendScheduledReportEmail(
  to: string,
  locale: string,
  summary: ReportEmailSummary,
  shareUrl: string,
  branding: ReportEmailBranding | null,
  /** The agency's address: a client's reply goes to them, not to the Rankdelta sender. */
  replyTo?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM')
  if (!apiKey || !from) return { ok: false, error: 'email_not_configured' }

  const { subject, html } = buildScheduledReportEmail(locale, summary, shareUrl, branding)
  const payload: Record<string, unknown> = { from: reportFromHeader(from, branding), to: [to], subject, html }
  if (replyTo && EMAIL_RE.test(replyTo)) payload.reply_to = replyTo

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      // Keep the provider's reason (e.g. "domain is not verified") — without it a 403 is a guess.
      const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)
      console.error('[report-email] send failed', res.status, detail)
      return { ok: false, error: `resend_${res.status}` }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'send_failed' }
  }
}

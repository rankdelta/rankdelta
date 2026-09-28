/**
 * A report holds only the sections its owner chose.
 *
 * report-build and report-schedule-runner assemble every source, then keep the owner's choice in
 * `sections`, but they stored the full assembled `data`: a section the owner left out (GA4 traffic,
 * backlinks, site health…) stayed readable through the public share link (get_shared_report
 * returns `data` whole), and the AI summary was written from it. restrictReportData blanks the
 * excluded sections before the narrative and the insert, including what other blocks copy from
 * them (scorecard tiles, history points, GA4 visits in AI attribution).
 */

import { isConnectedSection, nullSection } from './reportBuild.ts'

export const REPORT_DATA_SECTIONS = ['geo', 'ai_attribution', 'rankings', 'gsc', 'ga4', 'site_health', 'backlinks'] as const

/** Scorecard tiles (data.summary) that come from each section. */
const SUMMARY_FIELDS: Record<string, string[]> = {
  geo: ['aiSov'],
  rankings: ['avgPosition'],
  gsc: ['gscClicks'],
  ga4: ['ga4Sessions', 'ga4AiAssistantSessions', 'keyEvents'],
  site_health: ['healthScore'],
}

/** Fields of each history point (data.meta.history) that come from each section. */
const HISTORY_FIELDS: Record<string, string[]> = {
  geo: ['aiSov', 'citationRate'],
  rankings: ['avgPosition'],
  gsc: ['gscClicks', 'gscImpressions'],
  ga4: ['ga4Sessions', 'aiSessions'],
  site_health: ['healthScore'],
  backlinks: ['referringDomains'],
}

/** AI attribution rows carry GA4 traffic per engine. */
const ATTRIBUTION_GA4_FIELDS = ['aiAssistantSessions', 'ga4Sessions', 'keyEvents', 'conversionRate']

const EMPTY_METRIC = { value: null, delta: null, deltaPct: null }

function blank(obj: Record<string, unknown>, fields: string[], empty: unknown): Record<string, unknown> {
  const out = { ...obj }
  for (const f of fields) if (f in out) out[f] = empty
  return out
}

export function restrictReportData(data: Record<string, unknown>, sections: readonly string[]): Record<string, unknown> {
  const excluded = REPORT_DATA_SECTIONS.filter((k) => !sections.includes(k) && isConnectedSection(data[k]))
  if (excluded.length === 0) return data
  const out: Record<string, unknown> = { ...data }

  for (const k of excluded) out[k] = nullSection('excluded')

  const summary = out['summary']
  if (summary && typeof summary === 'object') {
    out['summary'] = blank(summary as Record<string, unknown>, excluded.flatMap((k) => SUMMARY_FIELDS[k] ?? []), EMPTY_METRIC)
  }

  const attribution = out['ai_attribution']
  if (excluded.includes('ga4') && isConnectedSection(attribution) && typeof attribution === 'object') {
    const a = attribution as Record<string, unknown>
    out['ai_attribution'] = {
      ...a,
      byEngine: Array.isArray(a['byEngine'])
        ? (a['byEngine'] as Record<string, unknown>[]).map((row) => blank(row, ATTRIBUTION_GA4_FIELDS, null))
        : a['byEngine'],
      topAiReferredLandingPages: [],
    }
  }

  const meta = out['meta']
  if (meta && typeof meta === 'object' && Array.isArray((meta as Record<string, unknown>)['history'])) {
    const m = meta as Record<string, unknown>
    const fields = excluded.flatMap((k) => HISTORY_FIELDS[k] ?? [])
    out['meta'] = { ...m, history: (m['history'] as Record<string, unknown>[]).map((p) => blank(p, fields, null)) }
  }

  return out
}

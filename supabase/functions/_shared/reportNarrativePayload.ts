/**
 * Trim assembled report data to the fields the narrative LLM prompt actually uses.
 * Reduces token count while preserving numbers needed for grounding.
 *
 * Wire into report-build / report-schedule-runner via buildNarrativePrompt(trimReportDataForNarrative(data)).
 * Grounding checks should still use the full assembled.data stored in client_reports.
 */

import { buildNarrativePrompt, isNullSection } from './reportBuild.ts'

const TOP_N = 10

function pick<T extends Record<string, unknown>>(obj: T, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    if (k in obj) out[k] = obj[k]
  }
  return out
}

function trimGeo(section: Record<string, unknown>): Record<string, unknown> {
  // No run counters (the model wrote "16 tracked AI engine runs" to a client) and no engine
  // without a value (it wrote "AI Overviews shows null data" and asked to "add tracking").
  const sovByEngine = Array.isArray(section.sovByEngine)
    ? (section.sovByEngine as Array<Record<string, unknown>>).filter(
        (e) => e && typeof e.sovPercent === 'number' && Number.isFinite(e.sovPercent),
      )
    : []
  return {
    ...pick(section, [
      'sovOverall',
      'citationRate',
      'citationCounts',
      'competitorLeaderboard',
      'sovScope',
    ]),
    sovByEngine,
    brandedPrompts: Array.isArray(section.brandedPrompts) ? section.brandedPrompts.slice(0, TOP_N) : [],
    topPromptsMentioned: Array.isArray(section.topPromptsMentioned)
      ? section.topPromptsMentioned.slice(0, TOP_N)
      : [],
    topPromptsNotMentioned: Array.isArray(section.topPromptsNotMentioned)
      ? section.topPromptsNotMentioned.slice(0, TOP_N)
      : [],
    topCitedSources: Array.isArray(section.topCitedSources)
      ? section.topCitedSources.slice(0, TOP_N)
      : [],
  }
}

function trimRankings(section: Record<string, unknown>): Record<string, unknown> {
  return {
    ...pick(section, ['avgPosition', 'distribution']),
    topMovers: Array.isArray(section.topMovers) ? section.topMovers.slice(0, TOP_N) : [],
  }
}

function trimGsc(section: Record<string, unknown>): Record<string, unknown> {
  return {
    ...pick(section, ['clicks', 'impressions', 'ctr', 'avgPosition']),
    topQueries: Array.isArray(section.topQueries) ? section.topQueries.slice(0, TOP_N) : [],
    topPages: Array.isArray(section.topPages) ? section.topPages.slice(0, TOP_N) : [],
  }
}

function trimGa4(section: Record<string, unknown>): Record<string, unknown> {
  return {
    ...pick(section, [
      'sessions',
      'users',
      'engagedSessions',
      'keyEvents',
      'organicShare',
      'aiAssistantSessions',
    ]),
    topLandingPages: Array.isArray(section.topLandingPages)
      ? section.topLandingPages.slice(0, TOP_N)
      : [],
    topSources: Array.isArray(section.topSources) ? section.topSources.slice(0, TOP_N) : [],
  }
}

function trimAiAttribution(section: Record<string, unknown>): Record<string, unknown> {
  // Drop null fields per engine: a null traffic metric means "GA4 not connected", and the model
  // must not see a key it can turn into "zero sessions".
  const byEngine = Array.isArray(section.byEngine)
    ? (section.byEngine as Array<Record<string, unknown>>).map((row) =>
        Object.fromEntries(Object.entries(row ?? {}).filter(([, v]) => v !== null && v !== undefined)),
      )
    : []
  return {
    byEngine,
    topAiReferredLandingPages: Array.isArray(section.topAiReferredLandingPages)
      ? section.topAiReferredLandingPages.slice(0, TOP_N)
      : [],
  }
}

function trimSiteHealth(section: Record<string, unknown>): Record<string, unknown> {
  return {
    auditScore: section.auditScore ?? null,
    topIssues: Array.isArray(section.topIssues) ? section.topIssues.slice(0, 5) : [],
    auditedAt: section.auditedAt ?? null,
  }
}

function trimBacklinks(section: Record<string, unknown>): Record<string, unknown> {
  return pick(section, ['referringDomains', 'new', 'lost'])
}

function trimMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return pick(meta, ['periodStart', 'periodEnd', 'previousPeriod', 'locale'])
}

/**
 * Return a shallow-trimmed copy of assembled report data suitable for the narrative LLM prompt.
 */
export function trimReportDataForNarrative(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  const meta = data.meta
  if (meta && typeof meta === 'object') {
    out.meta = trimMeta(meta as Record<string, unknown>)
  }

  if (data.summary && !isNullSection(data.summary)) {
    // Only the headline metrics that have a value: a `gscClicks: null` reads as "data missing" to the model.
    const summary = Object.fromEntries(
      Object.entries(data.summary as Record<string, unknown>).filter(([, m]) => {
        const value = m && typeof m === 'object' ? (m as Record<string, unknown>)['value'] : m
        return value !== null && value !== undefined
      }),
    )
    if (Object.keys(summary).length > 0) out.summary = summary
  }

  const sectionTrimmers: Array<[string, (s: Record<string, unknown>) => Record<string, unknown>]> = [
    ['geo', trimGeo],
    ['rankings', trimRankings],
    ['gsc', trimGsc],
    ['ga4', trimGa4],
    ['ai_attribution', trimAiAttribution],
    ['site_health', trimSiteHealth],
    ['backlinks', trimBacklinks],
  ]

  for (const [key, trim] of sectionTrimmers) {
    const section = data[key]
    if (!section || isNullSection(section) || typeof section !== 'object') continue
    out[key] = trim(section as Record<string, unknown>)
  }

  return out
}

/** Estimate JSON byte size for before/after comparisons in logs. */
export function narrativePayloadByteSize(data: unknown): number {
  return new TextEncoder().encode(JSON.stringify(data)).length
}

/**
 * Drop-in replacement for buildNarrativePrompt once report-build / schedule-runner
 * are editable. Grounding checks should still use the full assembled.data.
 */
export function buildTrimmedNarrativePrompt(
  data: Record<string, unknown>,
  locale: string,
): { system: string; user: string } {
  const trimmed = trimReportDataForNarrative(data)
  logTrimStats(data, trimmed)
  return buildNarrativePrompt(trimmed, locale)
}

function logTrimStats(full: Record<string, unknown>, trimmed: Record<string, unknown>): void {
  const before = narrativePayloadByteSize(full)
  const after = narrativePayloadByteSize(trimmed)
  console.log(JSON.stringify({ tag: 'reportNarrativePayload', beforeBytes: before, afterBytes: after }))
}

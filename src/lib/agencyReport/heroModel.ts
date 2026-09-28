/**
 * Pure view-model behind the AI visibility hero (report section and deck slide).
 * Reads `report.data` only; the layouts read defaults from it and never guess.
 */
import { engineLabel, competitorCountsReliable, promptSplitReliable } from './insights'
import { hasBaseline } from './reportUi'
import { isConnectedSection } from './sections'
import { engineSessions, type AiAttributionSectionData, type GeoSectionData, type ReportData } from './types'

export const HERO_MAX_PROMPTS = 6
export const HERO_MAX_SOURCES = 6

export interface HeroModel {
  sovPct: number | null
  sovDelta: number | null
  sovHasBaseline: boolean
  promptsWon: string[]
  promptsMissing: string[]
  promptsTotal: number
  engines: Array<{ engine: string; pct: number; sessions: number | null }>
  citationPct: number | null
  citationDelta: number | null
  citationHasBaseline: boolean
  /** "3 of 6 answers with sources": the sample behind the rate, when the snapshot has it. */
  citationSample: { cited: number; withSources: number } | null
  trend: Array<{ date: string; yours: number; competitors: number }>
  sources: Array<{ domain: string; count: number }>
  competitors: Array<{ name: string; mentions: number }>
  leader: string | null
  /** False when the mentioned / missing split contradicts the mention counts (see promptSplitReliable). */
  promptSplitOk: boolean
  /** False when every competitor shows 0 mentions but share of voice says otherwise (see competitorCountsReliable). */
  competitorCountsOk: boolean
  /** Prompts that name the brand; shown apart because they are not counted in SoV or won/missing. */
  brandedPrompts: Array<{ text: string; mentioned: boolean }>
}

export function buildHeroModel(data: ReportData | null | undefined): HeroModel | null {
  if (!data || !isConnectedSection<GeoSectionData>(data.geo)) return null
  const geo = data.geo
  const attr = isConnectedSection<AiAttributionSectionData>(data.ai_attribution) ? data.ai_attribution : null
  const sessionsByEngine = new Map<string, number>()
  for (const e of attr?.byEngine ?? []) {
    // The assembler writes `aiAssistantSessions`; older snapshots carry `ga4Sessions`.
    const sessions = engineSessions(e)
    if (sessions != null) sessionsByEngine.set(e.engine.toLowerCase(), sessions)
  }

  const engines = (geo.sovByEngine ?? [])
    .filter((e) => e.sovPercent != null && Number.isFinite(e.sovPercent))
    .map((e) => ({ engine: engineLabel(e.engine), pct: e.sovPercent as number, sessions: sessionsByEngine.get(e.engine.toLowerCase()) ?? null }))
    .sort((a, b) => b.pct - a.pct)

  const promptsWon = (geo.topPromptsMentioned ?? []).filter((p) => typeof p === 'string' && p.trim())
  const promptsMissing = (geo.topPromptsNotMentioned ?? []).filter((p) => typeof p === 'string' && p.trim())
  const competitors = [...(geo.competitorLeaderboard ?? [])]
    .filter((c) => typeof c.name === 'string' && c.name.trim())
    .map((c) => ({ name: c.name, mentions: typeof c.mentions === 'number' ? c.mentions : 0 }))
    .sort((a, b) => b.mentions - a.mentions)
  const leader = competitors[0] && competitors[0].mentions > 0 ? competitors[0].name : null

  const sovPct = geo.sovOverall?.value ?? null
  const trend = (geo.trend ?? [])
    .filter((d) => d && typeof d.date === 'string')
    .map((d) => ({ date: d.date, yours: d.yours ?? 0, competitors: d.competitors ?? 0 }))

  const model: HeroModel = {
    sovPct,
    sovDelta: geo.sovOverall?.delta ?? null,
    sovHasBaseline: hasBaseline(geo.sovOverall) && !(geo.sovOverall?.value === 0 && geo.sovOverall?.delta === 0),
    promptsWon,
    promptsMissing,
    promptsTotal: promptsWon.length + promptsMissing.length,
    engines,
    citationPct: geo.citationRate?.value ?? null,
    citationDelta: geo.citationRate?.delta ?? null,
    citationHasBaseline: hasBaseline(geo.citationRate) && !(geo.citationRate?.value === 0 && geo.citationRate?.delta === 0),
    citationSample: geo.citationCounts && geo.citationCounts.withSources > 0 ? geo.citationCounts : null,
    trend,
    sources: (geo.topCitedSources ?? []).filter((s) => s && typeof s.domain === 'string' && s.count > 0).slice(0, HERO_MAX_SOURCES),
    competitors,
    leader,
    promptSplitOk: promptSplitReliable(geo),
    competitorCountsOk: competitorCountsReliable(geo),
    brandedPrompts:
      geo.sovScope === 'discovery'
        ? (geo.brandedPrompts ?? []).filter((p) => p && typeof p.text === 'string' && p.text.trim())
        : [],
  }
  const hasAnything = model.sovPct != null || model.promptsTotal > 0 || model.engines.length > 0 || model.trend.length > 1
  return hasAnything ? model : null
}

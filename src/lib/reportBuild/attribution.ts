/**
 * AI attribution join: per-engine Share of Voice → GA4 AI-assistant sessions → key events.
 */

export interface EngineSovRow {
  engine: string;
  sovPercent: number | null;
  yourMentions: number;
  competitorMentions: number;
}

export interface Ga4SourceRow {
  source: string;
  sessions: number;
  keyEvents?: number;
}

export interface AiAttributionRow {
  engine: string;
  sovPercent: number | null;
  aiAssistantSessions: number;
  keyEvents: number;
  conversionRate: number | null;
}

/** Known AI-referrer source substrings (lowercase). */
export const AI_ASSISTANT_SOURCE_PATTERNS: ReadonlyArray<{ engine: string; patterns: string[] }> = [
  { engine: 'chatgpt', patterns: ['chatgpt', 'chat.openai', 'openai'] },
  { engine: 'perplexity', patterns: ['perplexity'] },
  { engine: 'gemini', patterns: ['gemini', 'bard', 'google bard'] },
  { engine: 'claude', patterns: ['claude', 'anthropic'] },
  { engine: 'copilot', patterns: ['copilot', 'bing chat'] },
];

export function matchEngineFromSource(source: string): string | null {
  const s = source.toLowerCase();
  for (const { engine, patterns } of AI_ASSISTANT_SOURCE_PATTERNS) {
    if (patterns.some((p) => s.includes(p))) return engine;
  }
  return null;
}

/** Aggregate GA4 top_sources into AI-assistant sessions + key events per engine. */
export function aggregateAiSessionsByEngine(sources: Ga4SourceRow[]): Map<string, { sessions: number; keyEvents: number }> {
  const map = new Map<string, { sessions: number; keyEvents: number }>();
  for (const row of sources) {
    const engine = matchEngineFromSource(row.source);
    if (!engine) continue;
    const cur = map.get(engine) ?? { sessions: 0, keyEvents: 0 };
    cur.sessions += row.sessions;
    cur.keyEvents += row.keyEvents ?? 0;
    map.set(engine, cur);
  }
  return map;
}

/**
 * Join per-engine SoV with GA4 AI-assistant traffic.
 * Engines without GA4 traffic still appear with zero sessions.
 */
export function buildAiAttribution(
  engineSov: EngineSovRow[],
  ga4Sources: Ga4SourceRow[],
): AiAttributionRow[] {
  const sessionsByEngine = aggregateAiSessionsByEngine(ga4Sources);
  const engines = new Set<string>([
    ...engineSov.map((e) => e.engine),
    ...sessionsByEngine.keys(),
  ]);

  const sovByEngine = new Map(engineSov.map((e) => [e.engine, e]));

  return [...engines].sort().map((engine) => {
    const sov = sovByEngine.get(engine);
    const traffic = sessionsByEngine.get(engine) ?? { sessions: 0, keyEvents: 0 };
    const conversionRate =
      traffic.sessions > 0 ? Math.round((1000 * traffic.keyEvents) / traffic.sessions) / 10 : null;
    return {
      engine,
      sovPercent: sov?.sovPercent ?? null,
      aiAssistantSessions: traffic.sessions,
      keyEvents: traffic.keyEvents,
      conversionRate,
    };
  });
}

/** Top AI-referred landing pages from GA4 pages filtered by AI session sources (when page-level AI data unavailable, rank by overall top pages cited in GEO). */
export interface AiLandingPageRow {
  page: string;
  sessions: number;
  keyEvents: number;
}

export function topAiReferredLandingPages(
  pages: Array<{ page: string; sessions: number; keyEvents?: number }>,
  limit = 10,
): AiLandingPageRow[] {
  return pages
    .map((p) => ({
      page: p.page,
      sessions: p.sessions,
      keyEvents: p.keyEvents ?? 0,
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);
}

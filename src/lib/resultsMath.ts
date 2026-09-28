/**
 * resultsMath — pure, dependency-free functions for the AI-visibility RESULTS surfaces.
 *
 * These compute what users see and trust (per-answer outcome, per-prompt standing, the headline
 * verdict), so they're isolated here and unit-tested separately from the React-Query hooks that
 * fetch the data. No Supabase, no i18n, no React — just inputs → outputs.
 */

/** The UTC calendar day of an ISO timestamp, as 'YYYY-MM-DD'. */
export function utcDayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export interface WowWindows {
  /** the most recent 7 UTC days */
  last7: Set<string>;
  /** the 7 UTC days before those */
  prior7: Set<string>;
}

/**
 * Split a span of UTC day keys into the two week-over-week windows the deltas compare: the most recent
 * 7 days and the 7 before them. Pass the full tracked span (any order); sorting happens here.
 */
export function weekOverWeekWindows(dayKeys: Iterable<string>): WowWindows {
  const sorted = [...dayKeys].sort((a, b) => a.localeCompare(b));
  return { last7: new Set(sorted.slice(-7)), prior7: new Set(sorted.slice(-14, -7)) };
}

/** Which week-over-week window a UTC day falls in — or null if it predates both. */
export function classifyDayWindow(dayKey: string, windows: WowWindows): 'last' | 'prior' | null {
  if (windows.last7.has(dayKey)) return 'last';
  if (windows.prior7.has(dayKey)) return 'prior';
  return null;
}

export type RunOutcome = 'cited' | 'mentioned' | 'not_mentioned';
export type QueryStanding = 'cited' | 'mentioned' | 'absent' | 'none';
export type VerdictTone = 'good' | 'neutral' | 'bad';
export type VerdictKey = 'verdictEarly' | 'verdictGaining' | 'verdictHolding' | 'verdictSlipping';

/** cited beats mentioned beats absent beats nothing — used to keep the best standing seen. */
const STANDING_RANK: Record<QueryStanding, number> = { none: 0, absent: 1, mentioned: 2, cited: 3 };

/**
 * Share of Voice: your share of all brand mentions (yours + competitors') across answers, as a
 * percentage. `null` when there are no mentions at all (the metric is undefined, not zero).
 */
export function shareOfVoice(yours: number, competitors: number): number | null {
  const total = yours + competitors;
  return total > 0 ? (100 * yours) / total : null;
}

export interface RankEntity {
  /** true if this mention is YOUR tracked brand */
  you: boolean;
  /** stable id per distinct brand, so the same competitor named twice counts once */
  entityId: string;
  /** character offset of the mention in the answer (earlier = higher rank) */
  pos: number;
}

/**
 * Average rank of your brand among the brands named in each answer (1 = first). Lower is better.
 * Per answer the rank is `1 + (distinct competitors appearing before your earliest mention)`; answers
 * where you aren't named are skipped. `null` when you're never named with a position.
 */
export function averageBrandPosition(runEntities: Iterable<ReadonlyArray<RankEntity>>): number | null {
  let rankSum = 0;
  let rankRuns = 0;
  for (const arr of runEntities) {
    const yourPos = arr.filter((a) => a.you).map((a) => a.pos);
    if (yourPos.length === 0) continue;
    const youMin = Math.min(...yourPos);
    const earlier = new Set(arr.filter((a) => !a.you && a.pos < youMin).map((a) => a.entityId));
    rankSum += 1 + earlier.size;
    rankRuns += 1;
  }
  return rankRuns > 0 ? rankSum / rankRuns : null;
}

/**
 * The RESULT of a single AI answer from the brand's perspective. `null` for non-completed runs
 * (their technical status — failed/pending — is what matters, not an outcome).
 */
export function classifyRunOutcome(opts: { status: string; cited: boolean; mentioned: boolean }): RunOutcome | null {
  if (opts.status !== 'completed') return null;
  if (opts.cited) return 'cited';
  if (opts.mentioned) return 'mentioned';
  return 'not_mentioned';
}

/**
 * Best standing per tracked prompt across all its completed runs: cited > mentioned > absent.
 * Prompts with no completed runs are absent from the map (caller renders "not run").
 */
export function aggregateQueryStanding(
  runs: ReadonlyArray<{ id: string; query_id: string; status: string }>,
  citedRunIds: ReadonlySet<string>,
  mentionedRunIds: ReadonlySet<string>,
): Map<string, Exclude<QueryStanding, 'none'>> {
  const map = new Map<string, Exclude<QueryStanding, 'none'>>();
  for (const r of runs) {
    if (r.status !== 'completed') continue;
    let cur: Exclude<QueryStanding, 'none'> = 'absent';
    if (citedRunIds.has(r.id)) cur = 'cited';
    else if (mentionedRunIds.has(r.id)) cur = 'mentioned';
    const prev = map.get(r.query_id) ?? 'none';
    if (STANDING_RANK[cur] > STANDING_RANK[prev]) map.set(r.query_id, cur);
  }
  return map;
}

/**
 * The plain-language "are we winning?" verdict for the results report, chosen from Share of Voice
 * and its week-over-week delta. Returns the tone + the i18n key to render (caller does the t()).
 * `threshold` (pp) is the dead-band where movement counts as "holding".
 */
export function pickResultsVerdict(opts: {
  sovPercent: number | null;
  sovWowDelta: number | null;
  comparisonAvailable: boolean;
  threshold?: number;
}): { tone: VerdictTone; key: VerdictKey } | null {
  const { sovPercent, sovWowDelta, comparisonAvailable } = opts;
  const threshold = opts.threshold ?? 0.5;
  if (sovPercent == null) return null;
  if (!comparisonAvailable || sovWowDelta == null) return { tone: 'neutral', key: 'verdictEarly' };
  if (sovWowDelta > threshold) return { tone: 'good', key: 'verdictGaining' };
  if (sovWowDelta < -threshold) return { tone: 'bad', key: 'verdictSlipping' };
  return { tone: 'neutral', key: 'verdictHolding' };
}

/**
 * Share-of-Voice is unreliable when it's computed from only a handful of brand mentions — e.g. a
 * single prompt that ran once can show "100%" simply because no competitor happened to appear.
 * Returns true when the SoV denominator (your mentions + competitor mentions) is below `minSample`,
 * so the UI can flag the headline as an early/low-confidence signal instead of a real win.
 */
export function isLowConfidenceSov(
  yourMentions: number,
  competitorMentions: number,
  minSample = 5,
): boolean {
  return (yourMentions + competitorMentions) < minSample;
}

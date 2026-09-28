/**
 * Default lookback for SoV trend / WoW charts (not the headline snapshot).
 */
export const CANONICAL_SOV_RANGE_DAYS = 14;

export function computeMentionShareOfVoice(yourMentions: number, competitorMentions: number): number | null {
  const total = yourMentions + competitorMentions;
  return total > 0 ? Math.round((1000 * yourMentions) / total) / 10 : null;
}

/** One active, SoV-eligible query's headline-run tally: your brand vs competitor mentions.
 *  A query that was never scanned, or whose answer named no tracked brand, is {0,0}. */
export interface QuerySovSample {
  yours: number;
  competitors: number;
}

/**
 * Weighted Share of Voice — the mean of each query's own share, averaged over ALL active,
 * SoV-eligible queries (brand/navigational queries are excluded upstream). A query where you are
 * absent (or that was never scanned) contributes 0, so being missing from most answers correctly
 * pulls the number toward 0 instead of a handful of mentions inflating it (the "1 of 7 → 14%"
 * bug). Contrast computeMentionShareOfVoice(), which pools mentions and ignores absent queries.
 * Returns null only when there are no eligible queries at all (metric undefined).
 */
export function computeWeightedSov(samples: QuerySovSample[]): number | null {
  if (samples.length === 0) return null;
  let sum = 0;
  for (const s of samples) {
    const total = s.yours + s.competitors;
    if (total > 0) sum += s.yours / total;
  }
  return Math.round((1000 * sum) / samples.length) / 10;
}

/** Below this many *scanned* eligible queries, the SoV % rests on too little data to trust. */
export const SOV_MIN_CONFIDENT_SAMPLE = 10;

/** True when the SoV % is backed by some, but too few, scanned eligible queries. */
export function sovIsLowConfidence(scannedEligibleQueries: number): boolean {
  return scannedEligibleQueries > 0 && scannedEligibleQueries < SOV_MIN_CONFIDENT_SAMPLE;
}

/** Intent types excluded from SoV (own-brand and navigational queries trivially mention you). */
export const SOV_EXCLUDED_INTENTS = new Set(['brand', 'navigational', 'navigation']);

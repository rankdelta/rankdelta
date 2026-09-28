/**
 * brand_detect — pure, dependency-free brand/competitor mention detection over an AI answer.
 *
 * This is the ground truth for every downstream visibility metric: each detected mention becomes a
 * `visibility_brand_mentions` row, and those rows are counted into Share of Voice (yours vs
 * competitors) and averaged into your brand's rank position. So the detector must be *accurate* —
 * a false positive inflates a competitor's Share of Voice, a miss deflates yours, and users trust
 * these numbers to decide whether they're winning on AI search.
 *
 * The old detector used `answer.toLowerCase().includes(name)` — naive substring matching, which
 * fails two ways that matter for real brand names:
 *   1. False positives on short names: brand "Ora" matches "decORAtion", "Well" matches "farewell".
 *   2. Misses on accents/spacing: brand "L'Oréal" never matches an answer that writes "L'Oreal".
 *
 * This module fixes both with diacritic-folded, word-boundary matching, and computes a meaningful
 * "is recommended" flag (a top-N appearance in the answer, not the old insertion-order counter).
 *
 * No Deno/Node APIs are used here so the same logic is unit-tested from vitest (see
 * src/lib/brandDetect.test.ts) and runs unchanged inside the Deno edge function.
 */

/**
 * Normalise text for matching: lowercase, strip diacritics (NFD → drop combining marks), and
 * collapse any run of whitespace to a single space. Applied to BOTH the answer and each brand name
 * so "L'Oréal" (name) matches "l'oreal" (answer) and vice-versa. Offsets are computed in this folded
 * space; every brand in one answer is matched against the same folded string, so relative positions
 * (all that rank/position math relies on) stay consistent.
 */
export function foldForMatch(input: string): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Earliest word-boundary position of `name` inside an already-folded answer, or -1 if absent.
 * "Boundary" here means the match is not flanked by a letter or number (Unicode-aware), so "HP"
 * won't match inside "graphpaper" but will match "HP" or "an HP laptop". Runs of whitespace in both
 * the name and the answer are already collapsed to a single space by folding, so "Ben  &  Jerry's"
 * matches "ben & jerry's". Names shorter than 2 characters after folding are ignored — single
 * characters are too noisy to attribute.
 */
export function findNamePosition(foldedAnswer: string, name: string): number {
  const folded = foldForMatch(name);
  if (folded.length < 2) return -1;
  const pattern = escapeRegExp(folded);
  try {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'u');
    const m = re.exec(foldedAnswer);
    return m ? m.index : -1;
  } catch {
    // Extremely defensive: if the engine lacks lookbehind, fall back to a plain folded includes().
    const idx = foldedAnswer.indexOf(folded);
    return idx;
  }
}

export interface BrandDetectEntry {
  kind: 'tracked' | 'competitor';
  id: string;
  /** the brand's primary name plus any aliases; the earliest-appearing one wins */
  names: string[];
}

export interface BrandDetectResult {
  kind: 'tracked' | 'competitor';
  id: string;
  /** the specific name/alias that matched (as passed in, not folded) */
  name: string;
  /** char offset in the folded answer — for relative ordering only, not display */
  position: number;
  /** 0-based rank of this brand among all detected brands, earliest first */
  rank: number;
  /** true when this is YOUR brand appearing among the first N brands in the answer */
  isRecommended: boolean;
}

/**
 * Detect which of the given brands (yours + competitors) appear in an AI answer, once per brand at
 * its earliest mention, ranked by order of appearance. A tracked brand is flagged `isRecommended`
 * when it lands in the first `recommendedTopN` (default 3) brands named — a real "top pick" signal,
 * unlike the previous flag which counted the order brands happened to be inserted in.
 */
export function detectBrandMentions(
  answerText: string,
  entries: BrandDetectEntry[],
  opts: { recommendedTopN?: number } = {},
): BrandDetectResult[] {
  const topN = opts.recommendedTopN ?? 3;
  const folded = foldForMatch(answerText);
  if (!folded) return [];

  const found: Array<{ kind: 'tracked' | 'competitor'; id: string; name: string; position: number }> = [];
  for (const entry of entries) {
    let best: { name: string; position: number } | null = null;
    for (const raw of entry.names) {
      if (!raw) continue;
      const p = findNamePosition(folded, raw);
      if (p >= 0 && (best === null || p < best.position)) best = { name: raw, position: p };
    }
    if (best) found.push({ kind: entry.kind, id: entry.id, name: best.name, position: best.position });
  }

  found.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  return found.map((f, i) => ({
    ...f,
    rank: i,
    isRecommended: f.kind === 'tracked' && i < topN,
  }));
}

/**
 * brand_match — decide whether one of the AI's recommended names IS the site's own brand.
 *
 * This powers the public landing verdict: "recommended" (ChatGPT already names you) vs "absent".
 * A false positive here is the worst outcome — it tells a visitor they're already visible on AI,
 * removing every reason to sign up. The old check compared alphanumeric-stripped strings with a
 * bidirectional `includes`, so brand "Ora" matched recommended "Aurora" (both → "…ora…") and lit up
 * a fake "recommended". This compares on WORD TOKENS instead, so a brand only matches when it is a
 * whole word (or a contiguous run of words) of a recommended name — "Notion" still matches "Notion
 * Calendar", but "Ora" no longer matches "Aurora".
 *
 * Pure and dependency-free so it's unit-tested from vitest (src/lib/brandMatch.test.ts) and runs
 * unchanged inside the Deno edge function.
 */

/** Lowercase, strip diacritics, turn every non-alphanumeric run into a single space, trim. */
export function foldTokens(input: string): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Alphanumeric-only form (no spaces) — used for domain roots, which concatenate the brand words. */
function concatForm(input: string): string {
  return foldTokens(input).replace(/ /g, '');
}

/** True if `needle` tokens appear as a contiguous run inside `hay` tokens. */
function hasTokenRun(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Does `candidate` (one of the AI's recommended names) refer to this brand? True when the brand name
 * matches by whole-word tokens (either direction — "Notion" ⊆ "Notion Calendar" and vice-versa), or
 * when the domain root matches the candidate's concatenated form (covers multi-word brands like
 * "L'Oréal" ↔ loreal.com). The domain root must be ≥4 chars to loosely match, so a short root can't
 * false-positive on an unrelated longer name.
 */
export function isBrandName(brand: string, domainRoot: string, candidate: string): boolean {
  const cTokens = foldTokens(candidate).split(' ').filter(Boolean);
  if (cTokens.length === 0) return false;

  const bTokens = foldTokens(brand).split(' ').filter(Boolean);
  if (bTokens.length > 0 && (hasTokenRun(cTokens, bTokens) || hasTokenRun(bTokens, cTokens))) {
    return true;
  }

  const d = concatForm(domainRoot);
  const c = concatForm(candidate);
  if (d.length >= 4 && c.length > 0) {
    if (d === c || c.startsWith(d) || d.startsWith(c)) return true;
  }
  return false;
}

/**
 * Split the recommended list into whether YOU are cited and who the competitors are (everyone that
 * isn't you), preserving order and capping the competitor list.
 */
export function classifyRecommended(
  brand: string,
  domainRoot: string,
  recommended: string[],
  maxCompetitors = 5,
): { cited: boolean; competitors: string[] } {
  let cited = false;
  const competitors: string[] = [];
  for (const r of recommended) {
    if (isBrandName(brand, domainRoot, r)) cited = true;
    else competitors.push(r);
  }
  return { cited, competitors: competitors.slice(0, maxCompetitors) };
}

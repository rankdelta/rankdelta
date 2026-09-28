/**
 * Which brands from past AI answers become a site's tracked competitors (setup_ai_visibility).
 *
 * Only brands the answers NAME count. Cited source domains are publishers, review sites and
 * directories (g2.com, it.trustpilot.com, msn.com…), not competitors: seeding them turned one
 * scan into 76 "competitors" named "It", "Blog" or "Data". A brand must come up in at least
 * `minRuns` different answers, and the most frequent `max` win.
 *
 * Pure module (no Deno APIs) so it can be unit-tested.
 */

export type MentionRow = {
  brand_name: unknown;
  query_run_id: unknown;
  tracked_brand_id: unknown;
  competitor_brand_id: unknown;
};

export function pickCompetitorCandidates(
  mentions: readonly MentionRow[],
  existing: ReadonlySet<string>,
  opts: { max?: number; minRuns?: number } = {},
): string[] {
  const max = opts.max ?? 8;
  const minRuns = opts.minRuns ?? 2;
  const runsByBrand = new Map<string, { name: string; runs: Set<string> }>();
  for (const m of mentions) {
    // Already linked to the site's own brand or to a known competitor.
    if (m.tracked_brand_id || m.competitor_brand_id) continue;
    const name = String(m.brand_name ?? '').replace(/\s+/g, ' ').trim();
    const key = name.toLowerCase();
    if (name.length < 2 || existing.has(key)) continue;
    const entry = runsByBrand.get(key) ?? { name, runs: new Set<string>() };
    entry.runs.add(String(m.query_run_id ?? ''));
    runsByBrand.set(key, entry);
  }
  return [...runsByBrand.values()]
    .filter((e) => e.runs.size >= minRuns)
    .sort((a, b) => b.runs.size - a.runs.size || a.name.localeCompare(b.name))
    .slice(0, max)
    .map((e) => e.name);
}

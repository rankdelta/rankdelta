/**
 * Content-gap analysis — stored SERP snapshots only. ZERO DataForSEO cost. Ever.
 *
 * Data source: `serp_rank_keywords` + `serp_rank_snapshots.raw_response` (full Google organic
 * SERP at depth 100, written by run_serp_rank) + optional `keyword_metrics.volume`.
 *
 * A gap is a tracked keyword where the competitor ranks in the top 20 and the site does
 * not appear in the top 100. No new API calls are made on any code path.
 *
 * No Deno-only APIs so vitest can import this module unchanged.
 */

export const DEFAULT_CONTENT_GAP_LIMIT = 50;
export const CONTENT_GAP_COST_USD = 0;

export interface RankKeywordInput {
  id: string;
  phrase: string;
}

export interface RankSnapshotInput {
  keyword_id: string;
  rank_absolute: number | null;
  ranking_url: string | null;
  raw_response: unknown;
  status?: string | null;
  checked_at: string;
}

export interface ContentGapItem {
  keyword: string;
  competitor_url: string;
  competitor_position: number;
  est_volume_if_stored: number | null;
}

export interface ContentGapResponse {
  ok: true;
  site_id: string;
  competitor_domain: string;
  limit: number;
  cost_usd: number;
  items: ContentGapItem[];
  keywords_considered: number;
  snapshots_used: number;
  data_source: 'serp_rank_snapshots';
  note?: string;
}

export interface OrganicHit {
  url: string;
  domain: string;
  position: number;
}

type Json = Record<string, unknown>;

function asJson(v: unknown): Json | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
}

export function clampLimit(raw: unknown, fallback = DEFAULT_CONTENT_GAP_LIMIT): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(200, Math.max(1, n));
}

export function siteHost(url: string | null | undefined): string | null {
  if (!url || !String(url).trim()) return null;
  const s = String(url).trim();
  try {
    const u = s.includes('://') ? new URL(s) : new URL(`https://${s}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return s.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0]?.toLowerCase() ?? null;
  }
}

export function urlMatchesDomain(resultUrl: string, domainOrUrl: string): boolean {
  const need = siteHost(domainOrUrl);
  const got = siteHost(resultUrl);
  if (!need || !got) return false;
  return got === need || got.endsWith('.' + need);
}

export function domainMatches(candidate: string | null | undefined, target: string): boolean {
  const need = siteHost(target);
  const got = siteHost(candidate);
  if (!need || !got) return false;
  return got === need || got.endsWith('.' + need);
}

function collectItemArrays(raw: unknown): Json[] {
  const items: Json[] = [];
  const pushItems = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      const row = asJson(it);
      if (row) items.push(row);
    }
  };

  const root = asJson(raw);
  if (!root) return items;

  const tasks = Array.isArray(root['tasks']) ? root['tasks'] : [root];
  for (const task of tasks) {
    const t = asJson(task);
    if (!t) continue;
    const resultArr = Array.isArray(t['result']) ? t['result'] : [];
    if (resultArr.length === 0) pushItems(t['items']);
    for (const block of resultArr) {
      const b = asJson(block);
      if (b) pushItems(b['items']);
    }
  }
  return items;
}

export function positionFromOrganicItem(row: Json): number | null {
  const abs = row['rank_absolute'];
  const grp = row['rank_group'];
  const n = typeof abs === 'number' ? abs : typeof grp === 'number' ? grp : NaN;
  if (!Number.isFinite(n) || n < 1 || n > 100) return null;
  return n;
}

export function extractOrganicHits(raw: unknown): OrganicHit[] {
  const hits: OrganicHit[] = [];
  for (const row of collectItemArrays(raw)) {
    if (row['type'] && row['type'] !== 'organic') continue;
    const url = typeof row['url'] === 'string' ? row['url'] : '';
    if (!url) continue;
    const position = positionFromOrganicItem(row);
    if (position == null) continue;
    const domain =
      (typeof row['domain'] === 'string' && row['domain']) || siteHost(url) || '';
    hits.push({ url, domain, position });
  }
  return hits;
}

export function latestSnapshotPerKeyword(
  snapshots: RankSnapshotInput[],
): Map<string, RankSnapshotInput> {
  const latest = new Map<string, RankSnapshotInput>();
  for (const snap of snapshots) {
    if (snap.status && snap.status !== 'completed') continue;
    const prev = latest.get(snap.keyword_id);
    if (!prev) {
      latest.set(snap.keyword_id, snap);
      continue;
    }
    const prevT = new Date(prev.checked_at).getTime();
    const nextT = new Date(snap.checked_at).getTime();
    if (Number.isFinite(nextT) && nextT >= (Number.isFinite(prevT) ? prevT : 0)) {
      latest.set(snap.keyword_id, snap);
    }
  }
  return latest;
}

function siteRanksTop100(opts: {
  hits: OrganicHit[];
  siteUrl: string;
  snap: RankSnapshotInput;
}): boolean {
  if (opts.hits.some((h) => urlMatchesDomain(h.url, opts.siteUrl) && h.position <= 100)) {
    return true;
  }
  if (opts.hits.length > 0) return false;
  const pos = opts.snap.rank_absolute;
  const url = opts.snap.ranking_url;
  return (
    typeof pos === 'number' &&
    pos >= 1 &&
    pos <= 100 &&
    !!url &&
    urlMatchesDomain(url, opts.siteUrl)
  );
}

function bestCompetitorHit(hits: OrganicHit[], competitorDomain: string): OrganicHit | null {
  let best: OrganicHit | null = null;
  for (const h of hits) {
    const match =
      domainMatches(h.domain, competitorDomain) || urlMatchesDomain(h.url, competitorDomain);
    if (!match || h.position > 20) continue;
    if (!best || h.position < best.position) best = h;
  }
  return best;
}

export function analyzeContentGaps(opts: {
  keywords: RankKeywordInput[];
  snapshots: RankSnapshotInput[];
  siteUrl: string;
  competitorDomain: string;
  volumes?: Map<string, number | null>;
  limit?: number;
}): ContentGapItem[] {
  const phraseById = new Map(opts.keywords.map((k) => [k.id, k.phrase]));
  const latest = latestSnapshotPerKeyword(opts.snapshots);
  const items: ContentGapItem[] = [];

  for (const [keywordId, snap] of latest) {
    const phrase = phraseById.get(keywordId);
    if (!phrase) continue;
    const hits = extractOrganicHits(snap.raw_response);
    const competitor = bestCompetitorHit(hits, opts.competitorDomain);
    if (!competitor) continue;
    if (siteRanksTop100({ hits, siteUrl: opts.siteUrl, snap })) continue;
    const volKey = phrase.trim().toLowerCase();
    const stored = opts.volumes?.get(volKey);
    items.push({
      keyword: phrase,
      competitor_url: competitor.url,
      competitor_position: competitor.position,
      est_volume_if_stored: typeof stored === 'number' && Number.isFinite(stored) ? stored : null,
    });
  }

  const anyVolume = items.some((i) => i.est_volume_if_stored != null);
  items.sort((a, b) => {
    if (anyVolume) {
      const av = a.est_volume_if_stored;
      const bv = b.est_volume_if_stored;
      if (av != null && bv != null && bv !== av) return bv - av;
      if (av != null && bv == null) return -1;
      if (av == null && bv != null) return 1;
    }
    return a.competitor_position - b.competitor_position;
  });

  return items.slice(0, clampLimit(opts.limit, DEFAULT_CONTENT_GAP_LIMIT));
}

export function buildContentGapResponse(opts: {
  siteId: string;
  competitorDomain: string;
  keywords: RankKeywordInput[];
  snapshots: RankSnapshotInput[];
  siteUrl: string;
  volumes?: Map<string, number | null>;
  limit?: number;
}): ContentGapResponse {
  const limit = clampLimit(opts.limit, DEFAULT_CONTENT_GAP_LIMIT);
  const competitorDomain = siteHost(opts.competitorDomain) ?? String(opts.competitorDomain).trim();
  const items = analyzeContentGaps({
    keywords: opts.keywords,
    snapshots: opts.snapshots,
    siteUrl: opts.siteUrl,
    competitorDomain,
    volumes: opts.volumes,
    limit,
  });
  return {
    ok: true,
    site_id: opts.siteId,
    competitor_domain: competitorDomain,
    limit,
    cost_usd: CONTENT_GAP_COST_USD,
    items,
    keywords_considered: opts.keywords.length,
    snapshots_used: latestSnapshotPerKeyword(opts.snapshots).size,
    data_source: 'serp_rank_snapshots',
  };
}

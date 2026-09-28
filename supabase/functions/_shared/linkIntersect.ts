/**
 * Link intersect — referring domains that link to a competitor but NOT to the site.
 *
 * Default path is a pure join of already-stored `backlink_referring_domains` rows.
 * ZERO DataForSEO cost. This module never fires a network call.
 *
 * Today Site Explorer fetches backlinks live via seo-proxy and (until this feature) did not
 * persist referring-domain lists. If stored coverage is missing, callers must NOT invent
 * prospects — they return coverage_missing + a dry_run estimate for the additional DataForSEO
 * call (POST /v3/backlinks/domain_intersection/live) that would be needed.
 *
 * No Deno-only APIs so vitest can import this module unchanged.
 */

export const ACTION_HINT = 'outreach prospect' as const;
export const DEFAULT_LINK_INTERSECT_LIMIT = 50;
export const LINK_INTERSECT_COST_USD = 0;

/** DataForSEO Backlinks API (pay-as-you-go, Jul 2026): $0.024/request + $0.000036/row. */
export const DFS_BACKLINKS_REQUEST_USD = 0.024;
export const DFS_BACKLINKS_ROW_USD = 0.000036;
export const DFS_DOMAIN_INTERSECTION_ENDPOINT = '/backlinks/domain_intersection/live';
export const DFS_REFERRING_DOMAINS_ENDPOINT = '/backlinks/referring_domains/live';
export const DFS_BACKLINKS_LIST_ENDPOINT = '/backlinks/backlinks/live';

export type LinkIntersectCoverage =
  | 'ok'
  | 'missing_competitor'
  | 'missing_site'
  | 'missing_both';

export type LinkIntersectMode = 'stored' | 'dry_run' | 'refresh_refused';

export interface StoredReferringDomainRow {
  target_domain: string;
  referring_domain: string;
  referring_rank: number | null;
  links_to_target: number | null;
  sample_target_urls: string[];
}

export interface LinkIntersectItem {
  referring_domain: string;
  links_to_competitor: number;
  sample_target_urls: string[];
  action_hint: typeof ACTION_HINT;
  referring_rank: number | null;
}

export interface LinkIntersectResponse {
  ok: true;
  site_id: string;
  site_domain: string;
  competitor_domain: string;
  cost_usd: number;
  dry_run: boolean;
  executed: boolean;
  mode: LinkIntersectMode;
  coverage: LinkIntersectCoverage;
  estimated_usd: number;
  estimate_endpoint: typeof DFS_DOMAIN_INTERSECTION_ENDPOINT;
  estimate_rows: number;
  items: LinkIntersectItem[];
  data_source: 'backlink_referring_domains';
  site_referring_domains: number;
  competitor_referring_domains: number;
  note?: string;
}

export interface ExecuteLinkIntersectInput {
  siteId: string;
  siteDomain: string;
  competitorDomain: string;
  rows: StoredReferringDomainRow[];
  limit?: number;
  dryRun?: boolean;
  refresh?: boolean;
  estimateRows?: number;
}

type Json = Record<string, unknown>;

function asJson(v: unknown): Json | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
}

export function clampLimit(raw: unknown, fallback = DEFAULT_LINK_INTERSECT_LIMIT): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1000, Math.max(1, n));
}

export function normalizeDomain(input: string | null | undefined): string {
  if (!input || !String(input).trim()) return '';
  const s = String(input).trim();
  try {
    const u = s.includes('://') ? new URL(s) : new URL(`https://${s}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return s
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0]
      ?.toLowerCase() ?? '';
  }
}

export function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/**
 * Cost of one DataForSEO Backlinks live task (domain_intersection or referring_domains).
 * Official pay-as-you-go: $0.024 per request + $0.000036 per returned row (max 1000).
 */
export function estimateBacklinksLiveUsd(rows = 1000): number {
  const n = Math.min(1000, Math.max(0, Math.floor(Number(rows) || 0)));
  return roundUsd(DFS_BACKLINKS_REQUEST_USD + DFS_BACKLINKS_ROW_USD * n);
}

export function resolveExecutionMode(refresh: boolean, dryRun: boolean): LinkIntersectMode {
  if (dryRun) return 'dry_run';
  if (refresh) return 'refresh_refused';
  return 'stored';
}

export function coverageOf(
  siteCount: number,
  competitorCount: number,
): LinkIntersectCoverage {
  const site = siteCount > 0;
  const comp = competitorCount > 0;
  if (site && comp) return 'ok';
  if (!site && !comp) return 'missing_both';
  if (!comp) return 'missing_competitor';
  return 'missing_site';
}

function uniqUrls(urls: unknown, cap = 5): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(urls) ? urls : [];
  for (const u of list) {
    if (typeof u !== 'string' || !u.trim()) continue;
    const v = u.trim();
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

export function intersectReferringDomains(opts: {
  siteDomain: string;
  competitorDomain: string;
  rows: StoredReferringDomainRow[];
  limit?: number;
}): LinkIntersectItem[] {
  const site = normalizeDomain(opts.siteDomain);
  const competitor = normalizeDomain(opts.competitorDomain);
  if (!site || !competitor) return [];

  const siteRefs = new Set<string>();
  const competitorByRef = new Map<string, StoredReferringDomainRow>();

  for (const row of opts.rows) {
    const target = normalizeDomain(row.target_domain);
    const ref = normalizeDomain(row.referring_domain);
    if (!target || !ref) continue;
    if (target === site) siteRefs.add(ref);
    if (target === competitor) {
      const prev = competitorByRef.get(ref);
      if (!prev) {
        competitorByRef.set(ref, { ...row, referring_domain: ref, target_domain: competitor });
      } else {
        const rank = row.referring_rank;
        const prevRank = prev.referring_rank;
        const betterRank =
          rank != null && (prevRank == null || rank > prevRank) ? rank : prevRank;
        const links = Math.max(prev.links_to_target ?? 0, row.links_to_target ?? 0);
        competitorByRef.set(ref, {
          target_domain: competitor,
          referring_domain: ref,
          referring_rank: betterRank ?? null,
          links_to_target: links || null,
          sample_target_urls: uniqUrls([
            ...prev.sample_target_urls,
            ...row.sample_target_urls,
          ]),
        });
      }
    }
  }

  const items: LinkIntersectItem[] = [];
  for (const [ref, row] of competitorByRef) {
    if (siteRefs.has(ref)) continue;
    if (ref === site || ref === competitor) continue;
    items.push({
      referring_domain: ref,
      links_to_competitor: row.links_to_target ?? 0,
      sample_target_urls: uniqUrls(row.sample_target_urls),
      action_hint: ACTION_HINT,
      referring_rank: row.referring_rank,
    });
  }

  items.sort((a, b) => {
    const ar = a.referring_rank;
    const br = b.referring_rank;
    if (ar != null && br != null && br !== ar) return br - ar;
    if (ar != null && br == null) return -1;
    if (ar == null && br != null) return 1;
    return b.links_to_competitor - a.links_to_competitor;
  });

  return items.slice(0, clampLimit(opts.limit, DEFAULT_LINK_INTERSECT_LIMIT));
}

function coverageNote(coverage: LinkIntersectCoverage): string {
  if (coverage === 'ok') {
    return 'Aggregated from stored backlink_referring_domains only. cost_usd is always 0.';
  }
  if (coverage === 'missing_competitor') {
    return 'Stored backlink data has no referring-domain list for the competitor. No prospects invented. One POST /v3/backlinks/domain_intersection/live would be required. This action never fires that call.';
  }
  if (coverage === 'missing_site') {
    return 'Stored backlink data has competitor referring domains but no site-side list, so a true NOT-to-site filter cannot be proven. No prospects invented.';
  }
  return 'Stored backlink data has no referring-domain coverage for the site or the competitor. Site Explorer historically called DataForSEO live and did not persist those rows.';
}

export function executeLinkIntersect(input: ExecuteLinkIntersectInput): LinkIntersectResponse {
  const siteDomain = normalizeDomain(input.siteDomain);
  const competitorDomain = normalizeDomain(input.competitorDomain);
  const limit = clampLimit(input.limit, DEFAULT_LINK_INTERSECT_LIMIT);
  const estimateRows = Math.min(1000, Math.max(1, Math.floor(Number(input.estimateRows) || limit)));
  const estimatedUsd = estimateBacklinksLiveUsd(estimateRows);
  const mode = resolveExecutionMode(!!input.refresh, !!input.dryRun);

  const siteCount = input.rows.filter((r) => normalizeDomain(r.target_domain) === siteDomain).length;
  const competitorCount = input.rows.filter(
    (r) => normalizeDomain(r.target_domain) === competitorDomain,
  ).length;
  const coverage = coverageOf(siteCount, competitorCount);

  const base: LinkIntersectResponse = {
    ok: true,
    site_id: input.siteId,
    site_domain: siteDomain,
    competitor_domain: competitorDomain,
    cost_usd: LINK_INTERSECT_COST_USD,
    dry_run: mode === 'dry_run',
    executed: false,
    mode,
    coverage,
    estimated_usd: estimatedUsd,
    estimate_endpoint: DFS_DOMAIN_INTERSECTION_ENDPOINT,
    estimate_rows: estimateRows,
    items: [],
    data_source: 'backlink_referring_domains',
    site_referring_domains: siteCount,
    competitor_referring_domains: competitorCount,
    note: coverageNote(coverage),
  };

  if (mode === 'dry_run') {
    return {
      ...base,
      note:
        `DRY RUN — estimate only, nothing executed. ` +
        `One ${DFS_DOMAIN_INTERSECTION_ENDPOINT} call for ~${estimateRows} rows ≈ $${estimatedUsd.toFixed(4)} ` +
        `($${DFS_BACKLINKS_REQUEST_USD}/request + $${DFS_BACKLINKS_ROW_USD}/row). ` +
        `This action never fires DataForSEO; refresh=true is refused.`,
    };
  }

  if (mode === 'refresh_refused') {
    return {
      ...base,
      note:
        `refresh=true is refused: stored backlink coverage is not a trivial refresh of an existing snapshot. ` +
        `Call dry_run=true for the estimate (≈ $${estimatedUsd.toFixed(4)}). ` +
        `This action never fires DataForSEO.`,
    };
  }

  if (coverage !== 'ok') {
    return base;
  }

  return {
    ...base,
    items: intersectReferringDomains({
      siteDomain,
      competitorDomain,
      rows: input.rows,
      limit,
    }),
  };
}

function firstResultItems(raw: unknown): Json[] {
  const root = asJson(raw);
  if (!root) return [];
  const tasks = Array.isArray(root['tasks']) ? (root['tasks'] as unknown[]) : [root];
  const items: Json[] = [];
  for (const task of tasks) {
    const t = asJson(task);
    if (!t) continue;
    const resultArr = Array.isArray(t['result']) ? t['result'] : [];
    const block = asJson(resultArr[0]) ?? t;
    const arr = Array.isArray(block['items']) ? block['items'] : [];
    for (const it of arr) {
      const row = asJson(it);
      if (row) items.push(row);
    }
  }
  return items;
}

function payloadTarget(payload: unknown): string {
  const p = asJson(payload);
  if (!p) return '';
  if (typeof p['target'] === 'string') return normalizeDomain(p['target']);
  const targets = p['targets'];
  if (targets && typeof targets === 'object' && !Array.isArray(targets)) {
    const one = (targets as Json)['1'];
    if (typeof one === 'string') return normalizeDomain(one);
  }
  return '';
}

/**
 * Parse a DataForSEO backlink live response into stored referring-domain rows.
 * Used by seo-proxy to persist rows the account already paid for (no extra call).
 */
export function extractReferringDomainRows(
  endpoint: string,
  payload: unknown,
  response: unknown,
): StoredReferringDomainRow[] {
  const ep = String(endpoint || '');
  const target = payloadTarget(payload);
  const items = firstResultItems(response);

  if (ep.includes('/backlinks/referring_domains/')) {
    if (!target) return [];
    return items
      .map((it) => ({
        target_domain: target,
        referring_domain: normalizeDomain(
          (typeof it['domain'] === 'string' && it['domain']) ||
            (typeof it['target'] === 'string' && it['target']) ||
            '',
        ),
        referring_rank: typeof it['rank'] === 'number' ? it['rank'] : null,
        links_to_target: typeof it['backlinks'] === 'number' ? it['backlinks'] : null,
        sample_target_urls: [],
      }))
      .filter((r) => r.referring_domain);
  }

  if (ep.includes('/backlinks/backlinks/')) {
    if (!target) return [];
    const grouped = new Map<string, StoredReferringDomainRow>();
    for (const it of items) {
      const from =
        normalizeDomain(
          (typeof it['domain_from'] === 'string' && it['domain_from']) ||
            (typeof it['url_from'] === 'string' && it['url_from']) ||
            '',
        );
      if (!from) continue;
      const urlTo = typeof it['url_to'] === 'string' ? it['url_to'] : '';
      const prev = grouped.get(from);
      if (!prev) {
        grouped.set(from, {
          target_domain: target,
          referring_domain: from,
          referring_rank: typeof it['rank'] === 'number' ? it['rank'] : null,
          links_to_target: 1,
          sample_target_urls: urlTo ? [urlTo] : [],
        });
      } else {
        prev.links_to_target = (prev.links_to_target ?? 0) + 1;
        if (urlTo) prev.sample_target_urls = uniqUrls([...prev.sample_target_urls, urlTo]);
        if (typeof it['rank'] === 'number') {
          prev.referring_rank = Math.max(prev.referring_rank ?? 0, it['rank'] as number);
        }
      }
    }
    return [...grouped.values()];
  }

  return [];
}

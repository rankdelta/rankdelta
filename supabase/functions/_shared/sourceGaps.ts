/**
 * sourceGaps — aggregate cited_sources[] already stored on visibility_query_runs.
 *
 * gap_score = citation_count × (1 − your_share)
 *   your_share = (citations whose domain is the site / tracked-brand domain) / total citations
 *   your_presence = this row's domain is one of the site's own domains (or a subdomain)
 *
 * Pure aggregation — no API calls. No Deno/Node APIs so vitest can import this file.
 */

export interface CitedSourceIn {
  url?: string | null;
  domain?: string | null;
}

export interface SourceGapRow {
  domain: string;
  citation_count: number;
  sample_urls: string[];
  your_presence: boolean;
  gap_score: number;
}

export interface SourceGapsResult {
  site_id: string;
  window_days: number;
  total_citations: number;
  your_citations: number;
  your_share: number;
  gaps: SourceGapRow[];
}

const SAMPLE_LIMIT = 3;

export function normalizeGapDomain(input: string | null | undefined): string {
  return (input ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .replace(/[?#].*$/, '')
    .toLowerCase();
}

export function isOwnOrSubdomain(candidate: string | null | undefined, base: string | null | undefined): boolean {
  const c = normalizeGapDomain(candidate);
  const b = normalizeGapDomain(base);
  if (!c || !b) return false;
  return c === b || c.endsWith(`.${b}`);
}

export function domainMatchesAnyOwn(
  candidate: string | null | undefined,
  ownDomains: Array<string | null | undefined>,
): boolean {
  return ownDomains.some((d) => isOwnOrSubdomain(candidate, d));
}

export function hostFromUrl(url: string | null | undefined): string {
  if (!url || !String(url).trim()) return '';
  const s = String(url).trim();
  try {
    const u = s.includes('://') ? new URL(s) : new URL(`https://${s}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return normalizeGapDomain(s);
  }
}

/** Flatten a stored cited_sources JSON value into {domain, url} rows. Drops empties. */
export function flattenCitedSources(cited: unknown): Array<{ domain: string; url: string | null }> {
  if (cited == null) return [];
  const list = Array.isArray(cited) ? cited : [];
  const out: Array<{ domain: string; url: string | null }> = [];
  for (const item of list) {
    if (typeof item === 'string') {
      const domain = hostFromUrl(item) || normalizeGapDomain(item);
      if (domain) out.push({ domain, url: item.startsWith('http') ? item : null });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const url = typeof rec['url'] === 'string' ? rec['url'] : null;
    const domain = normalizeGapDomain(
      (typeof rec['domain'] === 'string' && rec['domain']) || hostFromUrl(url),
    );
    if (domain) out.push({ domain, url });
  }
  return out;
}

export function computeSourceGaps(input: {
  siteId: string;
  ownDomains: Array<string | null | undefined>;
  citedSources: unknown[];
  limit?: number;
  windowDays?: number;
}): SourceGapsResult {
  const limit = Math.min(100, Math.max(1, Math.floor(Number(input.limit ?? 20)) || 20));
  const windowDays = Math.max(1, Math.floor(Number(input.windowDays ?? 30)) || 30);

  const flat: Array<{ domain: string; url: string | null }> = [];
  for (const cited of input.citedSources) {
    flat.push(...flattenCitedSources(cited));
  }

  const byDomain = new Map<string, { count: number; urls: string[] }>();
  let yourCitations = 0;
  for (const row of flat) {
    const owned = domainMatchesAnyOwn(row.domain, input.ownDomains);
    if (owned) yourCitations++;
    const cur = byDomain.get(row.domain) ?? { count: 0, urls: [] };
    cur.count++;
    if (row.url && cur.urls.length < SAMPLE_LIMIT && !cur.urls.includes(row.url)) {
      cur.urls.push(row.url);
    }
    byDomain.set(row.domain, cur);
  }

  const total = flat.length;
  const yourShare = total > 0 ? yourCitations / total : 0;
  const round4 = (n: number) => Math.round(n * 10000) / 10000;

  const gaps: SourceGapRow[] = [...byDomain.entries()]
    .map(([domain, v]) => ({
      domain,
      citation_count: v.count,
      sample_urls: v.urls,
      your_presence: domainMatchesAnyOwn(domain, input.ownDomains),
      gap_score: round4(v.count * (1 - yourShare)),
    }))
    .sort((a, b) => b.gap_score - a.gap_score || b.citation_count - a.citation_count || a.domain.localeCompare(b.domain))
    .slice(0, limit);

  return {
    site_id: input.siteId,
    window_days: windowDays,
    total_citations: total,
    your_citations: yourCitations,
    your_share: round4(yourShare),
    gaps,
  };
}

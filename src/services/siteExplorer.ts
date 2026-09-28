/**
 * Site Explorer — competitor overview, their organic keywords, and their backlink profile.
 * Ported into the cloud app from the open edition so both editions share it. Calls DataForSEO via
 * the existing seo-proxy Edge Function (no key in the browser). BYOK/managed keys are handled by the
 * proxy, so this works in cloud and self-host unchanged.
 *
 * Honest labelling kept from the open edition: DataForSEO's domain "rank" is its own 0–1000 metric,
 * NOT Ahrefs DR; traffic is estimated.
 */

import { TRAFFIC_MARKETS } from '../lib/seoMarkets';
import {
  competitionOf,
  monthlyVolumes,
  posDistribution,
  rankDeltaOf,
  serpItemFeatures,
  serpTypesToFeatures,
  type PosDistribution,
  type RankDelta,
  type SerpFeature,
} from '../lib/labsMetrics';
import { parseSerpAdvanced, type SerpSnapshot, type SerpOrganic } from '../lib/serpSnapshot';
import { AccountBudgetError, proxyDataForSEO as _proxyDataForSEO, proxyOpenPageRank } from './edgeProxy';

// Session cache: dedupe identical DataForSEO calls (same endpoint+payload) so re-exploring a domain
// or re-opening a tab costs nothing. Caches the Promise, and evicts on error so failures can retry.
// This is a client-side guard against runaway credit use; the server-side per-account cap is the
// real safeguard (see supabase/functions/_shared/accountBudget.ts).
const _dfsCache = new Map<string, Promise<unknown>>();
function proxyDataForSEO(endpoint: string, payload: unknown): Promise<unknown> {
  const key = `${endpoint}::${JSON.stringify(payload)}`;
  const hit = _dfsCache.get(key);
  if (hit) return hit;
  const p = _proxyDataForSEO(endpoint, payload).catch((e) => { _dfsCache.delete(key); throw e; });
  _dfsCache.set(key, p);
  return p;
}

type Dict = Record<string, unknown>;
type DfsResponse = { tasks?: Array<{ result?: Array<Dict & { items?: Dict[] }> }> };
const firstResult = (raw: unknown): (Dict & { items?: Dict[] }) | undefined =>
  (raw as DfsResponse)?.tasks?.[0]?.result?.[0];
const asDict = (v: unknown): Dict => (v as Dict) ?? {};
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export interface Locale { locationCode: number; languageCode: string }
export const DEFAULT_LOCALE: Locale = { locationCode: 2840, languageCode: 'en' };
export const hostOf = (u: string) => u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

/**
 * Open PageRank (Domcop) authority as a 0–100 score — a FREE, independent cross-check for the
 * DataForSEO domain rank (Common Crawl link graph). Returns null when the API key isn't configured
 * or the domain has no data, so the UI can simply omit it. Never throws.
 */
export async function openPageRank(domain: string): Promise<number | null> {
  try {
    const raw = await proxyOpenPageRank([hostOf(domain)]) as
      { error?: string; response?: Array<{ page_rank_decimal?: number | string; status_code?: number }> };
    if (!raw || raw.error) return null;
    const r = raw.response?.[0];
    if (!r || r.status_code !== 200) return null;
    const pr = Number(r.page_rank_decimal);
    return Number.isFinite(pr) ? Math.max(0, Math.min(100, Math.round(pr * 10))) : null;
  } catch {
    return null;
  }
}

export interface BulkDomainRow {
  domain: string;
  authority: number | null;
  traffic: number | null;
  keywords: number | null;
  refDomains: number | null;
  backlinks: number | null;
}

/**
 * Batch domain analysis (Ahrefs "Batch Analysis" + a cheap Domain Comparison). Metrics for MANY
 * domains at once in a FIXED ~4 DataForSEO calls total (each bulk endpoint takes up to 1000 targets)
 * — the most credit-efficient way to compare domains: cost does not grow with the number of domains.
 */
export async function bulkDomainMetrics(domains: string[], loc: Locale = DEFAULT_LOCALE): Promise<BulkDomainRow[]> {
  const targets = [...new Set(domains.map((d) => hostOf(d)).filter(Boolean))].slice(0, 200);
  if (!targets.length) return [];

  const [ranksR, blR, rdR, trafR] = await Promise.all([
    proxyDataForSEO('/backlinks/bulk_ranks/live', { targets }),
    proxyDataForSEO('/backlinks/bulk_backlinks/live', { targets }),
    proxyDataForSEO('/backlinks/bulk_referring_domains/live', { targets }),
    proxyDataForSEO('/dataforseo_labs/google/bulk_traffic_estimation/live', {
      targets, location_code: loc.locationCode, language_code: loc.languageCode,
    }),
  ]);

  const mapBy = <T>(raw: unknown, pick: (it: Dict) => T): Map<string, T> => {
    const m = new Map<string, T>();
    for (const it of firstResult(raw)?.items ?? []) {
      const t = str(it['target']);
      if (t) m.set(t, pick(it));
    }
    return m;
  };
  const ranks = mapBy(ranksR, (it) => num(it['rank']));
  const backlinks = mapBy(blR, (it) => num(it['backlinks']));
  const refDomains = mapBy(rdR, (it) => num(it['referring_domains']));
  const organic = mapBy(trafR, (it) => asDict(asDict(it['metrics'])['organic']));

  return targets.map((t) => {
    const rank = ranks.get(t) ?? null;
    const org = organic.get(t) ?? {};
    return {
      domain: t,
      authority: rank == null ? null : Math.max(0, Math.min(100, Math.round(rank / 10))),
      traffic: num(org['etv']),
      keywords: num(org['count']),
      refDomains: refDomains.get(t) ?? null,
      backlinks: backlinks.get(t) ?? null,
    };
  }).sort((a, b) => (b.authority ?? -1) - (a.authority ?? -1));
}

export interface DomainOverview {
  target: string;
  organicKeywords: number | null;
  organicTraffic: number | null;
  organicTrafficValue: number | null;
  paidKeywords: number | null;
  /** Full-index position buckets — already on this payload, not the sampled keyword table. */
  positions: PosDistribution;
}

export async function domainOverview(target: string, loc: Locale = DEFAULT_LOCALE): Promise<DomainOverview> {
  const raw = await proxyDataForSEO('/dataforseo_labs/google/domain_rank_overview/live', {
    target, location_code: loc.locationCode, language_code: loc.languageCode,
  });
  const metrics = asDict(asDict(firstResult(raw)?.items?.[0])['metrics']);
  const organic = asDict(metrics['organic']);
  const paid = asDict(metrics['paid']);
  return {
    target,
    organicKeywords: num(organic['count']),
    organicTraffic: num(organic['etv']),
    organicTrafficValue: num(organic['estimated_paid_traffic_cost']),
    paidKeywords: num(paid['count']),
    positions: posDistribution(organic),
  };
}

export interface TrafficPoint { date: string; traffic: number | null; keywords: number | null }

/**
 * Estimated organic traffic + keyword count over time (monthly) — powers the trend chart.
 * Fetches from `dateFrom` (YYYY-MM-DD) if given, so the UI can offer 3M/6M/1Y/2Y ranges.
 */
export async function trafficHistory(target: string, loc: Locale = DEFAULT_LOCALE, dateFrom?: string): Promise<TrafficPoint[]> {
  const raw = await proxyDataForSEO('/dataforseo_labs/google/historical_rank_overview/live', {
    target, location_code: loc.locationCode, language_code: loc.languageCode,
    ...(dateFrom ? { date_from: dateFrom } : {}),
  });
  const items = firstResult(raw)?.items ?? [];
  return items.map((it) => {
    const m = asDict(asDict(it['metrics'])['organic']);
    const y = num(it['year']);
    const mo = num(it['month']);
    return {
      date: y && mo ? `${y}-${String(mo).padStart(2, '0')}` : '',
      traffic: num(m['etv']),
      keywords: num(m['count']),
    };
  }).filter((p) => p.date).sort((a, b) => a.date.localeCompare(b.date));
}

export interface CountryTraffic { country: string; traffic: number | null }

/** How many DataForSEO calls a full traffic-by-country estimate costs (one per market). */
export const TRAFFIC_BY_COUNTRY_CALLS = TRAFFIC_MARKETS.length;

/**
 * Estimated organic traffic split across major markets (Ahrefs "Traffic by country"). One
 * domain_rank_overview per market; markets with no traffic are dropped. A budget 402 propagates so
 * the page can show the cap banner. It's a curated top-markets estimate, not an exhaustive list.
 */
export async function trafficByCountry(target: string): Promise<CountryTraffic[]> {
  const results = await Promise.all(TRAFFIC_MARKETS.map(async (m) => ({
    country: m.name,
    traffic: (await domainOverview(target, m.loc)).organicTraffic,
  })));
  return results.filter((r) => (r.traffic ?? 0) > 0).sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0));
}

export interface RankedKeyword {
  keyword: string;
  position: number | null;
  volume: number | null;
  url: string | null;
  intent: string | null;
  difficulty: number | null;
  cpc: number | null;
  traffic: number | null;
  change?: RankDelta;
  trend?: number[];
  features?: SerpFeature[];
}

export async function rankedKeywords(target: string, loc: Locale = DEFAULT_LOCALE, limit = 100): Promise<RankedKeyword[]> {
  const raw = await proxyDataForSEO('/dataforseo_labs/google/ranked_keywords/live', {
    target, location_code: loc.locationCode, language_code: loc.languageCode,
    limit: Math.min(1000, limit), order_by: ['ranked_serp_element.serp_item.rank_group,asc'],
  });
  const items = firstResult(raw)?.items ?? [];
  return items.map((it) => {
    const kd = asDict(it['keyword_data']);
    const ki = asDict(kd['keyword_info']);
    const serp = asDict(asDict(it['ranked_serp_element'])['serp_item']);
    const position = num(serp['rank_group']);
    return {
      keyword: str(kd['keyword']) ?? '',
      position,
      volume: num(ki['search_volume']),
      url: str(serp['url']),
      intent: str(asDict(kd['search_intent_info'])['main_intent']),
      difficulty: num(asDict(kd['keyword_properties'])['keyword_difficulty']),
      cpc: num(ki['cpc']),
      traffic: num(serp['etv']),
      change: rankDeltaOf(serp, position),
      trend: monthlyVolumes(ki),
      features: serpItemFeatures(serp),
    };
  });
}

export interface KeywordIdea {
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  intent: string | null;
  competition: number | null;
  trend?: number[];
  resultsCount?: number | null;
  features?: SerpFeature[];
}

/**
 * Keyword ideas for a seed term (Ahrefs/Semrush-style research) — related keywords with search
 * volume, difficulty, CPC and intent. Powers the Keyword Research page. Same server-side proxy +
 * session cache as the rest of Site Explorer, so it's covered by the per-account spend cap.
 */
export async function keywordIdeas(seed: string, loc: Locale = DEFAULT_LOCALE, limit = 100): Promise<KeywordIdea[]> {
  const raw = await proxyDataForSEO('/dataforseo_labs/google/keyword_suggestions/live', {
    keyword: seed, location_code: loc.locationCode, language_code: loc.languageCode,
    limit: Math.min(1000, limit), order_by: ['keyword_info.search_volume,desc'],
  });
  const items = firstResult(raw)?.items ?? [];
  return items.map((it) => {
    const kd = asDict(it['keyword_data'] ?? it);
    const ki = asDict(kd['keyword_info']);
    const serpInfo = asDict(kd['serp_info']);
    return {
      keyword: str(kd['keyword']) ?? '',
      volume: num(ki['search_volume']),
      difficulty: num(asDict(kd['keyword_properties'])['keyword_difficulty']),
      cpc: num(ki['cpc']),
      intent: str(asDict(kd['search_intent_info'])['main_intent']),
      competition: competitionOf(ki),
      trend: monthlyVolumes(ki),
      resultsCount: num(serpInfo['se_results_count']),
      features: serpTypesToFeatures(serpInfo['serp_item_types']),
    };
  }).filter((k) => k.keyword);
}

/**
 * Keyword Difficulty (0–100) for many keywords in ONE bulk call (up to 1000) — keyword_suggestions
 * doesn't return KD, so Keyword Research enriches its ideas with this. Cheap (single call), and KD
 * is core to the feature. Very low-volume long-tail keywords may legitimately have no KD (omitted).
 */
export async function bulkKeywordDifficulty(keywords: string[], loc: Locale = DEFAULT_LOCALE): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  const uniq = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 1000);
  if (!uniq.length) return m;
  const raw = await proxyDataForSEO('/dataforseo_labs/google/bulk_keyword_difficulty/live', {
    keywords: uniq, location_code: loc.locationCode, language_code: loc.languageCode,
  });
  for (const it of firstResult(raw)?.items ?? []) {
    const k = str(it['keyword']);
    const kd = num(it['keyword_difficulty']);
    if (k && kd != null) m.set(k, kd);
  }
  return m;
}

export type SerpResult = SerpOrganic;
export type { SerpSnapshot };

async function fetchSerpAdvanced(keyword: string, loc: Locale): Promise<SerpSnapshot> {
  const raw = await proxyDataForSEO('/serp/google/organic/live/advanced', {
    keyword, location_code: loc.locationCode, language_code: loc.languageCode, depth: 10,
  });
  return parseSerpAdvanced(firstResult(raw)?.items ?? []);
}

/**
 * Live Google SERP for a keyword — organic + features already in the advanced payload.
 * `fallbackLoc` is used only when the primary location is rejected (typical for a few city codes).
 */
export async function serpForKeyword(
  keyword: string,
  loc: Locale = DEFAULT_LOCALE,
  fallbackLoc?: Locale,
): Promise<SerpSnapshot> {
  try {
    return await fetchSerpAdvanced(keyword, loc);
  } catch (e) {
    if (!fallbackLoc || fallbackLoc.locationCode === loc.locationCode || e instanceof AccountBudgetError) throw e;
    return fetchSerpAdvanced(keyword, fallbackLoc);
  }
}

export interface Competitor { domain: string; commonKeywords: number | null; theirKeywords: number | null; theirTraffic: number | null; avgPosition: number | null }

/**
 * Organic competitors for a domain (Ahrefs "Competing domains"): sites that rank for many of the
 * same keywords. Shows how many keywords they share, plus the competitor's own keyword count and
 * estimated traffic. Shared proxy + cache, so it's covered by the per-account spend cap.
 */
export async function competitorDomains(target: string, loc: Locale = DEFAULT_LOCALE, limit = 50): Promise<Competitor[]> {
  const raw = await proxyDataForSEO('/dataforseo_labs/google/competitors_domain/live', {
    target, location_code: loc.locationCode, language_code: loc.languageCode, limit: Math.min(1000, limit),
  });
  const items = firstResult(raw)?.items ?? [];
  const self = hostOf(target);
  return items.map((it) => {
    const organic = asDict(asDict(it['full_domain_metrics'])['organic']);
    return {
      domain: str(it['domain']) ?? '',
      commonKeywords: num(it['intersections']),
      theirKeywords: num(organic['count']),
      theirTraffic: num(organic['etv']),
      avgPosition: num(it['avg_position']),
    };
  }).filter((c) => c.domain && hostOf(c.domain) !== self);
}

export interface TopPage { url: string; keywords: number | null; traffic: number | null; trafficValue?: number | null }

/**
 * A domain's best-performing pages by estimated organic traffic (Ahrefs "Top pages") — shows which
 * URLs pull the traffic and how many keywords each ranks for. Shared proxy + cache (spend-capped).
 */
export async function topPages(target: string, loc: Locale = DEFAULT_LOCALE, limit = 50): Promise<TopPage[]> {
  const raw = await proxyDataForSEO('/dataforseo_labs/google/relevant_pages/live', {
    target, location_code: loc.locationCode, language_code: loc.languageCode, limit: Math.min(1000, limit),
  });
  const items = firstResult(raw)?.items ?? [];
  return items.map((it) => {
    const organic = asDict(asDict(it['metrics'])['organic']);
    return {
      url: str(it['page_address']) ?? '',
      keywords: num(organic['count']),
      traffic: num(organic['etv']),
      trafficValue: num(organic['estimated_paid_traffic_cost']),
    };
  }).filter((p) => p.url).sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0));
}

export interface BacklinkSummary {
  target: string;
  domainRank: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  referringMainDomains: number | null;
  brokenBacklinks: number | null;
  referringDomainsNofollow: number | null;
}

export async function backlinkSummary(target: string): Promise<BacklinkSummary> {
  const raw = await proxyDataForSEO('/backlinks/summary/live', { target, internal_list_limit: 10, backlinks_status_type: 'live' });
  const s = asDict(firstResult(raw));
  return {
    target,
    domainRank: num(s['rank']),
    backlinks: num(s['backlinks']),
    referringDomains: num(s['referring_domains']),
    referringMainDomains: num(s['referring_main_domains']),
    brokenBacklinks: num(s['broken_backlinks']),
    referringDomainsNofollow: num(s['referring_domains_nofollow']),
  };
}

export interface ReferringDomain {
  domain: string;
  rank: number | null;
  backlinks: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  /** Count of dofollow backlinks from this domain (DataForSEO integer). */
  dofollow: number | null;
  country: string | null;
}

function dofollowCount(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}

function topCountry(it: Dict): string | null {
  const direct = str(it['country']) ?? str(it['country_iso_code']);
  if (direct) return direct;
  const map = it['referring_links_countries'];
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  let best: string | null = null;
  let n = -1;
  for (const [iso, count] of Object.entries(map as Record<string, unknown>)) {
    const c = typeof count === 'number' ? count : -1;
    if (c > n) { n = c; best = iso; }
  }
  return best;
}

export async function referringDomains(target: string, limit = 100): Promise<ReferringDomain[]> {
  const raw = await proxyDataForSEO('/backlinks/referring_domains/live', {
    target, limit: Math.min(1000, limit), order_by: ['rank,desc'], backlinks_status_type: 'live',
  });
  const items = firstResult(raw)?.items ?? [];
  return items.map((it) => ({
    domain: str(it['domain']) ?? '',
    rank: num(it['rank']),
    backlinks: num(it['backlinks']),
    firstSeen: str(it['first_seen']),
    lastSeen: str(it['last_seen']),
    dofollow: dofollowCount(it['dofollow']),
    country: topCountry(it),
  }));
}

export interface Backlink {
  from: string | null;
  to: string | null;
  fromTitle: string | null;
  anchor: string | null;
  dofollow: boolean | null;
  rank: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  itemType: string | null;
  broken?: boolean;
  attributes?: string[];
  domainFromRank?: number | null;
}

export async function backlinksList(target: string, limit = 100): Promise<Backlink[]> {
  const raw = await proxyDataForSEO('/backlinks/backlinks/live', {
    target, limit: Math.min(1000, limit), mode: 'as_is', order_by: ['rank,desc'], backlinks_status_type: 'live',
  });
  const items = firstResult(raw)?.items ?? [];
  return items.map((it) => {
    const attrs = Array.isArray(it['attributes'])
      ? (it['attributes'] as unknown[]).filter((a): a is string => typeof a === 'string')
      : [];
    return {
      from: str(it['url_from']),
      to: str(it['url_to']),
      fromTitle: str(it['page_from_title']),
      anchor: str(it['anchor']),
      dofollow: typeof it['dofollow'] === 'boolean' ? (it['dofollow'] as boolean) : null,
      rank: num(it['rank']),
      firstSeen: str(it['first_seen']),
      lastSeen: str(it['last_seen']),
      itemType: str(it['item_type']),
      broken: it['is_broken'] === true,
      attributes: attrs.filter((a) => a === 'ugc' || a === 'sponsored' || a === 'nofollow'),
      domainFromRank: num(it['domain_from_rank']) ?? num(asDict(it['page_from_rank'])['rank']),
    };
  });
}

export interface Anchor { anchor: string; backlinks: number | null; referringDomains: number | null; refDomainsNofollow: number | null }

/** Anchor-text distribution for a domain's backlinks (Ahrefs "Anchors"). One lazy call. */
export async function backlinkAnchors(target: string, limit = 50): Promise<Anchor[]> {
  const raw = await proxyDataForSEO('/backlinks/anchors/live', {
    target, limit: Math.min(1000, limit), order_by: ['backlinks,desc'], backlinks_status_type: 'live',
  });
  const items = firstResult(raw)?.items ?? [];
  return items.map((it) => ({
    anchor: str(it['anchor']) || '(empty)',
    backlinks: num(it['backlinks']),
    referringDomains: num(it['referring_domains']),
    refDomainsNofollow: num(it['referring_domains_nofollow']),
  })).filter((a) => a.anchor);
}

export interface BacklinkTimepoint { date: string; newRefDomains: number | null; lostRefDomains: number | null; newBacklinks: number | null; lostBacklinks: number | null }

/**
 * New vs lost referring domains / backlinks over time (Ahrefs backlink-growth chart). One lazy call;
 * `dateFrom` defaults to ~1 year back. Shows whether a domain's link profile is growing or decaying.
 */
export async function backlinkHistory(target: string, dateFrom?: string): Promise<BacklinkTimepoint[]> {
  const raw = await proxyDataForSEO('/backlinks/timeseries_new_lost_summary/live', {
    target, date_from: dateFrom ?? oneYearAgo(), group_range: 'month',
  });
  const items = firstResult(raw)?.items ?? [];
  return items.map((it) => ({
    date: (str(it['date']) ?? '').slice(0, 7),
    newRefDomains: num(it['new_referring_domains']),
    lostRefDomains: num(it['lost_referring_domains']),
    newBacklinks: num(it['new_backlinks']),
    lostBacklinks: num(it['lost_backlinks']),
  })).filter((p) => p.date).sort((a, b) => a.date.localeCompare(b.date));
}

function oneYearAgo(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export interface LinkGapRow { domain: string; rank: number | null; backlinks: number | null; firstSeen: string | null }

/**
 * Link gap (Ahrefs "Link intersect"): referring domains that link to `competitor` but NOT to
 * `yourDomain` — your backlink prospecting list. One lazy call.
 */
export async function linkIntersect(competitor: string, yourDomain: string, limit = 50): Promise<LinkGapRow[]> {
  const raw = await proxyDataForSEO('/backlinks/domain_intersection/live', {
    targets: { '1': hostOf(competitor) },
    exclude_targets: [hostOf(yourDomain)],
    limit: Math.min(1000, limit),
    order_by: ['1.rank,desc'],
  });
  const items = firstResult(raw)?.items ?? [];
  return items.map((it) => {
    const d = asDict(asDict(it['domain_intersection'])['1']);
    return {
      domain: str(d['target']) ?? '',
      rank: num(d['rank']),
      backlinks: num(d['backlinks']),
      firstSeen: str(d['first_seen']),
    };
  }).filter((r) => r.domain);
}

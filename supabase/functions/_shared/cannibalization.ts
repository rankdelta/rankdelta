/**
 * Cannibalization analysis — stored rank snapshots only by default (ZERO DataForSEO cost).
 *
 * Data source: `serp_rank_keywords` + `serp_rank_snapshots` (history is kept; each snapshot
 * stores the first matching URL in `ranking_url` AND the full SERP in `raw_response`).
 * We parse `raw_response` organic items to find every site URL in the top 100.
 *
 * GSC query×page (PR #51, unmerged) is a future enhancement — not required here.
 *
 * No Deno-only APIs in the analysis path so vitest can import this module unchanged.
 */

export const DEFAULT_MAX_KEYWORDS_PER_CHECK = 100;
export const DEFAULT_SERP_ESTIMATE_USD = 0.025;
export const DEFAULT_DAYS = 90;
export const DEFAULT_ENGINE = 'google';
export const DATAFORSEO_SERP_LIVE_ADVANCED =
  'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';

export type CannibalizationSeverity = 'HIGH' | 'MEDIUM' | 'LOW';
export type CannibalizationRecommendation =
  | 'consolidate into stronger URL'
  | 'differentiate intent'
  | 'internal-link from weaker to stronger';
export type ExecutionMode = 'stored' | 'dry_run' | 'refresh';

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

export interface SiteUrlHit {
  url: string;
  position: number;
}

export interface CannibalizationItem {
  keyword: string;
  urls: string[];
  best_position_each: number[];
  severity: CannibalizationSeverity;
  recommendation: CannibalizationRecommendation;
}

export interface CannibalizationResponse {
  ok: true;
  dry_run: boolean;
  executed: boolean;
  mode: ExecutionMode;
  site_id: string;
  engine: string;
  days: number;
  cost_usd: number;
  keyword_count?: number;
  estimated_usd?: number;
  max_keywords_per_check: number;
  keywords_total: number;
  keywords_capped: boolean;
  keywords_considered?: number;
  items: CannibalizationItem[];
  data_source: 'serp_rank_snapshots';
  note?: string;
}

export interface RefreshSerpResult {
  costUsd: number;
  snapshots: RankSnapshotInput[];
  httpCalls: number;
}

export interface ExecuteCannibalizationInput {
  siteId: string;
  engine?: string;
  days?: number;
  limit?: number;
  refresh?: boolean;
  dryRun?: boolean;
  maxKeywordsPerCheck?: number;
  estimateUsdPerKeyword?: number;
  siteUrl: string;
  keywords: RankKeywordInput[];
  snapshots: RankSnapshotInput[];
  now?: Date;
  refreshSerp?: (keywords: RankKeywordInput[]) => Promise<RefreshSerpResult>;
}

const STOP_TOKENS = new Set([
  'www', 'com', 'net', 'org', 'html', 'htm', 'php', 'asp', 'aspx', 'index',
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'you', 'your', 'our',
  'are', 'was', 'how', 'why', 'what', 'when', 'who', 'best', 'top', 'vs',
  'or', 'of', 'to', 'in', 'on', 'at', 'a', 'an', 'it', 'en', 'https', 'http',
]);

const SEVERITY_RANK: Record<CannibalizationSeverity, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

export function resolveExecutionMode(refresh: boolean, dryRun: boolean): ExecutionMode {
  if (dryRun) return 'dry_run';
  if (refresh) return 'refresh';
  return 'stored';
}

export function clampDays(raw: unknown, fallback = DEFAULT_DAYS): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(365, Math.max(1, n));
}

export function clampLimit(raw: unknown, fallback: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(200, Math.max(1, n));
}

export function resolveMaxKeywordsPerCheck(
  raw: unknown,
  fallback = DEFAULT_MAX_KEYWORDS_PER_CHECK,
): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(10_000, n);
}

/** Read the plan-tier hook: project metadata override → plan config → default 100. */
export function readMaxKeywordsPerCheck(opts: {
  projectMetadata?: unknown;
  planValue?: unknown;
}): number {
  const meta = opts.projectMetadata && typeof opts.projectMetadata === 'object'
    ? (opts.projectMetadata as Record<string, unknown>)['max_keywords_per_check']
    : undefined;
  if (meta != null && Number.isFinite(Number(meta))) {
    return resolveMaxKeywordsPerCheck(meta);
  }
  if (opts.planValue != null && Number.isFinite(Number(opts.planValue))) {
    return resolveMaxKeywordsPerCheck(opts.planValue);
  }
  return DEFAULT_MAX_KEYWORDS_PER_CHECK;
}

export function applyKeywordCap<T>(items: T[], cap: number): {
  selected: T[];
  capped: boolean;
  total: number;
} {
  const limit = resolveMaxKeywordsPerCheck(cap);
  return {
    selected: items.slice(0, limit),
    capped: items.length > limit,
    total: items.length,
  };
}

export function estimateRefreshUsd(
  keywordCount: number,
  usdPerKeyword = DEFAULT_SERP_ESTIMATE_USD,
): number {
  const n = Math.max(0, Math.floor(keywordCount) || 0);
  const usd = n * (Number(usdPerKeyword) || DEFAULT_SERP_ESTIMATE_USD);
  return Math.round(usd * 1_000_000) / 1_000_000;
}

export function siteHost(url: string | null | undefined): string | null {
  if (!url || !String(url).trim()) return null;
  const s = String(url).trim();
  try {
    const u = s.includes('://') ? new URL(s) : new URL(`https://${s}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

export function urlMatchesSite(resultUrl: string, siteUrl: string): boolean {
  const need = siteHost(siteUrl);
  const got = siteHost(resultUrl);
  if (!need || !got) return false;
  return got === need || got.endsWith('.' + need);
}

export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    u.hash = '';
    u.hostname = u.hostname.replace(/^www\./i, '').toLowerCase();
    for (const p of [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'gclid', 'fbclid',
    ]) {
      u.searchParams.delete(p);
    }
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const search = u.searchParams.toString();
    return `${u.protocol}//${u.hostname}${path}${search ? `?${search}` : ''}`;
  } catch {
    return url.trim();
  }
}

export function tokenize(raw: string): Set<string> {
  const folded = String(raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const out = new Set<string>();
  for (const part of folded.split(/[^a-z0-9]+/)) {
    if (part.length >= 3 && !STOP_TOKENS.has(part)) out.add(part);
  }
  return out;
}

export function urlPathForTokens(url: string): string {
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    return decodeURIComponent(u.pathname);
  } catch {
    return url;
  }
}

export function tokenOverlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

export function significantTokenOverlap(a: Set<string>, b: Set<string>): boolean {
  const n = tokenOverlapCount(a, b);
  if (n >= 2) return true;
  const denom = Math.min(a.size, b.size);
  return denom > 0 && n >= 1 && n / denom >= 0.5;
}

/** Same-intent cluster via token overlap of URL paths (and keyword). No LLM. */
export function sameIntentCluster(keyword: string, urls: string[]): boolean {
  if (urls.length < 2) return false;
  const kw = tokenize(keyword);
  const sets = urls.map((u) => tokenize(urlPathForTokens(u)));
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i];
      const b = sets[j];
      if (a && b && significantTokenOverlap(a, b)) return true;
    }
  }
  return kw.size > 0 && sets.every((s) => significantTokenOverlap(s, kw));
}

export function recommendationFor(
  severity: CannibalizationSeverity,
): CannibalizationRecommendation {
  if (severity === 'HIGH') return 'consolidate into stronger URL';
  if (severity === 'MEDIUM') return 'internal-link from weaker to stronger';
  return 'differentiate intent';
}

/**
 * (a) both URLs top-20 = HIGH
 * (b) one top-10 + one 11–30 = MEDIUM
 * (c) both below 30 + same intent cluster = LOW
 */
export function classifySeverity(
  positions: number[],
  keyword: string,
  urls: string[],
): CannibalizationSeverity | null {
  const pos = positions.filter((p) => Number.isFinite(p) && p >= 1 && p <= 100);
  if (pos.length < 2 || urls.length < 2) return null;
  const top20 = pos.filter((p) => p <= 20);
  if (top20.length >= 2) return 'HIGH';
  const top10 = pos.filter((p) => p <= 10);
  const mid = pos.filter((p) => p >= 11 && p <= 30);
  if (top10.length >= 1 && mid.length >= 1) return 'MEDIUM';
  if (pos.every((p) => p > 30) && sameIntentCluster(keyword, urls)) return 'LOW';
  return null;
}

type Json = Record<string, unknown>;

function asJson(v: unknown): Json | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
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

export function extractSiteHitsFromRawResponse(raw: unknown, siteUrl: string): SiteUrlHit[] {
  const hits: SiteUrlHit[] = [];
  for (const row of collectItemArrays(raw)) {
    if (row['type'] && row['type'] !== 'organic') continue;
    const url = typeof row['url'] === 'string' ? row['url'] : '';
    if (!url || !urlMatchesSite(url, siteUrl)) continue;
    const position = positionFromOrganicItem(row);
    if (position == null) continue;
    hits.push({ url: canonicalizeUrl(url), position });
  }
  return hits;
}

export function hitsFromSnapshot(snap: RankSnapshotInput, siteUrl: string): SiteUrlHit[] {
  const fromRaw = extractSiteHitsFromRawResponse(snap.raw_response, siteUrl);
  if (fromRaw.length > 0) return fromRaw;
  const url = snap.ranking_url;
  const pos = snap.rank_absolute;
  if (url && typeof pos === 'number' && pos >= 1 && pos <= 100 && urlMatchesSite(url, siteUrl)) {
    return [{ url: canonicalizeUrl(url), position: pos }];
  }
  return [];
}

export function sortKeywordsByFreshness(
  keywords: RankKeywordInput[],
  snapshots: RankSnapshotInput[],
): RankKeywordInput[] {
  const latest = new Map<string, number>();
  for (const s of snapshots) {
    const t = new Date(s.checked_at).getTime();
    if (!Number.isFinite(t)) continue;
    const cur = latest.get(s.keyword_id) ?? 0;
    if (t > cur) latest.set(s.keyword_id, t);
  }
  return [...keywords].sort((a, b) => (latest.get(b.id) ?? 0) - (latest.get(a.id) ?? 0));
}

export function analyzeStoredSnapshots(opts: {
  keywords: RankKeywordInput[];
  snapshots: RankSnapshotInput[];
  siteUrl: string;
  days: number;
  now?: Date;
  limit?: number;
}): CannibalizationItem[] {
  const now = opts.now ?? new Date();
  const since = now.getTime() - clampDays(opts.days) * 864e5;
  const phraseById = new Map(opts.keywords.map((k) => [k.id, k.phrase]));
  const best = new Map<string, Map<string, number>>();

  for (const snap of opts.snapshots) {
    if (snap.status && snap.status !== 'completed') continue;
    const checked = new Date(snap.checked_at).getTime();
    if (!Number.isFinite(checked) || checked < since) continue;
    const phrase = phraseById.get(snap.keyword_id);
    if (!phrase) continue;
    let urlMap = best.get(phrase);
    if (!urlMap) {
      urlMap = new Map();
      best.set(phrase, urlMap);
    }
    for (const hit of hitsFromSnapshot(snap, opts.siteUrl)) {
      const cur = urlMap.get(hit.url);
      if (cur == null || hit.position < cur) urlMap.set(hit.url, hit.position);
    }
  }

  const items: CannibalizationItem[] = [];
  for (const [keyword, urlMap] of best) {
    if (urlMap.size < 2) continue;
    const pairs = [...urlMap.entries()]
      .filter(([, p]) => p >= 1 && p <= 100)
      .sort((a, b) => a[1] - b[1]);
    if (pairs.length < 2) continue;
    const urls = pairs.map(([u]) => u);
    const positions = pairs.map(([, p]) => p);
    const severity = classifySeverity(positions, keyword, urls);
    if (!severity) continue;
    items.push({
      keyword,
      urls,
      best_position_each: positions,
      severity,
      recommendation: recommendationFor(severity),
    });
  }

  items.sort((a, b) => {
    const sr = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sr !== 0) return sr;
    return (a.best_position_each[0] ?? 99) - (b.best_position_each[0] ?? 99);
  });

  const limit = clampLimit(opts.limit, items.length || 25);
  return items.slice(0, limit);
}

export function emptyEngineResponse(
  siteId: string,
  engine: string,
  days: number,
  cap: number,
): CannibalizationResponse {
  return {
    ok: true,
    dry_run: false,
    executed: false,
    mode: 'stored',
    site_id: siteId,
    engine,
    days,
    cost_usd: 0,
    max_keywords_per_check: cap,
    keywords_total: 0,
    keywords_capped: false,
    keywords_considered: 0,
    items: [],
    data_source: 'serp_rank_snapshots',
    note:
      'Only Google organic rank snapshots are stored today. Other engines and GSC query×page (PR #51) are future enhancements.',
  };
}

/**
 * Core action. dry_run=true never calls refreshSerp (no SERP, no writes).
 * Default mode reads stored snapshots only and always returns cost_usd: 0.
 */
export async function executeCannibalization(
  input: ExecuteCannibalizationInput,
): Promise<CannibalizationResponse> {
  const engine = (input.engine || DEFAULT_ENGINE).toLowerCase();
  const days = clampDays(input.days);
  const cap = resolveMaxKeywordsPerCheck(input.maxKeywordsPerCheck);
  const mode = resolveExecutionMode(!!input.refresh, !!input.dryRun);
  const estimateUsd = input.estimateUsdPerKeyword ?? DEFAULT_SERP_ESTIMATE_USD;

  if (engine !== 'google') {
    return emptyEngineResponse(input.siteId, engine, days, cap);
  }

  const ordered = sortKeywordsByFreshness(input.keywords, input.snapshots);
  const { selected, capped, total } = applyKeywordCap(ordered, cap);

  if (mode === 'dry_run') {
    return {
      ok: true,
      dry_run: true,
      executed: false,
      mode: 'dry_run',
      site_id: input.siteId,
      engine,
      days,
      keyword_count: selected.length,
      estimated_usd: estimateRefreshUsd(selected.length, estimateUsd),
      cost_usd: 0,
      max_keywords_per_check: cap,
      keywords_total: total,
      keywords_capped: capped,
      keywords_considered: selected.length,
      items: [],
      data_source: 'serp_rank_snapshots',
    };
  }

  let snapshots = input.snapshots;
  let costUsd = 0;

  if (mode === 'refresh') {
    if (typeof input.refreshSerp !== 'function') {
      throw new Error('refreshSerp is required when refresh=true');
    }
    const refreshed = await input.refreshSerp(selected);
    costUsd = Number(refreshed.costUsd) || 0;
    snapshots = [...snapshots, ...refreshed.snapshots];
  }

  const items = analyzeStoredSnapshots({
    keywords: selected,
    snapshots,
    siteUrl: input.siteUrl,
    days,
    now: input.now,
    limit: input.limit,
  });

  return {
    ok: true,
    dry_run: false,
    executed: mode === 'refresh',
    mode,
    site_id: input.siteId,
    engine,
    days,
    cost_usd: mode === 'stored' ? 0 : Math.round(costUsd * 1_000_000) / 1_000_000,
    max_keywords_per_check: cap,
    keywords_total: total,
    keywords_capped: capped,
    keywords_considered: selected.length,
    items,
    data_source: 'serp_rank_snapshots',
  };
}

export function buildSerpTasks(
  keywords: RankKeywordInput[],
  locationCode: number,
  languageCode: string,
): Array<Record<string, unknown>> {
  return keywords.map((k) => ({
    keyword: k.phrase,
    location_code: locationCode,
    language_code: languageCode,
    depth: 100,
    device: 'desktop',
    os: 'windows',
  }));
}

function basicAuthHeader(login: string, password: string): string {
  const raw = `${login}:${password}`;
  if (typeof btoa === 'function') return `Basic ${btoa(raw)}`;
  const encoded = typeof Buffer !== 'undefined'
    ? Buffer.from(raw, 'utf8').toString('base64')
    : raw;
  return `Basic ${encoded}`;
}

/**
 * ONE batched DataForSEO SERP call for the given keywords. Caller is responsible
 * for persisting snapshots / spend. Used only when refresh=true and dry_run=false.
 */
export async function refreshKeywordsViaSerp(opts: {
  fetchFn: typeof fetch;
  login: string;
  password: string;
  keywords: RankKeywordInput[];
  languageCode: string;
  locationCode: number;
  siteUrl: string;
  now?: Date;
}): Promise<RefreshSerpResult> {
  if (opts.keywords.length === 0) {
    return { costUsd: 0, snapshots: [], httpCalls: 0 };
  }

  const res = await opts.fetchFn(DATAFORSEO_SERP_LIVE_ADVANCED, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(opts.login, opts.password),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildSerpTasks(opts.keywords, opts.locationCode, opts.languageCode)),
  });

  let json: Json = {};
  try {
    json = (await res.json()) as Json;
  } catch {
    throw new Error('DataForSEO SERP response not JSON');
  }

  const tasks = Array.isArray(json['tasks']) ? (json['tasks'] as Json[]) : [];
  const topCost = Number(json['cost']) || 0;
  let costUsd = topCost;
  const nowIso = (opts.now ?? new Date()).toISOString();
  const snapshots: RankSnapshotInput[] = [];

  for (let i = 0; i < opts.keywords.length; i++) {
    const kw = opts.keywords[i];
    if (!kw) continue;
    const task = asJson(tasks[i]) ?? {};
    const taskCost = Number(task['cost']);
    if (Number.isFinite(taskCost) && taskCost > 0 && !topCost) {
      costUsd += taskCost;
    }
    const statusCode = task['status_code'];
    const ok = statusCode === 20000 || statusCode == null;
    const hits = extractSiteHitsFromRawResponse(task, opts.siteUrl);
    const best = hits.slice().sort((a, b) => a.position - b.position)[0];
    snapshots.push({
      keyword_id: kw.id,
      rank_absolute: best?.position ?? null,
      ranking_url: best?.url ?? null,
      raw_response: task,
      status: ok ? 'completed' : 'failed',
      checked_at: nowIso,
    });
  }

  if (!topCost) {
    costUsd = tasks.reduce((sum, t) => sum + (Number(asJson(t)?.['cost']) || 0), 0);
  }

  return { costUsd, snapshots, httpCalls: 1 };
}

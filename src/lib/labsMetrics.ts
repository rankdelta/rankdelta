/**
 * Parse ranking / keyword fields that DataForSEO already returns on the Labs
 * calls Site Explorer and Keyword Research make. No extra paid request —
 * we were dropping position distribution, rank deltas, volume trend and SERP
 * feature flags on the floor.
 */

export type Dict = Record<string, unknown>;

export const asDict = (v: unknown): Dict => (v as Dict) ?? {};
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export const bool = (v: unknown): boolean => v === true;

export interface PosDistribution {
  pos1: number;
  pos2_3: number;
  pos4_10: number;
  pos11_20: number;
  pos21plus: number;
  isNew: number | null;
  isUp: number | null;
  isDown: number | null;
  isLost: number | null;
}

const POS_21 = [
  'pos_21_30', 'pos_31_40', 'pos_41_50', 'pos_51_60',
  'pos_61_70', 'pos_71_80', 'pos_81_90', 'pos_91_100',
] as const;

/** Full-index position buckets from domain_rank_overview `metrics.organic`. */
export function posDistribution(organic: Dict): PosDistribution {
  const n = (k: string) => Math.max(0, Math.round(num(organic[k]) ?? 0));
  return {
    pos1: n('pos_1'),
    pos2_3: n('pos_2_3'),
    pos4_10: n('pos_4_10'),
    pos11_20: n('pos_11_20'),
    pos21plus: POS_21.reduce((s, k) => s + n(k), 0),
    isNew: num(organic['is_new']),
    isUp: num(organic['is_up']),
    isDown: num(organic['is_down']),
    isLost: num(organic['is_lost']),
  };
}

export function posDistributionTotal(p: PosDistribution): number {
  return p.pos1 + p.pos2_3 + p.pos4_10 + p.pos11_20 + p.pos21plus;
}

export interface RankDelta {
  previous: number | null;
  /** previous − current; positive = moved up (Ahrefs/Semrush convention). */
  delta: number | null;
  isNew: boolean;
  isUp: boolean;
  isDown: boolean;
}

/** Rank movement from `ranked_serp_element.serp_item.rank_changes`. */
export function rankDeltaOf(serp: Dict, current: number | null): RankDelta {
  const ch = asDict(serp['rank_changes']);
  const previous = num(ch['previous_rank_absolute']) ?? num(ch['previous_rank_group']);
  const isNew = bool(ch['is_new']);
  const isUp = bool(ch['is_up']);
  const isDown = bool(ch['is_down']);
  let delta: number | null = null;
  if (previous != null && current != null) delta = previous - current;
  return { previous, delta, isNew, isUp, isDown };
}

export type SerpFeature = 'snippet' | 'video' | 'image' | 'news' | 'shopping' | 'paa' | 'local' | 'ai' | 'kg';

/** Read a SERP item flag from `checks`, falling back to legacy top-level booleans. */
function serpCheck(serp: Dict, key: string): boolean {
  const checks = serp['checks'];
  if (checks != null && typeof checks === 'object' && key in (checks as Dict)) {
    return bool((checks as Dict)[key]);
  }
  return bool(serp[key]);
}

/** Feature flags already on the ranked SERP element. */
export function serpItemFeatures(serp: Dict): SerpFeature[] {
  const out: SerpFeature[] = [];
  if (serpCheck(serp, 'is_featured_snippet') || str(serp['type']) === 'featured_snippet') out.push('snippet');
  if (serpCheck(serp, 'is_video')) out.push('video');
  if (serpCheck(serp, 'is_image')) out.push('image');
  if (serpCheck(serp, 'is_news')) out.push('news');
  if (serpCheck(serp, 'is_shop') || serpCheck(serp, 'is_shopping')) out.push('shopping');
  return out;
}

const SERP_TYPE_FEATURE: Record<string, SerpFeature> = {
  featured_snippet: 'snippet',
  answer_box: 'snippet',
  video: 'video',
  videos: 'video',
  images: 'image',
  image: 'image',
  top_stories: 'news',
  news: 'news',
  shopping: 'shopping',
  popular_products: 'shopping',
  people_also_ask: 'paa',
  local_pack: 'local',
  maps: 'local',
  local_services: 'local',
  ai_overview: 'ai',
  google_ai_overview: 'ai',
  knowledge_graph: 'kg',
  knowledge_panel: 'kg',
};

/**
 * Keyword Labs `serp_info.serp_item_types` — the SERP-feature column Semrush/Ahrefs
 * show on ideas, already on keyword_suggestions (no live SERP call).
 */
export function serpTypesToFeatures(raw: unknown): SerpFeature[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<SerpFeature>();
  const out: SerpFeature[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const f = SERP_TYPE_FEATURE[v];
    if (!f || seen.has(f)) continue;
    seen.add(f);
    out.push(f);
  }
  return out;
}

/** Prefer `competition_index` (0–100) when Labs sent it; else the 0–1 `competition` float. */
export function competitionOf(keywordInfo: Dict): number | null {
  return num(keywordInfo['competition_index']) ?? num(keywordInfo['competition']);
}

/** Last 12 monthly search volumes, oldest → newest. */
export function monthlyVolumes(keywordInfo: Dict): number[] {
  const raw = keywordInfo['monthly_searches'];
  if (!Array.isArray(raw)) return [];
  const rows = raw
    .map((x) => {
      const d = asDict(x);
      const y = num(d['year']) ?? 0;
      const m = num(d['month']) ?? 0;
      const v = num(d['search_volume']);
      return { sort: y * 100 + m, v: v ?? 0 };
    })
    .filter((r) => r.sort > 0)
    .sort((a, b) => a.sort - b.sort);
  return rows.map((r) => r.v).slice(-12);
}

export function competitionPct(competition: number | null | undefined): number | null {
  if (competition == null || Number.isNaN(competition)) return null;
  const pct = competition <= 1 ? competition * 100 : competition;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * Parse a DataForSEO SERP advanced `items` array into the organic list plus
 * features that the same response already contains (PAA, related, snippet, ads).
 * No extra API call — callers were previously dropping everything except organic.
 */

export interface SerpSitelink { title: string; url: string }
export interface SerpOrganic {
  position: number | null;
  domain: string | null;
  title: string | null;
  url: string | null;
  snippet: string | null;
  sitelinks: SerpSitelink[];
}

/** Live SERP feature types already in the advanced payload (no extra call). */
export type LiveSerpFeature =
  | 'ai_overview'
  | 'knowledge_graph'
  | 'local_pack'
  | 'images'
  | 'video'
  | 'top_stories'
  | 'discussions';
export interface SerpFeatured {
  title: string | null;
  url: string | null;
  snippet: string | null;
}
export interface SerpSnapshot {
  organic: SerpOrganic[];
  paa: string[];
  related: string[];
  featured: SerpFeatured | null;
  ads: number;
  features: LiveSerpFeature[];
}

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v as Dict) ?? {};
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

function sitelinksOf(it: Dict): SerpSitelink[] {
  const raw = it['links'] ?? it['sitelinks'];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      const d = asDict(x);
      const title = str(d['title']) ?? str(d['description']) ?? '';
      const url = str(d['url']) ?? '';
      return { title, url };
    })
    .filter((s) => s.url || s.title)
    .slice(0, 4);
}

export function parseSerpAdvanced(items: unknown[]): SerpSnapshot {
  const organic: SerpOrganic[] = [];
  const paa: string[] = [];
  const related: string[] = [];
  const features = new Set<LiveSerpFeature>();
  let featured: SerpFeatured | null = null;
  let ads = 0;

  const FEATURE_TYPE: Record<string, LiveSerpFeature> = {
    ai_overview: 'ai_overview',
    google_ai_overview: 'ai_overview',
    knowledge_graph: 'knowledge_graph',
    local_pack: 'local_pack',
    maps: 'local_pack',
    images: 'images',
    video: 'video',
    top_stories: 'top_stories',
    discussions_and_forums: 'discussions',
    discuss: 'discussions',
  };

  for (const raw of items) {
    const it = asDict(raw);
    const type = str(it['type']) ?? '';
    const feat = FEATURE_TYPE[type];
    if (feat) features.add(feat);
    if (type === 'organic') {
      organic.push({
        position: num(it['rank_group']),
        domain: str(it['domain']),
        title: str(it['title']),
        url: str(it['url']),
        snippet: str(it['description']) ?? str(it['snippet']),
        sitelinks: sitelinksOf(it),
      });
    } else if (type === 'people_also_ask') {
      const nested = Array.isArray(it['items']) ? it['items'] : [];
      for (const p of nested) {
        const d = asDict(p);
        const q = str(d['title']) ?? str(d['question']);
        if (q) paa.push(q);
      }
    } else if (type === 'related_searches') {
      const nested = Array.isArray(it['items']) ? it['items'] : [];
      for (const p of nested) {
        const d = asDict(p);
        const q = str(d['title']) ?? str(d['query']);
        if (q) related.push(q);
      }
    } else if ((type === 'featured_snippet' || type === 'answer_box') && !featured) {
      featured = {
        title: str(it['title']),
        url: str(it['url']),
        snippet: str(it['description']) ?? str(it['text']),
      };
    } else if (type === 'paid' || type === 'ads_top' || type === 'ads_bottom') {
      ads += Array.isArray(it['items']) ? it['items'].length : 1;
    }
  }

  return {
    organic: organic.slice(0, 10),
    paa: paa.slice(0, 8),
    related: related.slice(0, 10),
    featured,
    ads,
    features: [...features],
  };
}

/**
 * serpClusters — SERP-based keyword clustering (Keyword Insights style).
 *
 * Groups keywords by how many URLs their top-N organic SERPs share: two keywords that surface
 * the same pages are the same search intent and should live on one page. This is the accurate
 * method (unlike the free lexical grouping in `keywordClusters.ts`, which only matches shared
 * words) — at the cost of one SERP lookup per keyword. The fetch/cost lives in the caller (routed
 * through seo-proxy, so it inherits the account spend cap + plan lookup quota); THIS module is a
 * pure, deterministic, network-free function so it is cheap to test and reuse (UI + MCP tool).
 *
 * Three linkage modes, matching the tools people know:
 *   - 'centroid'  (default): a keyword joins the first cluster whose PIVOT (highest-volume member)
 *                 shares >= minShared URLs with it. Fast, balanced, stable — the sensible default.
 *   - 'connected' (loose):   union-find over every pair sharing >= minShared. Transitive, so it
 *                 produces fewer/larger clusters (A~B, B~C ⇒ A,B,C together even if A⊥C).
 *   - 'complete'  (hard):    a keyword joins a cluster only if it shares >= minShared with EVERY
 *                 member. Strictest — tight, high-precision clusters, more singletons.
 */

export interface SerpClusterInput {
  keyword: string
  volume?: number | null
  difficulty?: number | null
  /** Top organic result URLs for this keyword's SERP, best-rank first. */
  urls: string[]
}

export interface SerpCluster {
  /** Primary keyword — the highest-volume member; represents the cluster. */
  pivot: string
  /** Members, pivot first, then by descending volume. */
  keywords: SerpClusterInput[]
  /** Sum of member volumes (nulls treated as 0). */
  totalVolume: number
  size: number
}

export type ClusterMethod = 'centroid' | 'connected' | 'complete'

export interface SerpClusterOptions {
  /** Minimum shared URLs for two keywords to be considered the same intent. Default 3. */
  minShared?: number
  /** Linkage strategy. Default 'centroid'. */
  method?: ClusterMethod
  /** Only compare the first N URLs of each SERP (top-N). Default 10. */
  topN?: number
}

/** Normalize a result URL so the same page compares equal across keywords: drop protocol, a
 *  leading www., the query string, the fragment, and any trailing slash; lowercase the host+path. */
export function normalizeSerpUrl(raw: string): string {
  let u = String(raw || '').trim().toLowerCase()
  if (!u) return ''
  u = u.replace(/^https?:\/\//, '').replace(/^www\./, '')
  u = (u.split('#')[0] ?? '').split('?')[0] ?? ''
  u = u.replace(/\/+$/, '')
  return u
}

const vol = (i: SerpClusterInput): number => (typeof i.volume === 'number' && i.volume > 0 ? i.volume : 0)

function shared(a: Set<string>, b: Set<string>): number {
  // Iterate the smaller set for speed.
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  let n = 0
  for (const url of small) if (url && big.has(url)) n++
  return n
}

function makeCluster(members: SerpClusterInput[]): SerpCluster {
  const sorted = [...members].sort((x, y) => vol(y) - vol(x))
  return {
    pivot: sorted[0]?.keyword ?? '',
    keywords: sorted,
    totalVolume: sorted.reduce((s, m) => s + vol(m), 0),
    size: sorted.length,
  }
}

/**
 * Cluster keywords by shared SERP URLs. Pure and deterministic: same input + options ⇒ same
 * output (clusters sorted by descending total volume; members by descending volume, pivot first).
 * A keyword with an empty SERP can never meet the threshold, so it stays a singleton cluster.
 */
export function clusterKeywordsBySerp(
  inputs: SerpClusterInput[],
  options: SerpClusterOptions = {},
): SerpCluster[] {
  const minShared = Math.max(1, Math.floor(options.minShared ?? 3))
  const method: ClusterMethod = options.method ?? 'centroid'
  const topN = Math.max(1, Math.floor(options.topN ?? 10))

  // Precompute a normalized top-N URL set per keyword, in stable input order.
  const items = inputs.map((it) => ({
    input: it,
    urls: new Set((it.urls || []).slice(0, topN).map(normalizeSerpUrl).filter(Boolean)),
  }))

  if (method === 'connected') {
    // Union-find over pairs sharing >= minShared.
    const parent = items.map((_, i) => i)
    const find = (x: number): number => {
      let root = x
      while (parent[root] !== root) root = parent[root]!
      // Path compression.
      while (parent[x] !== root) { const next = parent[x]!; parent[x] = root; x = next }
      return root
    }
    const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
    for (let i = 0; i < items.length; i++) {
      const a = items[i]!
      for (let j = i + 1; j < items.length; j++) {
        if (shared(a.urls, items[j]!.urls) >= minShared) union(i, j)
      }
    }
    const groups = new Map<number, SerpClusterInput[]>()
    for (let i = 0; i < items.length; i++) {
      const r = find(i)
      const arr = groups.get(r) ?? []
      arr.push(items[i]!.input)
      groups.set(r, arr)
    }
    return finalize([...groups.values()])
  }

  // 'centroid' and 'complete' both grow clusters greedily over volume-sorted keywords.
  const order = items
    .map((it, idx) => ({ it, idx }))
    .sort((a, b) => vol(b.it.input) - vol(a.it.input) || a.idx - b.idx)

  const clusters: { members: { input: SerpClusterInput; urls: Set<string> }[] }[] = []
  for (const { it } of order) {
    let target: (typeof clusters)[number] | null = null
    for (const c of clusters) {
      const pivot = c.members[0]! // clusters always have >= 1 member; pivot = first added = highest volume
      const ok = method === 'complete'
        ? c.members.every((m) => shared(m.urls, it.urls) >= minShared)
        : shared(pivot.urls, it.urls) >= minShared // centroid: compare only to the pivot
      if (ok) { target = c; break }
    }
    if (target) target.members.push({ input: it.input, urls: it.urls })
    else clusters.push({ members: [{ input: it.input, urls: it.urls }] })
  }
  return finalize(clusters.map((c) => c.members.map((m) => m.input)))
}

function finalize(groups: SerpClusterInput[][]): SerpCluster[] {
  return groups.map(makeCluster).sort((a, b) => b.totalVolume - a.totalVolume || b.size - a.size)
}

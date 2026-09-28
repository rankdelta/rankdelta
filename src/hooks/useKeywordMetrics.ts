/**
 * useKeywordMetrics — real Google search volume + keyword difficulty, DB-cached.
 *
 * Search volume changes slowly (monthly), so we keep a SHARED `keyword_metrics` cache in Postgres:
 *   1. read whatever is already cached for these keywords + locale,
 *   2. call DataForSEO ONLY for the missing/stale (>30d) ones (2 bulk calls, batched),
 *   3. upsert the fresh values back.
 * Net effect: each keyword costs one DataForSEO lookup ~per month instead of per page view, and the
 * common case (cache hit) is instant and free. Cost-aware by construction.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { getEnrichedKeywordData, resolveLocale } from '../services/dataforseo'
import { isProxyEnabled, proxyKeywordMetricsUpsert } from '../services/edgeProxy'

export interface KeywordMetric {
  volume: number
  difficulty?: number
}

const MAX_KEYWORDS = 50
const TTL_MS = 30 * 24 * 60 * 60 * 1000 // volume is stable month-to-month

interface CacheRow {
  keyword: string
  volume: number
  difficulty: number | null
  fetched_at: string
}

async function getCachedOrFetch(
  keywords: string[],
  locationCode: number,
  languageCode: string,
): Promise<Map<string, KeywordMetric>> {
  const out = new Map<string, KeywordMetric>()
  if (keywords.length === 0) return out

  // 1. Read the shared cache.
  const { data } = await supabase
    .from('keyword_metrics')
    .select('keyword, volume, difficulty, fetched_at')
    .eq('location_code', locationCode)
    .eq('language_code', languageCode)
    .in('keyword', keywords)
  const cached = new Map<string, CacheRow>((data ?? []).map((r) => [(r as CacheRow).keyword, r as CacheRow]))

  const now = Date.now()
  const stale: string[] = []
  for (const kw of keywords) {
    const row = cached.get(kw)
    if (row && now - new Date(row.fetched_at).getTime() < TTL_MS) {
      out.set(kw, { volume: row.volume, difficulty: row.difficulty ?? undefined })
    } else {
      stale.push(kw)
    }
  }

  // 2. Fetch only what's missing/stale (2 bulk DataForSEO calls), then 3. write it back.
  if (stale.length > 0) {
    try {
      const rows = await getEnrichedKeywordData(stale, locationCode, languageCode)
      const upserts = rows.map((r) => ({
        keyword: r.keyword.toLowerCase(),
        location_code: locationCode,
        language_code: languageCode,
        volume: r.search_volume ?? 0,
        difficulty: r.difficulty ?? null,
        fetched_at: new Date().toISOString(),
      }))
      for (const r of rows) out.set(r.keyword.toLowerCase(), { volume: r.search_volume ?? 0, difficulty: r.difficulty })
      if (upserts.length > 0) {
        // Writes go through seo-proxy (service_role). Direct client upserts are blocked by RLS.
        if (isProxyEnabled()) {
          await proxyKeywordMetricsUpsert(upserts)
        }
      }
    } catch {
      /* DataForSEO unavailable / plan without keyword data → just return whatever was cached */
    }
  }

  return out
}

export function useKeywordMetrics(keywords: string[], market?: string | null, language?: string | null) {
  const unique = Array.from(
    new Set(keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length > 1)),
  ).slice(0, MAX_KEYWORDS)
  const { locationCode, languageCode } = resolveLocale(market, language)

  return useQuery({
    queryKey: ['kwMetrics', locationCode, languageCode, unique.slice().sort().join('|')],
    enabled: unique.length > 0,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
    queryFn: () => getCachedOrFetch(unique, locationCode, languageCode),
  })
}

/** "1.2k", "920", "—". */
export function formatVolume(v: number | undefined): string {
  if (v == null || v <= 0) return '—'
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
  return String(v)
}

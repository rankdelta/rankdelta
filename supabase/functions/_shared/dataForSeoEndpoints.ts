/**
 * DataForSEO endpoints seo-proxy forwards: the exact ones the app, the MCP server and the self-host
 * smoke test call — every one a `live` (or instant) endpoint priced per call.
 *
 * It used to be a prefix list (/serp/, /backlinks/, /on_page/…), which also let any account reach
 * task_post endpoints, on_page crawls with a caller-chosen max_crawl_pages and other calls whose
 * cost the 10¢ pre-reservation does not cover. A new endpoint is added here on purpose, with the
 * feature that uses it.
 */
export const DATAFORSEO_ALLOWED_ENDPOINTS: ReadonlySet<string> = new Set([
  // SERP
  '/serp/google/organic/live/advanced',
  // Keywords
  '/keywords_data/google_ads/search_volume/live',
  '/dataforseo_labs/google/keyword_suggestions/live',
  '/dataforseo_labs/google/keyword_ideas/live',
  '/dataforseo_labs/google/bulk_keyword_difficulty/live',
  // Domains / pages
  '/dataforseo_labs/google/ranked_keywords/live',
  '/dataforseo_labs/google/domain_rank_overview/live',
  '/dataforseo_labs/google/historical_rank_overview/live',
  '/dataforseo_labs/google/competitors_domain/live',
  '/dataforseo_labs/google/relevant_pages/live',
  '/dataforseo_labs/google/bulk_traffic_estimation/live',
  // Backlinks
  '/backlinks/summary/live',
  '/backlinks/referring_domains/live',
  '/backlinks/backlinks/live',
  '/backlinks/anchors/live',
  '/backlinks/timeseries_new_lost_summary/live',
  '/backlinks/domain_intersection/live',
  '/backlinks/bulk_ranks/live',
  '/backlinks/bulk_backlinks/live',
  '/backlinks/bulk_referring_domains/live',
  // On-page (single page, synchronous)
  '/on_page/instant_pages',
])

export function isAllowedDataForSeoEndpoint(endpoint: unknown): endpoint is string {
  return typeof endpoint === 'string' && DATAFORSEO_ALLOWED_ENDPOINTS.has(endpoint)
}

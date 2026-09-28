/**
 * Live, read-only Google Search Console calls for the MCP, with the project's stored grant
 * (webmasters.readonly). The nightly cache covers 7/28/90-day overviews; agents diagnosing a site
 * also need the full 16-month history with any dimension, per-URL index status and sitemaps.
 *
 * What Google does NOT expose through any API: manual actions, security issues, the Page
 * indexing (coverage) report as a whole, Core Web Vitals and link reports. Tools say so, so an
 * agent doesn't go looking.
 *
 * Request building and response trimming are pure and unit-tested; the fetches are thin.
 */

export const GSC_HISTORY_MONTHS = 16
export const GSC_MAX_ROWS = 25_000
const GSC_TIMEOUT_MS = 25_000

export const SEARCH_DIMENSIONS = ['query', 'page', 'country', 'device', 'date', 'searchAppearance'] as const
export const SEARCH_TYPES = ['web', 'image', 'video', 'news', 'discover', 'googleNews'] as const
const FILTER_OPERATORS = ['equals', 'notEquals', 'contains', 'notContains', 'includingRegex', 'excludingRegex'] as const

type Dimension = (typeof SEARCH_DIMENSIONS)[number]

export type SearchAnalyticsRequest = {
  startDate: string
  endDate: string
  dimensions: Dimension[]
  type: string
  rowLimit: number
  startRow: number
  dataState: 'final' | 'all'
  dimensionFilterGroups?: Array<{ groupType: 'and'; filters: Array<{ dimension: string; operator: string; expression: string }> }>
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Validate an agent's arguments into a Search Analytics request, or explain what to change. */
export function buildSearchAnalyticsRequest(
  args: Record<string, unknown>,
  today: Date = new Date(),
): { ok: true; request: SearchAnalyticsRequest } | { ok: false; error: string; message: string } {
  const bad = (message: string) => ({ ok: false as const, error: 'invalid_arguments', message })

  const endDefault = new Date(today.getTime() - 2 * 86_400_000) // GSC data lags ~2 days
  const endDate = typeof args.end_date === 'string' && args.end_date ? args.end_date : isoDay(endDefault)
  const startDate =
    typeof args.start_date === 'string' && args.start_date
      ? args.start_date
      : isoDay(new Date(new Date(`${endDate}T00:00:00Z`).getTime() - 27 * 86_400_000))
  if (!ISO_DAY.test(startDate) || !ISO_DAY.test(endDate)) return bad('Dates must be YYYY-MM-DD.')
  if (startDate > endDate) return bad('start_date must be on or before end_date.')
  const oldest = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - GSC_HISTORY_MONTHS, today.getUTCDate()))
  if (startDate < isoDay(oldest)) {
    return bad(`Search Console keeps ${GSC_HISTORY_MONTHS} months of data: start_date can't be before ${isoDay(oldest)}.`)
  }

  const rawDims = Array.isArray(args.dimensions) ? args.dimensions.map(String) : ['query']
  const dimensions = [...new Set(rawDims)] as Dimension[]
  const unknownDim = dimensions.find((d) => !(SEARCH_DIMENSIONS as readonly string[]).includes(d))
  if (unknownDim) return bad(`Unknown dimension "${unknownDim}". Use: ${SEARCH_DIMENSIONS.join(', ')}.`)

  const type = typeof args.search_type === 'string' && args.search_type ? args.search_type : 'web'
  if (!(SEARCH_TYPES as readonly string[]).includes(type)) return bad(`search_type must be one of: ${SEARCH_TYPES.join(', ')}.`)

  const rowLimit = Math.min(GSC_MAX_ROWS, Math.max(1, Math.floor(Number(args.row_limit ?? 1000)) || 1000))
  const startRow = Math.max(0, Math.floor(Number(args.start_row ?? 0)) || 0)
  const dataState = args.include_fresh_data === true ? 'all' : 'final'

  const request: SearchAnalyticsRequest = { startDate, endDate, dimensions, type, rowLimit, startRow, dataState }

  if (Array.isArray(args.filters) && args.filters.length > 0) {
    const filters: Array<{ dimension: string; operator: string; expression: string }> = []
    for (const f of args.filters.slice(0, 10)) {
      const o = (f ?? {}) as Record<string, unknown>
      const dimension = String(o.dimension ?? '')
      const operator = String(o.operator ?? 'equals')
      const expression = String(o.expression ?? '')
      if (!['query', 'page', 'country', 'device', 'searchAppearance'].includes(dimension)) {
        return bad(`Filter dimension "${dimension}" is not filterable. Use query, page, country, device or searchAppearance.`)
      }
      if (!(FILTER_OPERATORS as readonly string[]).includes(operator)) return bad(`Filter operator must be one of: ${FILTER_OPERATORS.join(', ')}.`)
      if (!expression) return bad('Every filter needs an expression.')
      filters.push({ dimension, operator, expression })
    }
    request.dimensionFilterGroups = [{ groupType: 'and', filters }]
  }
  return { ok: true, request }
}

type GscRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }

/** Rows keyed by dimension name, CTR as a percentage, position to one decimal. */
export function shapeSearchAnalyticsRows(dimensions: readonly string[], rows: readonly GscRow[]) {
  return rows.map((r) => {
    const out: Record<string, string | number> = {}
    dimensions.forEach((d, i) => {
      out[d] = r.keys?.[i] ?? ''
    })
    out.clicks = r.clicks
    out.impressions = r.impressions
    out.ctr_percent = Math.round(r.ctr * 10_000) / 100
    out.position = Math.round(r.position * 10) / 10
    return out
  })
}

/** The parts of a URL Inspection result an agent needs, in plain field names. */
export function shapeInspection(result: Record<string, unknown> | null | undefined) {
  const r = (result ?? {}) as Record<string, Record<string, unknown> | undefined>
  const idx = r.indexStatusResult ?? {}
  const mobile = r.mobileUsabilityResult
  const rich = r.richResultsResult as { verdict?: string; detectedItems?: Array<{ richResultType?: string; items?: unknown[] }> } | undefined
  return {
    verdict: idx.verdict ?? null, // PASS (indexed) / NEUTRAL (excluded) / FAIL (error)
    coverage_state: idx.coverageState ?? null, // e.g. "Submitted and indexed", "Crawled - currently not indexed"
    indexing_state: idx.indexingState ?? null,
    robots_txt_state: idx.robotsTxtState ?? null,
    page_fetch_state: idx.pageFetchState ?? null,
    last_crawl_time: idx.lastCrawlTime ?? null,
    crawled_as: idx.crawledAs ?? null,
    google_canonical: idx.googleCanonical ?? null,
    user_canonical: idx.userCanonical ?? null,
    canonical_mismatch: !!idx.googleCanonical && !!idx.userCanonical && idx.googleCanonical !== idx.userCanonical,
    in_sitemaps: Array.isArray(idx.sitemap) ? idx.sitemap : [],
    referring_urls: Array.isArray(idx.referringUrls) ? (idx.referringUrls as unknown[]).slice(0, 10) : [],
    mobile_usability: mobile ? { verdict: mobile.verdict ?? null, issues: mobile.issues ?? [] } : null,
    rich_results: rich
      ? { verdict: rich.verdict ?? null, types: (rich.detectedItems ?? []).map((d) => d.richResultType).filter(Boolean) }
      : null,
    inspection_link: (r.inspectionResultLink as unknown as string) ?? null,
  }
}

async function googleFetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GSC_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`google_${res.status}: ${body.slice(0, 200)}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export async function querySearchAnalytics(token: string, siteUrl: string, request: SearchAnalyticsRequest) {
  const data = await googleFetch<{ rows?: GscRow[]; responseAggregationType?: string }>(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    token,
    { method: 'POST', body: JSON.stringify(request) },
  )
  return data.rows ?? []
}

export async function inspectUrl(token: string, siteUrl: string, url: string, languageCode = 'en-US') {
  const data = await googleFetch<{ inspectionResult?: Record<string, unknown> }>(
    'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
    token,
    { method: 'POST', body: JSON.stringify({ inspectionUrl: url, siteUrl, languageCode }) },
  )
  return data.inspectionResult ?? null
}

export async function listSitemaps(token: string, siteUrl: string) {
  const data = await googleFetch<{ sitemap?: Array<Record<string, unknown>> }>(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
    token,
  )
  return (data.sitemap ?? []).map((s) => ({
    path: s.path ?? null,
    type: s.type ?? null,
    last_submitted: s.lastSubmitted ?? null,
    last_downloaded: s.lastDownloaded ?? null,
    is_pending: s.isPending ?? false,
    is_index: s.isSitemapsIndex ?? false,
    errors: Number(s.errors ?? 0),
    warnings: Number(s.warnings ?? 0),
    contents: Array.isArray(s.contents) ? s.contents : [],
  }))
}

/** Is this URL inside the Search Console property (URL-prefix or sc-domain)? */
export function urlInProperty(url: string, siteUrl: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (siteUrl.startsWith('sc-domain:')) {
    const domain = siteUrl.slice('sc-domain:'.length).toLowerCase()
    const host = u.hostname.toLowerCase()
    return host === domain || host.endsWith(`.${domain}`)
  }
  return url.startsWith(siteUrl)
}

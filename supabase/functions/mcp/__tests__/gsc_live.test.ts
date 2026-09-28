/**
 * Live Search Console tools for agents (deno): request validation and response shaping.
 * Agents told us the MCP lacked history beyond 90 days and index status, so they opened Search
 * Console by hand; these tools read it live with the site's own read-only grant.
 */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  buildSearchAnalyticsRequest,
  shapeInspection,
  shapeSearchAnalyticsRows,
  urlInProperty,
} from '../../_shared/gscLive.ts'

const TODAY = new Date('2026-09-27T12:00:00Z')

Deno.test('defaults: last 28 final days ending 2 days ago, by query, web, 1000 rows', () => {
  const r = buildSearchAnalyticsRequest({}, TODAY)
  assert(r.ok)
  if (!r.ok) return
  assertEquals(r.request.endDate, '2026-09-25')
  assertEquals(r.request.startDate, '2026-08-29')
  assertEquals(r.request.dimensions, ['query'])
  assertEquals(r.request.type, 'web')
  assertEquals(r.request.rowLimit, 1000)
  assertEquals(r.request.dataState, 'final')
})

Deno.test('accepts a full 16-month history with dimensions, filters and paging', () => {
  const r = buildSearchAnalyticsRequest(
    {
      start_date: '2025-06-01',
      end_date: '2026-09-20',
      dimensions: ['date', 'page', 'date'],
      search_type: 'discover',
      filters: [{ dimension: 'page', operator: 'contains', expression: '/blog/' }],
      row_limit: 99999,
      start_row: 25000,
      include_fresh_data: true,
    },
    TODAY,
  )
  assert(r.ok)
  if (!r.ok) return
  assertEquals(r.request.dimensions, ['date', 'page'])
  assertEquals(r.request.rowLimit, 25000)
  assertEquals(r.request.startRow, 25000)
  assertEquals(r.request.dataState, 'all')
  assertEquals(r.request.dimensionFilterGroups, [
    { groupType: 'and', filters: [{ dimension: 'page', operator: 'contains', expression: '/blog/' }] },
  ])
})

Deno.test('explains what to fix instead of calling Google with a bad request', () => {
  const cases: Array<Record<string, unknown>> = [
    { start_date: '2024-01-01' }, // older than 16 months
    { start_date: '2026-09-10', end_date: '2026-09-01' },
    { start_date: '27/09/2026' },
    { dimensions: ['keyword'] },
    { search_type: 'shopping' },
    { filters: [{ dimension: 'date', expression: '2026-09-01' }] },
    { filters: [{ dimension: 'query', operator: 'like', expression: 'x' }] },
    { filters: [{ dimension: 'query' }] },
  ]
  for (const c of cases) {
    const r = buildSearchAnalyticsRequest(c, TODAY)
    assertEquals(r.ok, false, JSON.stringify(c))
    if (!r.ok) assert(r.message.length > 10)
  }
})

Deno.test('rows are keyed by dimension name, CTR as a percentage', () => {
  const rows = shapeSearchAnalyticsRows(['query', 'date'], [
    { keys: ['barocco noto', '2026-09-01'], clicks: 12, impressions: 400, ctr: 0.03, position: 4.26 },
  ])
  assertEquals(rows, [{ query: 'barocco noto', date: '2026-09-01', clicks: 12, impressions: 400, ctr_percent: 3, position: 4.3 }])
})

Deno.test('inspection result: index verdict, coverage and canonical mismatch in plain fields', () => {
  const shaped = shapeInspection({
    indexStatusResult: {
      verdict: 'NEUTRAL',
      coverageState: 'Crawled - currently not indexed',
      robotsTxtState: 'ALLOWED',
      lastCrawlTime: '2026-09-20T08:00:00Z',
      googleCanonical: 'https://example.com/a',
      userCanonical: 'https://example.com/a?ref=1',
      sitemap: ['https://example.com/sitemap.xml'],
    },
    mobileUsabilityResult: { verdict: 'PASS', issues: [] },
    richResultsResult: { verdict: 'PASS', detectedItems: [{ richResultType: 'FAQ', items: [] }] },
    inspectionResultLink: 'https://search.google.com/search-console/inspect?resource_id=x',
  })
  assertEquals(shaped.verdict, 'NEUTRAL')
  assertEquals(shaped.coverage_state, 'Crawled - currently not indexed')
  assertEquals(shaped.canonical_mismatch, true)
  assertEquals(shaped.in_sitemaps, ['https://example.com/sitemap.xml'])
  assertEquals(shaped.rich_results, { verdict: 'PASS', types: ['FAQ'] })
  assertEquals(shapeInspection(null).verdict, null)
})

Deno.test('a URL must belong to the property (domain or URL-prefix)', () => {
  assert(urlInProperty('https://blog.example.com/post', 'sc-domain:example.com'))
  assert(urlInProperty('https://example.com/', 'sc-domain:example.com'))
  assertEquals(urlInProperty('https://example.com.evil.io/', 'sc-domain:example.com'), false)
  assert(urlInProperty('https://www.example.com/it/pagina', 'https://www.example.com/'))
  assertEquals(urlInProperty('https://www.example.com.evil.io/', 'https://www.example.com/'), false)
  assertEquals(urlInProperty('not a url', 'sc-domain:example.com'), false)
})

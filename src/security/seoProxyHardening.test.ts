/**
 * Red-team fixes in seo-proxy (28/09/26): exact DataForSEO allowlist, keyword cache written from the
 * DataForSEO response (never from the browser), IPv6-aware SSRF DNS check.
 */
import { describe, expect, it } from 'vitest'
import { DATAFORSEO_ALLOWED_ENDPOINTS, isAllowedDataForSeoEndpoint } from '../../supabase/functions/_shared/dataForSeoEndpoints'
import {
  extractKeywordMetricRows,
  KEYWORD_DIFFICULTY_ENDPOINT,
  KEYWORD_VOLUME_ENDPOINT,
} from '../../supabase/functions/_shared/keywordMetricsCache'
import { dnsResolvesToBlocked, isBlockedIpv6, isBlockedResolvedIp } from '../../supabase/functions/_shared/ssrf'

describe('DataForSEO allowlist', () => {
  it('allows every endpoint the app, the MCP server and the self-host smoke test call', () => {
    for (const ep of [
      '/serp/google/organic/live/advanced',
      '/keywords_data/google_ads/search_volume/live',
      '/dataforseo_labs/google/keyword_suggestions/live',
      '/dataforseo_labs/google/keyword_ideas/live',
      '/dataforseo_labs/google/bulk_keyword_difficulty/live',
      '/dataforseo_labs/google/ranked_keywords/live',
      '/dataforseo_labs/google/domain_rank_overview/live',
      '/dataforseo_labs/google/historical_rank_overview/live',
      '/dataforseo_labs/google/competitors_domain/live',
      '/dataforseo_labs/google/relevant_pages/live',
      '/dataforseo_labs/google/bulk_traffic_estimation/live',
      '/backlinks/summary/live',
      '/backlinks/referring_domains/live',
      '/backlinks/backlinks/live',
      '/backlinks/anchors/live',
      '/backlinks/timeseries_new_lost_summary/live',
      '/backlinks/domain_intersection/live',
      '/backlinks/bulk_ranks/live',
      '/backlinks/bulk_backlinks/live',
      '/backlinks/bulk_referring_domains/live',
      '/on_page/instant_pages',
    ]) {
      expect(isAllowedDataForSeoEndpoint(ep), ep).toBe(true)
    }
    expect(DATAFORSEO_ALLOWED_ENDPOINTS.size).toBe(21)
  })

  it('refuses task endpoints, crawls and anything not on the list', () => {
    for (const ep of [
      '/on_page/task_post',
      '/serp/google/organic/task_post',
      '/backlinks/bulk_pages_summary/live',
      '/dataforseo_labs/google/keyword_suggestions/live/',
      '/serp/google/organic/live/advanced?x=1',
      '/../user_data/info',
      '',
      null,
    ]) {
      expect(isAllowedDataForSeoEndpoint(ep), String(ep)).toBe(false)
    }
  })
})

describe('keyword cache rows come from the DataForSEO response', () => {
  const payload = { keywords: ['crm software'], location_code: 2840, language_code: 'en' }
  const now = new Date('2026-09-28T10:00:00Z')

  it('volume: one row per keyword, volume only (never touches difficulty)', () => {
    const response = { tasks: [{ status_code: 20000, result: [{ keyword: 'CRM Software', search_volume: 49500 }, { keyword: '', search_volume: 1 }] }] }
    expect(extractKeywordMetricRows(KEYWORD_VOLUME_ENDPOINT, payload, response, now)).toEqual({
      kind: 'volume',
      rows: [{ keyword: 'crm software', location_code: 2840, language_code: 'en', volume: 49500, fetched_at: now.toISOString() }],
    })
  })

  it('difficulty: from result[0].items, clamped 0-100, difficulty only', () => {
    const response = { tasks: [{ status_code: 20000, result: [{ items: [{ keyword: 'crm software', keyword_difficulty: 140 }, { keyword: 'x', keyword_difficulty: null }] }] }] }
    expect(extractKeywordMetricRows(KEYWORD_DIFFICULTY_ENDPOINT, payload, response, now)).toEqual({
      kind: 'difficulty',
      rows: [{ keyword: 'crm software', location_code: 2840, language_code: 'en', difficulty: 100 }],
    })
  })

  it('writes nothing for failed tasks, other endpoints or a payload without a valid locale', () => {
    const ok = { tasks: [{ status_code: 20000, result: [{ keyword: 'a', search_volume: 1 }] }] }
    expect(extractKeywordMetricRows(KEYWORD_VOLUME_ENDPOINT, payload, { tasks: [{ status_code: 40501, result: null }] })).toBeNull()
    expect(extractKeywordMetricRows('/serp/google/organic/live/advanced', payload, ok)).toBeNull()
    expect(extractKeywordMetricRows(KEYWORD_VOLUME_ENDPOINT, { keywords: ['a'] }, ok)).toBeNull()
    expect(extractKeywordMetricRows(KEYWORD_VOLUME_ENDPOINT, { ...payload, language_code: "en'; drop" }, ok)).toBeNull()
  })
})

describe('SSRF DNS check with IPv6 answers', () => {
  it('lets public IPv6 through and blocks private, loopback, link-local and IPv4-embedding forms', () => {
    expect(isBlockedIpv6('2606:4700:3033::6815:3e5')).toBe(false) // Cloudflare
    expect(isBlockedIpv6('2a00:1450:4001:82a::200e')).toBe(false) // Google
    for (const ip of [
      '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1%eth0', 'ff02::1',
      '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::10.0.0.1', '64:ff9b::a00:1',
      '2002:a00:1::1', '2001:0:4136:e378::1', '2001:db8::1', 'not-an-ip', '1::2::3',
    ]) {
      expect(isBlockedIpv6(ip), ip).toBe(true)
    }
  })

  it('checks IPv4 answers exactly as before', () => {
    expect(isBlockedResolvedIp('93.184.216.34')).toBe(false)
    expect(isBlockedResolvedIp('169.254.169.254')).toBe(true)
    expect(isBlockedResolvedIp('10.1.2.3')).toBe(true)
  })

  it('blocks a host with a public A record and an internal AAAA record', async () => {
    expect(await dnsResolvesToBlocked('evil.example', () => Promise.resolve(['93.184.216.34', 'fd00::1']))).toBe(true)
    expect(await dnsResolvesToBlocked('ok.example', () => Promise.resolve(['93.184.216.34', '2606:4700::6810:84e5']))).toBe(false)
    expect(await dnsResolvesToBlocked('v6only.example', () => Promise.resolve(['2606:4700::6810:84e5']))).toBe(false)
  })
})

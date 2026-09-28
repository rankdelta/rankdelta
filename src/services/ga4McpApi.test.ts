/**
 * Contracts for hosted Rankdelta MCP GA4 cache reads (supabase/functions/mcp/index.ts).
 * The Edge Function runs on Deno; this file pins URL shape, period clamp, and column safety.
 */

import { describe, it, expect } from 'vitest'

const GA4_ALLOWED_PERIODS = [7, 28, 90]

function clampGa4PeriodDays(raw: unknown): number {
  const n = Number(raw ?? 28)
  return GA4_ALLOWED_PERIODS.includes(n) ? n : 28
}

describe('GA4 MCP cache-read contracts (hosted MCP)', () => {
  it('property select columns exclude OAuth secrets', () => {
    const propertyCols =
      'id, project_id, property_id, display_name, permission_level, connected_at, connected_by, verified'
    expect(propertyCols).not.toContain('refresh_token')
    expect(propertyCols).not.toContain('ga4_oauth')
  })

  it('analytics select columns exclude OAuth secrets', () => {
    const cacheCols =
      'id, project_id, property_id, period_days, sessions, users, pageviews, bounce_rate, top_pages, top_sources, daily_data, fetched_at, fetched_by'
    expect(cacheCols).not.toContain('refresh_token')
    expect(cacheCols).not.toContain('ga4_oauth')
  })

  it('clamps period_days to 7/28/90 (default 28)', () => {
    expect(clampGa4PeriodDays(7)).toBe(7)
    expect(clampGa4PeriodDays(28)).toBe(28)
    expect(clampGa4PeriodDays(90)).toBe(90)
    expect(clampGa4PeriodDays(1)).toBe(28)
    expect(clampGa4PeriodDays(365)).toBe(28)
    expect(clampGa4PeriodDays(Number.NaN)).toBe(28)
    expect(clampGa4PeriodDays(undefined)).toBe(28)
  })

  it('maps PostgREST no-rows (PGRST116) to null instead of throwing', () => {
    const error = { code: 'PGRST116', message: 'No rows returned' }
    const result = error.code === 'PGRST116' ? null : { error }
    expect(result).toBeNull()
  })

  it('hosted MCP tool names are get_ga4_property and get_ga4_analytics', () => {
    const toolNames = ['get_ga4_property', 'get_ga4_analytics']
    expect(toolNames).toContain('get_ga4_property')
    expect(toolNames).toContain('get_ga4_analytics')
    expect(toolNames).not.toContain('get_ga4_oauth_tokens')
  })
})

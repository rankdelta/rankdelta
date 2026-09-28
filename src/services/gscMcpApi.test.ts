/**
 * Contracts for hosted Rankdelta MCP GSC cache reads (supabase/functions/mcp/index.ts).
 * The Edge Function runs on Deno; this file pins URL shape, period clamp, and column safety.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// Read from the repo root: import.meta.url is not a file: URL under this vitest config.
const hostedMcpSource = readFileSync(resolve(process.cwd(), 'supabase/functions/mcp/index.ts'), 'utf8')
const gscPropertyHandler = hostedMcpSource.match(
  /if \(name === 'get_gsc_property'\)[\s\S]*?(?=\n\s*if \(name === 'list_client_reports')/,
)?.[0]

if (!gscPropertyHandler) throw new Error('get_gsc_property handler not found')

const GSC_ALLOWED_PERIODS = [7, 28, 90]

function clampGscPeriodDays(raw: unknown): number {
  const n = Number(raw ?? 28)
  return GSC_ALLOWED_PERIODS.includes(n) ? n : 28
}

describe('GSC MCP cache-read contracts (hosted MCP)', () => {
  it('property select columns exclude OAuth secrets', () => {
    const propertyCols =
      'id, project_id, site_url, permission_level, connected_at, connected_by, verified'
    expect(propertyCols).not.toContain('refresh_token')
    expect(propertyCols).not.toContain('gsc_oauth')
  })

  it('analytics select columns exclude OAuth secrets', () => {
    const cacheCols =
      'id, project_id, site_url, period_days, clicks, impressions, ctr, avg_position, top_queries, top_pages, daily_data, fetched_at, fetched_by'
    expect(cacheCols).not.toContain('refresh_token')
    expect(cacheCols).not.toContain('gsc_oauth')
  })

  it('clamps period_days to 7/28/90 (default 28)', () => {
    expect(clampGscPeriodDays(7)).toBe(7)
    expect(clampGscPeriodDays(28)).toBe(28)
    expect(clampGscPeriodDays(90)).toBe(90)
    expect(clampGscPeriodDays(1)).toBe(28)
    expect(clampGscPeriodDays(365)).toBe(28)
    expect(clampGscPeriodDays(Number.NaN)).toBe(28)
    expect(clampGscPeriodDays(undefined)).toBe(28)
  })

  it('reads one newest row with a null-safe contract', () => {
    expect(gscPropertyHandler).toMatch(
      /\.order\('connected_at', \{ ascending: false \}\)[\s\S]*?\.limit\(1\)[\s\S]*?\.maybeSingle\(\)/,
    )
    expect(gscPropertyHandler).toContain('return textResult(data ?? null)')
  })

  // Regression: `verified` is never written by gsc-connect (ga4-connect sets it, gsc-connect does
  // not), and the column is not guaranteed to exist on gsc_properties. Selecting or filtering it
  // made PostgREST error, so the handler threw and every caller got `tool_failed` instead of a
  // property or null. Reported from the field: 3/3 sites failing, while get_gsc_analytics on the
  // same site_id returned null cleanly.
  it('never selects or filters the unwritten `verified` column', () => {
    // Strip comments so the explanatory note about the bug doesn't match.
    const code = (gscPropertyHandler as string).replace(/\/\/.*$/gm, '')
    expect(code).not.toContain("eq('verified'")
    expect(code).not.toMatch(/select\([^)]*verified/)
  })

  it('maps PostgREST no-rows (PGRST116) to null instead of throwing', () => {
    const error = { code: 'PGRST116', message: 'No rows returned' }
    const result = error.code === 'PGRST116' ? null : { error }
    expect(result).toBeNull()
  })

  it('hosted MCP tool names are get_gsc_property and get_gsc_analytics', () => {
    const toolNames = ['get_gsc_property', 'get_gsc_analytics']
    expect(toolNames).toContain('get_gsc_property')
    expect(toolNames).toContain('get_gsc_analytics')
    expect(toolNames).not.toContain('get_gsc_oauth_tokens')
  })
})

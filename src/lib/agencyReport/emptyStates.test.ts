import { describe, it, expect } from 'vitest'
import { connectedButEmpty, emptyStateTimestamp, fmtGuidanceDate } from './emptyStates'
import type { ReportData } from './types'

const base: ReportData = {
  meta: { builtAt: '2026-02-01T09:30:00Z' },
  site_health: { auditScore: null, topIssues: [], auditedAt: '2026-01-10T15:31:55Z' },
  backlinks: { referringDomains: 0, new: 0, lost: null },
  gsc: {
    clicks: { value: 0, delta: null, deltaPct: null },
    impressions: { value: 0, delta: null, deltaPct: null },
    ctr: { value: null, delta: null, deltaPct: null },
    avgPosition: { value: null, delta: null, deltaPct: null },
    trend: [],
    topQueries: [],
    topPages: [],
  },
  ga4: { data: null, reason: 'not_connected' },
}

describe('connectedButEmpty', () => {
  it('flags zero backlinks, a scoreless audit and an all-zero GSC period', () => {
    expect(connectedButEmpty(base, 'backlinks')).toBe(true)
    expect(connectedButEmpty(base, 'site_health')).toBe(true)
    expect(connectedButEmpty(base, 'gsc')).toBe(true)
  })

  it('never flags disconnected or populated sections', () => {
    expect(connectedButEmpty(base, 'ga4')).toBe(false)
    expect(connectedButEmpty(base, 'geo')).toBe(false)
    expect(connectedButEmpty({ ...base, backlinks: { referringDomains: 4, new: 0, lost: null } }, 'backlinks')).toBe(false)
    expect(connectedButEmpty({ ...base, site_health: { auditScore: 72, topIssues: [], auditedAt: null } }, 'site_health')).toBe(false)
    const gscWithTraffic = { ...base.gsc!, trend: [{ date: '2026-01-05', clicks: 0, impressions: 3 }] }
    expect(connectedButEmpty({ ...base, gsc: gscWithTraffic }, 'gsc')).toBe(false)
    expect(connectedButEmpty(undefined, 'gsc')).toBe(false)
  })
})

describe('emptyStateTimestamp / fmtGuidanceDate', () => {
  it('prefers the audit time for site health and the build time otherwise', () => {
    expect(emptyStateTimestamp(base, 'site_health')).toBe('2026-01-10T15:31:55Z')
    expect(emptyStateTimestamp(base, 'backlinks')).toBe('2026-02-01T09:30:00Z')
    expect(emptyStateTimestamp({ ...base, meta: {} }, 'backlinks')).toBeNull()
  })

  it('formats dates per locale and rejects garbage', () => {
    expect(fmtGuidanceDate('2026-01-10T15:31:55Z', 'en-US')).toMatch(/Jan 10, 2026/)
    expect(fmtGuidanceDate('2026-01-10T15:31:55Z', 'it-IT')).toMatch(/10 gen 2026/)
    expect(fmtGuidanceDate('nope', 'en-US')).toBeNull()
    expect(fmtGuidanceDate(null, 'en-US')).toBeNull()
  })
})

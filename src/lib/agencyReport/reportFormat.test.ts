import { describe, it, expect } from 'vitest'
import { fmtPeriodRange, fmtRelativeTime, hasBaseline } from './reportUi'

describe('fmtPeriodRange', () => {
  it('shows the year once when both dates share it', () => {
    expect(fmtPeriodRange('2026-08-16', '2026-09-14', 'en-US')).toBe('Aug 16 – Sep 14, 2026')
  })
  it('shows both years when they differ', () => {
    expect(fmtPeriodRange('2025-12-20', '2026-01-18', 'en-US')).toBe('Dec 20, 2025 – Jan 18, 2026')
  })
  it('falls back to raw strings on garbage', () => {
    expect(fmtPeriodRange('nope', '2026-01-18', 'en-US')).toBe('nope – 2026-01-18')
  })
})

describe('fmtRelativeTime', () => {
  const now = new Date('2026-09-14T12:00:00Z')
  it('renders minutes, hours and days', () => {
    expect(fmtRelativeTime('2026-09-14T11:55:00Z', 'en-US', now)).toBe('5 minutes ago')
    expect(fmtRelativeTime('2026-09-14T09:00:00Z', 'en-US', now)).toBe('3 hours ago')
    expect(fmtRelativeTime('2026-09-12T12:00:00Z', 'en-US', now)).toBe('2 days ago')
  })
  it('falls back to an absolute date after 30 days', () => {
    expect(fmtRelativeTime('2026-06-01T12:00:00Z', 'en-US', now)).toBe('Jun 1, 2026')
  })
})

describe('hasBaseline', () => {
  it('rejects the "prior was missing" signature (delta === value, deltaPct 100)', () => {
    expect(hasBaseline({ value: 72, delta: 72, deltaPct: 100 })).toBe(false)
  })
  it('accepts real movements and rejects nulls', () => {
    expect(hasBaseline({ value: 72, delta: 2, deltaPct: 2.8 })).toBe(true)
    expect(hasBaseline({ value: 72, delta: null, deltaPct: null })).toBe(false)
    expect(hasBaseline({ value: null, delta: null, deltaPct: null })).toBe(false)
  })
})

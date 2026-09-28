import { describe, it, expect } from 'vitest'
import { withSectionSummary } from './snapshot'
import { hasBaseline } from './reportUi'
import type { MetricWithDelta } from '../reportBuild/math'

// The shape of the reports built on 14–15/09/26: summary deltas stored as 0 on a first reading.
const oldSnapshot = {
  id: 'r1',
  data: {
    summary: {
      aiSov: { value: 14.3, delta: 0, deltaPct: 0 },
      avgPosition: { value: 18.5, delta: 0, deltaPct: 0 },
      healthScore: { value: 51, delta: 51, deltaPct: 100 },
    },
    geo: { sovOverall: { value: 14.3, delta: 14.3, deltaPct: 100 } },
    rankings: { avgPosition: { value: 18.5, delta: 18.5, deltaPct: 100 } },
  },
}

describe('withSectionSummary', () => {
  it('reads an old first-reading snapshot as a first reading (no "±0.0" in the scorecard)', () => {
    const summary = (withSectionSummary(oldSnapshot).data as { summary: Record<string, MetricWithDelta> }).summary
    expect(summary['aiSov']).toEqual({ value: 14.3, delta: 14.3, deltaPct: 100 })
    expect(summary['avgPosition']).toEqual({ value: 18.5, delta: 18.5, deltaPct: 100 })
    expect(hasBaseline(summary['aiSov'])).toBe(false)
    expect(hasBaseline(summary['avgPosition'])).toBe(false)
    expect(summary['healthScore']).toEqual({ value: 51, delta: 51, deltaPct: 100 })
  })

  it('keeps a real movement, and leaves reports without the sections untouched', () => {
    const moved = { data: { summary: { aiSov: { value: 30, delta: 5, deltaPct: 20 } }, geo: { sovOverall: { value: 30, delta: 5, deltaPct: 20 } } } }
    expect(withSectionSummary(moved)).toEqual(moved)
    const noSections = { data: { summary: { aiSov: { value: 30, delta: 0, deltaPct: 0 } } } }
    expect(withSectionSummary(noSections)).toBe(noSections)
    const disconnected = { data: { summary: { aiSov: { value: null, delta: null, deltaPct: null } }, geo: { data: null, status: 'not_connected' } } }
    expect(withSectionSummary(disconnected)).toBe(disconnected)
    expect(withSectionSummary({ data: null })).toEqual({ data: null })
  })
})

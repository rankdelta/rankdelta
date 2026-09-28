import { describe, it, expect } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { Sparkline, cleanSparklineSeries, sparklinePaths } from '../../components/agencyReport/Sparkline'
import { kpiSparklineSeries } from './reportUi'
import type { ReportData } from './types'

describe('Sparkline', () => {
  it('renders nothing for missing or short series', () => {
    expect(render(<Sparkline values={null} />).container.querySelector('svg')).toBeNull()
    expect(render(<Sparkline values={[]} />).container.querySelector('svg')).toBeNull()
    expect(render(<Sparkline values={[5]} />).container.querySelector('svg')).toBeNull()
    expect(render(<Sparkline values={[5, null, undefined]} />).container.querySelector('svg')).toBeNull()
  })

  it('renders an inline svg line for a real series', () => {
    const { container } = render(<Sparkline values={[1, 3, 2, 5]} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelectorAll('path').length).toBe(2)
  })

  it('drops non-finite points instead of drawing NaN paths', () => {
    expect(cleanSparklineSeries([1, NaN, Infinity, 'x' as unknown as number, 4])).toEqual([1, 4])
  })

  it('maps highest value to the top and keeps a flat series in the middle', () => {
    const rising = sparklinePaths([0, 10])!
    expect(rising.line).toBe('M0 30 L120 2')
    const flat = sparklinePaths([7, 7, 7])!
    expect(flat.line).toBe('M0 16 L60 16 L120 16')
  })
})

describe('kpiSparklineSeries', () => {
  const data: ReportData = {
    geo: {
      sovOverall: { value: 20, delta: 2, deltaPct: 11 },
      sovByEngine: [],
      trend: [
        { date: '2026-01-01', yours: 1, competitors: 4, sovPercent: 20 },
        { date: '2026-01-02', yours: 2, competitors: 4, sovPercent: 33.3 },
      ],
      topPromptsMentioned: [],
      topPromptsNotMentioned: [],
      competitorLeaderboard: [],
      citationRate: { value: null, delta: null, deltaPct: null },
      topCitedSources: [],
    },
    gsc: {
      clicks: { value: 30, delta: null, deltaPct: null },
      impressions: { value: 300, delta: null, deltaPct: null },
      ctr: { value: 10, delta: null, deltaPct: null },
      avgPosition: { value: 8, delta: null, deltaPct: null },
      trend: [
        { date: '2026-01-01', clicks: 10, impressions: 100 },
        { date: '2026-01-02', clicks: 20, impressions: 200 },
      ],
      topQueries: [],
      topPages: [],
    },
    ga4: {
      sessions: { value: 5, delta: null, deltaPct: null },
      users: { value: 4, delta: null, deltaPct: null },
      engagedSessions: { value: null, delta: null, deltaPct: null },
      keyEvents: { value: null, delta: null, deltaPct: null },
      organicShare: { value: null, delta: null, deltaPct: null },
      aiAssistantSessions: { value: null, delta: null, deltaPct: null },
      trend: [
        { date: '2026-01-01', sessions: 2 },
        { date: '2026-01-02', sessions: 3 },
      ],
      topLandingPages: [],
      topSources: [],
    },
    backlinks: { data: null, reason: 'not_connected' },
  }

  it('maps scorecard KPIs to their source trend', () => {
    expect(kpiSparklineSeries(data, 'summary', 'aiSov')).toEqual([20, 33.3])
    expect(kpiSparklineSeries(data, 'summary', 'gscClicks')).toEqual([10, 20])
    expect(kpiSparklineSeries(data, 'summary', 'ga4Sessions')).toEqual([2, 3])
    expect(kpiSparklineSeries(data, 'summary', 'healthScore')).toBeNull()
  })

  it('maps section KPIs and refuses incomplete series', () => {
    expect(kpiSparklineSeries(data, 'gsc', 'impressions')).toEqual([100, 200])
    expect(kpiSparklineSeries(data, 'geo', 'sovOverall')).toEqual([20, 33.3])
    // GA4 users are optional per row — a series with holes is not drawn.
    expect(kpiSparklineSeries(data, 'ga4', 'users')).toBeNull()
    expect(kpiSparklineSeries(data, 'gsc', 'ctr')).toBeNull()
    expect(kpiSparklineSeries(data, 'backlinks', 'referringDomains')).toBeNull()
    expect(kpiSparklineSeries({ ...data, gsc: { data: null, reason: 'not_connected' } }, 'summary', 'gscClicks')).toBeNull()
    expect(kpiSparklineSeries(undefined, 'summary', 'gscClicks')).toBeNull()
  })
})

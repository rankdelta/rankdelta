import { describe, it, expect } from 'vitest'
import { briefingIsEmpty, competitorCountsReliable, deriveBriefing, hasAnyBaseline, movementPct, promptSplitReliable } from './insights'
import type { GeoSectionData } from './types'
import type { ReportData } from './types'

const m = (value: number | null, previous: number | null) => {
  if (value == null && previous == null) return { value: null, delta: null, deltaPct: null }
  const cur = value ?? 0
  const prev = previous ?? 0
  const delta = cur - prev
  return { value, delta, deltaPct: prev !== 0 ? Math.round((1000 * delta) / prev) / 10 : cur !== 0 ? 100 : 0 }
}

const richData: ReportData = {
  summary: {
    healthScore: m(74, 70),
    aiSov: m(42, 35),
    avgPosition: m(9.1, 11.4),
    gscClicks: m(1530, 1240),
    ga4Sessions: m(5200, 4800),
    ga4AiAssistantSessions: m(80, 40),
    keyEvents: m(null, null),
  },
  geo: {
    sovOverall: m(42, 35),
    sovByEngine: [
      { engine: 'openai', sovPercent: 61 },
      { engine: 'perplexity', sovPercent: 12 },
      { engine: 'gemini', sovPercent: 40 },
    ],
    trend: [],
    topPromptsMentioned: ['best crm for agencies', 'crm with ai features'],
    topPromptsNotMentioned: ['cheapest crm for freelancers', 'crm vs spreadsheet', 'crm for real estate'],
    competitorLeaderboard: [
      { id: 'c1', name: 'HubSpot', mentions: 14 },
      { id: 'c2', name: 'Pipedrive', mentions: 3 },
    ],
    citationRate: m(34, 12),
    topCitedSources: [{ domain: 'g2.com', count: 9 }],
  },
  rankings: {
    avgPosition: m(9.1, 11.4),
    distribution: { '1': 2, '2-3': 5, '4-10': 12, '11-20': 8, '21+': 3 },
    topMovers: [
      { phrase: 'crm software', currentRank: 2, previousRank: 6, delta: 4, url: null },
      { phrase: 'crm for agencies', currentRank: 8, previousRank: 14, delta: 6, url: null },
      { phrase: 'sales pipeline tool', currentRank: 15, previousRank: 7, delta: -8, url: null },
      { phrase: 'lead tracker', currentRank: 24, previousRank: 19, delta: -5, url: null },
    ],
    table: [
      { phrase: 'crm software', rank: 2, url: null },
      { phrase: 'crm pricing', rank: 12, url: null },
      { phrase: 'crm integrations', rank: 4, url: null },
      { phrase: 'sales pipeline tool', rank: 15, url: null },
    ],
  },
  gsc: {
    clicks: m(1530, 1240),
    impressions: m(120000, 80000),
    ctr: m(1.3, 1.55),
    avgPosition: m(12.2, 12.2),
    trend: [],
    topQueries: [
      { key: 'crm software', clicks: 400, impressions: 3000, ctr: 0.13, position: 2.1 },
      { key: 'crm', clicks: 120, impressions: 40000, ctr: 0.003, position: 6.8 },
      { key: 'crm pricing', clicks: 30, impressions: 2500, ctr: 0.012, position: 12.4 },
      { key: 'crm demo', clicks: 5, impressions: 20, ctr: 0.25, position: 14 },
    ],
    topPages: [
      { key: 'https://acme.test/crm/', clicks: 500, impressions: 20000, ctr: 0.025, position: 4 },
      { key: 'https://acme.test/blog/what-is-crm/', clicks: 40, impressions: 30000, ctr: 0.0013, position: 8.5 },
    ],
  },
  ga4: {
    sessions: m(5200, 4800),
    users: m(4000, 3900),
    engagedSessions: m(3000, 2900),
    keyEvents: m(null, null),
    organicShare: m(38, 44),
    aiAssistantSessions: m(80, 40),
    trend: [],
    topLandingPages: [{ key: '/crm/', sessions: 900, users: 800, pageviews: 1200 }],
    topSources: [],
  },
  site_health: { auditScore: 52, topIssues: [], auditedAt: null },
  backlinks: { referringDomains: 120, new: 6, lost: 1 },
}

describe('deriveBriefing', () => {
  it('returns three ranked groups capped at three items each', () => {
    const b = deriveBriefing(richData, { locale: 'en-US' })
    expect(b.wins.length).toBe(3)
    expect(b.watch.length).toBe(3)
    expect(b.actions.length).toBe(3)
    for (const group of [b.wins, b.watch, b.actions]) {
      for (let i = 1; i < group.length; i++) expect(group[i - 1]!.score).toBeGreaterThanOrEqual(group[i]!.score)
    }
    expect(b.wins.every((i) => i.kind === 'win')).toBe(true)
    expect(b.watch.every((i) => i.kind === 'watch')).toBe(true)
    expect(b.actions.every((i) => i.kind === 'action')).toBe(true)
  })

  it('surfaces the biggest positive movements with real numbers and names', () => {
    const b = deriveBriefing(richData, { locale: 'en-US', maxPerGroup: 20 })
    const keys = b.wins.map((w) => w.key)
    expect(keys).toContain('clicksUp')
    expect(keys).toContain('enteredTop3')
    expect(keys).toContain('citationUp')
    expect(keys).toContain('sovUp')
    const clicks = b.wins.find((w) => w.key === 'clicksUp')!
    expect(clicks.params).toMatchObject({ pct: '23%', from: '1,240', to: '1,530' })
    const top3 = b.wins.find((w) => w.key === 'enteredTop3')!
    expect(top3.params['count']).toBe(1)
    expect(String(top3.params['list'])).toContain('crm software')
    const page1 = b.wins.find((w) => w.key === 'enteredPage1')!
    expect(String(page1.params['list'])).toContain('crm for agencies')
    const cite = b.wins.find((w) => w.key === 'citationUp')!
    expect(cite.params).toMatchObject({ from: '12.0%', to: '34.0%' })
  })

  it('flags drops, prompt gaps (naming the top competitor only when it has mentions) and the CTR gap', () => {
    const flatClicks: ReportData = {
      ...richData,
      gsc: { ...(richData.gsc as Exclude<ReportData['gsc'], undefined | { data: null; reason: string }>), clicks: m(1250, 1240) },
    }
    const b = deriveBriefing(flatClicks, { locale: 'en-US', maxPerGroup: 20 })
    const keys = b.watch.map((w) => w.key)
    expect(keys).toContain('droppedPage1')
    expect(keys).toContain('promptsMissingCompetitor')
    expect(keys).toContain('ctrGap')
    expect(keys).toContain('organicShareDown')
    expect(keys).toContain('engineGap')
    const dropped = b.watch.find((w) => w.key === 'droppedPage1')!
    expect(String(dropped.params['list'])).toContain('sales pipeline tool')
    const missing = b.watch.find((w) => w.key === 'promptsMissingCompetitor')!
    expect(missing.params).toMatchObject({ count: 3, total: 5, competitor: 'HubSpot' })
    const gap = b.watch.find((w) => w.key === 'engineGap')!
    expect(gap.params).toMatchObject({ engine: 'Perplexity', bestEngine: 'ChatGPT' })
    const ctr = b.watch.find((w) => w.key === 'ctrGap')!
    expect(ctr.params).toMatchObject({ impPct: '50%', clicksPct: '+1%' })
  })

  it('derives specific, prioritised actions from page-2 keywords, missed prompts and low-CTR pages', () => {
    const b = deriveBriefing(richData, { locale: 'en-US', maxPerGroup: 20 })
    const keys = b.actions.map((a) => a.key)
    expect(keys).toContain('improveCtrQuery')
    expect(keys).toContain('improveCtrPage')
    expect(keys).toContain('winPromptCompetitor')
    expect(keys).toContain('reclaimKeyword')
    expect(keys).toContain('keywordNearPage1')
    const ctrQ = b.actions.find((a) => a.key === 'improveCtrQuery')!
    expect(ctrQ.params).toMatchObject({ query: 'crm', impressions: '40,000', ctr: '0.3%', position: '#6.8' })
    const ctrP = b.actions.find((a) => a.key === 'improveCtrPage')!
    expect(ctrP.params['page']).toBe('/blog/what-is-crm/')
    const near = b.actions.find((a) => a.key === 'keywordNearPage1')!
    expect(near.params).toMatchObject({ phrase: 'crm pricing', rank: '#12' })
    // The keyword already used by an action is not repeated by another one.
    const phrases = b.actions.map((a) => a.params['phrase'] ?? a.params['query']).filter(Boolean)
    expect(new Set(phrases).size).toBe(phrases.length)
    // Highest-scored action first: the CTR rewrite on a 40k-impression query outranks the rest.
    expect(b.actions[0]!.key).toBe('improveCtrQuery')
  })

  it('never turns a first reading (no baseline) or 0 → 0 into a movement', () => {
    const firstReading: ReportData = {
      summary: {
        healthScore: m(null, null),
        aiSov: m(null, null),
        avgPosition: m(null, null),
        gscClicks: m(15994, null), // computeDelta shape for a missing prior: delta === value, deltaPct === 100
        ga4Sessions: m(null, null),
        ga4AiAssistantSessions: m(null, null),
        keyEvents: m(null, null),
      },
      gsc: {
        clicks: m(15994, null),
        impressions: m(777805, null),
        ctr: m(2.06, 0),
        avgPosition: m(7.78, 7.78),
        trend: [],
        topQueries: [{ key: 'webcam marzamemi', clicks: 646, impressions: 1242, ctr: 0.52, position: 1.73 }],
        topPages: [],
      },
      ga4: {
        sessions: m(0, 0),
        users: m(0, 0),
        engagedSessions: m(0, 0),
        keyEvents: m(0, 0),
        organicShare: m(0, 0),
        aiAssistantSessions: m(0, 0),
        trend: [],
        topLandingPages: [],
        topSources: [],
      },
    }
    const b = deriveBriefing(firstReading, { locale: 'en-US', maxPerGroup: 20 })
    const allKeys = [...b.wins, ...b.watch, ...b.actions].map((i) => i.key)
    expect(allKeys).not.toContain('clicksUp')
    expect(allKeys).not.toContain('impressionsUp')
    expect(allKeys).not.toContain('sessionsUp')
    expect(allKeys).not.toContain('sessionsDown')
    expect(allKeys).not.toContain('ctrGap')
    // State facts are still allowed, so the briefing is honest but not empty.
    expect(allKeys).toContain('topQuery')
    expect(hasAnyBaseline(firstReading)).toBe(false)
    expect(hasAnyBaseline(richData)).toBe(true)
  })

  it('returns nothing (never fabricates) for empty or disconnected data', () => {
    expect(briefingIsEmpty(deriveBriefing(null))).toBe(true)
    expect(briefingIsEmpty(deriveBriefing({}))).toBe(true)
    const disconnected: ReportData = {
      geo: { data: null, reason: 'not_connected' },
      gsc: { data: null, reason: 'not_connected' },
      rankings: { data: null, reason: 'not_connected' },
    }
    expect(briefingIsEmpty(deriveBriefing(disconnected))).toBe(true)
  })

  it('does not name a competitor whose leaderboard mentions are all zero', () => {
    const data: ReportData = {
      geo: {
        ...(richData.geo as Exclude<ReportData['geo'], undefined | { data: null; reason: string }>),
        competitorLeaderboard: [{ id: 'c1', name: 'HubSpot', mentions: 0 }],
      },
    }
    const b = deriveBriefing(data, { maxPerGroup: 20 })
    const keys = [...b.watch, ...b.actions].map((i) => i.key)
    expect(keys).toContain('promptsMissing')
    expect(keys).toContain('winPrompt')
    expect(keys).not.toContain('promptsMissingCompetitor')
    expect(keys).not.toContain('winPromptCompetitor')
  })

  it('formats numbers for the requested locale', () => {
    const b = deriveBriefing(richData, { locale: 'it-IT', maxPerGroup: 20 })
    // Italian CLDR does not group four-digit numbers; five digits are grouped with a dot.
    const imps = b.wins.find((w) => w.key === 'impressionsUp')!
    expect(imps.params['from']).toBe('80.000')
    const ctrQ = b.actions.find((a) => a.key === 'improveCtrQuery')!
    expect(ctrQ.params).toMatchObject({ impressions: '40.000', ctr: '0,3%', position: '#6,8' })
    // Average position 11.4 → 9.1: "2,3 posizioni", never "2.3" on an Italian briefing.
    const avg = b.wins.find((w) => w.key === 'avgPositionImproved')!
    expect(avg.params).toMatchObject({ from: '#11,4', to: '#9,1', delta: '2,3' })
  })
})

describe('promptSplitReliable', () => {
  const geo = richData.geo as Exclude<ReportData['geo'], undefined | { data: null; reason: string }>

  it('rejects a split where no prompt is mentioned while share of voice says the brand is', () => {
    const contradictory = { ...geo, topPromptsMentioned: [], topPromptsNotMentioned: ['a', 'b'], sovOverall: m(84.6, null) }
    expect(promptSplitReliable(contradictory)).toBe(false)
    const b = deriveBriefing({ geo: contradictory }, { maxPerGroup: 20 })
    const keys = [...b.wins, ...b.watch, ...b.actions].map((i) => i.key)
    expect(keys).not.toContain('promptsMissing')
    expect(keys).not.toContain('promptsMissingCompetitor')
    expect(keys).not.toContain('winPrompt')
    expect(keys).not.toContain('winPromptCompetitor')
  })

  it('accepts a split with at least one mentioned prompt, or with no mentions anywhere', () => {
    expect(promptSplitReliable(geo)).toBe(true)
    const nothing = {
      ...geo,
      topPromptsMentioned: [],
      topPromptsNotMentioned: ['a'],
      sovOverall: m(0, null),
      sovByEngine: [{ engine: 'openai', sovPercent: 0 }],
      trend: [],
    }
    expect(promptSplitReliable(nothing)).toBe(true)
  })
})

describe('movementPct', () => {
  it('recomputes the percent from delta when deltaPct is missing', () => {
    expect(movementPct({ value: 120, delta: 20, deltaPct: null })).toBe(20)
    expect(movementPct({ value: 120, delta: null, deltaPct: null })).toBeNull()
    expect(movementPct({ value: 120, delta: 120, deltaPct: 100 })).toBeNull()
  })
})

describe('competitorCountsReliable', () => {
  const geo = (sov: number | null, mentions: number[]) =>
    ({
      sovOverall: { value: sov, delta: null, deltaPct: null },
      competitorLeaderboard: mentions.map((m, i) => ({ id: `c${i}`, name: `Rival ${i}`, mentions: m })),
    }) as unknown as GeoSectionData

  it('flags a board of zeros next to a share of voice below 100% (the 14–15/09 snapshots)', () => {
    expect(competitorCountsReliable(geo(14.3, [0, 0, 0, 0, 0, 0, 0]))).toBe(false)
  })

  it('trusts counts that agree with share of voice', () => {
    expect(competitorCountsReliable(geo(30.8, [4, 3, 0]))).toBe(true)
    expect(competitorCountsReliable(geo(100, [0, 0]))).toBe(true)
    expect(competitorCountsReliable(geo(null, [0, 0]))).toBe(true)
    expect(competitorCountsReliable(geo(14.3, []))).toBe(true)
  })
})

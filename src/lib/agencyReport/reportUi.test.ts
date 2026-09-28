import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import {
  auditDateBeforePeriod,
  biggestPositiveMovement,
  derivePeriodHeadline,
  formatScorecardValue,
  hexToTremorColor,
  sortMoversByAbsChange,
} from './reportUi'

describe('reportUi', () => {
  it('maps brand hex to tremor palette', () => {
    expect(hexToTremorColor('#2563eb')).toBe('blue')
    expect(hexToTremorColor('#7c3aed')).toBe('violet')
  })

  it('sorts movers by absolute delta', () => {
    const sorted = sortMoversByAbsChange([
      { phrase: 'a', delta: 2 },
      { phrase: 'b', delta: -9 },
      { phrase: 'c', delta: 5 },
    ])
    expect(sorted.map((m) => m.phrase)).toEqual(['b', 'c', 'a'])
  })

  it('derives period headline from summary', () => {
    const summary = {
      healthScore: { value: 80, delta: 3, deltaPct: null },
      aiSov: { value: 20, delta: 2, deltaPct: null },
      avgPosition: { value: 5, delta: -1, deltaPct: null },
      gscClicks: { value: 100, delta: 10, deltaPct: null },
      ga4Sessions: { value: 50, delta: null, deltaPct: null },
      ga4AiAssistantSessions: { value: 5, delta: null, deltaPct: null },
      keyEvents: { value: null, delta: null, deltaPct: null },
    }
    const labels = {
      healthScore: 'Health',
      aiSov: 'SoV',
      avgPosition: 'Position',
      gscClicks: 'Clicks',
      ga4Sessions: 'Sessions',
      aiSessions: 'AI',
    }
    const movement = biggestPositiveMovement(summary, labels)
    expect(movement?.label).toBe('Clicks')
    const headline = derivePeriodHeadline(summary, labels, ((k: string, o?: Record<string, unknown>) =>
      `${k}:${JSON.stringify(o)}`) as TFunction)
    expect(headline).toContain('80')
  })

  it('names the audit behind the health score when it predates the period', () => {
    // A 30 Jun audit in a 16 Aug – 14 Sep report used to read "Health score 51 this period".
    expect(auditDateBeforePeriod({ auditScore: 51, auditedAt: '2026-06-30T18:28:06Z' }, '2026-08-16', 'en-US')).toBe('Jun 30, 2026')
    expect(auditDateBeforePeriod({ auditScore: 84, auditedAt: '2026-09-16T13:48:18Z' }, '2026-08-25', 'en-US')).toBeNull()
    expect(auditDateBeforePeriod({ auditScore: 84, auditedAt: null }, '2026-08-25', 'en-US')).toBeNull()
    expect(auditDateBeforePeriod(null, '2026-08-25', 'en-US')).toBeNull()

    const summary = {
      healthScore: { value: 51, delta: null, deltaPct: null },
      aiSov: { value: null, delta: null, deltaPct: null },
      avgPosition: { value: null, delta: null, deltaPct: null },
      gscClicks: { value: null, delta: null, deltaPct: null },
      ga4Sessions: { value: null, delta: null, deltaPct: null },
      ga4AiAssistantSessions: { value: null, delta: null, deltaPct: null },
      keyEvents: { value: null, delta: null, deltaPct: null },
    }
    const labels = { healthScore: 'Health', aiSov: 'SoV', avgPosition: 'Position', gscClicks: 'Clicks', ga4Sessions: 'Sessions', aiSessions: 'AI' }
    const t = ((k: string, o?: Record<string, unknown>) => `${k}:${JSON.stringify(o)}`) as TFunction
    expect(derivePeriodHeadline(summary, labels, t, 'en-US', 'Jun 30, 2026')).toBe('agencyReport.periodHeadlineHealthOnlyAudit:{"health":51,"date":"Jun 30, 2026"}')
    expect(derivePeriodHeadline(summary, labels, t, 'en-US', null)).toBe('agencyReport.periodHeadlineHealthOnly:{"health":51}')
  })

  it('formats scorecard values', () => {
    expect(formatScorecardValue(18.2, 'pct')).toBe('18.2%')
    expect(formatScorecardValue(8.4, 'position')).toBe('#8.4')
    expect(formatScorecardValue(1500, 'num')).toBe('1.5k')
  })
})

import { describe, expect, it } from 'vitest'
import { attentionScore, sortByAttention, tileNeedsAttention } from './portfolio'

const tile = (aiSov: number | null, clicks: number | null, name = 'x') => ({
  name,
  aiSov: { value: 10, delta: aiSov },
  gscClicks: { value: 100, delta: clicks },
})

describe('portfolio attention helpers', () => {
  it('flags a client when AI share of voice or clicks dropped', () => {
    expect(tileNeedsAttention(tile(-2, 5))).toBe(true)
    expect(tileNeedsAttention(tile(1, -12))).toBe(true)
    expect(tileNeedsAttention(tile(0, 0))).toBe(false)
    expect(tileNeedsAttention(tile(null, null))).toBe(false)
  })

  it('scores by the worst drop, null when nothing fell', () => {
    expect(attentionScore(tile(-2, -12))).toBe(-12)
    expect(attentionScore(tile(-2, 30))).toBe(-2)
    expect(attentionScore(tile(3, null))).toBeNull()
  })

  it('sorts the biggest drop first and keeps healthy clients in their original order', () => {
    const sorted = sortByAttention([tile(1, 2, 'a'), tile(-1, 4, 'b'), tile(null, -20, 'c'), tile(2, null, 'd')])
    expect(sorted.map((t) => t.name)).toEqual(['c', 'b', 'a', 'd'])
  })
})

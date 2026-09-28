import { describe, it, expect } from 'vitest'
import { evaluateGoalRag, goalProgressRatio, goalRagClasses } from './goals'

describe('evaluateGoalRag', () => {
  it('returns green when value meets target (higher is better)', () => {
    expect(evaluateGoalRag({ value: 80, target: 70 })).toBe('green')
  })

  it('returns amber within 10% of target', () => {
    expect(evaluateGoalRag({ value: 68, target: 70 })).toBe('amber')
  })

  it('returns red when far below target', () => {
    expect(evaluateGoalRag({ value: 50, target: 70 })).toBe('red')
  })

  it('inverts for lower-is-better metrics', () => {
    expect(evaluateGoalRag({ value: 3, target: 5, higherIsBetter: false })).toBe('green')
    expect(evaluateGoalRag({ value: 6, target: 5, higherIsBetter: false })).toBe('red')
  })

  it('returns none without value or target', () => {
    expect(evaluateGoalRag({ value: null, target: 70 })).toBe('none')
  })
})

describe('goalRagClasses', () => {
  it('maps rag states to classes', () => {
    expect(goalRagClasses('green')).toContain('emerald')
    expect(goalRagClasses('none')).toContain('gray')
  })
})

describe('goalProgressRatio', () => {
  it('is value/target capped at 1 when higher is better', () => {
    expect(goalProgressRatio({ value: 35, target: 70 })).toBe(0.5)
    expect(goalProgressRatio({ value: 72, target: 70 })).toBe(1)
    expect(goalProgressRatio({ value: 0, target: 70 })).toBe(0)
  })

  it('inverts for lower-is-better metrics (at or below target is full)', () => {
    expect(goalProgressRatio({ value: 10, target: 5, higherIsBetter: false })).toBe(0.5)
    expect(goalProgressRatio({ value: 4, target: 5, higherIsBetter: false })).toBe(1)
  })

  it('returns null without a value or target', () => {
    expect(goalProgressRatio({ value: null, target: 70 })).toBeNull()
    expect(goalProgressRatio({ value: 70, target: undefined })).toBeNull()
    expect(goalProgressRatio({ value: NaN, target: 70 })).toBeNull()
  })
})

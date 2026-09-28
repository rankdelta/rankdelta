import { describe, it, expect } from 'vitest'
import { isNullSection, isConnectedSection } from './sections'

describe('agency report sections', () => {
  it('detects null sections', () => {
    expect(isNullSection({ data: null, reason: 'not_connected' })).toBe(true)
    expect(isNullSection({ sovOverall: { value: 10 } })).toBe(false)
  })

  it('narrows connected sections', () => {
    const geo = { sovOverall: { value: 12, delta: null, deltaPct: null } }
    expect(isConnectedSection(geo)).toBe(true)
    expect(isConnectedSection({ data: null, reason: 'not_connected' })).toBe(false)
  })
})

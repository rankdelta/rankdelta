import { describe, expect, it } from 'vitest'
import { contrastRatio, readableOn } from './colorContrast'

const HERO_BG = '#0e0f1d'

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    // The failures axe reported on the shared reports (28/09).
    expect(contrastRatio('#7c3aed', HERO_BG)).toBeCloseTo(3.33, 1)
    expect(contrastRatio('#99a1af', '#ffffff')).toBeCloseTo(2.6, 1)
    expect(contrastRatio('nope', '#ffffff')).toBeNull()
  })
})

describe('readableOn', () => {
  it('lightens the default violet just enough to read on the dark hero', () => {
    const out = readableOn('#7c3aed', HERO_BG)
    expect(out).not.toBe('#7c3aed')
    expect(contrastRatio(out, HERO_BG)!).toBeGreaterThanOrEqual(4.5)
    // Still recognisably the brand violet: not pushed all the way to white.
    expect(contrastRatio(out, '#ffffff')!).toBeGreaterThan(2)
  })

  it('keeps a colour that already passes, darkens on light backgrounds, ignores bad input', () => {
    expect(readableOn('#fde047', HERO_BG)).toBe('#fde047')
    const onWhite = readableOn('#fde047', '#ffffff')
    expect(contrastRatio(onWhite, '#ffffff')!).toBeGreaterThanOrEqual(4.5)
    expect(readableOn('violet', HERO_BG)).toBe('violet')
  })
})

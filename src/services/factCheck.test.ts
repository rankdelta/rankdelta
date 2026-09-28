import { beforeEach, describe, expect, it, vi } from 'vitest'

const complete = vi.fn()
let proxyEnabled = false

vi.mock('./openrouter', () => ({ complete: (...a: unknown[]) => complete(...a) }))
vi.mock('./edgeProxy', () => ({ isProxyEnabled: () => proxyEnabled }))

import {
  aiAssistedFactCheck,
  applyClaimCorrections,
  extractClaims,
  factCheckContent,
  generateSafeReplacement,
  splitIntoChunks,
} from './factCheck'

const countPlaceholders = (text: string, label: string): number =>
  text.split(`[${label}:`).length - 1

describe('generateSafeReplacement', () => {
  it('returns a visible placeholder in the article language for every claim type', () => {
    expect(generateSafeReplacement({ text: '73.2%' }, 'en')).toBe('[Source needed: 73.2%]')
    expect(generateSafeReplacement({ text: 'Dr. Mario Rossi' }, 'it')).toBe('[Fonte necessaria: Dr. Mario Rossi]')
    expect(generateSafeReplacement({ text: 'x' }, 'de')).toBe('[Quelle erforderlich: x]')
  })
})

describe('factCheckContent (pattern-based)', () => {
  beforeEach(() => {
    proxyEnabled = false
  })

  it('replaces unverified claims and counts exactly what it replaced (Italian)', async () => {
    const text = 'Secondo il Dr. Mario Rossi, il 73.2% dei cani migliora. Lo conferma anche l\'OMS.'
    const r = await factCheckContent(text, { language: 'it' })
    expect(r.claimsRemoved).toBeGreaterThan(0)
    expect(r.claimsRemoved).toBe(countPlaceholders(r.correctedContent, 'Fonte necessaria'))
    expect(r.correctedContent).not.toMatch(/(^|[^:] )il 73\.2%/)
    expect(r.correctedContent).toContain('[Fonte necessaria: 73.2%]')
  })

  it('detects English claims too', async () => {
    const text = 'According to Dr. John Smith, in our study 12.5% of users churned. We found that onboarding matters.'
    const r = await factCheckContent(text, { language: 'en' })
    expect(r.claimsFound).toBeGreaterThanOrEqual(3)
    expect(r.claimsRemoved).toBe(countPlaceholders(r.correctedContent, 'Source needed'))
    expect(r.correctedContent).toContain('[Source needed: 12.5%]')
  })

  it('never flags the configured real author', async () => {
    const text = 'Articolo scritto da Dr. Anna Bianchi. Il 12.5% dei casi.'
    const r = await factCheckContent(text, { language: 'it', trustedTerms: ['Anna Bianchi'] })
    expect(r.correctedContent).toContain('Articolo scritto da Dr. Anna Bianchi')
  })

  it('reports zero replacements when there is nothing to fix', async () => {
    const r = await factCheckContent('A plain article with general advice.', { language: 'en' })
    expect(r).toMatchObject({ claimsFound: 0, claimsRemoved: 0, overallScore: 100 })
  })
})

describe('applyClaimCorrections', () => {
  it('applies overlapping claims once and counts one replacement', () => {
    const text = 'Oggi, secondo il Dr. Mario Rossi, i cani stanno meglio.'
    const claims = extractClaims(text)
    expect(claims.length).toBeGreaterThanOrEqual(2) // "secondo il Dr. Mario Rossi" + "Dr. Mario Rossi"
    const { content, applied } = applyClaimCorrections(text, claims, 'it')
    expect(applied).toBe(1)
    expect(countPlaceholders(content, 'Fonte necessaria')).toBe(1)
  })

  it('does not count claims it could not locate in the text', () => {
    const { applied } = applyClaimCorrections('abc', [
      { type: 'study', text: 'missing', context: '', startIndex: -1, endIndex: -1, isVerified: false },
    ])
    expect(applied).toBe(0)
  })
})

describe('splitIntoChunks', () => {
  it('covers the whole article without losing text', () => {
    const article = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} `.repeat(40)).join('\n\n')
    const chunks = splitIntoChunks(article, 2000)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.length <= 2000)).toBe(true)
    expect(chunks.join('')).toBe(article)
  })
})

describe('aiAssistedFactCheck', () => {
  beforeEach(() => {
    proxyEnabled = true
    complete.mockReset()
  })

  it('checks the whole article in chunks and flags claims past the first 8000 chars', async () => {
    const filler = 'General advice paragraph. '.repeat(400) // ~10k chars
    const article = `${filler}\n\nA 2021 survey by Acme Labs found 64% of teams agree.`
    complete.mockImplementation(async (messages: Array<{ content: string }>) => {
      const body = messages[0]?.content ?? ''
      return body.includes('Acme Labs')
        ? JSON.stringify({ suspiciousClaims: [{ original: 'A 2021 survey by Acme Labs found 64% of teams agree', reason: 'invented survey' }] })
        : JSON.stringify({ suspiciousClaims: [] })
    })
    const r = await aiAssistedFactCheck(article, { language: 'en' })
    expect(complete.mock.calls.length).toBeGreaterThan(1)
    expect(r.claimsRemoved).toBe(1)
    expect(r.correctedContent).toContain('[Source needed: A 2021 survey by Acme Labs found 64% of teams agree]')
    expect(r.checkFailed).toBeUndefined()
  })

  it('ignores quotes that are not in the article and never uses the model rewrite', async () => {
    complete.mockResolvedValue(JSON.stringify({
      suspiciousClaims: [
        { original: 'not in the text', reason: 'x', replacement: 'invented rewrite' },
        { original: '40% faster', reason: 'no source', replacement: 'a new invented 35%' },
      ],
    }))
    const r = await aiAssistedFactCheck('Our tool is 40% faster.', { language: 'en' })
    expect(r.claimsFound).toBe(1)
    expect(r.claimsRemoved).toBe(1)
    expect(r.correctedContent).toBe('Our tool is [Source needed: 40% faster].')
  })

  it('reports checkFailed when the AI pass fails', async () => {
    complete.mockRejectedValue(new Error('proxy down'))
    const r = await aiAssistedFactCheck('Some text.', { language: 'en' })
    expect(r.checkFailed).toBe(true)
    expect(r.warnings?.length).toBeGreaterThan(0)
  })
})

describe('claim patterns', () => {
  it('do not flag plain prose or match entity substrings', async () => {
    const r = await factCheckContent('Come spiega questo articolo, la cura è semplice. The whole team agrees.', { language: 'it' })
    expect(r.claimsFound).toBe(0)
    expect(r.correctedContent).toBe('Come spiega questo articolo, la cura è semplice. The whole team agrees.')
  })

  it('keeps a known institution and captures multi-word names whole', () => {
    const claims = extractClaims("Lo dice l'Istituto Superiore di Sanità e l'Istituto Mario Negri.")
    expect(claims.map((c) => c.text)).toEqual(['Istituto Superiore di Sanità', 'Istituto Mario Negri'])
    expect(claims[0]?.isVerified).toBe(true)
    expect(claims[1]?.isVerified).toBe(false)
  })
})

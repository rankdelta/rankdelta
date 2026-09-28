import { beforeEach, describe, expect, it, vi } from 'vitest'

const verifyClaimWithPerplexity = vi.fn()
const proxyFetchPage = vi.fn()

vi.mock('../perplexity', () => ({
  isPerplexityAvailable: () => true,
  verifyClaimWithPerplexity: (...a: unknown[]) => verifyClaimWithPerplexity(...a),
}))
vi.mock('../edgeProxy', () => ({
  proxyFetchPage: (...a: unknown[]) => proxyFetchPage(...a),
}))

import {
  decideCitationVerification,
  isSuccessfulFetch,
  verifyExternalSources,
  MIN_SUPPORT_CONFIDENCE,
} from './citationVerifier'

const source = { url: 'https://www.who.int/page', title: 'WHO page', domain: 'who.int', isAuthoritative: true, snippet: '' }

describe('decideCitationVerification', () => {
  it('verifies only a fetched page that Perplexity confirms with enough confidence', () => {
    const d = decideCitationVerification({ fetchOk: true, perplexity: { isVerified: true, confidence: 85 } })
    expect(d).toMatchObject({ exists: true, supportsClaim: true, verified: true })
    expect(d.confidence).toBeCloseTo(0.85)
  })

  it('rejects a page that could not be fetched, whatever Perplexity says', () => {
    const d = decideCitationVerification({ fetchOk: false, fetchStatus: 404, perplexity: { isVerified: true, confidence: 99 } })
    expect(d.verified).toBe(false)
    expect(d.exists).toBe(false)
    expect(d.note).toContain('404')
  })

  it('rejects isVerified:false even when the explanation contains positive keywords', () => {
    // Regression: the old parser keyword-matched "accessibile"/"supporta" in the text and returned true.
    const d = decideCitationVerification({
      fetchOk: true,
      perplexity: { isVerified: false, confidence: 90, explanation: 'La pagina è accessibile ma non supporta il claim' },
    })
    expect(d.verified).toBe(false)
  })

  it('rejects low-confidence confirmations and missing verdicts', () => {
    expect(decideCitationVerification({ fetchOk: true, perplexity: { isVerified: true, confidence: MIN_SUPPORT_CONFIDENCE - 1 } }).verified).toBe(false)
    expect(decideCitationVerification({ fetchOk: true, perplexity: null }).verified).toBe(false)
  })
})

describe('isSuccessfulFetch', () => {
  it('requires a 2xx status and a non-empty body', () => {
    expect(isSuccessfulFetch({ ok: true, status: 200, body: '<html>ok</html>' })).toBe(true)
    expect(isSuccessfulFetch({ ok: false, status: 404, body: 'Not found' })).toBe(false)
    expect(isSuccessfulFetch({ ok: true, status: 200, body: '   ' })).toBe(false)
    expect(isSuccessfulFetch(null)).toBe(false)
  })
})

describe('verifyExternalSources', () => {
  beforeEach(() => {
    verifyClaimWithPerplexity.mockReset()
    proxyFetchPage.mockReset()
  })

  it('uses result.isVerified and the real fetch, not keywords in the prompt text', async () => {
    proxyFetchPage.mockResolvedValue({ ok: true, status: 200, body: '<html>content</html>' })
    verifyClaimWithPerplexity.mockResolvedValue({
      originalClaim: 'accessibile supporta verificata',
      isVerified: false,
      confidence: 80,
      explanation: 'accessibile, supporta',
    })
    const [check] = await verifyExternalSources([source], 'topic', 'en')
    expect(check?.verified).toBe(false)
  })

  it('marks a source verified when the page loads and Perplexity confirms it', async () => {
    proxyFetchPage.mockResolvedValue({ ok: true, status: 200, body: '<html>content</html>' })
    verifyClaimWithPerplexity.mockResolvedValue({ originalClaim: '', isVerified: true, confidence: 80, explanation: 'ok' })
    const [check] = await verifyExternalSources([source], 'topic', 'en')
    expect(check?.verified).toBe(true)
    expect(proxyFetchPage).toHaveBeenCalledWith(source.url)
  })

  it('treats a fetch error as a non-existent page', async () => {
    proxyFetchPage.mockRejectedValue(new Error('URL not allowed'))
    verifyClaimWithPerplexity.mockResolvedValue({ originalClaim: '', isVerified: true, confidence: 95, explanation: 'ok' })
    const [check] = await verifyExternalSources([source], 'topic', 'en')
    expect(check?.exists).toBe(false)
    expect(check?.verified).toBe(false)
  })
})

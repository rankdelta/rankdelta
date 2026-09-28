import { describe, it, expect } from 'vitest'
import {
  getMoneyPages,
  rankMoneyPagesForKeyword,
  ensureMoneyPageLink,
  boostMoneyPagesIntoResearch,
  type MoneyPage,
} from './moneyPages'
import type { ResearchResult } from './agent/types'

const PAGE: MoneyPage = { url: 'https://example.com/servizi/conto-terzi', keyword: 'produzione conto terzi' }

const emptyResearch = (): ResearchResult => ({
  keyword: 'kw',
  serpTopUrls: [],
  peopleAlsoAsk: [],
  relatedKeywords: [],
  internalLinks: [],
  externalSources: [],
  competitorWordCounts: [],
  competitorHeadings: [],
  recommendedWordCount: 2800,
})

describe('getMoneyPages', () => {
  it('sanitizes bad entries and caps at 5', () => {
    const metadata = {
      money_pages: [
        { url: 'https://a.com/servizi', keyword: ' k1 ' },
        { url: 'not-a-url', keyword: 'k2' }, // dropped: relative/invalid url
        { url: 'https://b.com/x', keyword: '' }, // dropped: empty keyword
        null,
        'garbage',
        ...Array.from({ length: 6 }, (_, i) => ({ url: `https://c.com/p${i}`, keyword: `k${i}` })),
      ],
    }
    const pages = getMoneyPages({ metadata } as never)
    expect(pages).toHaveLength(5)
    expect(pages[0]).toEqual({ url: 'https://a.com/servizi', keyword: 'k1', label: undefined })
  })

  it('returns [] for missing/invalid metadata', () => {
    expect(getMoneyPages(null)).toEqual([])
    expect(getMoneyPages({ metadata: {} } as never)).toEqual([])
  })
})

describe('rankMoneyPagesForKeyword', () => {
  it('puts the page with the highest keyword affinity first, keeps all pages', () => {
    const pages: MoneyPage[] = [
      { url: 'https://x.com/prezzi', keyword: 'listino prezzi software' },
      { url: 'https://x.com/servizi', keyword: 'produzione cosmetici conto terzi' },
    ]
    const ranked = rankMoneyPagesForKeyword(pages, 'migliori produttori cosmetici conto terzi')
    expect(ranked[0]!.url).toBe('https://x.com/servizi')
    expect(ranked).toHaveLength(2)
  })
})

describe('ensureMoneyPageLink', () => {
  it('wraps the keyword in a plain paragraph', () => {
    const html = '<p>La produzione conto terzi conviene.</p>'
    const out = ensureMoneyPageLink(html, [PAGE])
    expect(out).toBe(`<p>La <a href="${PAGE.url}">produzione conto terzi</a> conviene.</p>`)
  })

  it('wraps the keyword in a paragraph that contains inline markup', () => {
    const html = '<p>Molte aziende <strong>scelgono</strong> la produzione conto terzi per <em>scalare</em>.</p>'
    const out = ensureMoneyPageLink(html, [PAGE])
    expect(out).toContain(`la <a href="${PAGE.url}">produzione conto terzi</a> per`)
    expect(out).toContain('<strong>scelgono</strong>') // inline markup untouched
  })

  it('wraps the keyword when it sits INSIDE an inline element', () => {
    const html = '<p>Scopri la <strong>produzione conto terzi</strong> oggi.</p>'
    const out = ensureMoneyPageLink(html, [PAGE])
    expect(out).toContain(`<strong><a href="${PAGE.url}">produzione conto terzi</a></strong>`)
  })

  it('matches paragraphs that carry attributes', () => {
    const html = '<p style="color:#111">Guida alla produzione conto terzi.</p>'
    const out = ensureMoneyPageLink(html, [PAGE])
    expect(out).toContain(`<a href="${PAGE.url}">produzione conto terzi</a>`)
  })

  it('NEVER wraps a keyword that is inside an existing anchor (no nested <a>)', () => {
    const html = '<p>Vedi <a href="https://other.com">la produzione conto terzi spiegata</a> qui.</p>'
    const out = ensureMoneyPageLink(html, [PAGE])
    expect(out).not.toMatch(/<a[^>]*>[^<]*<a/) // no nested anchors
    // keyword only occurs inside the anchor → fallback editorial line is used instead
    expect(out).toContain(`Per approfondire, visita la nostra pagina su <a href="${PAGE.url}">`)
  })

  it('is idempotent: already-linked page (with or without trailing slash) is untouched', () => {
    const linked = `<p>Vedi la <a href="${PAGE.url}">produzione conto terzi</a>.</p>`
    expect(ensureMoneyPageLink(linked, [PAGE])).toBe(linked)
    const linkedSlash = `<p>Vedi <a href="${PAGE.url}/">qui</a>. E la produzione conto terzi.</p>`
    expect(ensureMoneyPageLink(linkedSlash, [PAGE])).toBe(linkedSlash)
    // running twice never doubles the link
    const once = ensureMoneyPageLink('<p>La produzione conto terzi conviene.</p>', [PAGE])
    expect(ensureMoneyPageLink(once, [PAGE])).toBe(once)
  })

  it('appends the editorial pointer after the first H2 section when the keyword never occurs', () => {
    const html =
      '<!-- wp:heading {"level":2} --><h2>Intro</h2><!-- /wp:heading -->' +
      '<!-- wp:paragraph --><p>Testo senza la parola chiave.</p><!-- /wp:paragraph -->'
    const out = ensureMoneyPageLink(html, [PAGE])
    expect(out).toContain(`Per approfondire, visita la nostra pagina su <a href="${PAGE.url}">${PAGE.keyword}</a>.`)
    expect(out.indexOf('Per approfondire')).toBeGreaterThan(out.indexOf('Testo senza'))
  })

  it('uses the English pointer for en language', () => {
    const out = ensureMoneyPageLink('<p>No keyword here.</p>', [PAGE], 'en')
    expect(out).toContain('To go deeper, see our page on')
  })

  it('escapes regex metacharacters in the keyword', () => {
    const page: MoneyPage = { url: 'https://x.com/p', keyword: 'c++ (avanzato)' }
    const out = ensureMoneyPageLink('<p>Corso di c++ (avanzato) qui.</p>', [page])
    expect(out).toContain(`<a href="https://x.com/p">c++ (avanzato)</a>`)
  })

  it('returns html unchanged when there are no pages', () => {
    expect(ensureMoneyPageLink('<p>x</p>', [])).toBe('<p>x</p>')
  })
})

describe('boostMoneyPagesIntoResearch', () => {
  it('prepends money pages as top-relevance internal links, deduped by URL', () => {
    const research = emptyResearch()
    research.internalLinks = [
      { url: 'https://example.com/servizi/conto-terzi/', anchorText: 'già presente', relevanceScore: 1 },
      { url: 'https://example.com/blog/a', anchorText: 'post', relevanceScore: 1 },
    ]
    const other: MoneyPage = { url: 'https://example.com/prezzi', keyword: 'listino prezzi' }
    boostMoneyPagesIntoResearch(research, [PAGE, other])
    // PAGE already in the pool (trailing-slash variant) → only `other` is prepended
    expect(research.internalLinks).toHaveLength(3)
    expect(research.internalLinks[0]).toEqual({ url: other.url, anchorText: other.keyword, relevanceScore: 100 })
  })

  it('is a no-op without money pages', () => {
    const research = emptyResearch()
    boostMoneyPagesIntoResearch(research, [])
    expect(research.internalLinks).toEqual([])
  })
})

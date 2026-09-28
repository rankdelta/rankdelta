import { describe, expect, it } from 'vitest'
import {
  buildArticleJsonLd,
  buildFaqJsonLd,
  buildOrgJsonLd,
  decodeEntities,
  extractArticleMeta,
  extractAuthor,
  extractFaqPairs,
  extractOrgProfile,
  extractSocialLinks,
  generateSchemaForUrl,
  htmlToText,
  isQuestionHeading,
  recoverPublishDate,
  type OrgProfile,
} from './schemaGenerator'

describe('isQuestionHeading', () => {
  it('detects headings ending in a question mark', () => {
    expect(isQuestionHeading('What is GEO?')).toBe(true)
    expect(isQuestionHeading('Come funziona?  ')).toBe(true)
  })
  it('detects question-word openers without a mark (IT + EN)', () => {
    expect(isQuestionHeading('How to optimize for AI')).toBe(true)
    expect(isQuestionHeading('Quando conviene usare lo schema')).toBe(true)
  })
  it('detects an accented Italian "Perche..." opener regardless of encoding', () => {
    expect(isQuestionHeading('Perché scegliere Rankdelta')).toBe(true) // precomposed
    expect(isQuestionHeading('Perché usare lo schema')).toBe(true) // decomposed
  })
  it('is false for plain statement headings and empty text', () => {
    expect(isQuestionHeading('Our pricing plans')).toBe(false)
    expect(isQuestionHeading('   ')).toBe(false)
  })
})

describe('htmlToText / decodeEntities', () => {
  it('separates list items with spaces instead of concatenating them', () => {
    expect(htmlToText('<ul><li>uno</li><li>due</li></ul>')).toBe('uno due')
  })
  it('decodes common entities', () => {
    expect(decodeEntities('Cani &amp; gatti &#39;top&#39;')).toBe("Cani & gatti 'top'")
  })
})

describe('extractFaqPairs', () => {
  const html = `
    <h2>Cosa e' il GEO?</h2>
    <p>Il GEO ottimizza i contenuti per i motori di risposta AI come ChatGPT.</p>
    <h3>Perché serve lo schema FAQ?</h3>
    <ul><li>Aiuta l'estrazione</li><li>Migliora la citabilità nelle risposte AI</li></ul>
    <h2>Prezzi</h2>
    <p>Questa non e' una domanda e non deve diventare una coppia FAQ mai.</p>
  `
  it('extracts >=2 clean question/answer pairs and ignores non-question headings', () => {
    const pairs = extractFaqPairs(html)
    expect(pairs.length).toBe(2)
    expect(pairs[0]!.question).toContain('GEO')
    expect(pairs[0]!.answer).toContain('ChatGPT')
    // The list answer is space-joined, not concatenated.
    expect(pairs[1]!.answer).toContain('estrazione')
    expect(pairs[1]!.answer).toContain('citabilità')
    // The non-question "Prezzi" heading is not captured.
    expect(pairs.some((p) => /prezzi/i.test(p.question))).toBe(false)
  })

  it('drops a question whose answer is empty or too short', () => {
    const thin = `<h2>Che cos'è?</h2><p>ok</p><h2>Altro titolo qui</h2>`
    expect(extractFaqPairs(thin).length).toBe(0)
  })

  it('yields a single pair when only one question has a real answer (=> caller skips FAQPage)', () => {
    const one = `<h2>Come funziona il sistema di audit?</h2><p>Analizza il contenuto esistente della pagina e genera JSON-LD pronto da incollare.</p>`
    expect(extractFaqPairs(one).length).toBe(1)
  })

  it('ignores content inside script/style blocks', () => {
    const withScript = `
      <h2>Domanda vera sul funzionamento?</h2>
      <p>Ecco una risposta abbastanza lunga da essere valida per lo schema FAQ.</p>
      <script>var q = "<h2>fake?</h2><p>this should never be parsed as an answer block</p>";</script>
    `
    const pairs = extractFaqPairs(withScript)
    expect(pairs.length).toBe(1)
    expect(pairs.some((p) => /fake/i.test(p.question))).toBe(false)
  })
})

describe('recoverPublishDate', () => {
  it('prefers an existing Article JSON-LD datePublished', () => {
    const html = `<script type="application/ld+json">{"@type":"Article","datePublished":"2024-03-08T09:00:00Z"}</script>`
    expect(recoverPublishDate(html)?.slice(0, 10)).toBe('2024-03-08')
  })
  it('falls back to a visible dd/mm/yyyy byline', () => {
    const html = `<span class="meta">Pubblicato: 08/03/2024</span>`
    expect(recoverPublishDate(html)?.slice(0, 10)).toBe('2024-03-08')
  })
  it('reads an ISO-form visible byline', () => {
    const html = `<p>Updated: 2025-11-30 by the team</p>`
    expect(recoverPublishDate(html)?.slice(0, 10)).toBe('2025-11-30')
  })
  it('returns undefined when no date is present', () => {
    expect(recoverPublishDate('<p>no dates here at all</p>')).toBeUndefined()
  })
})

describe('extractAuthor', () => {
  it('reads meta[name=author]', () => {
    expect(extractAuthor('<meta name="author" content="Angelo Sorbello">')).toBe('Angelo Sorbello')
  })
  it('reads a rel=author link', () => {
    expect(extractAuthor('<a rel="author" href="/x">Mario Rossi</a>')).toBe('Mario Rossi')
  })
  it('reads a JSON-LD Person name in either attribute order', () => {
    expect(extractAuthor('<script>{"@type":"Person","name":"Luca Bianchi"}</script>')).toBe('Luca Bianchi')
    expect(extractAuthor('<script>{"name":"Sara Verdi","@type":"Person"}</script>')).toBe('Sara Verdi')
  })
})

describe('extractArticleMeta', () => {
  it('takes headline + author + datePublished from existing JSON-LD', () => {
    const html = `
      <title>Guida al GEO | Rankdelta</title>
      <meta property="og:title" content="Guida completa al GEO">
      <a rel="author" href="/a">Angelo Sorbello</a>
      <script type="application/ld+json">{"@type":"Article","datePublished":"2023-06-01"}</script>
    `
    const meta = extractArticleMeta(html)
    expect(meta.headline).toBe('Guida completa al GEO') // og:title wins over <title>
    expect(meta.author).toBe('Angelo Sorbello')
    expect(meta.datePublished?.slice(0, 10)).toBe('2023-06-01')
  })

  it('recovers datePublished from a visible byline when no JSON-LD date exists', () => {
    const html = `<title>Blog post</title><div class="byline">Published: 12/01/2025</div>`
    const meta = extractArticleMeta(html)
    expect(meta.headline).toBe('Blog post')
    expect(meta.datePublished?.slice(0, 10)).toBe('2025-01-12')
  })

  it('yields an empty headline when the page has no title/og:title', () => {
    expect(extractArticleMeta('<p>bodyless</p>').headline).toBe('')
  })
})

describe('extractSocialLinks', () => {
  it('collects brand social profiles, de-duplicates, and skips share/intent endpoints', () => {
    const html = `
      <a href="https://twitter.com/rankdelta">tw</a>
      <a href="https://www.linkedin.com/company/rankdelta/">li</a>
      <a href="https://twitter.com/intent/tweet?url=x">share</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=x">fb-share</a>
      <a href="https://instagram.com/rankdelta">ig</a>
      <a href="https://twitter.com/rankdelta">tw-dup</a>
      <a href="https://example.com/blog">not social</a>
    `
    const links = extractSocialLinks(html)
    expect(links).toContain('https://twitter.com/rankdelta')
    expect(links).toContain('https://www.linkedin.com/company/rankdelta/')
    expect(links).toContain('https://instagram.com/rankdelta')
    expect(links.some((l) => /intent|sharer/.test(l))).toBe(false)
    expect(links.filter((l) => l.includes('twitter.com/rankdelta')).length).toBe(1)
    expect(links.some((l) => l.includes('example.com'))).toBe(false)
  })
})

describe('extractOrgProfile', () => {
  it('resolves name (og:site_name), origin url, absolute logo and sameAs', () => {
    const html = `
      <meta property="og:site_name" content="Rankdelta">
      <meta property="og:image" content="/logo.png">
      <a href="https://linkedin.com/company/rankdelta">li</a>
    `
    const org = extractOrgProfile(html, 'https://rankdelta.ai/blog/geo-guide?ref=1')
    expect(org.name).toBe('Rankdelta')
    expect(org.url).toBe('https://rankdelta.ai')
    expect(org.logo).toBe('https://rankdelta.ai/logo.png') // relative -> absolute against origin
    expect(org.sameAs).toContain('https://linkedin.com/company/rankdelta')
  })

  it('derives the brand from the <title> when og:site_name is absent', () => {
    const org = extractOrgProfile('<title>Guida al GEO | Rankdelta</title>', 'https://rankdelta.ai/x')
    expect(org.name).toBe('Rankdelta')
  })

  it('leaves name undefined when neither og:site_name nor a title brand is present', () => {
    const org = extractOrgProfile('<title>Single</title>', 'https://rankdelta.ai/x')
    expect(org.name).toBeUndefined()
  })
})

describe('JSON-LD builders', () => {
  it('FAQPage node has the correct @context/@type and Question shape', () => {
    const node = buildFaqJsonLd([{ question: 'Q?', answer: 'A long enough answer.' }]) as Record<string, unknown>
    expect(node['@context']).toBe('https://schema.org')
    expect(node['@type']).toBe('FAQPage')
    const main = node['mainEntity'] as Array<Record<string, unknown>>
    expect(main[0]!['@type']).toBe('Question')
    const accepted = main[0]!['acceptedAnswer'] as Record<string, unknown>
    expect(accepted['@type']).toBe('Answer')
    expect(accepted['text']).toBe('A long enough answer.')
  })

  it('Article node carries context/type, dateModified, and publisher when org name exists', () => {
    const org: OrgProfile = { name: 'Rankdelta', url: 'https://rankdelta.ai', logo: 'https://rankdelta.ai/l.png', sameAs: [] }
    const node = buildArticleJsonLd(
      { headline: 'H', author: 'A', datePublished: '2024-01-01T00:00:00.000Z' },
      'https://rankdelta.ai/p',
      org,
    ) as Record<string, unknown>
    expect(node['@context']).toBe('https://schema.org')
    expect(node['@type']).toBe('Article')
    expect(typeof node['dateModified']).toBe('string')
    expect(node['datePublished']).toBe('2024-01-01T00:00:00.000Z')
    expect((node['author'] as Record<string, unknown>)['name']).toBe('A')
    expect((node['publisher'] as Record<string, unknown>)['name']).toBe('Rankdelta')
  })

  it('Organization node includes sameAs only when non-empty', () => {
    const withSocial = buildOrgJsonLd({ name: 'R', url: 'https://r.ai', sameAs: ['https://x.com/r'] }) as Record<string, unknown>
    expect(withSocial['@type']).toBe('Organization')
    expect(withSocial['sameAs']).toEqual(['https://x.com/r'])
    const noSocial = buildOrgJsonLd({ name: 'R', url: 'https://r.ai', sameAs: [] }) as Record<string, unknown>
    expect('sameAs' in noSocial).toBe(false)
  })
})

describe('generateSchemaForUrl (offline via opts.html)', () => {
  const richHtml = `
    <title>Guida al GEO | Rankdelta</title>
    <meta property="og:site_name" content="Rankdelta">
    <meta property="og:image" content="https://rankdelta.ai/logo.png">
    <a rel="author" href="/a">Angelo Sorbello</a>
    <script type="application/ld+json">{"@type":"Article","datePublished":"2024-05-01"}</script>
    <a href="https://linkedin.com/company/rankdelta">li</a>
    <h2>Cosa e' il GEO?</h2>
    <p>Il GEO ottimizza i contenuti per farsi citare dai motori di risposta AI.</p>
    <h2>Perché usare lo schema?</h2>
    <p>Perché rende le risposte estraibili e migliora la citabilità nelle AI answers.</p>
  `

  it('emits FAQPage + Article + Organization from a rich page, with no network call', async () => {
    const res = await generateSchemaForUrl('https://rankdelta.ai/blog/geo', { html: richHtml, language: 'en' })
    const types = res.generated.map((g) => g.type)
    expect(types).toEqual(['FAQPage', 'Article', 'Organization'])
    expect(res.skipped.length).toBe(0)
    for (const g of res.generated) {
      expect((g.jsonLd as Record<string, unknown>)['@context']).toBe('https://schema.org')
      expect((g.jsonLd as Record<string, unknown>)['@type']).toBe(g.type)
    }
    // English summaries when language=en.
    expect(res.generated[0]!.summary).toMatch(/FAQPage schema/)
  })

  it('skips FAQPage with a localized reason when only one pair is found', async () => {
    const html = `<title>Post | Rankdelta</title><h2>Come funziona?</h2><p>Una sola risposta valida ma sufficientemente lunga per passare.</p>`
    const res = await generateSchemaForUrl('https://rankdelta.ai/x', { html, language: 'it' })
    expect(res.generated.some((g) => g.type === 'FAQPage')).toBe(false)
    const faqSkip = res.skipped.find((s) => s.type === 'FAQPage')
    expect(faqSkip?.reason).toMatch(/solo 1 coppia FAQ/)
  })

  it('skips Article and Organization when there is no title at all', async () => {
    const res = await generateSchemaForUrl('https://rankdelta.ai/x', { html: '<p>just body text, no title</p>' })
    expect(res.skipped.map((s) => s.type)).toEqual(expect.arrayContaining(['Article', 'Organization']))
    expect(res.generated.some((g) => g.type === 'Article')).toBe(false)
  })

  it('returns all-skipped when html is empty', async () => {
    const res = await generateSchemaForUrl('https://rankdelta.ai/x', { html: '' })
    expect(res.generated.length).toBe(0)
    expect(res.skipped.length).toBe(3)
  })
})

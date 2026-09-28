import { describe, it, expect } from 'vitest'
import { validateArticle } from './contentValidator'
import type { ArticleContent, ResearchResult } from './types'

/**
 * Regression: an ENGLISH article must not be penalized for using English section labels.
 * Before the language fix, the validator only recognized the Italian labels ("Risposta rapida",
 * "Fonti", "A cura del team"), so a correct English article scored as if it were missing the
 * quick-answer box, the sources section and the author line.
 */

const research: ResearchResult = {
  keyword: 'pour-over coffee kit',
  serpTopUrls: [],
  peopleAlsoAsk: [],
  relatedKeywords: [],
  internalLinks: [],
  externalSources: [],
  competitorWordCounts: [],
  competitorHeadings: [],
  recommendedWordCount: 2800,
}

const article = (html: string): ArticleContent => ({
  title: 'Pour-over coffee kit',
  slug: 'pour-over-coffee-kit',
  metaTitle: 'Pour-over coffee kit',
  metaDescription: '',
  focusKeyword: 'pour-over coffee kit',
  gutenbergContent: html,
  wordCount: 0,
  seoScore: 0,
  geoScore: 0,
  language: 'en',
  authorLine: '',
  imageSearchTerms: ['pour-over coffee kit'],
})

describe('validateArticle — English GEO signals', () => {
  it('recognizes English quick-answer / sources / author labels', () => {
    const html = `
<div class="quick-answer-box"><h2>⚡ Quick Answer</h2><p>Smoking a cocktail infuses it with aromatic wood smoke.</p></div>
<h2>How it works</h2><p>Some body.</p>
<h2>Sources</h2><ol><li><a href="https://www.iso.org/">ISO</a></li></ol>
<p><strong>By the Acme Team | Published: 6 July 2026</strong></p>`
    const { stats } = validateArticle(article(html), research, { siteUrl: 'https://acme.com' })
    expect(stats.hasQuickAnswer).toBe(true)
    expect(stats.hasFonti).toBe(true)
    expect(stats.hasAuthorLine).toBe(true)
  })

  it('still recognizes the Italian labels (no regression)', () => {
    const html = `
<div class="quick-answer-box"><h2>⚡ Risposta rapida</h2><p>Testo.</p></div>
<h2>Fonti</h2><ol><li><a href="https://www.iso.org/">ISO</a></li></ol>
<p><strong>A cura del team Acme | Pubblicato: 6 luglio 2026</strong></p>`
    const { stats } = validateArticle(article(html), research, { siteUrl: 'https://acme.com' })
    expect(stats.hasQuickAnswer).toBe(true)
    expect(stats.hasFonti).toBe(true)
    expect(stats.hasAuthorLine).toBe(true)
  })
})

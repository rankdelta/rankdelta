import { describe, expect, it } from 'vitest'
import { buildBlogPostPrompts } from './openai'
import { REFRESH_DATA_RULE } from './contentRefresh'
import { WRITING_SYSTEM_PROMPT, buildWritingPrompt, stripUnlistedExternalLinks } from './agent/writingAgent'
import { validateArticle } from './agent/contentValidator'
import { noFabricationRules, sourceNeededPlaceholder } from '../lib/contentIntegrity'
import type { ArticleContent, ResearchResult } from './agent/types'

/**
 * Founder rule: generated content must never fabricate stats, studies, experts, case studies,
 * sources or experience. These tests pin the prompt contracts so the fabrication-inducing
 * instructions cannot come back.
 */

const FORBIDDEN = [
  'che sembrino derivare',
  'Secondo il Dr',
  'CASE STUDY DETTAGLIATI',
  'VISSUTO',
  '60-70%',
  'anni di esperienza',
  'Secondo gli esperti',
  'secondo gli esperti',
  'storia personale',
  'Almeno 3 citazioni',
  'URL-FONTE',
  'secondo la letteratura',
]

const blogParams = {
  topic: 'How to choose a CRM',
  primaryKeyword: 'choose a crm',
  tone: 'professional',
  length: 1500,
  language: 'en',
}

describe('generateBlogPost prompts', () => {
  it('contain the no-fabrication rule and none of the fabrication-inducing instructions', () => {
    const { systemPrompt, userPrompt } = buildBlogPostPrompts(blogParams)
    const all = systemPrompt + userPrompt
    expect(all).toContain('NEVER invent facts')
    expect(all).toContain('[Source needed:')
    expect(all).toContain('[ADD:')
    for (const phrase of FORBIDDEN) expect(all).not.toContain(phrase)
  })

  it('state the output language and write placeholders in it', () => {
    const { systemPrompt, userPrompt } = buildBlogPostPrompts({ ...blogParams, language: 'de' })
    expect(systemPrompt).toContain('OUTPUT LANGUAGE: German')
    expect(userPrompt).toContain('in German')
    expect(systemPrompt).toContain('[Quelle erforderlich:')
  })

  it('never asks for an author bio with credentials when no author is configured', () => {
    const { systemPrompt, userPrompt } = buildBlogPostPrompts(blogParams)
    expect(systemPrompt).toContain('Do NOT write a byline')
    expect(userPrompt).toContain('No byline')
  })

  it('uses the real author line verbatim when configured', () => {
    const { systemPrompt } = buildBlogPostPrompts({ ...blogParams, authorName: 'Jane Doe', authorBio: 'CRM consultant.' })
    expect(systemPrompt).toContain('*Written by Jane Doe. CRM consultant.*')
  })
})

describe('refresh prompt', () => {
  it('forbids new numbers and asks for placeholders in the article language', () => {
    const rule = REFRESH_DATA_RULE('it')
    expect(rule).toContain('Never write new numbers')
    expect(rule).toContain('[Fonte necessaria:')
  })
})

const research = (externalSources: ResearchResult['externalSources'] = []): ResearchResult => ({
  keyword: 'crm software',
  serpTopUrls: [],
  peopleAlsoAsk: [],
  relatedKeywords: [],
  internalLinks: [{ url: 'https://acme.com/blog/crm-basics', anchorText: 'CRM basics', relevanceScore: 0.9 }],
  externalSources,
  competitorWordCounts: [],
  competitorHeadings: [],
  recommendedWordCount: 2800,
})

const config = { siteName: 'Acme', siteUrl: 'https://acme.com', niche: 'software', language: 'en', targetWordCount: 2000 }

describe('writing agent prompts', () => {
  it('drop the expert note and sources section when there are no verified sources', () => {
    const system = WRITING_SYSTEM_PROMPT(config, false)
    const user = buildWritingPrompt('crm software', research(), config, '1 Sep 2026')
    const all = system + user
    expect(all).toContain('NESSUNA SEZIONE FONTI')
    expect(system).not.toContain('Blocco note-esperto')
    expect(all).toContain('[Source needed:')
    for (const phrase of FORBIDDEN) expect(all).not.toContain(phrase)
  })

  it('build the sources section from the real verified URLs only', () => {
    const src = [{ url: 'https://www.nist.gov/crm', title: 'NIST CRM', domain: 'nist.gov', isAuthoritative: true, snippet: '' }]
    const user = buildWritingPrompt('crm software', research(src), config, '1 Sep 2026')
    expect(user).toContain('<li><a href="https://www.nist.gov/crm" target="_blank" rel="noopener">NIST CRM</a></li>')
    expect(user).not.toContain('URL-FONTE')
    expect(WRITING_SYSTEM_PROMPT(config, true)).toContain('note-esperto')
  })
})

describe('stripUnlistedExternalLinks', () => {
  const html =
    '<p>See <a href="https://www.nist.gov/crm/">NIST</a>, <a href="https://made-up-journal.org/study-2024">a 2024 study</a>, ' +
    '<a href="https://acme.com/pricing">pricing</a> and <a href="/about">about</a>.</p>'

  it('unwraps external links that are not verified sources and flags them', () => {
    const { html: out, removed } = stripUnlistedExternalLinks(html, {
      allowedUrls: ['https://nist.gov/crm'],
      siteUrl: 'https://www.acme.com',
      language: 'en',
    })
    expect(removed).toEqual(['https://made-up-journal.org/study-2024'])
    expect(out).toContain('a 2024 study [Source needed]')
    expect(out).toContain('href="https://www.nist.gov/crm/"')
    expect(out).toContain('href="https://acme.com/pricing"')
    expect(out).toContain('href="/about"')
  })
})

const article = (html: string): ArticleContent => ({
  title: 'CRM', slug: 'crm', metaTitle: 'CRM', metaDescription: '', focusKeyword: 'crm software',
  gutenbergContent: html, wordCount: 0, seoScore: 0, geoScore: 0, language: 'en', authorLine: '', imageSearchTerms: [],
})

describe('validator', () => {
  it('flags template source URLs as placeholder links', () => {
    const { stats } = validateArticle(article('<ol><li><a href="https://URL-FONTE-1">Fonte 1</a></li></ol>'), research(), { siteUrl: 'https://acme.com' })
    expect(stats.placeholderLinks.length).toBe(1)
  })

  it('treats missing authoritative sources as a warning, not an error', () => {
    const { issues } = validateArticle(article('<p>No sources here.</p>'), research(), { siteUrl: 'https://acme.com' })
    const issue = issues.find((i) => i.code === 'insufficient_authoritative_externals')
    expect(issue?.severity).toBe('warning')
  })
})

describe('contentIntegrity helpers', () => {
  it('localise placeholders', () => {
    expect(sourceNeededPlaceholder('fr', '12 %')).toBe('[Source nécessaire: 12 %]')
    expect(sourceNeededPlaceholder('en')).toBe('[Source needed]')
    expect(noFabricationRules('es')).toContain('[Fuente necesaria:')
    expect(noFabricationRules('es')).toContain('[AÑADIR:')
  })
})

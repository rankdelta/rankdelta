import { describe, expect, it } from 'vitest'
import { looksTruncated, wordCount } from './contentRevisions'
import { ENHANCER_SYSTEM_PROMPT } from '../components/content/AIContentEnhancer'

describe('looksTruncated', () => {
  const article = 'word '.repeat(1000)
  it('flags a rewrite that lost the end of the article', () => {
    expect(looksTruncated(article, 'word '.repeat(600))).toBe(true)
  })
  it('accepts a rewrite that kept or grew the article', () => {
    expect(looksTruncated(article, 'word '.repeat(1400))).toBe(false)
    expect(looksTruncated(article, 'word '.repeat(950))).toBe(false)
  })
  it('counts words', () => {
    expect(wordCount('  a b\n c ')).toBe(3)
    expect(wordCount('')).toBe(0)
  })
})

describe('AI Content Enhancer prompt', () => {
  it('forbids invented facts and asks for [ADD: …] notes instead', () => {
    expect(ENHANCER_SYSTEM_PROMPT).toContain('NEVER invent facts')
    expect(ENHANCER_SYSTEM_PROMPT).toContain('ADD:')
    expect(ENHANCER_SYSTEM_PROMPT).toContain('same language as the article')
  })
})

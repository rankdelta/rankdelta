import { describe, expect, it } from 'vitest'
import { buildRevisionPrompt } from './contentRevisionPrompt'

const body = `${'parola '.repeat(99)}fine`

describe('buildRevisionPrompt', () => {
  it('always sends the full original article', () => {
    for (const mode of ['expand', 'rewrite', 'improve', 'shorten'] as const) {
      const { prompt } = buildRevisionPrompt({ mode, body, primaryKeyword: 'kw', tone: 'friendly' })
      expect(prompt).toContain(body)
    }
  })

  it('scales the target length per mode', () => {
    const len = (mode: 'expand' | 'shorten' | 'rewrite') =>
      buildRevisionPrompt({ mode, body, primaryKeyword: '', tone: 't' }).targetLength
    expect(len('expand')).toBe(150)
    expect(len('shorten')).toBe(70)
    expect(len('rewrite')).toBe(100)
  })

  it('includes the editor instructions only when given', () => {
    const withIt = buildRevisionPrompt({ mode: 'improve', body, primaryKeyword: 'kw', tone: 't', instructions: '  add a FAQ ' })
    expect(withIt.prompt).toContain('Additional instructions from the editor: add a FAQ')
    const without = buildRevisionPrompt({ mode: 'improve', body, primaryKeyword: 'kw', tone: 't', instructions: '   ' })
    expect(without.prompt).not.toContain('Additional instructions')
  })
})

import { describe, it, expect } from 'vitest'
import { slugToTitle, makeReason, buildLlmsTxtPages, renderLlmsTxt } from './llmsTxt'

const OPTS = {
	siteUrl: 'https://example.com',
	pages: [
		{ url: 'https://example.com/', title: 'Example' },
		{ url: 'https://example.com/docs/getting-started' },
		{ url: 'https://example.com/pricing' },
		{ url: 'https://example.com/about' },
		{ url: 'https://example.com/blog/my-first-post' },
	],
}

describe('slugToTitle', () => {
	it('humanizes slugs', () => {
		expect(slugToTitle('getting-started')).toBe('Getting Started')
		expect(slugToTitle('multi_word-here')).toBe('Multi Word Here')
	})
})

describe('makeReason', () => {
	it('explains homepage, docs, pricing, and exclusions', () => {
		expect(makeReason('/')).toMatch(/entry point/)
		expect(makeReason('/docs/api')).toMatch(/Reference/)
		expect(makeReason('/pricing')).toMatch(/pricing/i)
		expect(makeReason('/login')).toMatch(/Excluded/)
	})
})

describe('buildLlmsTxtPages', () => {
	it('keeps same-origin content pages and drops junk', () => {
		const res = buildLlmsTxtPages({
			...OPTS,
			pages: [
				...OPTS.pages,
				{ url: 'https://other.com/x' },
				{ url: 'not a url' },
				{ url: 'https://example.com/login' },
				{ url: 'https://example.com/logo.png' },
				{ url: 'https://example.com/pricing/' }, // trailing slash dup
			],
		})
		expect(res.included).toHaveLength(5)
		expect(res.excluded).toBe(5)
		expect(res.included.every((p) => p.section !== null)).toBe(true)
	})

	it('orders sections Docs → Product → Company → Optional', () => {
		const { included } = buildLlmsTxtPages(OPTS)
		expect(included[0]!.section).toBe('Docs')
		expect(included.map((p) => p.title)).toContain('Pricing')
	})

	it('throws on invalid site url', () => {
		expect(() => buildLlmsTxtPages({ ...OPTS, siteUrl: '' })).toThrow()
	})
})

describe('renderLlmsTxt', () => {
	it('renders h1, optional blockquote, and per-section lists', () => {
		const txt = renderLlmsTxt({
			...OPTS,
			siteName: 'Example Co',
			description: 'We do things.',
		})
		expect(txt).toMatch(/^# Example Co\n/)
		expect(txt).toContain('> We do things.')
		expect(txt).toContain('## Docs')
		expect(txt).toContain('- [Getting Started](https://example.com/docs/getting-started)')
		expect(txt.endsWith('\n')).toBe(true)
	})

	it('falls back site name to hostname and skips empty sections', () => {
		const txt = renderLlmsTxt({ siteUrl: 'https://www.mysite.it', pages: [{ url: 'https://www.mysite.it/' }] })
		expect(txt).toMatch(/^# mysite\.it\n/)
		expect(txt).not.toContain('## Docs')
	})
})

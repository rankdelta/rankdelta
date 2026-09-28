import { describe, expect, it } from 'vitest';
import {
	buildCannibalizationReport,
	extractSiteUrlsFromSerpRaw,
	isLikelyCommercialPath,
	isLikelyInformationalPath,
} from './cannibalizationReport';

const sampleRaw = {
	tasks: [
		{
			result: [
				{
					items: [
						{ type: 'organic', url: 'https://example.com/blog/guide', rank_absolute: 8, title: 'Blog' },
						{ type: 'organic', url: 'https://example.com/products/widget', rank_absolute: 14, title: 'Widget' },
						{ type: 'organic', url: 'https://other.com/x', rank_absolute: 1, title: 'Other' },
					],
				},
			],
		},
	],
};

describe('extractSiteUrlsFromSerpRaw', () => {
	it('returns site organic URLs sorted by position', () => {
		const urls = extractSiteUrlsFromSerpRaw(sampleRaw, 'https://example.com');
		expect(urls).toHaveLength(2);
		expect(urls[0]?.url).toContain('/blog/');
		expect(urls[1]?.url).toContain('/products/');
	});
});

describe('path heuristics', () => {
	it('flags informational paths', () => {
		expect(isLikelyInformationalPath('https://x.com/')).toBe(true);
		expect(isLikelyInformationalPath('https://x.com/blog/post')).toBe(true);
	});
	it('flags commercial paths', () => {
		expect(isLikelyCommercialPath('https://x.com/products/foo')).toBe(true);
	});
});

describe('buildCannibalizationReport', () => {
	it('detects multi-url and wrong-url issues', () => {
		const kw = {
			id: 'k1',
			phrase: 'widget shop',
			project_id: 'p1',
			is_active: true,
			created_at: '',
			updated_at: '',
		};
		const snap = {
			id: 's1',
			keyword_id: 'k1',
			rank_absolute: 8,
			ranking_url: 'https://example.com/blog/guide',
			result_title: 'Blog',
			serp_organic_count: 10,
			raw_response: sampleRaw,
			status: 'completed' as const,
			checked_at: '2026-01-01T00:00:00Z',
			cost_usd: 0,
			error_message: null,
		};
		const rows = buildCannibalizationReport({
			siteUrl: 'https://example.com',
			keywords: [kw],
			latestByKeyword: new Map([['k1', snap]]),
			moneyPages: [{ url: 'https://example.com/products/widget', keyword: 'widget shop' }],
		});
		expect(rows.some((r) => r.kind === 'multi_url')).toBe(true);
		expect(rows.some((r) => r.kind === 'wrong_url')).toBe(true);
	});
});

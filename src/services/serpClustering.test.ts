import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the paid SERP fetch and the quota-error classifier so the test is pure/offline.
const getSerpInsights = vi.fn();
vi.mock('./dataforseo', () => ({ getSerpInsights: (...a: unknown[]) => getSerpInsights(...a) }));
vi.mock('../lib/proxyErrorMessage', () => ({
	isProxyQuotaError: (e: unknown) => e instanceof Error && e.message === 'QUOTA',
}));

import { clusterIdeasBySerp } from './serpClustering';

const serp = (urls: string[]) => ({
	organic: urls.map((url, i) => ({ title: url, url, description: '', position: i + 1 })),
	peopleAlsoAsk: [],
	relatedSearches: [],
});

beforeEach(() => getSerpInsights.mockReset());

describe('clusterIdeasBySerp', () => {
	it('fetches each keyword and clusters by shared SERP URLs; reports progress', async () => {
		const serps: Record<string, string[]> = {
			'a': ['u1', 'u2', 'u3', 'u4'],
			'b': ['u1', 'u2', 'u3', 'z9'], // shares 3 with a → same cluster
			'c': ['x1', 'x2', 'x3', 'x4'], // shares 0 → its own cluster
		};
		getSerpInsights.mockImplementation((kw: string) => Promise.resolve(serp(serps[kw] ?? [])));
		const progress: Array<[number, number]> = [];
		const clusters = await clusterIdeasBySerp(
			[{ keyword: 'a', volume: 100 }, { keyword: 'b', volume: 80 }, { keyword: 'c', volume: 50 }],
			{ locationCode: 2840, languageCode: 'en', minShared: 3, concurrency: 1, onProgress: (d, t) => progress.push([d, t]) },
		);
		expect(getSerpInsights).toHaveBeenCalledTimes(3);
		expect(clusters.length).toBe(2);
		const ab = clusters.find((c) => c.size === 2)!;
		expect(ab.keywords.map((k) => k.keyword).sort()).toEqual(['a', 'b']);
		expect(progress[progress.length - 1]).toEqual([3, 3]);
	});

	it('dedupes case-insensitively and caps at maxKeywords', async () => {
		getSerpInsights.mockResolvedValue(serp(['u1', 'u2', 'u3']));
		await clusterIdeasBySerp(
			[{ keyword: 'Shoes' }, { keyword: 'shoes' }, { keyword: 'boots' }, { keyword: 'hats' }],
			{ locationCode: 2840, languageCode: 'en', maxKeywords: 2, concurrency: 1 },
		);
		// 'Shoes'/'shoes' dedupe to one, then cap at 2 distinct → 2 fetches.
		expect(getSerpInsights).toHaveBeenCalledTimes(2);
	});

	it('treats a non-budget SERP failure as a singleton, not a fatal error', async () => {
		getSerpInsights.mockImplementation((kw: string) =>
			kw === 'bad' ? Promise.reject(new Error('timeout')) : Promise.resolve(serp(['u1', 'u2', 'u3'])),
		);
		const clusters = await clusterIdeasBySerp(
			[{ keyword: 'good1', volume: 10 }, { keyword: 'good2', volume: 9 }, { keyword: 'bad', volume: 8 }],
			{ locationCode: 2840, languageCode: 'en', minShared: 3, concurrency: 1 },
		);
		// good1/good2 share 3 URLs → one cluster; bad has no SERP → its own singleton.
		expect(clusters.length).toBe(2);
		expect(clusters.some((c) => c.size === 1 && c.pivot === 'bad')).toBe(true);
	});
});

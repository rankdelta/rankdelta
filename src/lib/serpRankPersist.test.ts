import { describe, expect, it } from 'vitest';
import { escapeLikePattern, parseKeywordPhrases } from './serpRankPersist';

describe('escapeLikePattern', () => {
	it('escapes %, _ and backslash so ilike matches literally', () => {
		expect(escapeLikePattern('100% cotton_t-shirt\\x')).toBe('100\\% cotton\\_t-shirt\\\\x');
	});

	it('leaves plain phrases untouched', () => {
		expect(escapeLikePattern('best running shoes')).toBe('best running shoes');
	});
});

describe('parseKeywordPhrases', () => {
	it('splits on commas and newlines and dedupes case-insensitively', () => {
		expect(
			parseKeywordPhrases('alpha\nBeta, gamma ,beta\n\n  delta  '),
		).toEqual(['alpha', 'Beta', 'gamma', 'delta']);
	});

	it('returns empty for whitespace-only input', () => {
		expect(parseKeywordPhrases('  \n,  ')).toEqual([]);
	});
});

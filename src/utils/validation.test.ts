import { describe, it, expect } from 'vitest';
import { isValidKeyword } from './validation';

describe('isValidKeyword', () => {
	it('accepts accented and non-latin letters', () => {
		expect(isValidKeyword('caffè napoletano')).toBe(true);
		expect(isValidKeyword('maglie storiche calcio')).toBe(true);
		expect(isValidKeyword("l'aquila")).toBe(true);
		expect(isValidKeyword('über-alles')).toBe(true);
		expect(isValidKeyword('東京 ホテル')).toBe(true);
	});

	it('rejects symbols and too-short strings', () => {
		expect(isValidKeyword('a')).toBe(false);
		expect(isValidKeyword('seo @ home')).toBe(false);
		expect(isValidKeyword('')).toBe(false);
	});
});

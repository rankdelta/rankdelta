import { describe, expect, it } from 'vitest';
import {
	computeMentionShareOfVoice,
	computeWeightedSov,
	sovIsLowConfidence,
	SOV_MIN_CONFIDENT_SAMPLE,
	type QuerySovSample,
} from './visibilitySov';

describe('computeWeightedSov', () => {
	it('averages per-query share over ALL eligible queries — absent queries drag it toward 0', () => {
		// The "1 of 7 → 14%" bug: one query names you once among competitors, the rest are absent.
		const pooled = computeMentionShareOfVoice(1, 6); // legacy: 14.3%
		expect(pooled).toBeCloseTo(14.3, 1);

		const samples: QuerySovSample[] = [
			{ yours: 1, competitors: 6 }, // this query: ~14% share
			...Array.from({ length: 13 }, () => ({ yours: 0, competitors: 0 })), // 13 absent queries
		];
		const weighted = computeWeightedSov(samples);
		// (1/7 + 0*13) / 14 ≈ 1.0% — reflects real ~0 visibility instead of 14%.
		expect(weighted).toBeCloseTo(1.0, 1);
		expect(weighted!).toBeLessThan(pooled!);
	});

	it('gives 100 when you win every eligible query and 0 when absent from all', () => {
		expect(computeWeightedSov([{ yours: 3, competitors: 0 }, { yours: 1, competitors: 0 }])).toBe(100);
		expect(computeWeightedSov([{ yours: 0, competitors: 4 }, { yours: 0, competitors: 0 }])).toBe(0);
	});

	it('weights each query equally regardless of how many mentions it has', () => {
		// Query A: dominated by competitors (0/10 → 0%). Query B: split (5/5 → 50%). Mean = 25%
		// (each query counts once, so A's 10 competitor mentions don't outweigh B).
		expect(computeWeightedSov([{ yours: 0, competitors: 10 }, { yours: 5, competitors: 5 }])).toBe(25);
	});

	it('returns null only when there are no eligible queries', () => {
		expect(computeWeightedSov([])).toBeNull();
		expect(computeWeightedSov([{ yours: 0, competitors: 0 }])).toBe(0); // scanned-but-absent is data, not undefined
	});
});

describe('sovIsLowConfidence', () => {
	it('flags a small scanned sample but not zero (undefined) or a healthy sample', () => {
		expect(sovIsLowConfidence(0)).toBe(false);
		expect(sovIsLowConfidence(SOV_MIN_CONFIDENT_SAMPLE - 1)).toBe(true);
		expect(sovIsLowConfidence(SOV_MIN_CONFIDENT_SAMPLE)).toBe(false);
		expect(sovIsLowConfidence(50)).toBe(false);
	});
});

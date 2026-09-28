import { describe, expect, it } from 'vitest';
import {
	AGENCY_VISIBILITY_BATCH_MAX,
	buildVisibilityBatchSizeOptions,
	clampVisibilityBatchSize,
	defaultVisibilityBatchSize,
	resolveVisibilityPromptsCap,
} from './visibilityBatchCap';
import type { PlanConfiguration } from '../types/subscription';

const plan = (visibility_prompts: number | null): PlanConfiguration =>
	({ visibility_prompts }) as PlanConfiguration;

describe('resolveVisibilityPromptsCap', () => {
	it('uses plan visibility_prompts when set', () => {
		expect(resolveVisibilityPromptsCap(plan(10))).toBe(10);
		expect(resolveVisibilityPromptsCap(plan(20))).toBe(20);
		expect(resolveVisibilityPromptsCap(plan(30))).toBe(30);
	});

	it('falls back for agency/unlimited plans', () => {
		expect(resolveVisibilityPromptsCap(plan(null))).toBe(AGENCY_VISIBILITY_BATCH_MAX);
	});
});

describe('buildVisibilityBatchSizeOptions', () => {
	it('never exceeds the plan cap', () => {
		expect(buildVisibilityBatchSizeOptions(10)).toEqual([10]);
		expect(buildVisibilityBatchSizeOptions(20)).toEqual([10, 20]);
		expect(buildVisibilityBatchSizeOptions(30)).toEqual([10, 20, 30]);
		expect(buildVisibilityBatchSizeOptions(90).every((n) => n <= 90)).toBe(true);
	});

	it('returns empty list when cap is zero', () => {
		expect(buildVisibilityBatchSizeOptions(0)).toEqual([]);
	});
});

describe('defaultVisibilityBatchSize', () => {
	it('defaults to min(10, cap)', () => {
		expect(defaultVisibilityBatchSize(10)).toBe(10);
		expect(defaultVisibilityBatchSize(30)).toBe(10);
		expect(defaultVisibilityBatchSize(0)).toBe(0);
	});
});

describe('clampVisibilityBatchSize', () => {
	it('clamps within 1..cap', () => {
		expect(clampVisibilityBatchSize(60, 20)).toBe(20);
		expect(clampVisibilityBatchSize(5, 20)).toBe(5);
		expect(clampVisibilityBatchSize(0, 20)).toBe(1);
	});
});

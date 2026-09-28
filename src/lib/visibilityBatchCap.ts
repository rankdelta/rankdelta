import type { PlanConfiguration } from '../types/subscription';

/** Max selectable batch when plan visibility_prompts is null (Agency / self-host). */
export const AGENCY_VISIBILITY_BATCH_MAX = 90;

const BATCH_SIZE_STEPS = [10, 20, 30, 40, 60, 90] as const;

export const DEFAULT_VISIBILITY_BATCH_SIZE = 10;

/**
 * Resolve the per-plan cap on AI prompt generation batch size.
 * Null visibility_prompts (Agency) uses unlimitedFallback.
 */
export function resolveVisibilityPromptsCap(
	plan: PlanConfiguration | null | undefined,
	options?: { unlimitedFallback?: number },
): number {
	const fallback = options?.unlimitedFallback ?? AGENCY_VISIBILITY_BATCH_MAX;
	const raw = plan?.visibility_prompts;
	if (raw == null) return fallback;
	if (typeof raw === 'number' && raw > 0) return raw;
	return fallback;
}

/** Build ascending batch-size options that never exceed the plan cap. */
export function buildVisibilityBatchSizeOptions(cap: number): number[] {
	if (cap <= 0) return [];
	const steps: number[] = BATCH_SIZE_STEPS.filter((n) => n <= cap);
	if (steps.length === 0 || steps[steps.length - 1]! < cap) {
		if (!steps.includes(cap)) steps.push(cap);
	}
	return [...new Set(steps)].sort((a, b) => a - b);
}

/** Sensible default within cap — avoids pre-selecting a large, costly batch. */
export function defaultVisibilityBatchSize(cap: number): number {
	if (cap <= 0) return 0;
	return Math.min(DEFAULT_VISIBILITY_BATCH_SIZE, cap);
}

export function clampVisibilityBatchSize(value: number, cap: number): number {
	if (cap <= 0) return 0;
	return Math.min(Math.max(1, value), cap);
}

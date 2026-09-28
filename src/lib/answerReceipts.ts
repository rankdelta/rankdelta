import type { LlmProviderKey } from '../types/database';

/** Providers persisted on visibility_query_runs — must match visibility-ops KNOWN_VISIBILITY_PROVIDERS. */
export const ANSWER_RECEIPT_PROVIDERS = [
	'chatgpt',
	'perplexity',
	'gemini',
	'google_aio',
] as const satisfies readonly LlmProviderKey[];

export type AnswerReceiptProvider = (typeof ANSWER_RECEIPT_PROVIDERS)[number];

export const ANSWER_RECEIPT_LIMIT_DEFAULT = 50;
export const ANSWER_RECEIPT_LIMIT_MIN = 1;
export const ANSWER_RECEIPT_LIMIT_MAX = 50;

/** On by default; set VITE_ENABLE_AI_ANSWER_RECEIPTS=false to disable (OSS-safe opt-out). */
export function aiAnswerReceiptsEnabled(): boolean {
	return import.meta.env['VITE_ENABLE_AI_ANSWER_RECEIPTS'] !== 'false';
}

export function clampAnswerReceiptLimit(limit?: number): number {
	if (limit == null || !Number.isFinite(limit)) return ANSWER_RECEIPT_LIMIT_DEFAULT;
	return Math.min(ANSWER_RECEIPT_LIMIT_MAX, Math.max(ANSWER_RECEIPT_LIMIT_MIN, Math.floor(limit)));
}

/** Returns the provider when it is in the known set; otherwise undefined (filter ignored). */
export function validateAnswerReceiptProvider(provider?: string): AnswerReceiptProvider | undefined {
	if (!provider) return undefined;
	return (ANSWER_RECEIPT_PROVIDERS as readonly string[]).includes(provider)
		? (provider as AnswerReceiptProvider)
		: undefined;
}

import { describe, expect, it } from 'vitest';
import {
	aiAnswerReceiptsEnabled,
	clampAnswerReceiptLimit,
	validateAnswerReceiptProvider,
} from './answerReceipts';

describe('answerReceipts', () => {
	describe('clampAnswerReceiptLimit', () => {
		it('defaults to 50', () => {
			expect(clampAnswerReceiptLimit()).toBe(50);
			expect(clampAnswerReceiptLimit(undefined)).toBe(50);
			expect(clampAnswerReceiptLimit(Number.NaN)).toBe(50);
		});

		it('clamps to 1..50', () => {
			expect(clampAnswerReceiptLimit(0)).toBe(1);
			expect(clampAnswerReceiptLimit(1)).toBe(1);
			expect(clampAnswerReceiptLimit(25)).toBe(25);
			expect(clampAnswerReceiptLimit(50)).toBe(50);
			expect(clampAnswerReceiptLimit(99)).toBe(50);
			expect(clampAnswerReceiptLimit(2.9)).toBe(2);
		});
	});

	describe('validateAnswerReceiptProvider', () => {
		it('accepts known providers only', () => {
			expect(validateAnswerReceiptProvider('chatgpt')).toBe('chatgpt');
			expect(validateAnswerReceiptProvider('google_aio')).toBe('google_aio');
			expect(validateAnswerReceiptProvider('perplexity')).toBe('perplexity');
			expect(validateAnswerReceiptProvider('gemini')).toBe('gemini');
		});

		it('rejects deprecated or unknown providers', () => {
			expect(validateAnswerReceiptProvider('grok')).toBeUndefined();
			expect(validateAnswerReceiptProvider('bing')).toBeUndefined();
			expect(validateAnswerReceiptProvider('')).toBeUndefined();
			expect(validateAnswerReceiptProvider(undefined)).toBeUndefined();
		});
	});

	describe('aiAnswerReceiptsEnabled', () => {
		it('is true by default when VITE_ENABLE_AI_ANSWER_RECEIPTS is unset', () => {
			expect(aiAnswerReceiptsEnabled()).toBe(true);
		});
	});
});

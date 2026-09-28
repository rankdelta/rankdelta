/**
 * Audit validators — structured checks beyond DataForSEO regex flags.
 * JSON-LD: real parse after wpautop <br/> cleanup. H1: single-H1 rule. Links: basic resolver.
 */

import { isSameOrSubdomain, normalizeDomain } from './domains';

export interface JsonLdValidation {
	blockCount: number;
	validBlocks: number;
	invalidBlocks: number;
	errors: string[];
}

export interface H1Validation {
	count: number;
	texts: string[];
}

export interface InternalLinkIssue {
	href: string;
	reason: 'empty' | 'duplicate' | 'external_competitor' | 'suspicious_home_redirect';
}

export interface PageValidationResult {
	jsonLd: JsonLdValidation;
	h1: H1Validation;
	internalLinkIssues: InternalLinkIssue[];
}

/** Strip wpautop artifacts inside JSON-LD script blocks before parsing. */
export function sanitizeJsonLdHtml(html: string): string {
	return html.replace(
		/(<script[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi,
		(_m, open: string, body: string, close: string) =>
			`${open}${body.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, ' ')}${close}`,
	);
}

export function validateJsonLd(html: string): JsonLdValidation {
	const cleaned = sanitizeJsonLdHtml(html);
	const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
	const errors: string[] = [];
	let blockCount = 0;
	let validBlocks = 0;

	let match: RegExpExecArray | null;
	while ((match = re.exec(cleaned)) !== null) {
		blockCount += 1;
		const raw = match[1]?.trim() ?? '';
		if (!raw) {
			errors.push('Empty JSON-LD block');
			continue;
		}
		try {
			JSON.parse(raw);
			validBlocks += 1;
		} catch (e) {
			errors.push(e instanceof Error ? e.message.slice(0, 120) : 'Invalid JSON-LD');
		}
	}

	return {
		blockCount,
		validBlocks,
		invalidBlocks: blockCount - validBlocks,
		errors,
	};
}

export function validateH1(html: string): H1Validation {
	const texts: string[] = [];
	const re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) {
		const t = (m[1] ?? '').replace(/<[^>]+>/g, '').trim();
		if (t) texts.push(t);
	}
	return { count: texts.length, texts };
}

const COMPETITOR_HOST_HINTS = ['amazon.', 'ebay.', 'wikipedia.', 'facebook.', 'instagram.'];

export function findInternalLinkIssues(html: string, siteUrl: string): InternalLinkIssue[] {
	const issues: InternalLinkIssue[] = [];
	const seen = new Set<string>();
	const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) {
		const href = (m[1] ?? '').trim();
		if (!href || href === '#') {
			issues.push({ href: href || '(empty)', reason: 'empty' });
			continue;
		}
		if (href.startsWith('javascript:')) continue;
		let abs = href;
		try {
			abs = new URL(href, siteUrl).href;
		} catch {
			continue;
		}
		const key = abs.toLowerCase();
		if (seen.has(key)) {
			issues.push({ href: abs, reason: 'duplicate' });
			continue;
		}
		seen.add(key);
		if (!isSameOrSubdomain(abs, siteUrl)) {
			const host = normalizeDomain(abs);
			if (COMPETITOR_HOST_HINTS.some((h) => host.includes(h))) {
				issues.push({ href: abs, reason: 'external_competitor' });
			}
			continue;
		}
		try {
			const u = new URL(abs);
			if (u.pathname === '/' || u.pathname === '') {
				issues.push({ href: abs, reason: 'suspicious_home_redirect' });
			}
		} catch {
			/* ignore */
		}
	}
	return issues;
}

export function validatePageHtml(html: string, siteUrl: string): PageValidationResult {
	return {
		jsonLd: validateJsonLd(html),
		h1: validateH1(html),
		internalLinkIssues: findInternalLinkIssues(html, siteUrl),
	};
}

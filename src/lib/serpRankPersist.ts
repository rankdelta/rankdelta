/**
 * Resilient persistence for serp_rank_keywords — one DB commit per phrase so a dropped
 * connection mid-batch cannot discard keywords that already saved.
 */
import { supabase } from './supabaseClient';
import type { SerpRankKeywordRow } from '../types/database';

export type SerpKeywordPersistResult = {
	phrase: string;
	ok: boolean;
	id?: string;
	alreadyTracked?: boolean;
	error?: string;
};

/** Split pasted bulk input (commas or newlines) into unique trimmed phrases. */
export function parseKeywordPhrases(raw: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of raw.split(/[,\n]/)) {
		const phrase = part.trim();
		if (!phrase) continue;
		const key = phrase.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(phrase);
	}
	return out;
}

/** Escape LIKE/ILIKE wildcards (`%`, `_`) and the escape char itself so a phrase matches literally. */
export function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function isRetryableError(message: string): boolean {
	const m = message.toLowerCase();
	return (
		m.includes('fetch') ||
		m.includes('network') ||
		m.includes('timeout') ||
		m.includes('failed to fetch') ||
		m.includes('load failed') ||
		m.includes('connection')
	);
}

function isDuplicateError(message: string, code?: string): boolean {
	if (code === '23505') return true;
	const m = message.toLowerCase();
	return m.includes('duplicate') || m.includes('unique') || m.includes('already exists');
}

async function sleep(ms: number): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

async function persistOnePhrase(
	projectId: string,
	phrase: string,
	maxRetries: number,
): Promise<SerpKeywordPersistResult> {
	let lastError = '';
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const { data, error } = await supabase
			.from('serp_rank_keywords')
			.insert({ project_id: projectId, phrase, is_active: true })
			.select()
			.single();

		if (!error && data) {
			return { phrase, ok: true, id: (data as SerpRankKeywordRow).id };
		}

		const msg = error?.message ?? 'insert failed';
		const code = (error as { code?: string } | null)?.code;

		if (isDuplicateError(msg, code)) {
			// ilike treats % and _ as wildcards — escape them so "100% cotton" can't match several rows
			// (and maybeSingle() then throw on multiple matches).
			const { data: existing } = await supabase
				.from('serp_rank_keywords')
				.select('id, is_active')
				.eq('project_id', projectId)
				.ilike('phrase', escapeLikePattern(phrase))
				.limit(1)
				.maybeSingle();
			if (existing?.id) {
				if (!existing.is_active) {
					await supabase.from('serp_rank_keywords').update({ is_active: true }).eq('id', existing.id);
				}
				return { phrase, ok: true, id: existing.id as string, alreadyTracked: true };
			}
			return { phrase, ok: false, error: msg };
		}

		lastError = msg;
		if (attempt < maxRetries && isRetryableError(msg)) {
			await sleep(400 * (attempt + 1));
			continue;
		}
		break;
	}
	return { phrase, ok: false, error: lastError || 'insert failed' };
}

/**
 * Insert keywords one at a time (never all-or-nothing). Partial success is preserved.
 */
export async function persistSerpKeywords(
	projectId: string,
	phrases: string[],
	options?: { maxRetries?: number; onProgress?: (done: number, total: number) => void },
): Promise<SerpKeywordPersistResult[]> {
	const unique = parseKeywordPhrases(phrases.join('\n'));
	const maxRetries = options?.maxRetries ?? 2;
	const out: SerpKeywordPersistResult[] = [];
	for (let i = 0; i < unique.length; i++) {
		out.push(await persistOnePhrase(projectId, unique[i]!, maxRetries));
		options?.onProgress?.(i + 1, unique.length);
	}
	return out;
}

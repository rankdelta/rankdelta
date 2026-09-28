/**
 * Edge Function: visibility-ops (generate queries, run DataForSEO LLM Mentions)
 */
import { supabase } from '../lib/supabaseClient';
import {
	VISIBILITY_BATCH_DELAY_MS,
	VISIBILITY_BATCH_MAX_QUERIES,
	VISIBILITY_SERP_BATCH_DELAY_MS,
	VISIBILITY_SERP_BATCH_MAX_KEYWORDS,
} from '../config/dataforseoVisibility';

/** Active engines for visibility runs — must match visibility-ops KNOWN_VISIBILITY_PROVIDERS. */
export const DEFAULT_VISIBILITY_PROVIDERS = [
	'chatgpt',
	'perplexity',
	'gemini',
	'google_aio',
] as const;

export type VisibilityRunProvider = (typeof DEFAULT_VISIBILITY_PROVIDERS)[number];
import {
	ACCOUNT_BUDGET_ERROR_CODE,
	AccountBudgetError,
	PLAN_REQUIRED_ERROR_CODE,
	PlanRequiredError,
	RESEARCH_QUOTA_ERROR_CODE,
	ResearchQuotaError,
} from './edgeProxy';

function assertVisibilityOpsEnabled() {
	if (import.meta.env['VITE_DISABLE_VISIBILITY_OPS'] === 'true') {
		throw new Error(
			'Visibility API runs are temporarily disabled. Please try again later or contact support if this continues.',
		);
	}
}

function serverMessageFromBody(data: unknown): string | null {
	if (!data || typeof data !== 'object') return null;
	const o = data as Record<string, unknown>;
	const err = o['error'];
	if (typeof err !== 'string' || !err) return null;
	const detail = o['detail'];
	if (typeof detail === 'string' && detail.trim()) {
		const short = detail.length > 400 ? `${detail.slice(0, 400)}…` : detail;
		return `${err}: ${short}`;
	}
	return err;
}

function throwFrom402Body(data: unknown): void {
	if (!data || typeof data !== 'object') return;
	const body = data as Record<string, unknown>;
	const code = body['code'];
	const msg = typeof body['error'] === 'string' ? body['error'] : 'Request blocked';
	if (code === PLAN_REQUIRED_ERROR_CODE) {
		throw new PlanRequiredError(msg);
	}
	if (code === RESEARCH_QUOTA_ERROR_CODE) {
		throw new ResearchQuotaError(msg, Number(body['used']) || 0, Number(body['cap']) || 0);
	}
	if (code === ACCOUNT_BUDGET_ERROR_CODE) {
		throw new AccountBudgetError(msg, Number(body['spent_cents']), Number(body['cap_cents']));
	}
}

async function throwVisibilityOpsInvokeError(error: unknown, data: unknown): Promise<never> {
	try {
		throwFrom402Body(data);
	} catch (e) {
		if (
			e instanceof PlanRequiredError ||
			e instanceof AccountBudgetError ||
			e instanceof ResearchQuotaError
		) {
			throw e;
		}
	}

	const ctx = (error as { context?: Response }).context;
	if (ctx && typeof ctx.text === 'function') {
		let bodyText = '';
		try {
			bodyText = (await ctx.clone().text()).slice(0, 500);
		} catch {
			/* ignore */
		}
		if (bodyText) {
			try {
				throwFrom402Body(JSON.parse(bodyText) as unknown);
			} catch (e) {
				if (
					e instanceof PlanRequiredError ||
					e instanceof AccountBudgetError ||
					e instanceof ResearchQuotaError
				) {
					throw e;
				}
			}
		}
	}

	const fromBody = serverMessageFromBody(data);
	const base = error instanceof Error ? error.message : String(error);
	if (fromBody) {
		throw new Error(fromBody);
	}
	if (/non-2xx/i.test(base)) {
		throw new Error('Visibility request failed');
	}
	throw error instanceof Error ? error : new Error(base);
}

/**
 * Invoke `visibility-ops` with a guaranteed Authorization header and surface JSON error bodies
 * (Supabase often sets `error` to a generic "non-2xx" while the useful text is in `data`).
 */
async function invokeVisibilityOps(body: Record<string, unknown>): Promise<unknown> {
	assertVisibilityOpsEnabled();
	const {
		data: { session },
	} = await supabase.auth.getSession();
	if (!session?.access_token) {
		throw new Error('You must be signed in to run visibility operations.');
	}

	const { data, error } = await supabase.functions.invoke('visibility-ops', {
		body,
		headers: { Authorization: `Bearer ${session.access_token}` },
	});

	if (error) {
		await throwVisibilityOpsInvokeError(error, data);
	}

	const fromBody = serverMessageFromBody(data);
	if (fromBody) {
		throw new Error(fromBody);
	}

	return data;
}

export async function generateVisibilityQueries(projectId: string, count?: number) {
	const data = await invokeVisibilityOps({ action: 'generate_queries', projectId, count });
	return data as { ok?: boolean; inserted?: number; total?: number; error?: string };
}

export type RunVisibilityQueryOptions = {
	/** DataForSEO `limit` (1–1000). Lower = cheaper; default from Edge env or 3. */
	dfsLimit?: number;
	/** @see https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/search/live/ */
	matchType?: 'word_match' | 'partial_match';
	/**
	 * Adds tracked-brand domain with `sources` scope (stricter; may return fewer rows).
	 * Send true only when you want answers that cite your domain in sources.
	 */
	preferBrandSources?: boolean;
};

export async function runVisibilityQuery(
	queryId: string,
	providers: VisibilityRunProvider[] = [...DEFAULT_VISIBILITY_PROVIDERS],
	options?: RunVisibilityQueryOptions,
) {
	const data = await invokeVisibilityOps({
		action: 'run_query',
		queryId,
		providers,
		dfsLimit: options?.dfsLimit,
		matchType: options?.matchType,
		preferBrandSources: options?.preferBrandSources,
	});
	return data as {
		ok?: boolean;
		results?: Array<{ provider: string; runId?: string; skipped?: boolean; costUsd?: number; error?: string }>;
		error?: string;
	};
}

export type BatchRunItemResult = {
	queryId: string;
	success: boolean;
	error?: string;
	costUsdApprox?: number;
};

/**
 * Run many prompts sequentially (one Edge invocation each). Stops on first hard failure if `stopOnError`.
 */
export async function runVisibilityBatch(
	queryIds: string[],
	providers: VisibilityRunProvider[] = [...DEFAULT_VISIBILITY_PROVIDERS],
	options?: RunVisibilityQueryOptions & { delayMs?: number; stopOnError?: boolean },
): Promise<BatchRunItemResult[]> {
	const unique = [...new Set(queryIds)].slice(0, VISIBILITY_BATCH_MAX_QUERIES);
	const delayMs = options?.delayMs ?? VISIBILITY_BATCH_DELAY_MS;
	const stopOnError = options?.stopOnError ?? false;
	const out: BatchRunItemResult[] = [];

	for (const queryId of unique) {
		try {
			const data = await runVisibilityQuery(queryId, providers, {
				dfsLimit: options?.dfsLimit,
				matchType: options?.matchType,
				preferBrandSources: options?.preferBrandSources,
			});
			if (data?.error) {
				out.push({ queryId, success: false, error: String(data.error) });
				if (stopOnError) break;
				await new Promise((r) => setTimeout(r, delayMs));
				continue;
			}
			const results = data?.results ?? [];
			const anyFail = results.some((r) => r.error && !r.skipped);
			const costUsdApprox = results.reduce((s, r) => s + (Number(r.costUsd) || 0), 0);
			out.push({
				queryId,
				success: !anyFail && results.length > 0,
				error: anyFail ? results.map((r) => r.error).filter(Boolean).join('; ') : undefined,
				costUsdApprox,
			});
		} catch (e) {
			out.push({
				queryId,
				success: false,
				error: e instanceof Error ? e.message : String(e),
			});
			if (stopOnError) break;
		}
		await new Promise((r) => setTimeout(r, delayMs));
	}
	return out;
}

export type SerpRankBatchItemResult = {
	keywordId: string;
	success: boolean;
	position?: number | null;
	error?: string;
	costUsdApprox?: number;
};

/**
 * Run Google organic rank checks for tracked keywords (DataForSEO SERP live advanced).
 */
export async function runSerpRankBatch(
	keywordIds: string[],
	options?: { delayMs?: number },
): Promise<SerpRankBatchItemResult[]> {
	const unique = [...new Set(keywordIds)].slice(0, VISIBILITY_SERP_BATCH_MAX_KEYWORDS);
	const delayMs = options?.delayMs ?? VISIBILITY_SERP_BATCH_DELAY_MS;
	const out: SerpRankBatchItemResult[] = [];

	for (const keywordId of unique) {
		try {
			const data = await invokeVisibilityOps({
				action: 'run_serp_rank',
				keywordIds: [keywordId],
			});
			const o = data as {
				ok?: boolean;
				results?: Array<{
					keywordId?: string;
					position?: number | null;
					error?: string;
					skipped?: boolean;
					reason?: string;
					costUsd?: number;
				}>;
				error?: string;
			};
			if (o?.error) {
				out.push({ keywordId, success: false, error: String(o.error) });
				await new Promise((r) => setTimeout(r, delayMs));
				continue;
			}
			const row = o?.results?.[0];
			if (!row) {
				out.push({ keywordId, success: false, error: 'Empty response' });
			} else if (row.error) {
				out.push({ keywordId, success: false, error: row.error });
			} else if (row.skipped) {
				out.push({
					keywordId,
					success: false,
					error: row.reason || 'Skipped',
				});
			} else {
				out.push({
					keywordId,
					success: true,
					position: row.position ?? null,
					costUsdApprox: Number(row.costUsd) || 0,
				});
			}
		} catch (e) {
			out.push({
				keywordId,
				success: false,
				error: e instanceof Error ? e.message : String(e),
			});
		}
		await new Promise((r) => setTimeout(r, delayMs));
	}
	return out;
}

export type CannibalizationResult = {
	ok?: boolean;
	dry_run?: boolean;
	executed?: boolean;
	cost_usd?: number;
	keyword_count?: number;
	estimated_usd?: number;
	items?: Array<{
		keyword: string;
		urls: string[];
		best_position_each: number[];
		severity: 'HIGH' | 'MEDIUM' | 'LOW';
		recommendation: string;
	}>;
	error?: string;
};

/** Keyword cannibalization from stored rank snapshots. Default cost_usd=0. */
export async function getCannibalization(
	siteId: string,
	options?: { engine?: string; days?: number; limit?: number; refresh?: boolean; dryRun?: boolean },
): Promise<CannibalizationResult> {
	const data = await invokeVisibilityOps({
		action: 'get_cannibalization',
		site_id: siteId,
		engine: options?.engine ?? 'google',
		days: options?.days ?? 90,
		limit: options?.limit,
		refresh: options?.refresh === true,
		dry_run: options?.dryRun === true,
	});
	return data as CannibalizationResult;
}

/** Stored backlink join. Default cost_usd=0; never fires DataForSEO. */
export async function getLinkIntersect(
	siteId: string,
	competitorDomain: string,
	options?: { limit?: number; dryRun?: boolean; refresh?: boolean },
) {
	const data = await invokeVisibilityOps({
		action: 'get_link_intersect',
		site_id: siteId,
		competitor_domain: competitorDomain,
		limit: options?.limit,
		dry_run: options?.dryRun === true,
		refresh: options?.refresh === true,
	});
	return data as { ok?: boolean; cost_usd?: number; items?: unknown[]; coverage?: string; error?: string };
}

/** Stored SERP content-gap. Always cost_usd=0. */
export async function getContentGap(
	siteId: string,
	competitorDomain: string,
	options?: { limit?: number },
) {
	const data = await invokeVisibilityOps({
		action: 'get_content_gap',
		site_id: siteId,
		competitor_domain: competitorDomain,
		limit: options?.limit,
	});
	return data as { ok?: boolean; cost_usd?: number; items?: unknown[]; error?: string };
}

/** Brand sentiment on stored answers. Default never spends. */
export async function getBrandSentiment(
	siteId: string,
	options?: { days?: number; dryRun?: boolean; classify?: boolean },
) {
	const data = await invokeVisibilityOps({
		action: 'get_brand_sentiment',
		site_id: siteId,
		days: options?.days ?? 30,
		dry_run: options?.dryRun === true,
		classify: options?.classify === true,
	});
	return data as { ok?: boolean; status?: string; cost_usd?: number; per_engine?: unknown[]; error?: string };
}

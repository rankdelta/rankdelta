/**
 * serpClustering — fetch orchestration for SERP-based keyword clustering (stage 2).
 *
 * For each keyword it pulls the top-N organic SERP (one `serp/google/organic/live/advanced` call
 * via getSerpInsights → seo-proxy), so every call is metered by the account spend cap + plan
 * lookup quota exactly like any other research lookup — no separate billing. The pure clustering
 * math lives in `lib/serpClusters.ts`; this module only gathers the SERPs and hands them over.
 *
 * COST: one lookup per keyword. Callers MUST warn the user ("N keywords = N lookups") before running.
 */

import { getSerpInsights } from './dataforseo';
import { isProxyQuotaError } from '../lib/proxyErrorMessage';
import {
	clusterKeywordsBySerp,
	type SerpCluster,
	type SerpClusterInput,
	type ClusterMethod,
} from '../lib/serpClusters';

export interface ClusterIdeaInput {
	keyword: string;
	volume?: number | null;
	difficulty?: number | null;
}

export interface ClusterRunOptions {
	locationCode: number;
	languageCode: string;
	minShared?: number;
	method?: ClusterMethod;
	/** Top-N organic results per keyword to compare on. Default 10. */
	topN?: number;
	/** Hard ceiling on keywords per run (each is a paid lookup). Default 300. */
	maxKeywords?: number;
	/** Progress callback (done, total) fired after each keyword's SERP resolves. */
	onProgress?: (done: number, total: number) => void;
	/** How many SERPs to fetch in parallel. Default 5. */
	concurrency?: number;
}

/**
 * Fetch each keyword's SERP and cluster by shared URLs. Stops early and rethrows if the account
 * spend cap / plan quota is hit (isProxyQuotaError) so the UI can show the real reason instead of
 * silently returning junk singletons. Keywords whose SERP fails for other reasons become singletons.
 */
export async function clusterIdeasBySerp(
	ideas: ClusterIdeaInput[],
	opts: ClusterRunOptions,
): Promise<SerpCluster[]> {
	const topN = opts.topN ?? 10;
	const maxKeywords = opts.maxKeywords ?? 300;
	const concurrency = Math.max(1, opts.concurrency ?? 5);

	// Dedupe (case-insensitive) and cap — each keyword is a paid lookup.
	const seen = new Set<string>();
	const queue: ClusterIdeaInput[] = [];
	for (const it of ideas) {
		const k = it.keyword?.trim();
		if (!k) continue;
		const key = k.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		queue.push({ ...it, keyword: k });
		if (queue.length >= maxKeywords) break;
	}

	const total = queue.length;
	const inputs: SerpClusterInput[] = [];
	let done = 0;
	let fatal: unknown = null;
	let cursor = 0;

	const worker = async () => {
		while (true) {
			if (fatal) return;
			const idx = cursor++;
			if (idx >= queue.length) return;
			const idea = queue[idx]!;
			let urls: string[] = [];
			try {
				const serp = await getSerpInsights(idea.keyword, opts.locationCode, opts.languageCode, topN);
				urls = serp.organic.map((o) => o.url).filter(Boolean);
			} catch (e) {
				if (isProxyQuotaError(e)) { fatal = e; return; } // budget/quota → stop the whole run
				urls = []; // transient failure for this keyword → it becomes a singleton
			}
			inputs.push({ keyword: idea.keyword, volume: idea.volume ?? null, difficulty: idea.difficulty ?? null, urls });
			done += 1;
			opts.onProgress?.(done, total);
		}
	};

	await Promise.all(Array.from({ length: Math.min(concurrency, total || 1) }, worker));
	if (fatal) throw fatal;

	return clusterKeywordsBySerp(inputs, { minShared: opts.minShared, method: opts.method, topN });
}

/**
 * Cannibalization diagnostics from SERP rank snapshots.
 *
 * Uses `raw_response` (full organic SERP) already stored per check — no extra API calls.
 * Detects (a) multiple site URLs ranking for the same query and (b) likely wrong URL for intent
 * (homepage/blog vs money page). Money pages from project metadata refine (b) when configured.
 */

import { isSameOrSubdomain } from './domains';
import type { MoneyPage } from '../services/moneyPages';
import type { SerpRankKeywordRow, SerpRankSnapshotRow } from '../types/database';

export type CannibalizationIssueKind = 'multi_url' | 'wrong_url';

export interface SiteSerpUrl {
	url: string;
	position: number;
	title: string | null;
}

export interface CannibalizationRow {
	keywordId: string;
	phrase: string;
	kind: CannibalizationIssueKind;
	/** All site URLs found in the latest SERP snapshot. */
	siteUrls: SiteSerpUrl[];
	/** URL currently ranking highest (matches snapshot.ranking_url). */
	primaryUrl: string | null;
	/** Suggested canonical / commercial target. */
	suggestedUrl: string | null;
	/** Suggested anchor text for internal links (money page keyword when available). */
	suggestedAnchor: string | null;
	checkedAt: string | null;
}

/** Normalize pathname for comparison (lowercase, no trailing slash, no hash/query). */
export function normalizePagePath(url: string): string {
	try {
		const u = new URL(url);
		let p = u.pathname.toLowerCase();
		if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
		return p || '/';
	} catch {
		return url.toLowerCase();
	}
}

function pathsEqual(a: string, b: string): boolean {
	return normalizePagePath(a) === normalizePagePath(b);
}

const INFO_PATH_RE =
	/^\/$|^\/blog(\/|$)|^\/news(\/|$)|^\/articoli(\/|$)|^\/magazine(\/|$)|^\/insights(\/|$)|^\/resources(\/|$)/i;
const COMMERCE_PATH_RE =
	/\/(product|products|shop|store|collections?|categoria|categorie|servizi|services|pricing|prezzi|conto-terzi|catalogo|negozio)(\/|$)/i;

export function isLikelyInformationalPath(url: string): boolean {
	return INFO_PATH_RE.test(normalizePagePath(url));
}

export function isLikelyCommercialPath(url: string): boolean {
	return COMMERCE_PATH_RE.test(normalizePagePath(url));
}

/** Extract organic site URLs from a stored DataForSEO SERP `raw_response`. */
export function extractSiteUrlsFromSerpRaw(
	raw: unknown,
	siteUrl: string,
): SiteSerpUrl[] {
	if (!raw || typeof raw !== 'object') return [];
	const tasks = (raw as { tasks?: unknown[] }).tasks;
	if (!Array.isArray(tasks) || tasks.length === 0) return [];

	const st0 = tasks[0] as { result?: unknown[] } | undefined;
	const resultArr = st0?.result;
	if (!Array.isArray(resultArr) || resultArr.length === 0) return [];

	const block = resultArr[0] as { items?: unknown[] } | undefined;
	const items = block?.items;
	if (!Array.isArray(items)) return [];

	const out: SiteSerpUrl[] = [];
	for (const it of items) {
		if (!it || typeof it !== 'object') continue;
		const row = it as Record<string, unknown>;
		if (row['type'] !== 'organic') continue;
		const url = typeof row['url'] === 'string' ? row['url'] : '';
		if (!url || !isSameOrSubdomain(url, siteUrl)) continue;
		const position =
			typeof row['rank_absolute'] === 'number'
				? row['rank_absolute']
				: typeof row['rank_group'] === 'number'
					? row['rank_group']
					: null;
		if (position == null) continue;
		out.push({
			url,
			position,
			title: typeof row['title'] === 'string' ? row['title'] : null,
		});
	}
	out.sort((a, b) => a.position - b.position);
	return out;
}

function findMoneyPageForPhrase(phrase: string, moneyPages: MoneyPage[]): MoneyPage | null {
	const p = phrase.trim().toLowerCase();
	if (!p) return null;
	let best: MoneyPage | null = null;
	let bestScore = 0;
	for (const mp of moneyPages) {
		const kw = mp.keyword.trim().toLowerCase();
		if (!kw) continue;
		let score = 0;
		if (p === kw) score = 100;
		else if (p.includes(kw) || kw.includes(p)) score = 60;
		else {
			const pWords = new Set(p.split(/\s+/).filter((w) => w.length > 3));
			const kWords = kw.split(/\s+/).filter((w) => w.length > 3);
			const overlap = kWords.filter((w) => pWords.has(w)).length;
			if (overlap > 0) score = 20 + overlap * 10;
		}
		if (score > bestScore) {
			bestScore = score;
			best = mp;
		}
	}
	return bestScore >= 20 ? best : null;
}

function pickCommercialAlternative(siteUrls: SiteSerpUrl[], excludeUrl: string): SiteSerpUrl | null {
	const ex = normalizePagePath(excludeUrl);
	return (
		siteUrls.find(
			(u) => isLikelyCommercialPath(u.url) && normalizePagePath(u.url) !== ex,
		) ?? null
	);
}

export interface BuildCannibalizationReportArgs {
	siteUrl: string;
	keywords: SerpRankKeywordRow[];
	latestByKeyword: Map<string, SerpRankSnapshotRow>;
	moneyPages?: MoneyPage[];
}

/** Build cannibalization rows for keywords with at least one completed SERP snapshot. */
export function buildCannibalizationReport(args: BuildCannibalizationReportArgs): CannibalizationRow[] {
	const { siteUrl, keywords, latestByKeyword, moneyPages = [] } = args;
	const rows: CannibalizationRow[] = [];

	for (const kw of keywords) {
		const snap = latestByKeyword.get(kw.id);
		if (!snap || snap.status !== 'completed') continue;

		const siteUrls = extractSiteUrlsFromSerpRaw(snap.raw_response, siteUrl);
		if (siteUrls.length === 0 && !snap.ranking_url) continue;

		const primary =
			snap.ranking_url ??
			(siteUrls.length > 0 ? siteUrls[0]!.url : null);
		const money = findMoneyPageForPhrase(kw.phrase, moneyPages);

		if (siteUrls.length > 1) {
			rows.push({
				keywordId: kw.id,
				phrase: kw.phrase,
				kind: 'multi_url',
				siteUrls,
				primaryUrl: primary,
				suggestedUrl: money?.url ?? siteUrls[0]!.url,
				suggestedAnchor: money?.keyword ?? null,
				checkedAt: snap.checked_at,
			});
		}

		if (primary) {
			let wrongUrl = false;
			let suggested: string | null = null;
			let anchor: string | null = null;

			if (money && !pathsEqual(primary, money.url)) {
				wrongUrl = true;
				suggested = money.url;
				anchor = money.keyword;
			} else if (!money) {
				const alt = pickCommercialAlternative(siteUrls, primary);
				if (
					isLikelyInformationalPath(primary) &&
					alt &&
					!pathsEqual(primary, alt.url)
				) {
					wrongUrl = true;
					suggested = alt.url;
					anchor = alt.title;
				}
			}

			if (wrongUrl && suggested) {
				rows.push({
					keywordId: kw.id,
					phrase: kw.phrase,
					kind: 'wrong_url',
					siteUrls,
					primaryUrl: primary,
					suggestedUrl: suggested,
					suggestedAnchor: anchor,
					checkedAt: snap.checked_at,
				});
			}
		}
	}

	rows.sort((a, b) => {
		const kindOrder = a.kind === 'multi_url' ? 0 : 1;
		const kindOrderB = b.kind === 'multi_url' ? 0 : 1;
		if (kindOrder !== kindOrderB) return kindOrder - kindOrderB;
		return a.phrase.localeCompare(b.phrase);
	});

	return rows;
}

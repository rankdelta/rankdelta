/**
 * Strike-distance quick wins: GSC queries in positions 8–20 with high impressions,
 * low CTR, and clicks confirmed (>=2) to avoid zero-click position artifacts.
 */

import type { GscRow } from '../services/googleSearchConsole';

export interface StrikeDistanceQuery {
	query: string;
	position: number;
	impressions: number;
	clicks: number;
	ctr: number;
	clicksConfirmed: boolean;
	/** Latest Google organic rank from serp_rank tracker (desktop SERP), when tracked. */
	serpRank: number | null;
	rankingUrl: string | null;
}

export interface SerpRankLookup {
	phrase: string;
	rank: number | null;
	rankingUrl: string | null;
}

/** Build phrase → rank map (case-insensitive) from serp_rank_keywords + latest snapshots. */
export function buildSerpRankLookup(
	keywords: Array<{ phrase: string }>,
	latestByPhrase: Map<string, { rank_absolute: number | null; ranking_url: string | null }>,
): Map<string, SerpRankLookup> {
	const m = new Map<string, SerpRankLookup>();
	for (const k of keywords) {
		const key = k.phrase.trim().toLowerCase();
		const snap = latestByPhrase.get(key);
		m.set(key, {
			phrase: k.phrase,
			rank: snap?.rank_absolute ?? null,
			rankingUrl: snap?.ranking_url ?? null,
		});
	}
	return m;
}

export function mergeStrikeDistanceWithSerpRank(
	rows: StrikeDistanceQuery[],
	serpLookup: Map<string, SerpRankLookup>,
): StrikeDistanceQuery[] {
	return rows.map((r) => {
		const serp = serpLookup.get(r.query.trim().toLowerCase());
		return {
			...r,
			serpRank: serp?.rank ?? null,
			rankingUrl: serp?.rankingUrl ?? null,
		};
	});
}

export interface StrikeDistanceOptions {
	minPosition?: number;
	maxPosition?: number;
	minClicks?: number;
	minImpressions?: number;
	/** CTR must be below this fraction (0–1). Default: half of median CTR in band. */
	maxCtr?: number;
}

const DEFAULTS: Required<StrikeDistanceOptions> = {
	minPosition: 8,
	maxPosition: 20,
	minClicks: 2,
	minImpressions: 100,
	maxCtr: 0,
};

export function filterStrikeDistanceQueries(
	rows: GscRow[],
	opts: StrikeDistanceOptions = {},
): StrikeDistanceQuery[] {
	const o = { ...DEFAULTS, ...opts };
	const inBand = rows.filter(
		(r) => r.position >= o.minPosition && r.position <= o.maxPosition && r.impressions >= o.minImpressions,
	);
	const medianCtr =
		inBand.length > 0
			? inBand.map((r) => r.ctr).sort((a, b) => a - b)[Math.floor(inBand.length / 2)]!
			: 0.02;
	const ctrCap = o.maxCtr > 0 ? o.maxCtr : medianCtr * 0.5;

	return rows
		.filter(
			(r) =>
				r.position >= o.minPosition &&
				r.position <= o.maxPosition &&
				r.clicks >= o.minClicks &&
				r.impressions >= o.minImpressions &&
				r.ctr <= ctrCap,
		)
		.map((r) => ({
			query: r.key,
			position: r.position,
			impressions: r.impressions,
			clicks: r.clicks,
			ctr: r.ctr,
			clicksConfirmed: r.clicks >= o.minClicks,
			serpRank: null,
			rankingUrl: null,
		}))
		.sort((a, b) => b.impressions - a.impressions);
}

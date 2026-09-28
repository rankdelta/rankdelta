/** Normalize URL for GSC ↔ AI citation matching. */
export function pageMatchKey(url: string): string {
	try {
		const u = new URL(url.includes('://') ? url : `https://${url}`);
		const host = u.hostname.replace(/^www\./i, '').toLowerCase();
		let path = u.pathname.toLowerCase();
		if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
		return `${host}${path}`;
	} catch {
		return url.toLowerCase();
	}
}

export interface GscAiPageRow {
	pageUrl: string;
	gscClicks: number;
	gscImpressions: number;
	gscPosition: number;
	aiCitationCount: number;
	aiCited: boolean;
}

export function correlateGscPagesWithAiCitations(
	gscPages: Array<{ key: string; clicks: number; impressions: number; position: number }>,
	citationUrls: string[],
): GscAiPageRow[] {
	const citeKeys = new Map<string, number>();
	for (const u of citationUrls) {
		if (!u) continue;
		const k = pageMatchKey(u);
		citeKeys.set(k, (citeKeys.get(k) ?? 0) + 1);
	}

	return gscPages
		.map((p) => {
			const k = pageMatchKey(p.key);
			const aiCitationCount = citeKeys.get(k) ?? 0;
			return {
				pageUrl: p.key,
				gscClicks: p.clicks,
				gscImpressions: p.impressions,
				gscPosition: p.position,
				aiCitationCount,
				aiCited: aiCitationCount > 0,
			};
		})
		.sort((a, b) => b.gscImpressions - a.gscImpressions);
}

export interface VisibilityQueryAiFlag {
	text: string;
	mentioned: boolean;
	cited: boolean;
}

export interface GscAiQueryRow {
	query: string;
	gscClicks: number;
	gscImpressions: number;
	gscPosition: number;
	visibilityPrompt: string | null;
	aiMentioned: boolean;
	aiCited: boolean;
}

function normQuery(s: string): string {
	return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function matchVisibilityQuery(gscQuery: string, flags: VisibilityQueryAiFlag[]): VisibilityQueryAiFlag | null {
	const g = normQuery(gscQuery);
	if (!g) return null;
	let best: VisibilityQueryAiFlag | null = null;
	let bestScore = 0;
	for (const f of flags) {
		const v = normQuery(f.text);
		if (!v) continue;
		let score = 0;
		if (g === v) score = 100;
		else if (g.includes(v) || v.includes(g)) score = 70;
		if (score > bestScore) {
			bestScore = score;
			best = f;
		}
	}
	return bestScore >= 70 ? best : null;
}

/** Correlate GSC queries with visibility prompts (mention/citation on latest runs). */
export function correlateGscQueriesWithAi(
	gscQueries: Array<{ key: string; clicks: number; impressions: number; position: number }>,
	visibilityFlags: VisibilityQueryAiFlag[],
): GscAiQueryRow[] {
	return gscQueries
		.map((q) => {
			const match = matchVisibilityQuery(q.key, visibilityFlags);
			return {
				query: q.key,
				gscClicks: q.clicks,
				gscImpressions: q.impressions,
				gscPosition: q.position,
				visibilityPrompt: match?.text ?? null,
				aiMentioned: match?.mentioned ?? false,
				aiCited: match?.cited ?? false,
			};
		})
		.filter((r) => r.gscClicks >= 1 || r.aiMentioned || r.aiCited)
		.sort((a, b) => b.gscClicks - a.gscClicks);
}

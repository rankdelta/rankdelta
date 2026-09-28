import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { discoverCompetitors } from '../services/competitorDiscovery';
import { shareOfVoice, averageBrandPosition, utcDayKey, weekOverWeekWindows, classifyDayWindow } from '../lib/resultsMath';
import { computeMentionShareOfVoice, computeWeightedSov, sovIsLowConfidence, SOV_EXCLUDED_INTENTS, type QuerySovSample } from '../lib/visibilitySov';
import { normalizeDomain, isSameOrSubdomain } from '../lib/domains';
import type {
	CompetitorBrand,
	TrackedBrand,
	VisibilityCitationRow,
	VisibilityQueryRow,
	VisibilityQueryRunRow,
	VisibilityApiSpendEvent,
	WorkspaceVertical,
} from '../types/database';
import {
	generateVisibilityQueries,
	runVisibilityQuery,
	runVisibilityBatch,
	getLinkIntersect,
	getContentGap,
	DEFAULT_VISIBILITY_PROVIDERS,
	type RunVisibilityQueryOptions,
	type VisibilityRunProvider,
} from '../services/visibilityOps';

export const visibilityKeys = {
	project: (projectId: string) => ['visibility', projectId] as const,
	brands: (projectId: string) => ['visibility', projectId, 'brands'] as const,
	competitors: (projectId: string) => ['visibility', projectId, 'competitors'] as const,
	queries: (projectId: string) => ['visibility', projectId, 'queries'] as const,
	runs: (projectId: string) => ['visibility', projectId, 'runs'] as const,
	spend: (projectId: string) => ['visibility', projectId, 'spend'] as const,
	mentionCount: (projectId: string) => ['visibility', projectId, 'mentionCount'] as const,
	mentionInsights: (projectId: string, rangeDays = 14) =>
		['visibility', projectId, 'mentionInsights', rangeDays] as const,
	linkIntersect: (projectId: string, domain: string) =>
		['visibility', projectId, 'linkIntersect', domain] as const,
	contentGap: (projectId: string, domain: string) =>
		['visibility', projectId, 'contentGap', domain] as const,
	headToHead: (projectId: string, competitorId: string, rangeDays: number) =>
		['visibility', projectId, 'headToHead', competitorId, rangeDays] as const,
};

/** Split an id list so `.in(...)` filters stay under PostgREST/URL length limits. */
export function chunk<T>(arr: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

/** Columns of visibility_query_runs read by the run-list consumers — omits the heavy raw_response / answer_text / cited_sources payloads. */
const VISIBILITY_RUN_LIST_COLUMNS =
	'id, query_id, provider, status, mentioned_brands, run_at, cost_cents, cost_usd, error_message, dataforseo_platform, created_at';

export type VisibilityTrackedSentiment = {
	positive: number;
	neutral: number;
	negative: number;
	unknown: number;
};

export type VisibilityMentionInsights = {
	yourBrandMentions: number;
	competitorMentionsById: Record<string, number>;
	totalCompetitorMentions: number;
	shareOfVoicePercent: number | null;
	/** How many active, SoV-eligible queries have actually been scanned (backs the SoV %). */
	sovSampleSize: number;
	/** True when the SoV % rests on too few scanned queries to trust — show a "low confidence" hint. */
	sovLowConfidence: boolean;
	/** % of answers that include a clickable citation to your domain (null if no brand domain set). */
	citationRatePercent: number | null;
	/** Number of answers that cited your domain. */
	citedAnswers: number;
	/** Average rank (1 = first) at which your brand appears among brands in an answer (null if no data). */
	avgPosition: number | null;
	byProvider: Partial<Record<string, { yours: number; competitors: number }>>;
	/** Last 14 UTC days (kept for back-compat with sparkline/bars consumers) */
	trend14d: Array<{ date: string; yours: number; competitors: number }>;
	/** Full series over the requested range; sovPercent is daily Share of Voice (null when no mentions that day) */
	trend: Array<{ date: string; yours: number; competitors: number; sovPercent: number | null }>;
	/** Per-day, per-competitor mention counts (aligned with `trend` dates) + your own daily count. */
	competitorTrend: Array<{ date: string; yours: number; byCompetitor: Record<string, number> }>;
	/** Up to 3 competitor ids with the most total mentions (for the vs-competitor trend chart). */
	topCompetitorIds: string[];
	/** The range (in days) this insight set was computed over */
	rangeDays: number;
	hasData: boolean;
	/** At least one visibility query run exists for this project. */
	hasEverScanned: boolean;
	/** Newest `run_at` among the latest-per-query snapshot used for headline SoV. */
	sovAsOfAt: string | null;
	/** Brand mentions in the latest-per-query snapshot (headline low-confidence denominator). */
	yourBrandMentionsHeadline: number;
	totalCompetitorMentionsHeadline: number;
	/** SOV from mention rows in the most recent 7 UTC days of the 14d window */
	sovLast7d: number | null;
	/** SOV from the 7 UTC days before that */
	sovPrior7d: number | null;
	/** Percentage points: sovLast7d − sovPrior7d (null if either SOV is null) */
	sovWeekOverWeekDelta: number | null;
	/** True when both windows have at least one mention row (yours or competitors) */
	sovComparisonAvailable: boolean;
	/** Brand-mention COUNT change: last 7 UTC days − the 7 before (absolute; null if no prior-window data). */
	mentionsWeekOverWeekDelta: number | null;
	/** Citation-rate change in percentage points: last 7 days − prior 7 (null if either window lacks runs/domain). */
	citationRateWeekOverWeekDelta: number | null;
	/** Avg-position change: last 7 days − prior 7. NEGATIVE = improved (you moved up). null if either window empty. */
	positionWeekOverWeekDelta: number | null;
	trackedSentiment: VisibilityTrackedSentiment;
	/** Any tracked mention with non-neutral sentiment (pipeline may still be neutral-only) */
	hasNonNeutralSentiment: boolean;
};

export function useTrackedBrands(projectId: string | undefined) {
	return useQuery({
		queryKey: visibilityKeys.brands(projectId || ''),
		queryFn: async () => {
			if (!projectId) return [];
			const { data, error } = await supabase.from('tracked_brands').select('*').eq('project_id', projectId);
			if (error) throw error;
			return data as TrackedBrand[];
		},
		enabled: !!projectId,
	});
}

export function useCompetitorBrands(projectId: string | undefined) {
	return useQuery({
		queryKey: visibilityKeys.competitors(projectId || ''),
		queryFn: async () => {
			if (!projectId) return [];
			const { data, error } = await supabase.from('competitor_brands').select('*').eq('project_id', projectId);
			if (error) throw error;
			return data as CompetitorBrand[];
		},
		enabled: !!projectId,
	});
}

export function useVisibilityQueries(projectId: string | undefined) {
	return useQuery({
		queryKey: visibilityKeys.queries(projectId || ''),
		queryFn: async () => {
			if (!projectId) return [];
			const { data, error } = await supabase
				.from('visibility_queries')
				.select('*')
				.eq('project_id', projectId)
				.order('created_at', { ascending: false });
			if (error) throw error;
			return data as VisibilityQueryRow[];
		},
		enabled: !!projectId,
	});
}

export function useVisibilityQueryRuns(projectId: string | undefined) {
	return useQuery({
		queryKey: visibilityKeys.runs(projectId || ''),
		queryFn: async () => {
			if (!projectId) return [];
			const { data: qids, error: e1 } = await supabase
				.from('visibility_queries')
				.select('id')
				.eq('project_id', projectId);
			if (e1) throw e1;
			const ids = (qids || []).map((q) => q.id);
			if (ids.length === 0) return [];
			const { data, error } = await supabase
				.from('visibility_query_runs')
				.select(VISIBILITY_RUN_LIST_COLUMNS)
				.in('query_id', ids)
				.order('run_at', { ascending: false })
				.limit(1200);
			if (error) throw error;
			return data as unknown as VisibilityQueryRunRow[];
		},
		enabled: !!projectId,
	});
}

export type VisibilityRunOutcomes = {
	/** query_run_ids where YOUR tracked brand was mentioned in the answer. */
	mentionedRunIds: Set<string>;
	/** query_run_ids where the answer actually CITED (linked) your domain. */
	citedRunIds: Set<string>;
	/** True once a brand domain is set, so "cited vs only-mentioned" is meaningful. */
	hasBrandDomain: boolean;
};

/**
 * Per-run RESULT flags for the run-history table: was YOUR brand mentioned, and did the answer cite
 * your domain. Turns each run's technical "completed" status into a tracked outcome. Reads the same
 * authoritative mention/citation tables the insights use — not the run's raw parsed JSON.
 */
export function useVisibilityRunOutcomes(projectId: string | undefined) {
	return useQuery({
		queryKey: [...visibilityKeys.runs(projectId || ''), 'outcomes'],
		queryFn: async (): Promise<VisibilityRunOutcomes> => {
			const empty: VisibilityRunOutcomes = {
				mentionedRunIds: new Set<string>(),
				citedRunIds: new Set<string>(),
				hasBrandDomain: false,
			};
			if (!projectId) return empty;
			const { data: qids, error: e1 } = await supabase
				.from('visibility_queries')
				.select('id')
				.eq('project_id', projectId);
			if (e1) throw e1;
			const ids = (qids || []).map((q) => q.id);
			if (ids.length === 0) return empty;
			const { data: runs, error: e2 } = await supabase
				.from('visibility_query_runs')
				.select('id')
				.in('query_id', ids)
				.order('run_at', { ascending: false })
				.limit(1200);
			if (e2) throw e2;
			const runIds = (runs || []).map((r) => r.id);
			if (runIds.length === 0) return empty;

			const { data: brandRows } = await supabase
				.from('tracked_brands')
				.select('domain')
				.eq('project_id', projectId);
			const brandDomains = (brandRows || []).map((b) => normalizeDomain(b.domain)).filter(Boolean);

			const mentionedRunIds = new Set<string>();
			const citedRunIds = new Set<string>();
			const chunk = 100;
			for (let i = 0; i < runIds.length; i += chunk) {
				const slice = runIds.slice(i, i + chunk);
				const { data: mrows, error: e3 } = await supabase
					.from('visibility_brand_mentions')
					.select('query_run_id, tracked_brand_id')
					.in('query_run_id', slice)
					.not('tracked_brand_id', 'is', null);
				if (e3) throw e3;
				(mrows || []).forEach((m) => {
					if (m.tracked_brand_id) mentionedRunIds.add(m.query_run_id);
				});
				if (brandDomains.length > 0) {
					const { data: crows } = await supabase
						.from('visibility_citations')
						.select('query_run_id, source_domain')
						.in('query_run_id', slice);
					(crows || []).forEach((c) => {
						if (brandDomains.some((bd) => isSameOrSubdomain(c.source_domain, bd))) citedRunIds.add(c.query_run_id);
					});
				}
			}
			return { mentionedRunIds, citedRunIds, hasBrandDomain: brandDomains.length > 0 };
		},
		enabled: !!projectId,
	});
}

export function useVisibilitySpend(projectId: string | undefined) {
	return useQuery({
		queryKey: visibilityKeys.spend(projectId || ''),
		queryFn: async () => {
			if (!projectId) return [];
			const { data, error } = await supabase
				.from('visibility_api_spend_events')
				.select('*')
				.eq('project_id', projectId)
				.order('created_at', { ascending: false })
				.limit(200);
			if (error) throw error;
			return data as VisibilityApiSpendEvent[];
		},
		enabled: !!projectId,
	});
}

export function useVisibilityBrandMentionCount(projectId: string | undefined) {
	return useQuery({
		queryKey: visibilityKeys.mentionCount(projectId || ''),
		queryFn: async () => {
			if (!projectId) return 0;
			const { data: qids, error: e1 } = await supabase
				.from('visibility_queries')
				.select('id')
				.eq('project_id', projectId);
			if (e1) throw e1;
			const ids = (qids || []).map((q) => q.id);
			if (ids.length === 0) return 0;
			const { data: runs, error: e2 } = await supabase
				.from('visibility_query_runs')
				.select('id')
				.in('query_id', ids)
				.order('run_at', { ascending: false })
				.limit(4000);
			if (e2) throw e2;
			const runIds = (runs || []).map((r) => r.id);
			if (runIds.length === 0) return 0;
			const chunk = 120;
			let total = 0;
			for (let i = 0; i < runIds.length; i += chunk) {
				const slice = runIds.slice(i, i + chunk);
				const { count, error: e3 } = await supabase
					.from('visibility_brand_mentions')
					.select('id', { count: 'exact', head: true })
					.in('query_run_id', slice);
				if (e3) throw e3;
				total += count ?? 0;
			}
			return total;
		},
		enabled: !!projectId,
	});
}


export function useVisibilityMentionInsights(projectId: string | undefined, rangeDays = 14) {
	const span = Math.max(7, Math.min(rangeDays, 365));
	return useQuery({
		queryKey: visibilityKeys.mentionInsights(projectId || '', span),
		queryFn: async (): Promise<VisibilityMentionInsights> => {
			const emptySentiment: VisibilityTrackedSentiment = {
				positive: 0,
				neutral: 0,
				negative: 0,
				unknown: 0,
			};
			const empty: VisibilityMentionInsights = {
				yourBrandMentions: 0,
				competitorMentionsById: {},
				totalCompetitorMentions: 0,
				shareOfVoicePercent: null,
				sovSampleSize: 0,
				sovLowConfidence: false,
				citationRatePercent: null,
				citedAnswers: 0,
				avgPosition: null,
				byProvider: {},
				trend14d: [],
				trend: [],
				competitorTrend: [],
				topCompetitorIds: [],
				rangeDays: span,
				hasData: false,
				hasEverScanned: false,
				sovAsOfAt: null,
				yourBrandMentionsHeadline: 0,
				totalCompetitorMentionsHeadline: 0,
				sovLast7d: null,
				sovPrior7d: null,
				sovWeekOverWeekDelta: null,
				sovComparisonAvailable: false,
				mentionsWeekOverWeekDelta: null,
				citationRateWeekOverWeekDelta: null,
				positionWeekOverWeekDelta: null,
				trackedSentiment: { ...emptySentiment },
				hasNonNeutralSentiment: false,
			};
			if (!projectId) return empty;

			const { data: qrows, error: e1 } = await supabase
				.from('visibility_queries')
				.select('id, intent_type, is_active')
				.eq('project_id', projectId);
			if (e1) throw e1;
			const qids = (qrows || []).map((q) => q.id);
			if (qids.length === 0) return empty;
			// SoV-eligible = active queries whose intent isn't own-brand/navigational (those trivially
			// mention you and inflate the metric). This is the denominator for the weighted SoV below.
			const eligibleQids = new Set(
				(qrows || [])
					.filter((q) => q.is_active !== false && !SOV_EXCLUDED_INTENTS.has(String(q.intent_type ?? '')))
					.map((q) => q.id),
			);

			const { data: runs, error: e2 } = await supabase
				.from('visibility_query_runs')
				.select('id, provider, run_at, query_id')
				.in('query_id', qids)
				.order('run_at', { ascending: false })
				.limit(4000);
			if (e2) throw e2;
			const runList = runs || [];
			const hasEverScanned = runList.length > 0;
			if (runList.length === 0) return { ...empty, hasEverScanned: false };

			// Headline SoV = latest run per query (matches MCP v33 "ultima scan per query").
			const latestRunIdByQuery = new Map<string, string>();
			let sovAsOfAt: string | null = null;
			for (const r of runList) {
				const qid = String(r.query_id);
				if (latestRunIdByQuery.has(qid)) continue;
				latestRunIdByQuery.set(qid, String(r.id));
				const at = String(r.run_at);
				if (!sovAsOfAt || at > sovAsOfAt) sovAsOfAt = at;
			}
			const headlineRunIds = new Set(latestRunIdByQuery.values());

			const rangeCutoff = new Date();
			rangeCutoff.setUTCDate(rangeCutoff.getUTCDate() - span + 1);
			rangeCutoff.setUTCHours(0, 0, 0, 0);
			const inRange = (runAt: string) => new Date(runAt).getTime() >= rangeCutoff.getTime();
			const runListInRange = runList.filter((r) => inRange(r.run_at as string));

			const runById = new Map(runList.map((r) => [r.id, r]));
			const runIds = runList.map((r) => r.id);

			const chunk = 100;
			const mentions: Array<{
				tracked_brand_id: string | null;
				competitor_brand_id: string | null;
				query_run_id: string;
				sentiment: string | null;
				mention_position: number | null;
			}> = [];
			const citations: Array<{ query_run_id: string; source_domain: string | null }> = [];
			for (let i = 0; i < runIds.length; i += chunk) {
				const slice = runIds.slice(i, i + chunk);
				const { data: mrows, error: e3 } = await supabase
					.from('visibility_brand_mentions')
					.select('tracked_brand_id, competitor_brand_id, query_run_id, sentiment, mention_position')
					.in('query_run_id', slice);
				if (e3) throw e3;
				if (mrows) mentions.push(...mrows);
				const { data: crows } = await supabase
					.from('visibility_citations')
					.select('query_run_id, source_domain')
					.in('query_run_id', slice);
				if (crows) citations.push(...crows);
			}

			// Tracked-brand domain(s) → used to detect when an answer actually CITES (links to) you.
			const { data: brandRows } = await supabase
				.from('tracked_brands')
				.select('domain')
				.eq('project_id', projectId);
			const brandDomains = (brandRows || []).map((b) => normalizeDomain(b.domain)).filter(Boolean);

			const competitorMentionsById: Record<string, number> = {};
			let yourBrandMentions = 0;
			let yourBrandMentionsHeadline = 0;
			let competitorMentionsHeadline = 0;
			const trackedSentiment: VisibilityTrackedSentiment = { ...emptySentiment };
			const byProvider: Partial<Record<string, { yours: number; competitors: number }>> = {};
			// Per-headline-run tally (your vs competitor mentions) → feeds the weighted per-query SoV.
			const headlineTally = new Map<string, { yours: number; competitors: number }>();

			const trendMap = new Map<string, { yours: number; competitors: number }>();
			// Per-day, per-competitor counts → powers the "Share of Voice vs each competitor over time" chart.
			const compTrendMap = new Map<string, Record<string, number>>();
			// Week-over-week ALWAYS compares the most recent 7 UTC days against the 7 before, regardless
			// of the selected range (a 7-day range would otherwise compare a window against itself).
			const wowMap = new Map<string, { yours: number; competitors: number }>();
			const today = new Date();
			for (let i = Math.max(span, 14) - 1; i >= 0; i--) {
				const d = new Date(today);
				d.setUTCDate(d.getUTCDate() - i);
				const key = d.toISOString().slice(0, 10);
				if (i < span) {
					trendMap.set(key, { yours: 0, competitors: 0 });
					compTrendMap.set(key, {});
				}
				if (i < 14) wowMap.set(key, { yours: 0, competitors: 0 });
			}

			const bumpProv = (prov: string, field: 'yours' | 'competitors') => {
				if (!byProvider[prov]) byProvider[prov] = { yours: 0, competitors: 0 };
				byProvider[prov]![field] += 1;
			};

			for (const m of mentions) {
				const run = runById.get(m.query_run_id);
				if (!run) continue;
				const prov = String(run.provider);
				const dk = utcDayKey(run.run_at as string);
				const bucket = trendMap.get(dk);
				const wowBucket = wowMap.get(dk);
				const inHeadline = headlineRunIds.has(m.query_run_id);
				if (inHeadline) {
					const t = headlineTally.get(m.query_run_id) ?? { yours: 0, competitors: 0 };
					if (m.tracked_brand_id) t.yours += 1;
					if (m.competitor_brand_id) t.competitors += 1;
					headlineTally.set(m.query_run_id, t);
				}

				if (m.tracked_brand_id) {
					yourBrandMentions += 1;
					if (inHeadline) yourBrandMentionsHeadline += 1;
					bumpProv(prov, 'yours');
					if (bucket) bucket.yours += 1;
					if (wowBucket) wowBucket.yours += 1;
					const s = m.sentiment;
					if (s === 'positive') trackedSentiment.positive += 1;
					else if (s === 'negative') trackedSentiment.negative += 1;
					else if (s === 'neutral') trackedSentiment.neutral += 1;
					else trackedSentiment.unknown += 1;
				}
				if (m.competitor_brand_id) {
					const cid = m.competitor_brand_id;
					competitorMentionsById[cid] = (competitorMentionsById[cid] || 0) + 1;
					if (inHeadline) competitorMentionsHeadline += 1;
					bumpProv(prov, 'competitors');
					if (bucket) bucket.competitors += 1;
					if (wowBucket) wowBucket.competitors += 1;
					const cb = compTrendMap.get(dk);
					if (cb) cb[cid] = (cb[cid] || 0) + 1;
				}
			}

			const totalCompetitorMentions = Object.values(competitorMentionsById).reduce((a, b) => a + b, 0);
			// Weighted SoV: average each active, SoV-eligible query's own share over ALL such queries.
			// A query never scanned, or where you're absent, contributes 0 — so partial coverage or
			// broad absence reads as ~0 rather than a few mentions inflating the % (the n=7→14% bug).
			const sovSamples: QuerySovSample[] = [];
			let scannedEligible = 0;
			for (const qid of eligibleQids) {
				const runId = latestRunIdByQuery.get(String(qid));
				if (runId) {
					scannedEligible += 1;
					const t = headlineTally.get(runId) ?? { yours: 0, competitors: 0 };
					sovSamples.push({ yours: t.yours, competitors: t.competitors });
				} else {
					sovSamples.push({ yours: 0, competitors: 0 });
				}
			}
			const shareOfVoicePercent = computeWeightedSov(sovSamples);
			const sovSampleSize = scannedEligible;
			const sovLowConfidence = sovIsLowConfidence(scannedEligible);

			// ── Citation Rate: % of answers WITH SOURCES that actually LINK to your domain. Answers listing
			//    no source (ChatGPT, Gemini via API) cannot cite anyone; counting them capped the rate. ──
			const runsWithSources = new Set(citations.map((c) => c.query_run_id));
			const sourcedRunsInRange = runListInRange.filter((r) => runsWithSources.has(r.id as string));
			const citedRunIds = new Set<string>();
			if (brandDomains.length > 0) {
				for (const c of citations) {
					if (brandDomains.some((bd) => isSameOrSubdomain(c.source_domain, bd))) citedRunIds.add(c.query_run_id);
				}
			}
			const citationRatePercent = brandDomains.length > 0 && sourcedRunsInRange.length > 0
				? (100 * [...citedRunIds].filter((id) => {
					const run = runById.get(id);
					return run && inRange(run.run_at as string);
				}).length) / sourcedRunsInRange.length
				: null;

			// ── Position: average rank at which YOUR brand appears among all brands cited in an answer
			// (1 = first). Lower is better. Derived from each mention's char offset in the answer text. ──
			const runEntities = new Map<string, Array<{ you: boolean; entityId: string; pos: number }>>();
			for (const m of mentions) {
				if (m.mention_position == null || m.mention_position < 0) continue;
				const you = !!m.tracked_brand_id;
				const entityId = you ? '__you__' : m.competitor_brand_id ?? 'comp';
				const arr = runEntities.get(m.query_run_id) ?? [];
				arr.push({ you, entityId, pos: m.mention_position });
				runEntities.set(m.query_run_id, arr);
			}
			const avgPosition = averageBrandPosition(runEntities.values());

			const sovFrom = shareOfVoice;

			// Full series over the requested range, each day carrying its own Share-of-Voice %.
			const trend = [...trendMap.entries()]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([date, v]) => ({
					date,
					yours: v.yours,
					competitors: v.competitors,
					sovPercent: sovFrom(v.yours, v.competitors),
				}));

			// Back-compat: last 14 days, count-only shape for the sparkline/bars consumers.
			const trend14d = trend.slice(-14).map(({ date, yours, competitors }) => ({ date, yours, competitors }));

			// Per-competitor daily series (aligned with `trend`) + the top-3 competitors by total mentions.
			const competitorTrend = [...compTrendMap.entries()]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([date, byCompetitor]) => ({ date, yours: trendMap.get(date)?.yours ?? 0, byCompetitor }));
			const topCompetitorIds = Object.entries(competitorMentionsById)
				.sort(([, a], [, b]) => b - a)
				.slice(0, 3)
				.map(([id]) => id);

			const sumWindow = (days: Array<{ yours: number; competitors: number }>) =>
				days.reduce(
					(acc, d) => {
						acc.y += d.yours;
						acc.c += d.competitors;
						return acc;
					},
					{ y: 0, c: 0 },
				);
			// Week-over-week always uses the most recent 14 UTC days (wowMap), regardless of the selected range.
			const last14 = [...wowMap.entries()]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([date, v]) => ({ date, ...v }));
			const prior7 = last14.slice(0, 7);
			const last7 = last14.slice(-7);
			const p = sumWindow(prior7);
			const l = sumWindow(last7);
			const sovPrior7d = sovFrom(p.y, p.c);
			const sovLast7d = sovFrom(l.y, l.c);
			const sovWeekOverWeekDelta =
				sovPrior7d != null && sovLast7d != null ? sovLast7d - sovPrior7d : null;
			const sovComparisonAvailable = prior7.length === 7 && sovWeekOverWeekDelta != null;

			// ── Per-metric week-over-week (last 7 UTC days vs the 7 before) so EVERY headline KPI
			//    shows movement, not just a static number. Same windows as the SoV WoW above. ──
			const wowWindows = weekOverWeekWindows(wowMap.keys());
			const winOf = (runAt: string | null | undefined): 'last' | 'prior' | null =>
				runAt ? classifyDayWindow(utcDayKey(runAt), wowWindows) : null;

			// Brand mentions (absolute count) per window
			let mentionsLast7 = 0;
			let mentionsPrior7 = 0;
			for (const m of mentions) {
				if (!m.tracked_brand_id) continue;
				const w = winOf(runById.get(m.query_run_id)?.run_at as string | undefined);
				if (w === 'last') mentionsLast7 += 1;
				else if (w === 'prior') mentionsPrior7 += 1;
			}
			const mentionsWeekOverWeekDelta =
				mentionsLast7 + mentionsPrior7 > 0 ? mentionsLast7 - mentionsPrior7 : null;

			// Citation rate per window = cited runs / runs with sources within that window (pp delta)
			let runsLast7 = 0;
			let runsPrior7 = 0;
			for (const r of runList) {
				if (!runsWithSources.has(r.id as string)) continue;
				const w = winOf(r.run_at as string | undefined);
				if (w === 'last') runsLast7 += 1;
				else if (w === 'prior') runsPrior7 += 1;
			}
			let citedLast7 = 0;
			let citedPrior7 = 0;
			for (const id of citedRunIds) {
				const w = winOf(runById.get(id)?.run_at as string | undefined);
				if (w === 'last') citedLast7 += 1;
				else if (w === 'prior') citedPrior7 += 1;
			}
			const crLast7 = brandDomains.length > 0 && runsLast7 > 0 ? (100 * citedLast7) / runsLast7 : null;
			const crPrior7 = brandDomains.length > 0 && runsPrior7 > 0 ? (100 * citedPrior7) / runsPrior7 : null;
			const citationRateWeekOverWeekDelta =
				crLast7 != null && crPrior7 != null ? crLast7 - crPrior7 : null;

			// Avg position per window (lower = better; a NEGATIVE delta means you moved up)
			const posWindow = (which: 'last' | 'prior'): number | null =>
				averageBrandPosition(
					[...runEntities.entries()]
						.filter(([rid]) => winOf(runById.get(rid)?.run_at as string | undefined) === which)
						.map(([, arr]) => arr),
				);
			const posLast7 = posWindow('last');
			const posPrior7 = posWindow('prior');
			const positionWeekOverWeekDelta =
				posLast7 != null && posPrior7 != null ? posLast7 - posPrior7 : null;

			const hasNonNeutralSentiment = trackedSentiment.positive > 0 || trackedSentiment.negative > 0;

			return {
				yourBrandMentions,
				competitorMentionsById,
				totalCompetitorMentions,
				shareOfVoicePercent,
				sovSampleSize,
				sovLowConfidence,
				citationRatePercent,
				citedAnswers: citedRunIds.size,
				avgPosition,
				byProvider,
				trend14d,
				trend,
				competitorTrend,
				topCompetitorIds,
				rangeDays: span,
				hasData: mentions.length > 0,
				hasEverScanned,
				sovAsOfAt,
				yourBrandMentionsHeadline,
				totalCompetitorMentionsHeadline: competitorMentionsHeadline,
				sovLast7d,
				sovPrior7d,
				sovWeekOverWeekDelta,
				sovComparisonAvailable,
				mentionsWeekOverWeekDelta,
				citationRateWeekOverWeekDelta,
				positionWeekOverWeekDelta,
				trackedSentiment,
				hasNonNeutralSentiment,
			};
		},
		enabled: !!projectId,
	});
}

export type VisibilityContentGap = {
	queryId: string;
	text: string;
	/** how many competitors got cited for this prompt (higher = clearer gap to win) */
	competitorMentions: number;
	lastRunAt: string | null;
};

/**
 * Content opportunities: active prompts that HAVE completed runs but where your tracked brand
 * was NOT mentioned — i.e. AI doesn't cite you for these. These are the exact topics to create
 * content for (closes the measure-gap → write-content loop). Sorted by competitor mentions desc.
 */
export function useVisibilityContentGaps(projectId: string | undefined) {
	return useQuery({
		queryKey: ['visibility', projectId || '', 'contentGaps'],
		queryFn: async (): Promise<VisibilityContentGap[]> => {
			if (!projectId) return [];
			const { data: qrows } = await supabase
				.from('visibility_queries')
				.select('id, text, is_active')
				.eq('project_id', projectId)
				.eq('is_active', true);
			const queries = (qrows || []) as Array<{ id: string; text: string }>;
			if (queries.length === 0) return [];
			const qids = queries.map((q) => q.id);
			const { data: runs } = await supabase
				.from('visibility_query_runs')
				.select('id, query_id, status, run_at')
				.in('query_id', qids)
				.order('run_at', { ascending: false })
				.limit(2000);
			const completed = ((runs || []) as Array<{ id: string; query_id: string; status: string; run_at: string }>).filter(
				(r) => r.status === 'completed',
			);
			if (completed.length === 0) return [];
			const runToQuery = new Map(completed.map((r) => [r.id, r.query_id]));
			const runIds = completed.map((r) => r.id);
			const mentions: Array<{ query_run_id: string; tracked_brand_id: string | null; competitor_brand_id: string | null }> = [];
			const chunk = 100;
			for (let i = 0; i < runIds.length; i += chunk) {
				const { data: m } = await supabase
					.from('visibility_brand_mentions')
					.select('query_run_id, tracked_brand_id, competitor_brand_id')
					.in('query_run_id', runIds.slice(i, i + chunk));
				if (m) mentions.push(...(m as typeof mentions));
			}
			const brandByQuery = new Set<string>();
			const compByQuery = new Map<string, number>();
			for (const m of mentions) {
				const qid = runToQuery.get(m.query_run_id);
				if (!qid) continue;
				if (m.tracked_brand_id) brandByQuery.add(qid);
				if (m.competitor_brand_id) compByQuery.set(qid, (compByQuery.get(qid) || 0) + 1);
			}
			const ranAt = new Map<string, string>();
			for (const r of completed) if (!ranAt.has(r.query_id)) ranAt.set(r.query_id, r.run_at);
			return queries
				.filter((q) => ranAt.has(q.id) && !brandByQuery.has(q.id))
				.map((q) => ({ queryId: q.id, text: q.text, competitorMentions: compByQuery.get(q.id) || 0, lastRunAt: ranAt.get(q.id) || null }))
				.sort((a, b) => b.competitorMentions - a.competitorMentions);
		},
		enabled: !!projectId,
		staleTime: 60_000,
	});
}

export function useVisibilityCitations(projectId: string | undefined) {
	return useQuery({
		queryKey: [...visibilityKeys.project(projectId || ''), 'citations'],
		queryFn: async () => {
			if (!projectId) return [];
			const { data: qids } = await supabase
				.from('visibility_queries')
				.select('id')
				.eq('project_id', projectId);
			const ids = (qids || []).map((q) => q.id);
			if (ids.length === 0) return [];
			const since = new Date(Date.now() - 90 * 864e5).toISOString();
			const runIds: string[] = [];
			for (const slice of chunk(ids, 150)) {
				const { data: runs } = await supabase
					.from('visibility_query_runs')
					.select('id')
					.in('query_id', slice)
					.gte('run_at', since)
					.order('run_at', { ascending: false })
					.limit(2000);
				for (const r of runs || []) runIds.push(r.id);
			}
			if (runIds.length === 0) return [];
			const out: VisibilityCitationRow[] = [];
			for (const slice of chunk(runIds, 150)) {
				const { data, error } = await supabase
					.from('visibility_citations')
					.select('*')
					.in('query_run_id', slice);
				if (error) throw error;
				out.push(...(data as VisibilityCitationRow[]));
			}
			return out;
		},
		enabled: !!projectId,
	});
}

export function useInsertTrackedBrand(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (row: { name: string; domain?: string | null; aliases?: string[] }) => {
			const { data, error } = await supabase
				.from('tracked_brands')
				.insert({
					project_id: projectId,
					name: row.name,
					domain: row.domain ?? null,
					aliases: row.aliases ?? [],
				})
				.select()
				.single();
			if (error) throw error;
			return data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: visibilityKeys.brands(projectId) });
		},
	});
}

export function useUpdateTrackedBrand(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (args: { id: string; name?: string; domain?: string | null; aliases?: string[] }) => {
			const patch: Record<string, unknown> = {};
			if (args.name !== undefined) patch['name'] = args.name;
			if (args.domain !== undefined) patch['domain'] = args.domain;
			if (args.aliases !== undefined) patch['aliases'] = args.aliases;
			const { error } = await supabase.from('tracked_brands').update(patch).eq('id', args.id);
			if (error) throw error;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: visibilityKeys.brands(projectId) });
		},
	});
}

export function useInsertCompetitor(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (row: { name: string; domain?: string | null; aliases?: string[] }) => {
			const { data, error } = await supabase
				.from('competitor_brands')
				.insert({
					project_id: projectId,
					name: row.name,
					domain: row.domain ?? null,
					aliases: row.aliases ?? [],
				})
				.select()
				.single();
			if (error) throw error;
			return data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: visibilityKeys.competitors(projectId) });
		},
	});
}

/** Auto-discover real competitors from the brand URL (SERP + LLM). Returns proposals to review. */
export function useDiscoverCompetitors() {
	return useMutation({
		mutationFn: (opts: Parameters<typeof discoverCompetitors>[0]) => discoverCompetitors(opts),
	});
}

export function useDeleteCompetitor(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			const { error } = await supabase.from('competitor_brands').delete().eq('id', id);
			if (error) throw error;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: visibilityKeys.competitors(projectId) });
		},
	});
}

export function useInsertVisibilityQuery(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (row: {
			text: string;
			language: string;
			intent_type: VisibilityQueryRow['intent_type'];
			vertical?: WorkspaceVertical | null;
		}) => {
			const { data, error } = await supabase
				.from('visibility_queries')
				.insert({
					project_id: projectId,
					text: row.text,
					language: row.language,
					intent_type: row.intent_type,
					vertical: row.vertical ?? null,
					is_auto_generated: false,
					is_active: true,
				})
				.select()
				.single();
			if (error) throw error;
			return data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: visibilityKeys.queries(projectId) });
		},
	});
}

export function useInsertVisibilityQueryBatch(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (args: {
			rows: Array<{ text: string; language: string; intent_type: VisibilityQueryRow['intent_type'] }>;
			vertical?: WorkspaceVertical | null;
		}) => {
			const { rows, vertical } = args;
			if (rows.length === 0) return [];
			const { data, error } = await supabase
				.from('visibility_queries')
				.insert(
					rows.map((row) => ({
						project_id: projectId,
						text: row.text,
						language: row.language,
						intent_type: row.intent_type,
						vertical: vertical ?? null,
						is_auto_generated: false,
						is_active: true,
					})),
				)
				.select();
			if (error) throw error;
			return data ?? [];
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: visibilityKeys.queries(projectId) });
		},
	});
}

export function useDeleteVisibilityQuery(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			const { error } = await supabase.from('visibility_queries').delete().eq('id', id);
			if (error) throw error;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: visibilityKeys.queries(projectId) });
			void qc.invalidateQueries({ queryKey: visibilityKeys.runs(projectId) });
			void qc.invalidateQueries({ queryKey: visibilityKeys.mentionCount(projectId) });
			void qc.invalidateQueries({ queryKey: visibilityKeys.mentionInsights(projectId) });
		},
	});
}

export function useUpdateVisibilityQuery(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (args: { id: string; text: string; intent_type: VisibilityQueryRow['intent_type']; language?: string }) => {
			const text = args.text.trim();
			if (!text) throw new Error('empty');
			const patch: { text: string; intent_type: VisibilityQueryRow['intent_type']; language?: string } = { text, intent_type: args.intent_type };
			if (args.language) patch.language = args.language;
			const { error } = await supabase
				.from('visibility_queries')
				.update(patch)
				.eq('id', args.id);
			if (error) throw error;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: visibilityKeys.queries(projectId) });
		},
	});
}

export function useUpdateVisibilityQueryActive(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (args: { id: string; is_active: boolean }) => {
			const { error } = await supabase.from('visibility_queries').update({ is_active: args.is_active }).eq('id', args.id);
			if (error) throw error;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: visibilityKeys.queries(projectId) });
		},
	});
}

export function useBulkUpdateVisibilityQueriesActive(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (args: { ids: string[]; is_active: boolean }) => {
			const ids = [...new Set(args.ids)].filter(Boolean);
			if (ids.length === 0) return;
			const { error } = await supabase
				.from('visibility_queries')
				.update({ is_active: args.is_active })
				.in('id', ids);
			if (error) throw error;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: visibilityKeys.queries(projectId) });
		},
	});
}

export function useBulkDeleteVisibilityQueries(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (ids: string[]) => {
			const unique = [...new Set(ids)].filter(Boolean);
			if (unique.length === 0) return;
			const { error } = await supabase.from('visibility_queries').delete().in('id', unique);
			if (error) throw error;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: visibilityKeys.queries(projectId) });
			void qc.invalidateQueries({ queryKey: visibilityKeys.runs(projectId) });
			void qc.invalidateQueries({ queryKey: visibilityKeys.mentionCount(projectId) });
			void qc.invalidateQueries({ queryKey: visibilityKeys.mentionInsights(projectId) });
		},
	});
}

export function useDuplicateVisibilityQuery(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (args: { source: VisibilityQueryRow; text: string }) => {
			const { source, text } = args;
			const { data, error } = await supabase
				.from('visibility_queries')
				.insert({
					project_id: projectId,
					text,
					language: source.language,
					intent_type: source.intent_type,
					vertical: source.vertical,
					is_auto_generated: false,
					is_active: true,
				})
				.select()
				.single();
			if (error) throw error;
			return data;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: visibilityKeys.queries(projectId) });
		},
	});
}

export function useGenerateQueriesMutation(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (count?: number) => generateVisibilityQueries(projectId, count),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: visibilityKeys.queries(projectId) });
			void qc.invalidateQueries({ queryKey: visibilityKeys.spend(projectId) });
		},
	});
}

type RunPollContext = { pollId: number };

export function useRunQueryMutation(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (args: {
			queryId: string;
			providers?: VisibilityRunProvider[];
			dfsLimit?: RunVisibilityQueryOptions['dfsLimit'];
			matchType?: RunVisibilityQueryOptions['matchType'];
			preferBrandSources?: RunVisibilityQueryOptions['preferBrandSources'];
		}) =>
			runVisibilityQuery(args.queryId, args.providers, {
				dfsLimit: args.dfsLimit,
				matchType: args.matchType,
				preferBrandSources: args.preferBrandSources,
			}),
		onMutate: async (): Promise<RunPollContext> => {
			const pollId = window.setInterval(() => {
				void qc.invalidateQueries({ queryKey: visibilityKeys.runs(projectId) });
			}, 3500);
			return { pollId };
		},
		onSettled: (_data, _error, _variables, context) => {
			if (context?.pollId != null) window.clearInterval(context.pollId);
			void qc.invalidateQueries({ queryKey: visibilityKeys.runs(projectId) });
			void qc.invalidateQueries({ queryKey: [...visibilityKeys.project(projectId), 'citations'] });
			void qc.invalidateQueries({ queryKey: visibilityKeys.spend(projectId) });
			void qc.invalidateQueries({ queryKey: visibilityKeys.mentionCount(projectId) });
			void qc.invalidateQueries({ queryKey: visibilityKeys.mentionInsights(projectId) });
			void qc.invalidateQueries({ queryKey: ['projects', projectId] });
		},
	});
}

export function useRunBatchMutation(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (args: {
			queryIds: string[];
			providers?: VisibilityRunProvider[];
			dfsLimit?: RunVisibilityQueryOptions['dfsLimit'];
			matchType?: RunVisibilityQueryOptions['matchType'];
			preferBrandSources?: RunVisibilityQueryOptions['preferBrandSources'];
		}) =>
			runVisibilityBatch(args.queryIds, args.providers ?? [...DEFAULT_VISIBILITY_PROVIDERS], {
				dfsLimit: args.dfsLimit,
				matchType: args.matchType,
				preferBrandSources: args.preferBrandSources,
			}),
		onMutate: async (): Promise<RunPollContext> => {
			const pollId = window.setInterval(() => {
				void qc.invalidateQueries({ queryKey: visibilityKeys.runs(projectId) });
			}, 3500);
			return { pollId };
		},
		onSettled: (_data, _error, _variables, context) => {
			if (context?.pollId != null) window.clearInterval(context.pollId);
			void qc.invalidateQueries({ queryKey: visibilityKeys.runs(projectId) });
			void qc.invalidateQueries({ queryKey: [...visibilityKeys.project(projectId), 'citations'] });
			void qc.invalidateQueries({ queryKey: visibilityKeys.spend(projectId) });
			void qc.invalidateQueries({ queryKey: visibilityKeys.mentionCount(projectId) });
			void qc.invalidateQueries({ queryKey: visibilityKeys.mentionInsights(projectId) });
			void qc.invalidateQueries({ queryKey: ['projects', projectId] });
		},
	});
}

export type CompetitorHeadToHead = {
	yourMentions: number;
	competitorMentions: number;
	yourSovPercent: number | null;
	competitorSovPercent: number | null;
	byProvider: Partial<Record<string, { yours: number; theirs: number }>>;
	trend: Array<{ date: string; yours: number; theirs: number; yourSovPercent: number | null }>;
};

/** Head-to-head SoV vs one competitor (latest-per-query snapshot + range trend). */
export function useCompetitorHeadToHead(
	projectId: string | undefined,
	competitorId: string | undefined,
	rangeDays = 30,
) {
	return useQuery({
		queryKey: visibilityKeys.headToHead(projectId || '', competitorId || '', rangeDays),
		queryFn: async (): Promise<CompetitorHeadToHead> => {
			const empty: CompetitorHeadToHead = {
				yourMentions: 0,
				competitorMentions: 0,
				yourSovPercent: null,
				competitorSovPercent: null,
				byProvider: {},
				trend: [],
			};
			if (!projectId || !competitorId) return empty;

			const { data: runs } = await supabase
				.from('visibility_query_runs')
				.select('id, query_id, provider, run_at, visibility_queries!inner(project_id)')
				.eq('visibility_queries.project_id', projectId)
				.order('run_at', { ascending: false })
				.limit(1200);
			const runList = (runs || []) as Array<{ id: string; query_id: string; provider: string; run_at: string }>;
			if (runList.length === 0) return empty;

			const latestRunIdByQuery = new Map<string, string>();
			for (const r of runList) {
				const qid = String(r.query_id);
				if (!latestRunIdByQuery.has(qid)) latestRunIdByQuery.set(qid, String(r.id));
			}
			const headlineRunIds = new Set(latestRunIdByQuery.values());

			const span = Math.max(7, Math.min(90, rangeDays));
			const trendMap = new Map<string, { yours: number; theirs: number }>();
			const today = new Date();
			for (let i = span - 1; i >= 0; i--) {
				const d = new Date(today);
				d.setUTCDate(d.getUTCDate() - i);
				trendMap.set(d.toISOString().slice(0, 10), { yours: 0, theirs: 0 });
			}

			const runById = new Map(runList.map((r) => [r.id, r]));
			const runIds = runList.map((r) => r.id);
			const mentions: Array<{
				tracked_brand_id: string | null;
				competitor_brand_id: string | null;
				query_run_id: string;
			}> = [];
			const chunk = 100;
			for (let i = 0; i < runIds.length; i += chunk) {
				const { data: mrows } = await supabase
					.from('visibility_brand_mentions')
					.select('tracked_brand_id, competitor_brand_id, query_run_id')
					.in('query_run_id', runIds.slice(i, i + chunk));
				if (mrows) mentions.push(...(mrows as typeof mentions));
			}

			let yourMentions = 0;
			let competitorMentions = 0;
			const byProvider: Partial<Record<string, { yours: number; theirs: number }>> = {};

			const bumpProv = (prov: string, field: 'yours' | 'theirs') => {
				if (!byProvider[prov]) byProvider[prov] = { yours: 0, theirs: 0 };
				byProvider[prov]![field] += 1;
			};

			for (const m of mentions) {
				const run = runById.get(m.query_run_id);
				if (!run) continue;
				const prov = String(run.provider);
				const dk = utcDayKey(run.run_at);
				const bucket = trendMap.get(dk);
				const inHeadline = headlineRunIds.has(m.query_run_id);

				if (m.tracked_brand_id && inHeadline) {
					yourMentions += 1;
					bumpProv(prov, 'yours');
				}
				if (m.competitor_brand_id === competitorId) {
					if (inHeadline) competitorMentions += 1;
					bumpProv(prov, 'theirs');
					if (bucket) bucket.theirs += 1;
				}
				if (m.tracked_brand_id && bucket) bucket.yours += 1;
			}

			const yourSovPercent = computeMentionShareOfVoice(yourMentions, competitorMentions);
			const competitorSovPercent =
				yourSovPercent != null ? Math.max(0, Math.min(100, 100 - yourSovPercent)) : null;

			const trend = [...trendMap.entries()]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([date, v]) => ({
					date,
					yours: v.yours,
					theirs: v.theirs,
					yourSovPercent: shareOfVoice(v.yours, v.theirs),
				}));

			return {
				yourMentions,
				competitorMentions,
				yourSovPercent,
				competitorSovPercent,
				byProvider,
				trend,
			};
		},
		enabled: !!projectId && !!competitorId,
		staleTime: 60_000,
	});
}

export type TargetCompetitorPromptGap = {
	queryId: string;
	text: string;
	competitorMentions: number;
	lastRunAt: string | null;
};

/** Prompts where the target competitor is mentioned but your brand is not. */
export function useTargetCompetitorPromptGaps(
	projectId: string | undefined,
	competitorId: string | undefined,
) {
	return useQuery({
		queryKey: ['visibility', projectId || '', 'targetPromptGaps', competitorId || ''],
		queryFn: async (): Promise<TargetCompetitorPromptGap[]> => {
			if (!projectId || !competitorId) return [];
			const { data: qrows } = await supabase
				.from('visibility_queries')
				.select('id, text, is_active')
				.eq('project_id', projectId)
				.eq('is_active', true);
			const queries = (qrows || []) as Array<{ id: string; text: string }>;
			if (queries.length === 0) return [];
			const qids = queries.map((q) => q.id);
			const { data: runs } = await supabase
				.from('visibility_query_runs')
				.select('id, query_id, status, run_at')
				.in('query_id', qids)
				.order('run_at', { ascending: false })
				.limit(2000);
			const completed = ((runs || []) as Array<{ id: string; query_id: string; status: string; run_at: string }>).filter(
				(r) => r.status === 'completed',
			);
			if (completed.length === 0) return [];
			const runToQuery = new Map(completed.map((r) => [r.id, r.query_id]));
			const runIds = completed.map((r) => r.id);
			const mentions: Array<{ query_run_id: string; tracked_brand_id: string | null; competitor_brand_id: string | null }> = [];
			const chunk = 100;
			for (let i = 0; i < runIds.length; i += chunk) {
				const { data: m } = await supabase
					.from('visibility_brand_mentions')
					.select('query_run_id, tracked_brand_id, competitor_brand_id')
					.in('query_run_id', runIds.slice(i, i + chunk));
				if (m) mentions.push(...(m as typeof mentions));
			}
			const brandByQuery = new Set<string>();
			const targetByQuery = new Map<string, number>();
			for (const m of mentions) {
				const qid = runToQuery.get(m.query_run_id);
				if (!qid) continue;
				if (m.tracked_brand_id) brandByQuery.add(qid);
				if (m.competitor_brand_id === competitorId) {
					targetByQuery.set(qid, (targetByQuery.get(qid) || 0) + 1);
				}
			}
			const ranAt = new Map<string, string>();
			for (const r of completed) if (!ranAt.has(r.query_id)) ranAt.set(r.query_id, r.run_at);
			return queries
				.filter((q) => targetByQuery.has(q.id) && !brandByQuery.has(q.id))
				.map((q) => ({
					queryId: q.id,
					text: q.text,
					competitorMentions: targetByQuery.get(q.id) || 0,
					lastRunAt: ranAt.get(q.id) || null,
				}))
				.sort((a, b) => b.competitorMentions - a.competitorMentions);
		},
		enabled: !!projectId && !!competitorId,
		staleTime: 60_000,
	});
}

export function useLinkIntersect(
	projectId: string | undefined,
	competitorDomain: string | undefined,
	enabled = true,
) {
	const domain = competitorDomain?.trim() || '';
	return useQuery({
		queryKey: visibilityKeys.linkIntersect(projectId || '', domain),
		queryFn: async () => {
			if (!projectId || !domain) return null;
			return getLinkIntersect(projectId, domain, { limit: 25 });
		},
		enabled: !!projectId && !!domain && enabled,
		staleTime: 5 * 60_000,
	});
}

export function useContentGap(
	projectId: string | undefined,
	competitorDomain: string | undefined,
	enabled = true,
) {
	const domain = competitorDomain?.trim() || '';
	return useQuery({
		queryKey: visibilityKeys.contentGap(projectId || '', domain),
		queryFn: async () => {
			if (!projectId || !domain) return null;
			return getContentGap(projectId, domain, { limit: 25 });
		},
		enabled: !!projectId && !!domain && enabled,
		staleTime: 5 * 60_000,
	});
}

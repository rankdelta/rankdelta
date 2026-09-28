/**
 * Rank Tracking Hook
 *
 * Persists keywords to serp_rank_keywords immediately (per phrase), then enqueues
 * async SERP check jobs. Avoids blocking on DataForSEO before any DB write.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { persistSerpKeywords } from '../lib/serpRankPersist';
import { enqueueAndStartSerpRankJob } from '../services/serpRankJobs';
import type { RankData } from '../services/rankTracking';
import { compareWithCompetitors } from '../services/rankTracking';
import type { SerpRankKeywordRow, SerpRankSnapshotRow } from '../types/database';
import { serpRankKeys } from './useSerpRankTracker';

interface TrackRankingsParams {
	projectId: string;
	keywords: string[];
	websiteUrl: string;
	locationCode?: number;
	languageCode?: string;
	/** When false, only persist keywords (no SERP job). Default true. */
	runChecks?: boolean;
}

/** "Not ranked" (null position) is treated as just outside the top 100 for delta math only. */
const NOT_RANKED_SENTINEL = 101;

function latestSnapshotByKeyword(rows: SerpRankSnapshotRow[]): Map<string, SerpRankSnapshotRow> {
	const m = new Map<string, SerpRankSnapshotRow>();
	for (const r of rows) {
		const cur = m.get(r.keyword_id);
		if (!cur || new Date(r.checked_at).getTime() > new Date(cur.checked_at).getTime()) {
			m.set(r.keyword_id, r);
		}
	}
	return m;
}

/**
 * Track rankings: save keywords first, then enqueue async Google SERP checks.
 */
export const useTrackRankings = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (params: TrackRankingsParams) => {
			const persisted = await persistSerpKeywords(params.projectId, params.keywords);
			const savedIds = persisted.filter((p) => p.ok && p.id).map((p) => p.id as string);

			let job = null;
			if (savedIds.length > 0 && params.websiteUrl?.trim() && params.runChecks !== false) {
				job = await enqueueAndStartSerpRankJob(params.projectId, savedIds);
			}

			return persisted.map((p) => ({
				phrase: p.phrase,
				ok: p.ok,
				id: p.id,
				error: p.error,
				job,
			}));
		},
		onSuccess: (_, variables) => {
			void queryClient.invalidateQueries({ queryKey: serpRankKeys.project(variables.projectId) });
			void queryClient.invalidateQueries({ queryKey: ['rankings', variables.projectId] });
		},
	});
};

/**
 * Rankings for Analytics / Project detail — reads the canonical serp_rank_* tables.
 */
export const useRankings = (projectId: string | undefined) => {
	return useQuery({
		queryKey: ['rankings', projectId],
		queryFn: async () => {
			if (!projectId) return [];

			const { data: keywords, error: kwErr } = await supabase
				.from('serp_rank_keywords')
				.select('*')
				.eq('project_id', projectId)
				.eq('is_active', true)
				.order('created_at', { ascending: false });
			if (kwErr) throw kwErr;
			const rows = (keywords ?? []) as SerpRankKeywordRow[];
			if (!rows.length) return [];

			const ids = rows.map((k) => k.id);
			// raw_response (full SERP JSON) is not read here — skip it to keep the payload small.
			const { data: snaps, error: snapErr } = await supabase
				.from('serp_rank_snapshots')
				.select('id, keyword_id, rank_absolute, ranking_url, result_title, serp_organic_count, cost_usd, status, error_message, checked_at')
				.in('keyword_id', ids)
				.order('checked_at', { ascending: false })
				.limit(2500);
			if (snapErr) throw snapErr;

			const allSnaps = (snaps ?? []) as unknown as SerpRankSnapshotRow[];
			// Position/"not ranked" come from COMPLETED checks only — a failed check (API error) must
			// not read as "dropped out of the top 100".
			const completedSnaps = allSnaps.filter((s) => s.status === 'completed');
			const latest = latestSnapshotByKeyword(completedSnaps);
			const latestAny = latestSnapshotByKeyword(allSnaps);
			const history = new Map<string, SerpRankSnapshotRow[]>();
			for (const s of completedSnaps) {
				const arr = history.get(s.keyword_id) ?? [];
				arr.push(s);
				history.set(s.keyword_id, arr);
			}

			return rows.map((k): RankData & { rankingId: string } => {
				const cur = latest.get(k.id);
				const last = latestAny.get(k.id);
				const hist = (history.get(k.id) ?? [])
					.sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime());
				const prevSnap = hist.length >= 2 ? hist[hist.length - 2]! : null;
				const prev = prevSnap ? prevSnap.rank_absolute : null;
				const pos = cur?.rank_absolute ?? null;
				// Delta vs the previous COMPLETED check; "not ranked" counts as >100 for the math only.
				const change =
					cur && prevSnap
						? (prev ?? NOT_RANKED_SENTINEL) - (pos ?? NOT_RANKED_SENTINEL)
						: 0;
				return {
					keyword: k.phrase,
					position: pos,
					url: cur?.ranking_url ?? null,
					title: cur?.result_title ?? null,
					previousPosition: prev,
					change,
					searchVolume: null,
					difficulty: null,
					lastChecked: last?.checked_at ?? k.created_at,
					rankingId: k.id,
					checkStatus: last ? (last.status === 'completed' ? 'completed' : 'failed') : 'pending',
					errorMessage: last && last.status !== 'completed' ? last.error_message : null,
				};
			});
		},
		enabled: !!projectId,
	});
};

/**
 * Get ranking history for a keyword (serp_rank_snapshots).
 */
export const useRankingHistory = (rankingId: string | undefined) => {
	return useQuery({
		queryKey: ['ranking-history', rankingId],
		queryFn: async () => {
			if (!rankingId) return [];

			// Newest 365 checks, then reversed so the chart still gets ascending order.
			const { data, error } = await supabase
				.from('serp_rank_snapshots')
				.select('checked_at, rank_absolute, ranking_url')
				.eq('keyword_id', rankingId)
				.order('checked_at', { ascending: false })
				.limit(365);

			if (error) throw error;
			return (data ?? []).reverse().map((row) => ({
				ranking_id: rankingId,
				position: row.rank_absolute as number | null,
				url: row.ranking_url as string | null,
				checked_at: row.checked_at as string,
			}));
		},
		enabled: !!rankingId,
	});
};

export const useCompareCompetitors = () => {
	return useMutation({
		mutationFn: async (params: {
			keyword: string;
			competitorUrls: string[];
			locationCode?: number;
			languageCode?: string;
		}) => {
			return await compareWithCompetitors(
				params.keyword,
				params.competitorUrls,
				params.locationCode,
				params.languageCode,
			);
		},
	});
};

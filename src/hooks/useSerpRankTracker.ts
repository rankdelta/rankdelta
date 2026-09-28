import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { SerpRankKeywordRow, SerpRankSnapshotRow } from '../types/database';
import { persistSerpKeywords } from '../lib/serpRankPersist';
import {
	enqueueSerpRankJob,
	drainSerpRankJob,
	fetchActiveSerpRankJobs,
	jobRowToProgress,
	type SerpRankJobProgress,
} from '../services/serpRankJobs';
import { VISIBILITY_SERP_BATCH_MAX_KEYWORDS } from '../config/dataforseoVisibility';
import { visibilityKeys } from './useVisibilityTracker';

export const serpRankKeys = {
	project: (projectId: string) => ['serp-rank', projectId] as const,
	keywords: (projectId: string) => ['serp-rank', projectId, 'keywords'] as const,
	snapshots: (projectId: string) => ['serp-rank', projectId, 'snapshots'] as const,
	jobs: (projectId: string) => ['serp-rank', projectId, 'jobs'] as const,
};

function latestSnapshotByKeywordId(rows: SerpRankSnapshotRow[]): Map<string, SerpRankSnapshotRow> {
	const m = new Map<string, SerpRankSnapshotRow>();
	for (const r of rows) {
		const cur = m.get(r.keyword_id);
		if (!cur || new Date(r.checked_at).getTime() > new Date(cur.checked_at).getTime()) {
			m.set(r.keyword_id, r);
		}
	}
	return m;
}

export function useSerpRankKeywords(projectId: string | undefined) {
	return useQuery({
		queryKey: serpRankKeys.keywords(projectId || ''),
		queryFn: async () => {
			if (!projectId) return [];
			const { data, error } = await supabase
				.from('serp_rank_keywords')
				.select('*')
				.eq('project_id', projectId)
				.order('created_at', { ascending: false });
			if (error) throw error;
			return data as SerpRankKeywordRow[];
		},
		enabled: !!projectId,
	});
}

export function useSerpRankSnapshotsForProject(projectId: string | undefined, keywordIds: string[]) {
	return useQuery({
		queryKey: [...serpRankKeys.snapshots(projectId || ''), keywordIds.slice().sort().join(',')],
		queryFn: async () => {
			if (!projectId || keywordIds.length === 0) return [];
			const { data, error } = await supabase
				.from('serp_rank_snapshots')
				.select('*')
				.in('keyword_id', keywordIds)
				.order('checked_at', { ascending: false })
				.limit(2500);
			if (error) throw error;
			return data as SerpRankSnapshotRow[];
		},
		enabled: !!projectId && keywordIds.length > 0,
	});
}

function historyByKeywordId(rows: SerpRankSnapshotRow[]): Map<string, SerpRankSnapshotRow[]> {
	const m = new Map<string, SerpRankSnapshotRow[]>();
	for (const r of rows) {
		const arr = m.get(r.keyword_id) ?? [];
		arr.push(r);
		m.set(r.keyword_id, arr);
	}
	for (const arr of m.values()) {
		arr.sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime());
	}
	return m;
}

export function useSerpRankLatestMap(projectId: string | undefined) {
	const { data: keywords = [] } = useSerpRankKeywords(projectId);
	const ids = keywords.map((k) => k.id);
	const { data: snapshots = [] } = useSerpRankSnapshotsForProject(projectId, ids);
	return {
		keywords,
		latestByKeyword: latestSnapshotByKeywordId(snapshots),
		historyByKeyword: historyByKeywordId(snapshots),
	};
}

/** A pending/running job with no update for this long is considered stalled (its drainer died). */
const SERP_RANK_JOB_STALE_MS = 60_000;

function isStaleSerpRankJob(job: { updated_at: string; created_at: string }, now = Date.now()): boolean {
	const last = new Date(job.updated_at || job.created_at).getTime();
	return !Number.isFinite(last) || now - last > SERP_RANK_JOB_STALE_MS;
}

/**
 * Poll active background SERP check jobs. Drain is started ONCE per job by the enqueue mutation;
 * this poller only resumes jobs that look stalled (no update for 60s — e.g. the tab that
 * enqueued them was closed), once per job, so we never triple-drain the same job.
 */
export function useSerpRankActiveJobs(projectId: string | undefined) {
	const qc = useQueryClient();
	const resumedRef = useRef(new Set<string>());
	const query = useQuery({
		queryKey: serpRankKeys.jobs(projectId || ''),
		queryFn: async () => {
			if (!projectId) return [];
			return fetchActiveSerpRankJobs(projectId);
		},
		enabled: !!projectId,
		refetchInterval: (q) => ((q.state.data?.length ?? 0) > 0 ? 2500 : false),
	});

	useEffect(() => {
		if (!projectId || !query.data?.length) return;
		for (const job of query.data) {
			if (
				(job.status === 'pending' || job.status === 'running') &&
				!resumedRef.current.has(job.id) &&
				isStaleSerpRankJob(job)
			) {
				resumedRef.current.add(job.id);
				void drainSerpRankJob(job.id, {
					maxRounds: 3,
					onProgress: () => {
						void qc.invalidateQueries({ queryKey: serpRankKeys.project(projectId) });
					},
				}).finally(() => {
					void qc.invalidateQueries({ queryKey: serpRankKeys.jobs(projectId) });
					void qc.invalidateQueries({ queryKey: serpRankKeys.project(projectId) });
				});
			}
		}
	}, [projectId, query.data, qc]);

	return query;
}

export function useInsertSerpKeyword(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (phrase: string) => {
			const [row] = await persistSerpKeywords(projectId, [phrase]);
			if (!row?.ok || !row.id) throw new Error(row?.error ?? 'insert failed');
			return { id: row.id, phrase: row.phrase, project_id: projectId, is_active: true } as SerpRankKeywordRow;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: serpRankKeys.keywords(projectId) });
			void qc.invalidateQueries({ queryKey: ['rankings', projectId] });
		},
	});
}

export function useBulkInsertSerpKeywords(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (
			input:
				| string
				| string[]
				| { phrases: string | string[]; onProgress?: (done: number, total: number) => void },
		) => {
			const phrases =
				typeof input === 'object' && !Array.isArray(input) && 'phrases' in input
					? input.phrases
					: input;
			const onProgress =
				typeof input === 'object' && !Array.isArray(input) && 'phrases' in input
					? input.onProgress
					: undefined;
			return persistSerpKeywords(
				projectId,
				Array.isArray(phrases) ? phrases : [phrases],
				{ onProgress },
			);
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: serpRankKeys.keywords(projectId) });
			void qc.invalidateQueries({ queryKey: ['rankings', projectId] });
		},
	});
}

/** Split keyword ids into server-sized batches (VISIBILITY_SERP_BATCH_MAX_KEYWORDS each). */
export function chunkSerpKeywordIds(ids: string[], size = VISIBILITY_SERP_BATCH_MAX_KEYWORDS): string[][] {
	const out: string[][] = [];
	for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
	return out;
}

export function useEnqueueSerpRankJobMutation(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (keywordIds: string[]) => {
			const ids = [...new Set(keywordIds)];
			const batches = chunkSerpKeywordIds(ids);
			if (batches.length === 0) throw new Error('No keywords to check');
			// All selected keywords are checked: one job per batch of VISIBILITY_SERP_BATCH_MAX_KEYWORDS,
			// enqueued + drained sequentially. Exactly ONE drain is started per job (here); the
			// active-jobs poller only resumes jobs that went stale.
			const first = await enqueueSerpRankJob(projectId, batches[0]!);
			void qc.invalidateQueries({ queryKey: serpRankKeys.jobs(projectId) });
			void (async () => {
				let job: SerpRankJobProgress = first;
				for (let i = 0; i < batches.length; i++) {
					try {
						if (i > 0) {
							job = await enqueueSerpRankJob(projectId, batches[i]!);
							void qc.invalidateQueries({ queryKey: serpRankKeys.jobs(projectId) });
						}
						await drainSerpRankJob(job.jobId, {
							onProgress: () => {
								void qc.invalidateQueries({ queryKey: serpRankKeys.project(projectId) });
							},
						});
					} catch (err) {
						console.warn('[serp-rank] batch failed', err);
					} finally {
						void qc.invalidateQueries({ queryKey: serpRankKeys.jobs(projectId) });
						void qc.invalidateQueries({ queryKey: serpRankKeys.project(projectId) });
					}
				}
			})();
			return { ...first, total: ids.length };
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: serpRankKeys.jobs(projectId) });
			void qc.invalidateQueries({ queryKey: visibilityKeys.spend(projectId) });
			void qc.invalidateQueries({ queryKey: ['projects', projectId] });
		},
	});
}

/** @deprecated Use useEnqueueSerpRankJobMutation — kept as alias for existing call sites. */
export function useRunSerpRankBatchMutation(projectId: string) {
	return useEnqueueSerpRankJobMutation(projectId);
}

export function useDeleteSerpKeyword(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			const { error } = await supabase.from('serp_rank_keywords').delete().eq('id', id);
			if (error) throw error;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: serpRankKeys.project(projectId) });
		},
	});
}

export function useUpdateSerpKeyword(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (args: { id: string; phrase: string }) => {
			const p = args.phrase.trim();
			if (!p) throw new Error('empty');
			const { error } = await supabase
				.from('serp_rank_keywords')
				.update({ phrase: p })
				.eq('id', args.id);
			if (error) throw error;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: serpRankKeys.keywords(projectId) });
			void qc.invalidateQueries({ queryKey: ['rankings', projectId] });
		},
	});
}

export function useToggleSerpKeywordActive(projectId: string) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (args: { id: string; is_active: boolean }) => {
			const { error } = await supabase
				.from('serp_rank_keywords')
				.update({ is_active: args.is_active })
				.eq('id', args.id);
			if (error) throw error;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: serpRankKeys.keywords(projectId) });
			void qc.invalidateQueries({ queryKey: ['rankings', projectId] });
		},
	});
}

export type { SerpRankJobProgress };

/** Progress across ALL active jobs (a bulk refresh is split into several batches). */
export function activeJobProgress(
	jobs: Parameters<typeof jobRowToProgress>[0][],
): SerpRankJobProgress | null {
	if (!jobs.length) return null;
	const first = jobRowToProgress(jobs[0]!);
	if (jobs.length === 1) return first;
	return jobs.slice(1).reduce((acc, row) => {
		const p = jobRowToProgress(row);
		return {
			...acc,
			total: acc.total + p.total,
			completed: acc.completed + p.completed,
			failed: acc.failed + p.failed,
			finished: acc.finished && p.finished,
		};
	}, first);
}

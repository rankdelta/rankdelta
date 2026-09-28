/**
 * Async SERP rank check jobs — enqueue + process via visibility-ops edge function.
 */
import { supabase } from '../lib/supabaseClient';
import type { SerpRankCheckJobRow } from '../types/database';

async function invokeVisibilityOps(body: Record<string, unknown>): Promise<unknown> {
	if (import.meta.env['VITE_DISABLE_VISIBILITY_OPS'] === 'true') {
		throw new Error('Visibility API runs are temporarily disabled.');
	}
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
		const msg =
			data && typeof data === 'object' && 'error' in data
				? String((data as { error: unknown }).error)
				: error.message;
		throw new Error(msg);
	}
	return data;
}

export type SerpRankJobProgress = {
	jobId: string;
	status: SerpRankCheckJobRow['status'];
	total: number;
	completed: number;
	failed: number;
	finished: boolean;
};

export async function enqueueSerpRankJob(
	projectId: string,
	keywordIds: string[],
): Promise<SerpRankJobProgress> {
	const data = (await invokeVisibilityOps({
		action: 'enqueue_serp_rank_job',
		projectId,
		keywordIds,
	})) as { jobId?: string; status?: string; total?: number };
	if (!data?.jobId) throw new Error('Failed to enqueue rank check job');
	return {
		jobId: data.jobId,
		status: (data.status as SerpRankCheckJobRow['status']) || 'pending',
		total: data.total ?? keywordIds.length,
		completed: 0,
		failed: 0,
		finished: false,
	};
}

export async function processSerpRankJob(jobId: string): Promise<SerpRankJobProgress> {
	const data = (await invokeVisibilityOps({
		action: 'process_serp_rank_job',
		jobId,
	})) as {
		jobId?: string;
		status?: string;
		total?: number;
		completed?: number;
		failed?: number;
		finished?: boolean;
	};
	return {
		jobId: data.jobId ?? jobId,
		status: (data.status as SerpRankCheckJobRow['status']) || 'pending',
		total: data.total ?? 0,
		completed: data.completed ?? 0,
		failed: data.failed ?? 0,
		finished: !!data.finished,
	};
}

/** Enqueue a job and kick off background processing (safe to call and navigate away). */
export async function enqueueAndStartSerpRankJob(
	projectId: string,
	keywordIds: string[],
): Promise<SerpRankJobProgress> {
	const job = await enqueueSerpRankJob(projectId, keywordIds);
	void drainSerpRankJob(job.jobId);
	return job;
}

/** Process chunks until the job finishes or the caller stops (resumable). */
export async function drainSerpRankJob(
	jobId: string,
	options?: { onProgress?: (p: SerpRankJobProgress) => void; maxRounds?: number },
): Promise<SerpRankJobProgress> {
	const maxRounds = options?.maxRounds ?? 50;
	let progress = await processSerpRankJob(jobId);
	options?.onProgress?.(progress);
	let rounds = 1;
	while (!progress.finished && rounds < maxRounds) {
		await new Promise((r) => setTimeout(r, 300));
		progress = await processSerpRankJob(jobId);
		options?.onProgress?.(progress);
		rounds++;
	}
	return progress;
}

export async function fetchActiveSerpRankJobs(projectId: string): Promise<SerpRankCheckJobRow[]> {
	const { data, error } = await supabase
		.from('serp_rank_check_jobs')
		.select('*')
		.eq('project_id', projectId)
		.in('status', ['pending', 'running'])
		.order('created_at', { ascending: false })
		.limit(5);
	if (error) throw error;
	return (data ?? []) as SerpRankCheckJobRow[];
}

export async function fetchSerpRankJob(jobId: string): Promise<SerpRankCheckJobRow | null> {
	const { data, error } = await supabase
		.from('serp_rank_check_jobs')
		.select('*')
		.eq('id', jobId)
		.maybeSingle();
	if (error) throw error;
	return (data as SerpRankCheckJobRow) ?? null;
}

export function jobRowToProgress(row: SerpRankCheckJobRow): SerpRankJobProgress {
	const failed = Object.keys(row.failed || {}).length;
	return {
		jobId: row.id,
		status: row.status,
		total: row.keyword_ids.length,
		completed: row.completed_ids.length,
		failed,
		finished: ['completed', 'failed', 'partial'].includes(row.status),
	};
}

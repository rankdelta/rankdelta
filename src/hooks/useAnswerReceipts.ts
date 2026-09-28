import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import {
	aiAnswerReceiptsEnabled,
	clampAnswerReceiptLimit,
	validateAnswerReceiptProvider,
} from '../lib/answerReceipts';
import type { VisibilityQueryRunRow } from '../types/database';

export type AnswerReceipt = {
	run: VisibilityQueryRunRow;
	promptText: string;
};

export type UseAnswerReceiptsOptions = {
	/** Clamped to 1..50; default 50. */
	limit?: number;
	/** When set, only runs from this provider are returned (unknown values are ignored). */
	provider?: string;
	/** When set, only runs for this tracking question are returned. */
	queryId?: string;
};

/**
 * Answer receipts — saved AI answer text + cited domains behind a visibility metric.
 *
 * Reads existing `visibility_query_runs` rows (answer_text + cited_sources) via the user's
 * Supabase session; RLS enforces project ownership (auth.uid() → projects.user_id). No new
 * scans, tables, or MCP routes.
 */
export function useAnswerReceipts(projectId: string | undefined, options?: UseAnswerReceiptsOptions) {
	const limit = clampAnswerReceiptLimit(options?.limit);
	const provider = validateAnswerReceiptProvider(options?.provider);
	const queryId = options?.queryId?.trim() || undefined;

	return useQuery({
		queryKey: ['visibility', projectId || '', 'answerReceipts', limit, provider ?? '', queryId ?? ''],
		enabled: !!projectId && aiAnswerReceiptsEnabled(),
		staleTime: 60_000,
		queryFn: async (): Promise<AnswerReceipt[]> => {
			if (!projectId) return [];

			let queriesQuery = supabase
				.from('visibility_queries')
				.select('id, text')
				.eq('project_id', projectId);
			if (queryId) {
				queriesQuery = queriesQuery.eq('id', queryId);
			}
			const { data: qrows, error: e1 } = await queriesQuery;
			if (e1) throw e1;

			const queries = qrows || [];
			if (queries.length === 0) return [];

			const promptById = new Map(queries.map((q) => [q.id as string, q.text as string]));
			const ids = queries.map((q) => q.id);

			let runsQuery = supabase
				.from('visibility_query_runs')
				.select('*')
				.in('query_id', ids)
				.eq('status', 'completed')
				.not('answer_text', 'is', null)
				.order('run_at', { ascending: false })
				.limit(limit);

			if (provider) {
				runsQuery = runsQuery.eq('provider', provider);
			}

			const { data: runs, error: e2 } = await runsQuery;
			if (e2) throw e2;

			return ((runs || []) as VisibilityQueryRunRow[])
				.filter((r) => (r.answer_text || '').trim().length > 0)
				.map((run) => ({ run, promptText: promptById.get(run.query_id) ?? '' }));
		},
	});
}

export { aiAnswerReceiptsEnabled };

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { isSameOrSubdomain, normalizeDomain } from '../lib/domains';
import type { VisibilityQueryAiFlag } from '../lib/gscAiCorrelation';
import { chunk } from './useVisibilityTracker';

/** Ids per `.in(...)` filter — keeps the request URL well under PostgREST limits. */
const IN_CHUNK = 150;
/** Most recent runs considered per prompt (matches the old per-prompt `.limit(8)`). */
const RUNS_PER_QUERY = 8;
/** Upper bound on runs fetched per query-id chunk; ordered newest-first so the cut drops old runs. */
const RUNS_FETCH_LIMIT = 2000;

export function useVisibilityQueryAiFlags(projectId: string | undefined) {
	return useQuery({
		queryKey: ['visibility-query-ai-flags', projectId],
		queryFn: async (): Promise<VisibilityQueryAiFlag[]> => {
			if (!projectId) return [];
			const { data: queries, error: e1 } = await supabase
				.from('visibility_queries')
				.select('id, text')
				.eq('project_id', projectId);
			if (e1) throw e1;
			if (!queries?.length) return [];

			const { data: brandRows } = await supabase
				.from('tracked_brands')
				.select('domain')
				.eq('project_id', projectId);
			const brandDomains = (brandRows || []).map((b) => normalizeDomain(b.domain)).filter(Boolean);

			// One runs fetch for all prompts (chunked); keep the latest N runs per query in JS.
			const runIdsByQuery = new Map<string, string[]>();
			for (const slice of chunk(queries.map((q) => q.id), IN_CHUNK)) {
				const { data: runs } = await supabase
					.from('visibility_query_runs')
					.select('id, query_id')
					.in('query_id', slice)
					.order('run_at', { ascending: false })
					.limit(RUNS_FETCH_LIMIT);
				for (const r of runs || []) {
					const list = runIdsByQuery.get(r.query_id) ?? [];
					if (list.length >= RUNS_PER_QUERY) continue;
					list.push(r.id);
					runIdsByQuery.set(r.query_id, list);
				}
			}
			const runToQuery = new Map<string, string>();
			for (const [qid, runIds] of runIdsByQuery) for (const rid of runIds) runToQuery.set(rid, qid);
			const allRunIds = [...runToQuery.keys()];

			const mentionedQueries = new Set<string>();
			const citedQueries = new Set<string>();
			if (allRunIds.length > 0) {
				for (const slice of chunk(allRunIds, IN_CHUNK)) {
					const { data: mrows } = await supabase
						.from('visibility_brand_mentions')
						.select('query_run_id')
						.in('query_run_id', slice)
						.not('tracked_brand_id', 'is', null);
					for (const m of mrows || []) {
						const qid = runToQuery.get(m.query_run_id);
						if (qid) mentionedQueries.add(qid);
					}
				}
				if (brandDomains.length > 0) {
					for (const slice of chunk(allRunIds, IN_CHUNK)) {
						const { data: crows } = await supabase
							.from('visibility_citations')
							.select('query_run_id, source_domain')
							.in('query_run_id', slice);
						for (const c of crows || []) {
							const qid = runToQuery.get(c.query_run_id);
							if (!qid || citedQueries.has(qid)) continue;
							if (brandDomains.some((bd) => isSameOrSubdomain(c.source_domain, bd))) citedQueries.add(qid);
						}
					}
				}
			}

			return queries.map((q) => ({
				text: q.text,
				mentioned: mentionedQueries.has(q.id),
				cited: citedQueries.has(q.id),
			}));
		},
		enabled: !!projectId,
		staleTime: 60_000,
	});
}

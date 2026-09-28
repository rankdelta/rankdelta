/**
 * MCP `run_visibility_scan` → action `scan_project`.
 * Verifies the project belongs to the caller, then runs the real LLM-mentions
 * flow for up to N active queries (not a stub).
 */
import type { Json, Sb } from './shared.ts';
import {
  clampDfsLimit,
  corsHeaders as sharedCorsHeaders,
  filterKnownVisibilityProviders,
  projectDefaultVisibilityProviders,
} from './shared.ts';
import { pickStaleActiveQueryIds } from './cron.ts';
import { executeLlmMentionsRun } from './llm_mentions.ts';

export async function handleScanProject(
  db: Sb,
  admin: Sb,
  userId: string,
  body: Json,
  corsHeaders: Record<string, string> = sharedCorsHeaders,
): Promise<Response> {
  const projectId = String(body['projectId'] ?? '');
  if (!projectId) {
    return new Response(JSON.stringify({ error: 'projectId required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: project, error: pe } = await db
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', userId)
    .single();
  if (pe || !project) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const maxQueries = Math.min(12, Math.max(1, Number(body['maxQueries'] ?? 6)));
  const filtered = filterKnownVisibilityProviders(body['providers']);
  // No explicit list → the engines the user enabled in Visibility settings (metadata.engines_to_run).
  const providers = filtered.length > 0 ? filtered : projectDefaultVisibilityProviders(project as Json);

  const envLimit = clampDfsLimit(Deno.env.get('DATAFORSEO_LLM_MENTIONS_LIMIT') ?? '3', 3);
  const dfsLimit = clampDfsLimit(body['dfsLimit'], envLimit);
  const matchType = body['matchType'] === 'partial_match' ? 'partial_match' : 'word_match';
  const preferBrandSources = body['preferBrandSources'] === true;
  const delayMs = Math.max(250, Math.min(15000, Number(Deno.env.get('VISIBILITY_SCAN_QUERY_DELAY_MS') ?? '800')));

  const queryIds = await pickStaleActiveQueryIds(admin, projectId, maxQueries);
  if (queryIds.length === 0) {
    return new Response(JSON.stringify({
      ok: true,
      projectId,
      queries: 0,
      note: 'no_active_queries',
      results: [],
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const results: Json[] = [];
  const deferred: string[] = [];
  let pjWorking = project as Json;
  // Stop starting prompts before the platform's 150 s limit (callers such as the MCP pass a
  // shorter budget): a 504 after paying for half the prompts is worse than a partial scan that
  // says what is left. Unstarted prompts are not charged.
  const budgetMs = Math.min(120_000, Math.max(15_000, Number(body['budgetMs'] ?? 110_000) || 110_000));
  const startedAt = Date.now();

  for (let i = 0; i < queryIds.length; i++) {
    const qid = queryIds[i]!;
    if (i > 0 && Date.now() - startedAt > budgetMs) {
      deferred.push(...queryIds.slice(i));
      break;
    }
    const { data: vq, error: vqe } = await db
      .from('visibility_queries')
      .select('*')
      .eq('id', qid)
      .eq('project_id', projectId)
      .single();
    if (vqe || !vq) {
      results.push({ queryId: qid, error: 'query_missing' });
      continue;
    }

    const res = await executeLlmMentionsRun(
      admin,
      db,
      userId,
      vq as Json,
      pjWorking,
      qid,
      providers,
      dfsLimit,
      matchType,
      preferBrandSources,
      corsHeaders,
    );
    const j = (await res.json()) as Json;
    results.push({ queryId: qid, text: (vq as Json)['text'], httpStatus: res.status, ...j });

    if (res.status === 402) {
      break;
    }

    const { data: projFresh } = await db.from('projects').select('*').eq('id', projectId).eq('user_id', userId).single();
    if (projFresh) pjWorking = projFresh as Json;
    if (i < queryIds.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }

  return new Response(JSON.stringify({
    ok: true,
    projectId,
    queries: queryIds.length,
    scanned: results.length,
    deferred: deferred.length,
    results,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

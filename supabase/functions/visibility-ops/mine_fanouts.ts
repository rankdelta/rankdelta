import type { Json, Sb } from './shared.ts';
import type { User } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertAccountBudget, budgetBlockedResponse } from '../_shared/accountBudget.ts';
import {
  projectSpendExceeded,
  projectSpendThisMonthCents,
  recordProjectSpend,
  resolveProjectSpendCapCents,
} from './spend_cap.ts';
import {
  FANOUT_COST_CAP_USD,
  FANOUT_LLM_SYSTEM,
  FANOUT_MAX_ANSWER_CHARS,
  FANOUT_MAX_INPUT_TOKENS,
  FANOUT_MAX_OUTPUT_TOKENS,
  buildFanoutLlmUserPrompt,
  collectFanoutsForRun,
  estimateFanoutLlmCostUsd,
  fanoutLlmWithinCap,
  parseLlmFanoutContent,
  type FanoutCandidate,
  type FanoutRow,
} from '../_shared/fanoutExtract.ts';

interface RunRow {
  id: string;
  query_id: string;
  provider: string;
  raw_response: unknown;
  answer_text: string | null;
  run_at: string;
  status: string;
}

interface QueryRow {
  id: string;
  project_id: string;
  text: string;
}

const LLM_MODEL_OR = 'openai/gpt-4o-mini';
const LLM_MODEL_OA = 'gpt-4o-mini';

function pickId(body: Json, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function latestRunPerEngine(runs: RunRow[]): RunRow[] {
  const seen = new Set<string>();
  const out: RunRow[] = [];
  const sorted = [...runs].sort((a, b) => String(b.run_at).localeCompare(String(a.run_at)));
  for (const r of sorted) {
    if (seen.has(r.provider)) continue;
    seen.add(r.provider);
    out.push(r);
  }
  return out;
}

async function extractViaLlm(
  queryText: string,
  answerText: string,
): Promise<{ questions: FanoutCandidate[]; costUsd: number; model: string | null; skipped: string | null }> {
  const estimate = estimateFanoutLlmCostUsd(FANOUT_MAX_INPUT_TOKENS, FANOUT_MAX_OUTPUT_TOKENS);
  if (!fanoutLlmWithinCap(estimate)) {
    return { questions: [], costUsd: 0, model: null, skipped: `estimated ${estimate} exceeds ${FANOUT_COST_CAP_USD}` };
  }
  if (!answerText.trim() || answerText.trim().length < 40) {
    return { questions: [], costUsd: 0, model: null, skipped: 'answer too short for extraction' };
  }

  const openrouterKey = Deno.env.get('OPENROUTER_API_KEY');
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const useOpenRouter = !!openrouterKey;
  const llmKey = openrouterKey || openaiKey;
  if (!llmKey) {
    return { questions: [], costUsd: 0, model: null, skipped: 'no LLM key' };
  }

  const llmEndpoint = useOpenRouter
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const llmModel = useOpenRouter ? LLM_MODEL_OR : LLM_MODEL_OA;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${llmKey}`,
    'Content-Type': 'application/json',
  };
  if (useOpenRouter) {
    headers['HTTP-Referer'] = 'https://rankdelta.ai';
    headers['X-Title'] = 'Rankdelta Fanout Mine';
  }

  const clipped = answerText.length > FANOUT_MAX_ANSWER_CHARS
    ? answerText.slice(0, FANOUT_MAX_ANSWER_CHARS)
    : answerText;
  const approxInTokens = Math.ceil((FANOUT_LLM_SYSTEM.length + clipped.length + queryText.length) / 4);
  const callEstimate = estimateFanoutLlmCostUsd(
    Math.min(FANOUT_MAX_INPUT_TOKENS, approxInTokens),
    FANOUT_MAX_OUTPUT_TOKENS,
  );
  if (!fanoutLlmWithinCap(callEstimate)) {
    return { questions: [], costUsd: 0, model: null, skipped: `call estimate ${callEstimate} exceeds cap` };
  }

  const ores = await fetch(llmEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: llmModel,
      temperature: 0,
      max_tokens: FANOUT_MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: FANOUT_LLM_SYSTEM },
        { role: 'user', content: buildFanoutLlmUserPrompt(queryText, answerText) },
      ],
    }),
  });
  if (!ores.ok) {
    return { questions: [], costUsd: 0, model: llmModel, skipped: `llm http ${ores.status}` };
  }
  const ojson = (await ores.json()) as Json;
  const content = ((ojson['choices'] as Json[])?.[0]?.['message'] as Json)?.['content'] as string;
  const usage = (ojson['usage'] as Json) || {};
  const inTok = Number(usage['prompt_tokens'] ?? 0);
  const outTok = Number(usage['completion_tokens'] ?? 0);
  const costUsd = inTok || outTok
    ? estimateFanoutLlmCostUsd(inTok, outTok)
    : callEstimate;
  return {
    questions: parseLlmFanoutContent(content),
    costUsd,
    model: llmModel,
    skipped: null,
  };
}

export async function mineFanoutsForQueries(
  writer: Sb,
  queries: QueryRow[],
  userId: string | null,
  opts: { useLlm?: boolean; dryRun?: boolean; projectSpendCap?: number | null } = {},
): Promise<{
  fanout_queries: FanoutRow[];
  inserted: number;
  considered: number;
  costUsd: number;
  estimated_usd: number;
  executed: boolean;
  dry_run: boolean;
  cap_reached: boolean;
  llm: Array<{ query_id: string; engine: string; skipped: string | null; costUsd: number }>;
}> {
  const useLlm = opts.useLlm === true;
  const dryRun = opts.dryRun === true;
  const projectSpendCap = opts.projectSpendCap ?? null;
  const fanout_queries: FanoutRow[] = [];
  const llmMeta: Array<{ query_id: string; engine: string; skipped: string | null; costUsd: number }> = [];
  let costUsd = 0;
  let estimatedUsd = 0;
  // Set when record_project_spend refuses a write (cap exceeded): no further paid LLM calls.
  let capReached = false;

  for (const q of queries) {
    if (capReached) break;
    const { data: runs } = await writer
      .from('visibility_query_runs')
      .select('id, query_id, provider, raw_response, answer_text, run_at, status')
      .eq('query_id', q.id)
      .eq('status', 'completed');

    const latest = latestRunPerEngine((runs ?? []) as RunRow[]);
    for (const run of latest) {
      let llmQuestions: FanoutCandidate[] = [];
      const answer = (run.answer_text || '').trim();
      const hasStructural = collectFanoutsForRun({
        queryId: q.id,
        engine: run.provider,
        rawResponse: run.raw_response,
        answerText: run.answer_text,
        parentQuery: q.text,
      }).length > 0;

      // Default is structural-only (PAA / related / explicit "?"). Paid LLM extract
      // requires extract=true and is skipped entirely on dry_run.
      if (answer.length >= 40 && useLlm) {
        const callEstimate = estimateFanoutLlmCostUsd(
          Math.min(FANOUT_MAX_INPUT_TOKENS, Math.ceil((answer.length + q.text.length) / 4)),
          FANOUT_MAX_OUTPUT_TOKENS,
        );
        estimatedUsd += fanoutLlmWithinCap(callEstimate) ? callEstimate : 0;
        if (dryRun) {
          llmMeta.push({ query_id: q.id, engine: run.provider, skipped: 'dry_run', costUsd: 0 });
        } else if (capReached) {
          llmMeta.push({ query_id: q.id, engine: run.provider, skipped: 'monthly_api_spend_cap_reached', costUsd: 0 });
        } else {
          const llm = await extractViaLlm(q.text, run.answer_text || '');
          llmQuestions = llm.questions;
          costUsd += llm.costUsd;
          llmMeta.push({ query_id: q.id, engine: run.provider, skipped: llm.skipped, costUsd: llm.costUsd });
          if (llm.costUsd > 0 && userId) {
            const costCents = Math.max(0, Math.round(llm.costUsd * 100));
            // Authoritative per-project cap check (SELECT FOR UPDATE). The call above already cost
            // real money, so the event is logged either way; on refusal we stop spending.
            const spendRecord = await recordProjectSpend(writer, q.project_id, costCents, projectSpendCap);
            if (!spendRecord.allowed) capReached = true;
            await writer.from('visibility_api_spend_events').insert({
              project_id: q.project_id,
              user_id: userId,
              provider: run.provider,
              action: 'mine_fanouts',
              cost_cents: costCents,
              cost_usd: llm.costUsd,
              metadata: { query_id: q.id, run_id: run.id, model: llm.model, cap_usd: FANOUT_COST_CAP_USD },
            });
          }
        }
      } else if (answer.length >= 40 && !useLlm) {
        llmMeta.push({ query_id: q.id, engine: run.provider, skipped: 'llm_disabled_default', costUsd: 0 });
      } else if (!hasStructural) {
        llmMeta.push({ query_id: q.id, engine: run.provider, skipped: 'no extractable payload', costUsd: 0 });
      }

      const rows = collectFanoutsForRun({
        queryId: q.id,
        engine: run.provider,
        rawResponse: run.raw_response,
        answerText: run.answer_text,
        parentQuery: q.text,
        llmQuestions,
      });
      fanout_queries.push(...rows);
      if (capReached) break;
    }
  }

  let inserted = 0;
  if (!dryRun) {
    for (const row of fanout_queries) {
      const { error } = await writer.from('fanout_queries').insert(row);
      if (!error) inserted++;
    }
  }

  return {
    fanout_queries,
    inserted,
    considered: fanout_queries.length,
    costUsd: dryRun ? 0 : costUsd,
    estimated_usd: Number((useLlm ? estimatedUsd : 0).toFixed(6)),
    executed: !dryRun,
    dry_run: dryRun,
    cap_reached: capReached,
    llm: llmMeta,
  };
}

export async function handleMineFanouts(
  supabaseUser: Sb,
  admin: Sb,
  user: User,
  body: Json,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const queryId = pickId(body, 'queryId', 'query_id');
  const siteId = pickId(body, 'siteId', 'site_id', 'projectId', 'project_id');
  if (!queryId && !siteId) {
    return new Response(JSON.stringify({ error: 'query_id or site_id is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let queries: QueryRow[] = [];
  let projectRow: Json | null = null;
  if (queryId) {
    const { data: vq, error } = await supabaseUser
      .from('visibility_queries')
      .select('id, project_id, text')
      .eq('id', queryId)
      .single();
    if (error || !vq) {
      return new Response(JSON.stringify({ error: 'Query not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (siteId && vq.project_id !== siteId) {
      return new Response(JSON.stringify({ error: 'Query does not belong to site' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: project } = await supabaseUser.from('projects').select('*').eq('id', vq.project_id).single();
    if (!project || project.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    projectRow = project as Json;
    queries = [vq as QueryRow];
  } else if (siteId) {
    const { data: project } = await supabaseUser.from('projects').select('*').eq('id', siteId).single();
    if (!project || project.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    projectRow = project as Json;
    const { data: qs } = await supabaseUser
      .from('visibility_queries')
      .select('id, project_id, text')
      .eq('project_id', siteId)
      .eq('is_active', true);
    queries = (qs ?? []) as QueryRow[];
  }

  const dryRun = body['dry_run'] === true || body['dryRun'] === true;
  const useLlm = body['extract'] === true || body['use_llm'] === true || body['useLlm'] === true;
  const projectId = queries[0]?.project_id;
  // Pass the real row: resolveProjectSpendCapCents reads monthly_api_spend_cap_cents from it.
  const projectSpendCap = projectId
    ? await resolveProjectSpendCapCents(admin, projectRow ?? { id: projectId }, user.id)
    : null;
  if (useLlm && !dryRun && projectId) {
    const spendNow = await projectSpendThisMonthCents(admin, projectId);
    if (projectSpendExceeded(spendNow, projectSpendCap, 1)) {
      return new Response(JSON.stringify({ error: 'Monthly API spend cap reached' }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }
  if (useLlm && !dryRun) {
    const budget = await assertAccountBudget(admin, user.id, 1);
    if (!budget.allowed) return budgetBlockedResponse(budget, corsHeaders);
  }

  const result = await mineFanoutsForQueries(admin, queries, user.id, { useLlm, dryRun, projectSpendCap });
  return new Response(
    JSON.stringify({
      ok: true,
      fanout_queries: result.fanout_queries,
      inserted: result.inserted,
      considered: result.considered,
      costUsd: result.costUsd,
      cost_usd: result.costUsd,
      estimated_usd: result.estimated_usd,
      executed: result.executed,
      dry_run: result.dry_run,
      cap_reached: result.cap_reached,
      llm: result.llm,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

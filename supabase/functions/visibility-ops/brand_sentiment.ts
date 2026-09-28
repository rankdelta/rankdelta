import type { User } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertAccountBudget, budgetBlockedResponse, logSpend } from '../_shared/accountBudget.ts';
import {
  projectSpendExceeded,
  projectSpendThisMonthCents,
  recordProjectSpend,
  resolveProjectSpendCapCents,
} from './spend_cap.ts';
import {
  BRAND_SENTIMENT_COST_CAP_USD,
  BRAND_SENTIMENT_MAX_ANSWER_CHARS,
  BRAND_SENTIMENT_MAX_ANSWERS,
  BRAND_SENTIMENT_MAX_INPUT_TOKENS,
  BRAND_SENTIMENT_MAX_OUTPUT_TOKENS,
  BRAND_SENTIMENT_MIN_ANSWERS,
  BRAND_SENTIMENT_SYSTEM,
  aggregateByEngine,
  answersMentioningAnyBrand,
  brandNamesOf,
  brandSentimentWithinCap,
  buildBrandSentimentUserPrompt,
  clampDays,
  estimateBrandSentimentCostUsd,
  insufficientDataPayload,
  parseBrandSentimentContent,
  type StoredAnswerInput,
  type TrackedBrandInput,
  type SentimentClassification,
} from '../_shared/brandSentiment.ts';
import type { Json, Sb } from './shared.ts';

const LLM_MODEL_OR = 'openai/gpt-4o-mini';
const LLM_MODEL_OA = 'gpt-4o-mini';

function pickId(body: Json, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

async function classifyOneAnswer(
  brandName: string,
  answerText: string,
): Promise<{ items: ReturnType<typeof parseBrandSentimentContent>; costUsd: number; skipped: string | null }> {
  const clipped = answerText.length > BRAND_SENTIMENT_MAX_ANSWER_CHARS
    ? answerText.slice(0, BRAND_SENTIMENT_MAX_ANSWER_CHARS)
    : answerText;
  const approxIn = Math.min(
    BRAND_SENTIMENT_MAX_INPUT_TOKENS,
    Math.ceil((BRAND_SENTIMENT_SYSTEM.length + clipped.length + brandName.length) / 4),
  );
  const estimate = estimateBrandSentimentCostUsd(approxIn, BRAND_SENTIMENT_MAX_OUTPUT_TOKENS);

  const openrouterKey = Deno.env.get('OPENROUTER_API_KEY');
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const useOpenRouter = !!openrouterKey;
  const llmKey = openrouterKey || openaiKey;
  if (!llmKey) return { items: [], costUsd: 0, skipped: 'no LLM key' };

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
    headers['X-Title'] = 'Rankdelta Brand Sentiment';
  }

  const ores = await fetch(llmEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: llmModel,
      temperature: 0,
      max_tokens: BRAND_SENTIMENT_MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: BRAND_SENTIMENT_SYSTEM },
        { role: 'user', content: buildBrandSentimentUserPrompt(brandName, answerText) },
      ],
    }),
  });
  if (!ores.ok) return { items: [], costUsd: 0, skipped: `llm http ${ores.status}` };
  const ojson = (await ores.json()) as Json;
  const content = ((ojson['choices'] as Json[])?.[0]?.['message'] as Json)?.['content'] as string;
  const usage = (ojson['usage'] as Json) || {};
  const inTok = Number(usage['prompt_tokens'] ?? 0);
  const outTok = Number(usage['completion_tokens'] ?? 0);
  const costUsd = inTok || outTok ? estimateBrandSentimentCostUsd(inTok, outTok) : estimate;
  return { items: parseBrandSentimentContent(content, brandName), costUsd, skipped: null };
}

export async function handleGetBrandSentiment(
  supabaseUser: Sb,
  admin: Sb,
  user: User,
  body: Json,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  const siteId = pickId(body, 'site_id', 'siteId', 'projectId', 'project_id');
  if (!siteId) return json({ error: 'site_id is required', cost_usd: 0 }, 400);

  const days = clampDays(body['days']);
  const dryRun = body['dry_run'] === true || body['dryRun'] === true;
  const classify = body['classify'] === true || body['refresh'] === true;

  const { data: project } = await supabaseUser
    .from('projects')
    .select('id, user_id')
    .eq('id', siteId)
    .single();
  if (!project || project.user_id !== user.id) {
    return json({ error: 'Forbidden', cost_usd: 0 }, 403);
  }
  const projectSpendCap = await resolveProjectSpendCapCents(admin, project as Json, user.id);

  const { data: brands } = await supabaseUser
    .from('tracked_brands')
    .select('name, aliases')
    .eq('project_id', siteId);
  const tracked: TrackedBrandInput[] = (brands ?? []).map((b) => ({
    name: String(b.name ?? ''),
    aliases: (b.aliases as string[] | null) ?? [],
  })).filter((b) => b.name.trim());

  const { data: qs } = await supabaseUser.from('visibility_queries').select('id').eq('project_id', siteId);
  const queryIds = (qs ?? []).map((q) => q.id as string);
  const since = new Date(Date.now() - days * 864e5).toISOString();

  const answers: StoredAnswerInput[] = [];
  for (let i = 0; i < queryIds.length; i += 200) {
    const chunk = queryIds.slice(i, i + 200);
    if (!chunk.length) break;
    const { data: runs } = await supabaseUser
      .from('visibility_query_runs')
      .select('id, provider, answer_text, run_at, status')
      .in('query_id', chunk)
      .eq('status', 'completed')
      .gte('run_at', since);
    for (const r of runs ?? []) {
      answers.push({
        run_id: r.id as string,
        engine: String(r.provider ?? 'unknown'),
        answer_text: (r.answer_text as string | null) ?? null,
        run_at: r.run_at as string,
      });
    }
  }

  const classifiable = answersMentioningAnyBrand(answers, tracked).slice(0, BRAND_SENTIMENT_MAX_ANSWERS);
  if (classifiable.length < BRAND_SENTIMENT_MIN_ANSWERS) {
    return json(insufficientDataPayload(siteId, days, classifiable.length));
  }

  const perAnswerEstimate = estimateBrandSentimentCostUsd();
  const estimatedUsd = Number((classifiable.length * perAnswerEstimate).toFixed(6));

  if (dryRun) {
    return json({
      ok: true,
      status: 'dry_run',
      site_id: siteId,
      days,
      classifiable_answers: classifiable.length,
      estimated_usd: estimatedUsd,
      cost_usd: 0,
      executed: false,
      cap_usd: BRAND_SENTIMENT_COST_CAP_USD,
      per_engine: [],
      hint: 'Pass classify=true (not dry_run) after the user confirms the estimate. Default mode never spends.',
    });
  }

  const runIds = classifiable.map((a) => a.run_id);
  const cached: SentimentClassification[] = [];
  for (let i = 0; i < runIds.length; i += 200) {
    const chunk = runIds.slice(i, i + 200);
    const { data } = await admin
      .from('visibility_brand_sentiment')
      .select('query_run_id, engine, brand_name, sentiment, accuracy')
      .in('query_run_id', chunk);
    for (const row of data ?? []) {
      cached.push({
        run_id: row.query_run_id as string,
        engine: String(row.engine ?? ''),
        brand_name: String(row.brand_name ?? ''),
        sentiment: row.sentiment as SentimentClassification['sentiment'],
        accuracy: Number(row.accuracy ?? 0),
      });
    }
  }

  if (!classify) {
    if (cached.length === 0) {
      return json({
        ok: true,
        status: 'needs_classification',
        site_id: siteId,
        days,
        classifiable_answers: classifiable.length,
        estimated_usd: estimatedUsd,
        cost_usd: 0,
        executed: false,
        cap_usd: BRAND_SENTIMENT_COST_CAP_USD,
        per_engine: [],
        hint: 'Call with dry_run=true first, then classify=true to spend the estimate.',
      });
    }
    return json({
      ok: true,
      status: 'ok',
      site_id: siteId,
      days,
      classifiable_answers: classifiable.length,
      cost_usd: 0,
      executed: false,
      source: 'cached',
      per_engine: aggregateByEngine(cached),
    });
  }

  const budget = await assertAccountBudget(admin, user.id, Math.max(1, Math.ceil(Math.min(estimatedUsd, BRAND_SENTIMENT_COST_CAP_USD) * 100)));
  if (!budget.allowed) return budgetBlockedResponse(budget, corsHeaders);

  const spendNow = await projectSpendThisMonthCents(admin, siteId);
  if (projectSpendExceeded(spendNow, projectSpendCap, Math.max(1, Math.ceil(estimatedUsd * 100)))) {
    return json({ error: 'Monthly API spend cap reached', cost_usd: 0 }, 402);
  }

  const classifiedRunIds = new Set(cached.map((c) => c.run_id));
  const pending = classifiable.filter((a) => !classifiedRunIds.has(a.run_id));
  const primaryBrand = tracked[0]?.name ?? 'the brand';
  let spent = 0;
  const fresh: SentimentClassification[] = [...cached];

  for (const ans of pending) {
    const nextEst = estimateBrandSentimentCostUsd();
    if (!brandSentimentWithinCap(spent, nextEst)) break;
    const mentioned = tracked.find((b) => (ans.answer_text || '').length && brandNamesOf(b).some((n) =>
      (ans.answer_text || '').toLowerCase().includes(n.toLowerCase()),
    ));
    const brandName = mentioned?.name ?? primaryBrand;
    const result = await classifyOneAnswer(brandName, ans.answer_text || '');
    spent += result.costUsd;
    for (const item of result.items) {
      const row: SentimentClassification = {
        run_id: ans.run_id,
        engine: ans.engine,
        brand_name: item.brand_name,
        sentiment: item.sentiment,
        accuracy: item.accuracy,
      };
      fresh.push(row);
      await admin.from('visibility_brand_sentiment').upsert({
        query_run_id: row.run_id,
        engine: row.engine,
        brand_name: row.brand_name,
        sentiment: row.sentiment,
        accuracy: row.accuracy,
        model: LLM_MODEL_OR,
        cost_usd: result.costUsd,
      }, { onConflict: 'query_run_id,brand_name' });
    }
  }

  if (spent > 0) {
    const costCents = Math.max(0, Math.round(spent * 100));
    await recordProjectSpend(admin, siteId, costCents, projectSpendCap);
    await logSpend(admin, {
      userId: user.id,
      projectId: siteId,
      action: 'get_brand_sentiment',
      costCents,
      costUsd: spent,
      metadata: { answers: pending.length, cap_usd: BRAND_SENTIMENT_COST_CAP_USD },
    });
  }

  if (fresh.length === 0) {
    return json(insufficientDataPayload(siteId, days, classifiable.length));
  }

  return json({
    ok: true,
    status: 'ok',
    site_id: siteId,
    days,
    classifiable_answers: classifiable.length,
    cost_usd: Number(spent.toFixed(6)),
    executed: spent > 0,
    cap_usd: BRAND_SENTIMENT_COST_CAP_USD,
    per_engine: aggregateByEngine(fresh),
  });
}

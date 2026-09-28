import type { Json, Sb } from './shared.ts';
import {
  corsHeaders as sharedCorsHeaders,
  mapLangToCode,
  mapMarketToLocation,
} from './shared.ts';
import {
  ACCOUNT_BUDGET_ERROR_CODE,
  budgetBlockedResponse,
  finalizeAccountSpend,
  releaseAccountSpend,
  reserveAccountSpend,
} from '../_shared/accountBudget.ts';
import { detectBrandMentions, type BrandDetectEntry } from './brand_detect.ts';
import {
  attachProjectToSpendEvent,
  projectSpendExceeded,
  projectSpendThisMonthCents,
  recordProjectSpend,
  resolveProjectSpendCapCents,
  VISIBILITY_CHECK_ESTIMATE_CENTS,
} from './spend_cap.ts';

/**
 * Visibility runner — sources answers DIRECTLY from the model APIs via OpenRouter (ChatGPT,
 * Perplexity sonar, Gemini) and Google AI Overviews via the DataForSEO SERP API. This replaces
 * the DataForSEO "LLM Mentions" product (which carries a $100/mo minimum + $0.10/task): raw LLM
 * tokens are ~10-20× cheaper per check, have NO minimum, and add engines DataForSEO doesn't cover.
 * Brand/competitor detection is word-boundary + diacritic-folded (brand_detect.ts) so Share of Voice
 * isn't inflated by substring false positives.
 *
 * Secrets: OPENROUTER_API_KEY (chatgpt/perplexity/gemini), DATAFORSEO_LOGIN/PASSWORD (google_aio).
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// OpenRouter model per tracked "engine". gpt-4o represents consumer ChatGPT; sonar is web-grounded
// with real citations; gemini-flash is the cheap Google model.
const MODEL: Record<string, string> = {
  chatgpt: 'openai/gpt-4o',
  perplexity: 'perplexity/sonar',
  gemini: 'google/gemini-2.5-flash-lite',
  grok: 'x-ai/grok-2-1212',
};

// USD per 1M tokens (input/output) for cost tracking; sonar adds a per-request search fee.
const RATES: Record<string, { in: number; out: number; perReq?: number }> = {
  'openai/gpt-4o': { in: 2.5, out: 10 },
  'perplexity/sonar': { in: 1, out: 1, perReq: 0.005 },
  'google/gemini-2.5-flash-lite': { in: 0.1, out: 0.4 },
  'x-ai/grok-2-1212': { in: 2, out: 10 },
};

export interface ProviderAnswer {
  ok: boolean;
  answerText: string;
  cited: Array<{ url: string | null; domain: string | null; title: string | null; snippet: string | null }>;
  costUsd: number;
  errorMessage: string | null;
  sourceLabel: string;
  raw: Json;
}

function hostOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

export type CitedSource = { url: string | null; domain: string | null; title: string | null; snippet: string | null };

/**
 * Citations from an OpenRouter chat completion, whichever shape the upstream model used:
 *  - Perplexity direct / older OpenRouter: top-level `citations: string[]` (or `{url}` objects)
 *  - OpenRouter today: `choices[0].message.annotations[]` of `{type:'url_citation', url_citation:{url,title}}`
 * Reading only the first shape left every Perplexity run with zero stored citations (and every
 * report at a 0.0% citation rate) once OpenRouter moved to annotations. De-duplicated by URL.
 */
export function extractCitations(j: Json): CitedSource[] {
  const out: CitedSource[] = [];
  const seen = new Set<string>();
  const push = (url: unknown, title: unknown) => {
    if (typeof url !== 'string' || !url.trim() || seen.has(url)) return;
    seen.add(url);
    out.push({ url, domain: hostOf(url), title: typeof title === 'string' && title.trim() ? title : null, snippet: null });
  };
  for (const c of (Array.isArray(j['citations']) ? (j['citations'] as unknown[]) : [])) {
    if (typeof c === 'string') push(c, null);
    else if (c && typeof c === 'object') push((c as Json)['url'], (c as Json)['title']);
  }
  const choice = ((j['choices'] as Json[]) || [])[0] as Json | undefined;
  const message = (choice?.['message'] as Json | undefined) ?? {};
  const annotations = Array.isArray(message['annotations']) ? (message['annotations'] as unknown[]) : [];
  for (const a of annotations) {
    if (!a || typeof a !== 'object') continue;
    const ann = a as Json;
    if (ann['type'] !== 'url_citation') continue;
    const uc = (ann['url_citation'] as Json | undefined) ?? ann;
    push(uc['url'], uc['title']);
  }
  return out;
}

/** DataForSEO SERP task codes: 40106 = partial results (first pages are there); 40101/50000 = transient. */
const AIO_PARTIAL_OK = 40106;
const AIO_RETRYABLE = new Set([40101, 50000]);

/**
 * Normalise one DataForSEO organic/live/advanced response into an AI Overview answer.
 * A partial result (40106) still carries the first SERP pages — and usually the AI Overview — so it
 * is read like a full one instead of being thrown away; transient errors are flagged for a retry.
 */
export function parseAioResponse(j: Json, httpOk: boolean): ProviderAnswer & { retryable: boolean } {
  const t0 = ((j['tasks'] as Json[]) || [])[0] as Json | undefined;
  const costUsd = Number(t0?.['cost'] ?? j['cost'] ?? 0) || 0;
  const code = Number(t0?.['status_code']);
  const block = (((t0?.['result'] as Json[]) || [])[0] as Json) || {};
  const items = Array.isArray(block['items']) ? (block['items'] as Json[]) : [];
  const usable = httpOk && (code === 20000 || (code === AIO_PARTIAL_OK && items.length > 0));
  if (!usable) {
    return {
      ok: false, answerText: '', cited: [], costUsd,
      errorMessage: String(t0?.['status_message'] || `HTTP ${httpOk ? 'ok' : 'error'}`),
      sourceLabel: 'google_serp_aio', raw: j, retryable: AIO_RETRYABLE.has(code),
    };
  }
  const aio = items.find((it) => (it as Json)['type'] === 'ai_overview') as Json | undefined;
  if (!aio) return { ok: true, answerText: '', cited: [], costUsd, errorMessage: null, sourceLabel: 'google_serp_aio', raw: j, retryable: false };
  const parts: string[] = [];
  for (const el of (aio['items'] as Json[]) || []) {
    const txt = (el as Json)['text'];
    if (typeof txt === 'string' && txt.trim()) parts.push(txt.trim());
  }
  const markdown = aio['markdown'];
  if (parts.length === 0 && typeof markdown === 'string' && markdown.trim()) parts.push(markdown.trim());
  // Google showed an AI Overview but its content never reached us (loaded asynchronously and not
  // fetched): we did not see the answer, so it must not count as "the brand is not mentioned".
  if (parts.length === 0 && !Array.isArray(aio['references'])) {
    return {
      ok: false, answerText: '', cited: [], costUsd,
      errorMessage: 'AI Overview shown but its content was not loaded',
      sourceLabel: 'google_serp_aio', raw: j, retryable: false,
    };
  }
  const refs = (aio['references'] as Json[]) || [];
  const cited = refs.map((r) => {
    const ro = r as Json;
    return { url: (ro['url'] as string) || null, domain: (ro['domain'] as string) || hostOf(ro['url']), title: (ro['title'] as string) || null, snippet: (ro['text'] as string) || null };
  });
  return { ok: true, answerText: parts.join('\n\n'), cited, costUsd, errorMessage: null, sourceLabel: 'google_serp_aio', raw: j, retryable: false };
}

/** Query one engine and normalise to { answerText, cited[], costUsd }. */
async function fetchProviderAnswer(
  prov: string,
  queryText: string,
  ctx: { languageCode: string; locationCode: number; login: string; pass: string; openrouterKey?: string },
): Promise<ProviderAnswer> {
  // ── Google AI Overviews → DataForSEO SERP (organic/live/advanced exposes the ai_overview block) ──
  if (prov === 'google_aio') {
    const cred = btoa(`${ctx.login}:${ctx.pass}`);
    // load_async_ai_overview: without it DataForSEO only returns AI Overviews from its cache, and most
    // arrive empty ("asynchronous_ai_overview": true). +$0.002 per SERP, refunded when not needed.
    const task = [{ keyword: queryText, language_code: ctx.languageCode, location_code: ctx.locationCode, device: 'desktop', os: 'windows', depth: 20, load_async_ai_overview: true }];
    let spent = 0;
    let parsed: ProviderAnswer & { retryable?: boolean } = { ok: false, answerText: '', cited: [], costUsd: 0, errorMessage: 'not run', sourceLabel: 'google_serp_aio', raw: {} };
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
        method: 'POST',
        headers: { Authorization: `Basic ${cred}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      });
      const j = (await res.json().catch(() => ({}))) as Json;
      parsed = parseAioResponse(j, res.ok);
      spent += parsed.costUsd;
      if (parsed.ok || !parsed.retryable) break;
    }
    return { ok: parsed.ok, answerText: parsed.answerText, cited: parsed.cited, costUsd: spent, errorMessage: parsed.errorMessage, sourceLabel: parsed.sourceLabel, raw: parsed.raw };
  }

  // ── ChatGPT / Perplexity / Gemini → OpenRouter chat completions ──
  const model = MODEL[prov];
  if (!model) {
    return { ok: false, answerText: '', cited: [], costUsd: 0, errorMessage: `Unknown provider "${prov}"`, sourceLabel: prov, raw: {} };
  }
  if (!ctx.openrouterKey) {
    return { ok: false, answerText: '', cited: [], costUsd: 0, errorMessage: 'OPENROUTER_API_KEY not configured', sourceLabel: model, raw: {} };
  }
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.openrouterKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://rankdelta.ai',
      'X-Title': 'Rankdelta Visibility',
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 1000,
      messages: [{ role: 'user', content: queryText }],
    }),
  });
  const j = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    return { ok: false, answerText: '', cited: [], costUsd: 0, errorMessage: JSON.stringify(j).slice(0, 300), sourceLabel: model, raw: j };
  }
  const choice = ((j['choices'] as Json[]) || [])[0] as Json | undefined;
  const answerText = ((choice?.['message'] as Json)?.['content'] as string) || '';
  const cited = extractCitations(j);
  // Cost from usage tokens.
  const usage = (j['usage'] as Json) || {};
  const inTok = Number(usage['prompt_tokens'] ?? 0);
  const outTok = Number(usage['completion_tokens'] ?? 0);
  const rate = RATES[model] ?? { in: 1, out: 2 };
  const costUsd = (inTok * rate.in + outTok * rate.out) / 1_000_000 + (rate.perReq ?? 0);
  return { ok: true, answerText, cited, costUsd, errorMessage: null, sourceLabel: model, raw: j };
}

export async function executeLlmMentionsRun(
  admin: Sb,
  reader: Sb,
  userId: string,
  vq: Json,
  project: Json,
  queryId: string,
  providers: string[],
  _dfsLimit: number,
  _matchType: 'word_match' | 'partial_match',
  _preferBrandSources: boolean,
  corsHeaders: Record<string, string> = sharedCorsHeaders,
): Promise<Response> {
  const estimateMaxCents = VISIBILITY_CHECK_ESTIMATE_CENTS;

  // Account-level hard cap (in addition to the per-project cap below) is enforced per provider
  // call via reserveAccountSpend — atomic check+insert, no read-then-write gap (same as seo-proxy).

  const cap = await resolveProjectSpendCapCents(admin, project, userId);
  const pid = vq.project_id as string;
  let spendCentsAcc = await projectSpendThisMonthCents(admin, pid);
  if (projectSpendExceeded(spendCentsAcc, cap)) {
    return new Response(JSON.stringify({ error: 'Monthly API spend cap reached' }), {
      status: 402,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const openrouterKey = Deno.env.get('OPENROUTER_API_KEY') ?? undefined;
  const login = Deno.env.get('DATAFORSEO_LOGIN') ?? '';
  const pass = Deno.env.get('DATAFORSEO_PASSWORD') ?? '';
  const languageCode = mapLangToCode(project.primary_language as string);
  const locationCode = mapMarketToLocation(project.market as string);
  const queryText = vq.text as string;

  const { data: tb } = await reader.from('tracked_brands').select('id,name,aliases').eq('project_id', pid);
  const { data: cb } = await reader.from('competitor_brands').select('id,name,aliases').eq('project_id', pid);

  const results: Json[] = [];

  for (const prov of providers) {
    if (projectSpendExceeded(spendCentsAcc, cap, estimateMaxCents)) {
      results.push({ provider: prov, skipped: true, reason: 'Monthly API spend cap reached' });
      continue;
    }

    // Atomic account reserve BEFORE the paid call; finalized with the real cost (or released) after.
    const reserve = await reserveAccountSpend(
      admin,
      userId,
      estimateMaxCents,
      'visibility_check',
      { query_id: queryId, provider: prov },
      prov,
    );
    if (!reserve.allowed) {
      if (results.length === 0) return budgetBlockedResponse(reserve, corsHeaders);
      results.push({ provider: prov, skipped: true, reason: reserve.reason ?? ACCOUNT_BUDGET_ERROR_CODE });
      break;
    }

    let ans: ProviderAnswer;
    try {
      ans = await fetchProviderAnswer(prov, queryText, { languageCode, locationCode, login, pass, openrouterKey });
    } catch (e) {
      ans = { ok: false, answerText: '', cited: [], costUsd: 0, errorMessage: e instanceof Error ? e.message : String(e), sourceLabel: prov, raw: {} };
    }

    const taskCostCents = Math.max(0, Math.round(ans.costUsd * 100));
    // A failed call can still be billed (DataForSEO reports cost on error) — keep the event then.
    const billed = ans.ok || taskCostCents > 0;
    if (billed) {
      await finalizeAccountSpend(admin, reserve.eventId, taskCostCents, ans.costUsd, {
        query_id: queryId,
        source: ans.sourceLabel,
      });
    } else {
      await releaseAccountSpend(admin, reserve.eventId);
    }
    const spendEventId = billed ? reserve.eventId : undefined;

    // Authoritative per-project cap (SELECT FOR UPDATE). Money is already spent, so the run is
    // still persisted below; allowed=false aborts the remaining providers.
    const spendRecord = await recordProjectSpend(admin, pid, taskCostCents, cap);
    if (spendRecord.newSpend != null) spendCentsAcc = spendRecord.newSpend;
    else spendCentsAcc += taskCostCents;
    const capReached = !spendRecord.allowed;

    const { data: runInsert, error: runErr } = await admin
      .from('visibility_query_runs')
      .insert({
        query_id: queryId,
        provider: prov,
        status: ans.ok ? 'completed' : 'failed',
        raw_response: ans.raw as unknown as Json,
        cited_sources: ans.cited,
        answer_text: ans.answerText,
        cost_cents: Math.max(0, Math.round(ans.costUsd * 100)),
        cost_usd: ans.costUsd,
        error_message: ans.errorMessage,
        dataforseo_platform: ans.sourceLabel,
      })
      .select('id')
      .single();

    if (runErr || !runInsert) {
      await attachProjectToSpendEvent(admin, spendEventId, pid, { query_id: queryId, source: ans.sourceLabel });
      results.push({ provider: prov, error: runErr?.message || 'insert failed' });
      if (capReached) break;
      continue;
    }
    const runId = runInsert.id as string;

    // Citations.
    let rank = 0;
    for (const c of ans.cited) {
      rank++;
      await admin.from('visibility_citations').insert({
        query_run_id: runId,
        source_url: c.url,
        source_domain: c.domain,
        rank_in_answer: rank,
        snippet: c.snippet,
      });
    }

    // Word-boundary + diacritic-folded detection (see brand_detect.ts). The old
    // `answer.includes(name)` matcher inflated Share of Voice on short brands
    // ("Ora" inside "decoration") and missed accented names ("L'Oréal" vs "L'Oreal").
    const entries: BrandDetectEntry[] = [
      ...(tb || []).map((b) => ({
        kind: 'tracked' as const,
        id: String(b.id),
        names: [b.name, ...(b.aliases || [])].filter(Boolean) as string[],
      })),
      ...(cb || []).map((b) => ({
        kind: 'competitor' as const,
        id: String(b.id),
        names: [b.name, ...(b.aliases || [])].filter(Boolean) as string[],
      })),
    ];
    for (const m of detectBrandMentions(ans.answerText, entries)) {
      await admin.from('visibility_brand_mentions').insert({
        query_run_id: runId,
        tracked_brand_id: m.kind === 'tracked' ? m.id : null,
        competitor_brand_id: m.kind === 'competitor' ? m.id : null,
        brand_name: m.name,
        mention_position: m.position,
        sentiment: 'neutral',
        is_recommended: m.isRecommended,
      });
    }

    // The reserved (now finalized) event IS the spend record: scope it to the project.
    await attachProjectToSpendEvent(admin, spendEventId, pid, { query_id: queryId, run_id: runId, source: ans.sourceLabel });

    results.push({ provider: prov, runId, costUsd: ans.costUsd, ok: ans.ok, citations: ans.cited.length, source: ans.sourceLabel });
    if (capReached) {
      results.push({ provider: prov, skipped: true, reason: 'Monthly API spend cap reached', capReached: true });
      break;
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

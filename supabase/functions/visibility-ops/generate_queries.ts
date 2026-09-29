import type { Json, Sb } from './shared.ts';
import type { User } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertAccountBudget, budgetBlockedResponse } from '../_shared/accountBudget.ts';
import {
  projectSpendExceeded,
  projectSpendThisMonthCents,
  recordProjectSpend,
  resolveProjectSpendCapCents,
} from './spend_cap.ts';
import { triggerInitialProjectScan } from './cron.ts';
import { fetchHomepageHead } from '../_shared/siteLocaleFetch.ts';
import { siteSummaryText, summarizeSiteHtml } from '../_shared/siteSummary.ts';
import {
  businessProfilePrompt,
  buildCategorySeeds,
  parseBusinessProfile,
  verticalForBusinessType,
  dedupeQueries,
  isQueryLanguageValid,
  marketLocalityLabel,
  parseGeneratedQueries,
  queryGenSystem,
  queryGenUserPrompt,
  queryGenerationChunks,
  resolveQueryLanguage,
  type GeneratedQuery, resolveLocality } from './query_generation.ts';

/** One JSON completion; null on any failure (the caller falls back to the project's own signals). */
async function callJsonLlm(args: { llmEndpoint: string; llmHeaders: Record<string, string>; llmModel: string; prompt: string }): Promise<string | null> {
  try {
    const res = await fetch(args.llmEndpoint, {
      method: 'POST',
      headers: args.llmHeaders,
      body: JSON.stringify({
        model: args.llmModel,
        temperature: 0.2,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: args.prompt }],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Json;
    return (((json['choices'] as Json[])?.[0]?.['message'] as Json)?.['content'] as string) ?? null;
  } catch {
    return null;
  }
}

async function callQueryLlm(args: {
  llmEndpoint: string;
  llmHeaders: Record<string, string>;
  llmModel: string;
  system: string;
  userPrompt: string;
  chunkSize: number;
}): Promise<GeneratedQuery[]> {
  const { llmEndpoint, llmHeaders, llmModel, system, userPrompt, chunkSize } = args;
  const ores = await fetch(llmEndpoint, {
    method: 'POST',
    headers: llmHeaders,
    body: JSON.stringify({
      model: llmModel,
      temperature: 0.75,
      max_tokens: Math.min(16000, chunkSize * 160 + 600),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!ores.ok) {
    const t = await ores.text();
    console.error('generate_queries LLM failed:', t.slice(0, 500));
    throw new Error('Query-generation LLM failed');
  }

  const ojson = (await ores.json()) as Json;
  const content = ((ojson['choices'] as Json[])?.[0]?.['message'] as Json)?.['content'] as string;
  try {
    return parseGeneratedQueries(content);
  } catch {
    console.error('generate_queries JSON parse failed:', content.slice(0, 400));
    throw new Error('Failed to parse query-generation JSON');
  }
}

export async function handleGenerateQueries(
  supabaseUser: Sb,
  admin: Sb,
  user: User,
  body: Json,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const projectId = body['projectId'] as string;
  // Honour the requested count down to 5 (max 120); default 60 when absent/invalid.
  const requestedCount = Number(body['count']);
  const count = Math.min(120, Math.max(5, Number.isFinite(requestedCount) ? Math.floor(requestedCount) : 60));
  // Opt-out of the automatic initial paid scan (default false — unchanged behaviour).
  const skipInitialScan = body['skipInitialScan'] === true;

  const { data: project, error: pe } = await supabaseUser
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();
  if (pe || !project || project.user_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const budget = await assertAccountBudget(admin, user.id, 1);
  if (!budget.allowed) return budgetBlockedResponse(budget, corsHeaders);

  const projectSpendCap = await resolveProjectSpendCapCents(admin, project as Json, user.id);
  const spendNow = await projectSpendThisMonthCents(admin, projectId);
  if (projectSpendExceeded(spendNow, projectSpendCap, 1)) {
    return new Response(JSON.stringify({ error: 'Monthly API spend cap reached' }), {
      status: 402,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: brands } = await supabaseUser
    .from('tracked_brands')
    .select('*')
    .eq('project_id', projectId);
  const { data: comps } = await supabaseUser
    .from('competitor_brands')
    .select('*')
    .eq('project_id', projectId);

  const queryLang = resolveQueryLanguage(project);
  const brandName = brands?.[0]?.name || project.name || 'your brand';
  const compNames = (comps || []).map((c: { name: string }) => c.name).filter(Boolean);
  let seeds = buildCategorySeeds(project);
  let vertical = (project.vertical as string) || 'saas';
  const storePlatform = (project.store_platform as string) || '';
  const catalogNotes = (project.catalog_notes as string) || '';
  const siteUrl = (project.website_url as string) || '';
  const marketLabel = marketLocalityLabel(project.market as string, queryLang);
  let locality = resolveLocality(project as Json);
  const profileNotes = String(project.author_bio ?? '');
  // What the homepage says the business does: every prompt is grounded in it (best-effort).
  const siteHtml = siteUrl ? await fetchHomepageHead(siteUrl, 5000) : null;
  const siteSummary = siteSummaryText(summarizeSiteHtml(siteHtml));

  const openrouterKey = Deno.env.get('OPENROUTER_API_KEY');
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const useOpenRouter = !!openrouterKey;
  const llmKey = openrouterKey || openaiKey;
  if (!llmKey) {
    return new Response(
      JSON.stringify({
        error:
          'No LLM key for query generation: set OPENROUTER_API_KEY (preferred) or OPENAI_API_KEY in the function secrets.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  const llmEndpoint = useOpenRouter
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const llmModel = useOpenRouter ? 'openai/gpt-4o-mini' : 'gpt-4o-mini';

  const llmHeaders: Record<string, string> = {
    Authorization: `Bearer ${llmKey}`,
    'Content-Type': 'application/json',
  };
  if (useOpenRouter) {
    llmHeaders['HTTP-Referer'] = 'https://rankdelta.ai';
    llmHeaders['X-Title'] = 'Rankdelta Visibility';
  }

  // No category signal at all (projects added over MCP, or before onboarding stored one): read the
  // category, buyer and kind of business from the homepage instead of assuming a SaaS vendor, and
  // keep it on the project so the next generation and the UI agree.
  let profileInferred: Record<string, string> | null = null;
  if (seeds.length === 0) {
    const profile = parseBusinessProfile(
      await callJsonLlm({ llmEndpoint, llmHeaders, llmModel, prompt: businessProfilePrompt({ siteUrl, siteSummary, lang: queryLang }) }),
    );
    if (profile) {
      seeds = [profile.category, profile.audience].filter(Boolean);
      vertical = verticalForBusinessType(profile.businessType);
      if (!locality && profile.serviceArea) locality = profile.serviceArea;
      profileInferred = { category: profile.category, business_type: profile.businessType, service_area: profile.serviceArea };
      const metadata = { ...((project.metadata as Json | null) ?? {}) } as Json;
      if (profile.serviceArea && !resolveLocality(project as Json)) metadata['locality'] = profile.serviceArea;
      const { error: profileErr } = await admin
        .from('projects')
        .update({ main_topic: profile.category, vertical, metadata })
        .eq('id', projectId)
        .eq('user_id', user.id);
      if (profileErr) console.warn('generate_queries: inferred profile not stored', profileErr.message);
    }
  }

  // Existing prompts for this project: seed the LLM "avoid" list and dedupe before insert.
  const { data: existingRows } = await supabaseUser
    .from('visibility_queries')
    .select('text')
    .eq('project_id', projectId);
  const normalizeText = (t: unknown) => String(t ?? '').trim().toLowerCase();
  const existingTexts = new Set(
    ((existingRows ?? []) as Array<{ text: string | null }>).map((r) => normalizeText(r.text)).filter(Boolean),
  );

  const system = queryGenSystem(queryLang, brandName);
  const chunks = queryGenerationChunks(count);
  const collected: GeneratedQuery[] = [];
  const avoidTexts: string[] = ((existingRows ?? []) as Array<{ text: string | null }>)
    .map((r) => String(r.text ?? '').trim())
    .filter(Boolean);

  for (const chunkSize of chunks) {
    if (collected.length >= count) break;
    const need = Math.min(chunkSize, count - collected.length);
    let attempt = 0;
    while (attempt < 2 && collected.length < count) {
      attempt++;
      try {
        const batch = await callQueryLlm({
          llmEndpoint,
          llmHeaders,
          llmModel,
          system,
          userPrompt: queryGenUserPrompt({
            lang: queryLang,
            count: need,
            brandName,
            compNames,
            seeds,
            vertical,
            storePlatform,
            catalogNotes,
            siteUrl,
            marketLabel,
            avoidTexts,
            locality,
            profileNotes,
            siteSummary,
          }),
          chunkSize: need,
        });
        const valid = batch.filter((q) => isQueryLanguageValid(q.text, queryLang));
        const rejectedLang = batch.length - valid.length;
        if (rejectedLang > 0) {
          console.warn(`generate_queries: rejected ${rejectedLang}/${batch.length} queries for wrong language (expected ${queryLang})`);
        }
        collected.push(...valid);
        avoidTexts.push(...valid.map((q) => q.text));
      } catch (err) {
        console.error('generate_queries chunk failed:', err);
        if (attempt >= 2) {
          return new Response(JSON.stringify({ error: 'query_generation_failed' }), {
            status: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }
  }

  const deduped = dedupeQueries(collected);
  // Drop anything already saved for the project (case-insensitive, trimmed).
  const fresh = deduped.filter((q) => !existingTexts.has(normalizeText(q.text)));
  const skippedExisting = deduped.length - fresh.length;
  const rows = fresh.slice(0, count);

  let inserted = 0;
  for (const q of rows) {
    const { error: insErr } = await supabaseUser.from('visibility_queries').insert({
      project_id: projectId,
      text: q.text.trim(),
      language: queryLang,
      intent_type: q.intent_type,
      vertical,
      is_auto_generated: true,
      is_active: true,
    });
    if (!insErr) inserted++;
  }

  const queryGenCostCents = 1;
  await recordProjectSpend(admin, projectId, queryGenCostCents, projectSpendCap);
  await admin.from('visibility_api_spend_events').insert({
    project_id: projectId,
    user_id: user.id,
    provider: null,
    action: 'generate_queries',
    cost_cents: queryGenCostCents,
    cost_usd: 0.00015,
    metadata: {
      inserted,
      requested: count,
      parsed: rows.length,
      skipped_existing: skippedExisting,
      language: queryLang,
      site_summary: siteSummary ? 'read' : 'unavailable',
      profile_inferred: profileInferred,
      chunks: chunks.length,
      model: llmModel,
      provider: useOpenRouter ? 'openrouter' : 'openai',
    },
  });

  // First scan async so onboarding/dashboard show SoV instead of 0% (background task).
  const queueInitialScan = inserted > 0 && !skipInitialScan;
  if (queueInitialScan) {
    const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
    const scanPromise = triggerInitialProjectScan(admin, projectId);
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(scanPromise);
    } else {
      void scanPromise;
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      inserted,
      total: rows.length,
      requested: count,
      skippedExisting,
      language: queryLang,
      initialScanQueued: queueInitialScan,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

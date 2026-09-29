import type { User } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  applyKeywordCap,
  clampDays,
  clampLimit,
  DEFAULT_SERP_ESTIMATE_USD,
  executeCannibalization,
  readMaxKeywordsPerCheck,
  refreshKeywordsViaSerp,
  resolveExecutionMode,
  sortKeywordsByFreshness,
  type RankKeywordInput,
  type RankSnapshotInput,
} from '../_shared/cannibalization.ts';
import { assertAccountBudget, budgetBlockedResponse, logSpend } from '../_shared/accountBudget.ts';
import {
  projectSpendExceeded,
  projectSpendThisMonthCents,
  recordProjectSpend,
  resolveProjectSpendCapCents,
} from './spend_cap.ts';
import { mapLangToCode, mapMarketToLocation, type Json, type Sb } from './shared.ts';

async function resolvePlanCap(admin: Sb, userId: string, projectMetadata: unknown): Promise<number> {
  const { data: sub } = await admin
    .from('subscriptions')
    .select('plan')
    .eq('user_id', userId)
    .maybeSingle();
  let planValue: unknown;
  if (sub?.plan) {
    const { data: plan } = await admin
      .from('plan_configurations')
      .select('max_keywords_per_check')
      .eq('plan', sub.plan as string)
      .maybeSingle();
    planValue = plan?.max_keywords_per_check;
  }
  return readMaxKeywordsPerCheck({ projectMetadata, planValue });
}

export async function handleGetCannibalization(
  supabaseUser: Sb,
  admin: Sb,
  user: User,
  body: Json,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const siteId = String(body['site_id'] ?? body['siteId'] ?? body['projectId'] ?? '').trim();
  if (!siteId) {
    return new Response(JSON.stringify({ error: 'site_id required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const engine = String(body['engine'] ?? 'google');
  const days = clampDays(body['days']);
  const limit = clampLimit(body['limit'], 100);
  const refresh = body['refresh'] === true;
  const dryRun = body['dry_run'] === true || body['dryRun'] === true;
  const mode = resolveExecutionMode(refresh, dryRun);
  const estimateUsd = Number(
    Deno.env.get('DATAFORSEO_SERP_ESTIMATE_MAX_USD_PER_TASK') ?? DEFAULT_SERP_ESTIMATE_USD,
  );

  const { data: project, error: pe } = await supabaseUser
    .from('projects')
    .select(
      'id, user_id, website_url, metadata, primary_language, market, monthly_api_spend_cap_cents',
    )
    .eq('id', siteId)
    .single();

  if (pe || !project || project.user_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const siteUrl = (project.website_url as string) || '';
  const maxKeywordsPerCheck = await resolvePlanCap(admin, user.id, project.metadata);
  const projectSpendCap = await resolveProjectSpendCapCents(admin, project as Json, user.id);

  const { data: kwRows, error: kwe } = await supabaseUser
    .from('serp_rank_keywords')
    .select('id, phrase, is_active')
    .eq('project_id', siteId)
    .eq('is_active', true);

  if (kwe) {
    console.error('[visibility-ops] keywords_load_failed', kwe.message);
    return new Response(JSON.stringify({ error: 'keywords_load_failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const keywords: RankKeywordInput[] = (kwRows ?? []).map((r) => ({
    id: r.id as string,
    phrase: r.phrase as string,
  }));

  const sinceIso = new Date(Date.now() - days * 864e5).toISOString();
  const keywordIds = keywords.map((k) => k.id);
  const snapshots: RankSnapshotInput[] = [];

  for (let i = 0; i < keywordIds.length; i += 200) {
    const chunk = keywordIds.slice(i, i + 200);
    if (chunk.length === 0) break;
    const { data: snaps, error: se } = await supabaseUser
      .from('serp_rank_snapshots')
      .select('keyword_id, rank_absolute, ranking_url, raw_response, status, checked_at')
      .in('keyword_id', chunk)
      .gte('checked_at', sinceIso)
      .order('checked_at', { ascending: false });
    if (se) {
      console.error('[visibility-ops] snapshots_load_failed', se.message);
      return new Response(JSON.stringify({ error: 'snapshots_load_failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    for (const s of snaps ?? []) {
      snapshots.push({
        keyword_id: s.keyword_id as string,
        rank_absolute: (s.rank_absolute as number | null) ?? null,
        ranking_url: (s.ranking_url as string | null) ?? null,
        raw_response: s.raw_response,
        status: (s.status as string | null) ?? null,
        checked_at: s.checked_at as string,
      });
    }
  }

  if (mode === 'refresh') {
    const ordered = sortKeywordsByFreshness(keywords, snapshots);
    const { selected } = applyKeywordCap(ordered, maxKeywordsPerCheck);
    const estimateMaxCents = Math.max(1, Math.round(estimateUsd * 100));
    const budget = await assertAccountBudget(admin, user.id, selected.length * estimateMaxCents);
    if (!budget.allowed) return budgetBlockedResponse(budget, corsHeaders);
    const spendNow = await projectSpendThisMonthCents(admin, siteId);
    if (projectSpendExceeded(spendNow, projectSpendCap, selected.length * estimateMaxCents)) {
      return new Response(JSON.stringify({ error: 'Monthly API spend cap reached' }), {
        status: 402,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  const payload = await executeCannibalization({
    siteId,
    engine,
    days,
    limit,
    refresh,
    dryRun,
    maxKeywordsPerCheck,
    estimateUsdPerKeyword: estimateUsd,
    siteUrl,
    keywords,
    snapshots,
    refreshSerp: async (selected) => {
      if (mode !== 'refresh') {
        throw new Error('refreshSerp invoked outside refresh mode');
      }

      const login = Deno.env.get('DATAFORSEO_LOGIN');
      const pass = Deno.env.get('DATAFORSEO_PASSWORD');
      if (!login || !pass) {
        throw new Error('DataForSEO not configured');
      }

      const result = await refreshKeywordsViaSerp({
        fetchFn: fetch,
        login,
        password: pass,
        keywords: selected,
        languageCode: mapLangToCode(project.primary_language as string),
        locationCode: mapMarketToLocation(project.market as string),
        siteUrl,
      });

      for (const snap of result.snapshots) {
        await admin.from('serp_rank_snapshots').insert({
          keyword_id: snap.keyword_id,
          rank_absolute: snap.rank_absolute,
          ranking_url: snap.ranking_url,
          raw_response: snap.raw_response as unknown as Json,
          status: snap.status ?? 'completed',
          checked_at: snap.checked_at,
        });
      }

      const addCents = Math.max(0, Math.round(result.costUsd * 100));
      await recordProjectSpend(admin, siteId, addCents, projectSpendCap);
      await logSpend(admin, {
        userId: user.id,
        projectId: siteId,
        provider: null,
        action: 'serp_google_organic_cannibalization_refresh',
        costCents: addCents,
        costUsd: result.costUsd,
        metadata: {
          batched: true,
          http_calls: result.httpCalls,
          keyword_ids: selected.map((k) => k.id),
        },
      });
      return result;
    },
  });

  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

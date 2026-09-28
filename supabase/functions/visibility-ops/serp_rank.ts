import type { Json, Sb } from './shared.ts';
import type { User } from 'https://esm.sh/@supabase/supabase-js@2';
import { mapLangToCode, mapMarketToLocation, urlMatchesSite } from './shared.ts';
import { runWithBudget } from './batch_runner.ts';
import {
  finalizeAccountSpend,
  releaseAccountSpend,
  reserveAccountSpend,
} from '../_shared/accountBudget.ts';
import {
  attachProjectToSpendEvent,
  projectSpendExceeded,
  projectSpendThisMonthCents,
  recordProjectSpend,
  resolveProjectSpendCapCents,
} from './spend_cap.ts';

export type SerpRankKeywordResult = {
  keywordId: string;
  snapshotId?: string;
  position?: number | null;
  rankingUrl?: string | null;
  costUsd?: number;
  organicCount?: number;
  error?: string;
  skipped?: boolean;
  reason?: string;
  /** record_project_spend refused the write (cap exceeded): callers must stop the batch. */
  capReached?: boolean;
};

/** Run one Google organic rank check and persist a serp_rank_snapshots row. */
export async function runSerpRankForKeyword(
  supabaseUser: Sb,
  admin: Sb,
  user: User,
  keywordId: string,
  options?: { spendCentsAcc?: number },
): Promise<SerpRankKeywordResult> {
  const serpEstimateUsd = Number(
    Deno.env.get('DATAFORSEO_SERP_ESTIMATE_MAX_USD_PER_TASK') ?? '0.025',
  );
  const estimateMaxCents = Math.max(1, Math.round(serpEstimateUsd * 100));

  const login = Deno.env.get('DATAFORSEO_LOGIN');
  const pass = Deno.env.get('DATAFORSEO_PASSWORD');
  if (!login || !pass) {
    return { keywordId, error: 'DataForSEO not configured' };
  }

  const { data: kwRow, error: kwe } = await supabaseUser
    .from('serp_rank_keywords')
    .select('id, phrase, project_id, is_active')
    .eq('id', keywordId)
    .single();

  if (kwe || !kwRow || !kwRow.is_active) {
    return { keywordId, error: 'Keyword not found or inactive' };
  }

  const { data: proj, error: pje } = await supabaseUser
    .from('projects')
    .select('*')
    .eq('id', kwRow.project_id as string)
    .single();

  if (pje || !proj || proj.user_id !== user.id) {
    return { keywordId, error: 'Forbidden' };
  }

  const siteUrl = (proj.website_url as string) || '';
  if (!siteUrl.trim()) {
    return {
      keywordId,
      error: 'Store URL missing — add a website URL to run Google rank checks',
    };
  }

  const cap = await resolveProjectSpendCapCents(admin, proj as Record<string, unknown>, user.id);
  const projectId = kwRow.project_id as string;
  let spendCentsAcc = options?.spendCentsAcc ?? await projectSpendThisMonthCents(admin, projectId);
  if (projectSpendExceeded(spendCentsAcc, cap)) {
    return { keywordId, skipped: true, reason: 'Monthly API spend cap reached' };
  }
  if (projectSpendExceeded(spendCentsAcc, cap, estimateMaxCents)) {
    return { keywordId, skipped: true, reason: 'Insufficient cap remaining for SERP task' };
  }

  const languageCode = mapLangToCode(proj.primary_language as string);
  const locationCode = mapMarketToLocation(proj.market as string);
  const phrase = kwRow.phrase as string;
  const cred = btoa(`${login}:${pass}`);

  const serpTask = {
    keyword: phrase,
    location_code: locationCode,
    language_code: languageCode,
    depth: 100,
    device: 'desktop',
    os: 'windows',
  };

  // Atomic account reserve BEFORE the paid call (check + insert in one DB op, as in seo-proxy);
  // finalized with the reported cost, or released, once DataForSEO answers.
  const reserve = await reserveAccountSpend(
    admin,
    user.id,
    estimateMaxCents,
    'serp_google_organic',
    { keyword_id: keywordId, phrase },
  );
  if (!reserve.allowed) {
    return { keywordId, skipped: true, reason: reserve.reason || 'Account budget cap reached' };
  }

  const sres = await fetch(
    'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${cred}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([serpTask]),
    },
  );

  let sjson: Json;
  try {
    sjson = (await sres.json()) as Json;
  } catch {
    // Unknown cost: keep the conservative estimate on a 2xx, drop the reservation otherwise.
    if (sres.ok) await finalizeAccountSpend(admin, reserve.eventId, estimateMaxCents, estimateMaxCents / 100);
    else await releaseAccountSpend(admin, reserve.eventId);
    return { keywordId, error: 'DataForSEO SERP response not JSON' };
  }

  const tasks = (sjson['tasks'] as Json[]) || [];
  const st0 = tasks[0] as Json | undefined;
  const costUsd = (st0?.['cost'] as number) ?? (sjson['cost'] as number) ?? 0;
  const statusCode = st0?.['status_code'] as number;
  const okSerp = statusCode === 20000;

  let position: number | null = null;
  let rankingUrl: string | null = null;
  let resultTitle: string | null = null;
  let organicCount = 0;

  if (okSerp && st0) {
    const resultArr = (st0['result'] as Json[]) || [];
    const block = (resultArr[0] as Json) || {};
    const items = (block['items'] as Json[]) || [];
    const organic = items.filter((it) => (it as Json)['type'] === 'organic');
    organicCount = organic.length;
    for (const it of organic) {
      const row = it as Json;
      const url = row['url'] as string | undefined;
      if (url && urlMatchesSite(url, siteUrl)) {
        position =
          typeof row['rank_absolute'] === 'number'
            ? (row['rank_absolute'] as number)
            : typeof row['rank_group'] === 'number'
              ? (row['rank_group'] as number)
              : null;
        rankingUrl = url;
        resultTitle = (row['title'] as string) || null;
        break;
      }
    }
  }

  const taskCostCents = Math.max(0, Math.round(Number(costUsd) * 100));
  // DataForSEO can bill a failed task (cost reported on error) — keep the event then.
  const billed = sres.ok || taskCostCents > 0;
  if (billed) {
    await finalizeAccountSpend(admin, reserve.eventId, taskCostCents, Number(costUsd), { keyword_id: keywordId, phrase });
  } else {
    await releaseAccountSpend(admin, reserve.eventId);
  }
  const spendEventId = billed ? reserve.eventId : undefined;

  // Authoritative per-project cap (SELECT FOR UPDATE). Money is already spent, so the snapshot
  // is still persisted; allowed=false tells the caller to stop the batch.
  const spendRecord = await recordProjectSpend(admin, projectId, taskCostCents, cap);
  if (spendRecord.newSpend != null) spendCentsAcc = spendRecord.newSpend;
  else spendCentsAcc += taskCostCents;
  const capReached = !spendRecord.allowed;

  const { data: snap, error: snapErr } = await admin
    .from('serp_rank_snapshots')
    .insert({
      keyword_id: keywordId,
      rank_absolute: position,
      ranking_url: rankingUrl,
      result_title: resultTitle,
      serp_organic_count: organicCount,
      cost_usd: Number(costUsd),
      raw_response: sjson as unknown as Json,
      status: okSerp ? 'completed' : 'failed',
      error_message: okSerp
        ? null
        : JSON.stringify(st0?.['status_message'] || sjson).slice(0, 2000),
    })
    .select('id')
    .single();

  if (snapErr) {
    await attachProjectToSpendEvent(admin, spendEventId, projectId, { keyword_id: keywordId, phrase });
    return { keywordId, error: snapErr.message, capReached: capReached || undefined };
  }

  // The reserved (now finalized) event IS the spend record: scope it to the project.
  await attachProjectToSpendEvent(admin, spendEventId, projectId, {
    keyword_id: keywordId,
    phrase,
    snapshot_id: snap?.id,
    position,
  });

  return {
    keywordId,
    snapshotId: snap?.id as string | undefined,
    position,
    rankingUrl,
    costUsd: Number(costUsd),
    organicCount,
    capReached: capReached || undefined,
  };
}

export async function handleRunSerpRank(
  supabaseUser: Sb,
  admin: Sb,
  user: User,
  body: Json,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const keywordIdsRaw = body['keywordIds'];
  const keywordIds = Array.isArray(keywordIdsRaw)
    ? (keywordIdsRaw as string[]).filter((x) => typeof x === 'string')
    : [];
  const maxBatch = Math.min(
    20,
    Math.max(1, Number(Deno.env.get('DATAFORSEO_SERP_BATCH_MAX') ?? '12')),
  );
  const ids = [...new Set(keywordIds)].slice(0, maxBatch);

  if (ids.length === 0) {
    return new Response(JSON.stringify({ error: 'keywordIds required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // A few checks at a time within a budget that fits the MCP client's patience (see batch_runner):
  // keywords not started in time come back as `deferred` instead of a 504 after paying.
  const { results, deferred } = await runWithBudget(
    ids,
    (keywordId) => runSerpRankForKeyword(supabaseUser, admin, user, keywordId),
    {
      concurrency: Math.min(6, Math.max(1, Number(Deno.env.get('DATAFORSEO_SERP_CONCURRENCY') ?? '4'))),
      budgetMs: Math.max(10_000, Number(Deno.env.get('DATAFORSEO_SERP_BUDGET_MS') ?? '45000')),
      // Project cap hit (authoritative record_project_spend refusal): start nothing else.
      shouldStop: (result) => !!result.capReached,
    },
  );

  return new Response(JSON.stringify({ ok: true, results, deferred }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

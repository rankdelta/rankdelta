import type { Json, Sb } from './shared.ts';
import {
  clampDfsLimit,
  corsHeaders as sharedCorsHeaders,
  projectDefaultVisibilityProviders,
} from './shared.ts';
import { isPayingSubscription } from '../_shared/apiKeys.ts';
import { isSelfHost } from '../_shared/accountBudget.ts';
import { executeLlmMentionsRun } from './llm_mentions.ts';
import { resumeStalledSerpRankJobs } from './serp_rank_job.ts';
import { pickRunsToRetry, RETRY_WINDOW_MS, type RunRow } from './retry_failed.ts';
import {
  projectSpendExceeded,
  projectSpendThisMonthCents,
  resolveProjectSpendCapCents,
  VISIBILITY_CHECK_ESTIMATE_CENTS,
} from './spend_cap.ts';

const SCAN_LOCK_MS = 2 * 3600000;
const WEEKLY_MS = 7 * 86400000;

function cadenceIntervalMs(cadence: string): number {
  if (cadence === 'daily') return 86400000;
  if (cadence === 'every_3_days') return 3 * 86400000;
  return WEEKLY_MS;
}

function isProjectDueForCron(project: Json, force = false): boolean {
  if (force) return true;
  const cadence = (project['refresh_cadence'] as string) || 'weekly';
  const lastRaw = project['visibility_scheduled_last_at'] as string | null | undefined;
  const ms = cadenceIntervalMs(cadence);
  if (!lastRaw) return true;
  return Date.now() - new Date(lastRaw).getTime() >= ms;
}

export async function pickStaleActiveQueryIds(admin: Sb, projectId: string, max: number): Promise<string[]> {
  const { data: vqs, error } = await admin
    .from('visibility_queries')
    .select('id')
    .eq('project_id', projectId)
    .eq('is_active', true);
  if (error || !vqs?.length) return [];
  const ids = (vqs as { id: string }[]).map((v) => v.id);
  const { data: runs } = await admin
    .from('visibility_query_runs')
    .select('query_id, run_at')
    .in('query_id', ids)
    .order('run_at', { ascending: false });
  const lastRun = new Map<string, string>();
  for (const r of runs || []) {
    const row = r as { query_id: string; run_at: string };
    if (!lastRun.has(row.query_id)) lastRun.set(row.query_id, row.run_at);
  }
  return [...ids]
    .sort((a, b) => (lastRun.get(a) || '1970-01-01').localeCompare(lastRun.get(b) || '1970-01-01'))
    .slice(0, max);
}

type SubscriptionRow = { plan: string; status: string; is_internal?: boolean };

async function loadSubscription(admin: Sb, userId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await admin
    .from('subscriptions')
    .select('plan, status, is_internal')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as SubscriptionRow;
}

function subscriptionAllowsScheduledScan(sub: SubscriptionRow | null): boolean {
  // Self-host (BYOK): no Rankdelta subscription exists, the operator pays the providers directly.
  if (isSelfHost()) return true;
  if (!sub) return false;
  if (sub.is_internal === true) return true;
  return isPayingSubscription(sub.plan, sub.status);
}

async function projectHasActiveQueries(admin: Sb, projectId: string): Promise<boolean> {
  const { count, error } = await admin
    .from('visibility_queries')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('is_active', true);
  if (error) return false;
  return (count ?? 0) > 0;
}

async function isScanInProgress(admin: Sb, project: Json): Promise<boolean> {
  const lockRaw = project['visibility_scan_lock_at'] as string | null | undefined;
  if (lockRaw && Date.now() - new Date(lockRaw).getTime() < SCAN_LOCK_MS) return true;

  const projectId = project['id'] as string;
  const { data: vqs } = await admin
    .from('visibility_queries')
    .select('id')
    .eq('project_id', projectId)
    .eq('is_active', true);
  const ids = (vqs || []).map((q) => (q as { id: string }).id);
  if (ids.length === 0) return false;

  const since = new Date(Date.now() - SCAN_LOCK_MS).toISOString();
  const { count } = await admin
    .from('visibility_query_runs')
    .select('id', { count: 'exact', head: true })
    .in('query_id', ids)
    .in('status', ['pending', 'processing'])
    .gte('run_at', since);
  return (count ?? 0) > 0;
}

async function projectHasVisibilityChecks(admin: Sb, projectId: string): Promise<boolean> {
  const { count } = await admin
    .from('visibility_api_spend_events')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('action', 'visibility_check');
  return (count ?? 0) > 0;
}

export type RunProjectScanOptions = {
  maxQueries?: number;
  force?: boolean;
  reason?: string;
  providers?: string[];
};

/**
 * Run a capped batch of active visibility queries for one project (cron or post-onboarding).
 */
export async function runProjectScheduledScan(
  admin: Sb,
  project: Json,
  corsHeaders: Record<string, string> = sharedCorsHeaders,
  options: RunProjectScanOptions = {},
): Promise<Json> {
  const projectId = project['id'] as string;
  const userId = project['user_id'] as string;
  const maxQ = Math.min(
    20,
    Math.max(1, options.maxQueries ?? Number(Deno.env.get('VISIBILITY_CRON_MAX_QUERIES_PER_PROJECT') ?? '6')),
  );
  const providers = options.providers ?? projectDefaultVisibilityProviders(project);
  const envLimit = clampDfsLimit(Deno.env.get('DATAFORSEO_LLM_MENTIONS_LIMIT') ?? '3', 3);
  const dfsLimit = envLimit;
  const matchType = 'word_match' as const;
  const preferBrandSources = false;
  const delayMs = Math.max(
    500,
    Math.min(15000, Number(Deno.env.get('VISIBILITY_CRON_QUERY_DELAY_MS') ?? '2500')),
  );
  const reason = options.reason ?? 'scheduled';
  const isInitial = reason === 'initial_scan';

  // The RECURRING schedule is a paid feature and honours the user's schedule toggle. The
  // INITIAL scan right after prompt generation is the aha-moment and must run for never-paid
  // onboarding users too — otherwise they never see a single result (this silently blocked
  // every `incomplete`-checkout signup: the #1 activation leak). Cost stays bounded by the
  // spend cap, whose ONBOARDING_FREE_ALLOWANCE_CENTS exists precisely for this first scan.
  if (!isInitial && project['visibility_schedule_enabled'] === false) {
    return { projectId, skipped: true, reason: 'schedule_disabled' };
  }

  const sub = await loadSubscription(admin, userId);
  if (!isInitial && !subscriptionAllowsScheduledScan(sub)) {
    return { projectId, skipped: true, reason: 'subscription_inactive' };
  }

  if (!await projectHasActiveQueries(admin, projectId)) {
    return { projectId, skipped: true, reason: 'no_active_queries' };
  }

  if (await isScanInProgress(admin, project)) {
    return { projectId, skipped: true, reason: 'scan_in_progress' };
  }

  const force = options.force === true;
  if (!isProjectDueForCron(project, force)) {
    return { projectId, skipped: true, reason: 'not_due' };
  }

  if (isInitial && await projectHasVisibilityChecks(admin, projectId)) {
    return { projectId, skipped: true, reason: 'initial_scan_already_done' };
  }

  const capCents = await resolveProjectSpendCapCents(admin, project, userId);
  const spendCentsAcc = await projectSpendThisMonthCents(admin, projectId);
  if (projectSpendExceeded(spendCentsAcc, capCents, VISIBILITY_CHECK_ESTIMATE_CENTS * providers.length)) {
    return { projectId, skipped: true, reason: 'monthly_api_spend_cap_reached', capCents };
  }

  const lockAt = new Date().toISOString();
  await admin.from('projects').update({ visibility_scan_lock_at: lockAt }).eq('id', projectId);

  const queryIds = await pickStaleActiveQueryIds(admin, projectId, maxQ);
  if (queryIds.length === 0) {
    await admin
      .from('projects')
      .update({ visibility_scheduled_last_at: new Date().toISOString(), visibility_scan_lock_at: null })
      .eq('id', projectId);
    return { projectId, queries: 0, note: 'no_active_queries', reason };
  }

  const runs: Json[] = [];
  let pjWorking = project;
  try {
    for (const qid of queryIds) {
      const capNow = await resolveProjectSpendCapCents(admin, pjWorking, userId);
      const spendNow = await projectSpendThisMonthCents(admin, projectId);
      if (projectSpendExceeded(spendNow, capNow, VISIBILITY_CHECK_ESTIMATE_CENTS * providers.length)) {
        runs.push({ queryId: qid, skipped: true, reason: 'monthly_api_spend_cap_reached' });
        break;
      }

      const { data: vq, error: vqe } = await admin
        .from('visibility_queries')
        .select('*')
        .eq('id', qid)
        .single();
      if (vqe || !vq) {
        runs.push({ queryId: qid, error: 'query_missing' });
        continue;
      }

      const res = await executeLlmMentionsRun(
        admin,
        admin,
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
      runs.push({ queryId: qid, httpStatus: res.status, ...j });

      const { data: projFresh } = await admin.from('projects').select('*').eq('id', projectId).single();
      if (projFresh) pjWorking = projFresh as Json;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  } finally {
    await admin
      .from('projects')
      .update({
        visibility_scheduled_last_at: new Date().toISOString(),
        visibility_scan_lock_at: null,
      })
      .eq('id', projectId);
  }

  return { projectId, reason, queryIds, runs };
}

/** Fire-and-forget initial scan after query generation (onboarding). */
export async function triggerInitialProjectScan(admin: Sb, projectId: string): Promise<void> {
  const { data: project, error } = await admin.from('projects').select('*').eq('id', projectId).single();
  if (error || !project) return;
  try {
    await runProjectScheduledScan(admin, project as Json, sharedCorsHeaders, {
      reason: 'initial_scan',
      force: true,
    });
  } catch (e) {
    console.error('triggerInitialProjectScan failed:', e instanceof Error ? e.message : String(e));
  }
}

export async function handleCronScheduledRun(
  admin: Sb,
  corsHeaders: Record<string, string> = sharedCorsHeaders,
  options: { projectId?: string } = {},
): Promise<Response> {
  const targetProjectId = options.projectId;

  if (targetProjectId) {
    const { data: project, error } = await admin.from('projects').select('*').eq('id', targetProjectId).single();
    if (error || !project) {
      return new Response(JSON.stringify({ error: 'Project not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const summary = await runProjectScheduledScan(admin, project as Json, corsHeaders, { reason: 'cron_single' });
    return new Response(JSON.stringify({ ok: true, processed: 1, summary: [summary] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // One real scan per invocation, in the background.
  //
  // This used to walk EVERY project inside one HTTP request, once a week. A scan takes ~160-200s
  // per project (6 prompts × 4 engines + delays) and an Edge invocation is capped at 400s, so the
  // weekly call could only ever reach the first one or two projects before being killed — and the
  // pg_net caller gives up after a few seconds anyway. pg_cron now calls every 15 minutes; each call
  // picks the most overdue due project and scans just that one. 20 projects are covered in ~5h,
  // and each comes due again on its own cadence.
  const work = runNextDueProject(admin, corsHeaders).catch((e) => {
    console.error('[visibility-cron] run failed:', e instanceof Error ? e.message : String(e));
    return null;
  });
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(work);
    return new Response(JSON.stringify({ ok: true, accepted: true }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  // Local / non-Supabase runtime: no background tasks, so wait for the result.
  const result = await work;
  return new Response(JSON.stringify({ ok: true, ...(result ?? {}) }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Scan the most overdue project that is actually due. Skips (spend cap reached, lock held, no
 * prompts) do not stamp `visibility_scheduled_last_at`, so a skipped project must not block the
 * queue: keep walking candidates until one real scan runs, then stop.
 */
export async function runNextDueProject(
  admin: Sb,
  corsHeaders: Record<string, string> = sharedCorsHeaders(),
): Promise<Json> {
  // PostgREST caps an un-ranged select at max-rows (1000 by default): page explicitly.
  const PAGE_SIZE = 500;
  const projects: Json[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error: pe } = await admin
      .from('projects')
      .select('*')
      .eq('visibility_schedule_enabled', true)
      .order('visibility_scheduled_last_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (pe) throw new Error(pe.message);
    const rows = (page || []) as Json[];
    projects.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  const subscriptionCache = new Map<string, SubscriptionRow | null>();
  const skipped: Json[] = [];
  let scanned: Json | null = null;

  for (const pj of projects) {
    const userId = pj['user_id'] as string;
    if (!subscriptionCache.has(userId)) {
      subscriptionCache.set(userId, await loadSubscription(admin, userId));
    }
    if (!subscriptionAllowsScheduledScan(subscriptionCache.get(userId) ?? null)) continue;
    if (!isProjectDueForCron(pj)) continue;

    const result = await runProjectScheduledScan(admin, pj, corsHeaders, { reason: 'scheduled' });
    if (result['skipped'] === true) {
      if (result['reason'] !== 'not_due' && result['reason'] !== 'no_active_queries') skipped.push(result);
      continue;
    }
    scanned = result;
    break;
  }

  // Idle tick (nothing due): spend it re-running engine calls lost to a provider outage.
  const retried = scanned ? [] : await retryTransientFailures(admin, corsHeaders);

  const serpResumed = await resumeStalledSerpRankJobs(admin, admin, corsHeaders);
  console.log(
    '[visibility-cron]',
    JSON.stringify({
      candidates: projects.length,
      scanned: scanned ? scanned['projectId'] : null,
      skipped: skipped.map((r) => ({ projectId: r['projectId'], reason: r['reason'] })),
      retried: retried.length ? retried : undefined,
    }),
  );
  return { candidates: projects.length, scanned, skipped, serpResumed, retried };
}

const RETRIES_PER_TICK = 4;

/**
 * Re-run the most recent engine calls that failed with a transient provider error (see
 * retry_failed.ts), one engine per call, under the same rules as a scheduled scan: schedule on,
 * paying (or self-host), no scan in progress, spend cap not reached.
 */
export async function retryTransientFailures(
  admin: Sb,
  corsHeaders: Record<string, string> = sharedCorsHeaders(),
  max = RETRIES_PER_TICK,
): Promise<Json[]> {
  const since = new Date(Date.now() - RETRY_WINDOW_MS).toISOString();
  const { data: rows, error } = await admin
    .from('visibility_query_runs')
    .select('query_id, provider, status, run_at, task_code:raw_response->tasks->0->>status_code')
    .eq('provider', 'google_aio')
    .gte('run_at', since)
    .order('run_at', { ascending: false })
    .limit(2000);
  if (error) {
    console.error('[visibility-cron] retry lookup failed', error.message);
    return [];
  }
  const picks = pickRunsToRetry((rows ?? []) as RunRow[], max);
  const out: Json[] = [];
  const subscriptions = new Map<string, SubscriptionRow | null>();
  for (const pick of picks) {
    const { data: vq } = await admin.from('visibility_queries').select('*').eq('id', pick.queryId).maybeSingle();
    if (!vq || (vq as Json)['is_active'] === false) continue;
    const projectId = (vq as Json)['project_id'] as string;
    const { data: project } = await admin.from('projects').select('*').eq('id', projectId).maybeSingle();
    if (!project || (project as Json)['visibility_schedule_enabled'] === false) continue;
    const userId = (project as Json)['user_id'] as string;
    if (!subscriptions.has(userId)) subscriptions.set(userId, await loadSubscription(admin, userId));
    if (!subscriptionAllowsScheduledScan(subscriptions.get(userId) ?? null)) continue;
    if (await isScanInProgress(admin, project as Json)) continue;
    const capCents = await resolveProjectSpendCapCents(admin, project as Json, userId);
    if (projectSpendExceeded(await projectSpendThisMonthCents(admin, projectId), capCents, VISIBILITY_CHECK_ESTIMATE_CENTS)) continue;
    const res = await executeLlmMentionsRun(
      admin, admin, userId, vq as Json, project as Json, pick.queryId, [pick.provider],
      clampDfsLimit(Deno.env.get('DATAFORSEO_LLM_MENTIONS_LIMIT') ?? '3', 3), 'word_match', false, corsHeaders,
    );
    await res.body?.cancel();
    out.push({ queryId: pick.queryId, provider: pick.provider, httpStatus: res.status });
  }
  return out;
}

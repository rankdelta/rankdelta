import type { Json, Sb } from './shared.ts';
import type { User } from 'https://esm.sh/@supabase/supabase-js@2';
import { runSerpRankForKeyword, type SerpRankKeywordResult } from './serp_rank.ts';

type SerpRankJobRow = {
  id: string;
  project_id: string;
  user_id: string;
  status: string;
  keyword_ids: string[];
  completed_ids: string[];
  failed: Record<string, string>;
  attempts: number;
  max_attempts: number;
};

function jobProgress(job: SerpRankJobRow) {
  const total = job.keyword_ids.length;
  const completed = job.completed_ids.length;
  const failed = Object.keys(job.failed || {}).length;
  return { total, completed, failed, done: completed + failed };
}

function finalizeJobStatus(job: SerpRankJobRow): 'completed' | 'partial' | 'failed' {
  const { total, completed, failed } = jobProgress(job);
  if (completed + failed >= total) {
    if (failed > 0 && completed > 0) return 'partial';
    if (failed > 0) return 'failed';
    return 'completed';
  }
  return 'completed';
}

async function loadJob(admin: Sb, jobId: string): Promise<SerpRankJobRow | null> {
  const { data, error } = await admin
    .from('serp_rank_check_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (error || !data) return null;
  return data as SerpRankJobRow;
}

export async function handleEnqueueSerpRankJob(
  supabaseUser: Sb,
  admin: Sb,
  user: User,
  body: Json,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const projectId = typeof body['projectId'] === 'string' ? body['projectId'] : '';
  const keywordIdsRaw = body['keywordIds'];
  const keywordIds = Array.isArray(keywordIdsRaw)
    ? [...new Set((keywordIdsRaw as string[]).filter((x) => typeof x === 'string'))]
    : [];

  if (!projectId || keywordIds.length === 0) {
    return new Response(JSON.stringify({ error: 'projectId and keywordIds required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: proj, error: pje } = await supabaseUser
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();
  if (pje || !proj) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: kws, error: kwe } = await supabaseUser
    .from('serp_rank_keywords')
    .select('id')
    .eq('project_id', projectId)
    .in('id', keywordIds)
    .eq('is_active', true);
  if (kwe) {
    return new Response(JSON.stringify({ error: kwe.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const validIds = (kws || []).map((k) => (k as { id: string }).id);
  if (validIds.length === 0) {
    return new Response(JSON.stringify({ error: 'No active keywords found' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: job, error: je } = await admin
    .from('serp_rank_check_jobs')
    .insert({
      project_id: projectId,
      user_id: user.id,
      status: 'pending',
      keyword_ids: validIds,
    })
    .select('id, status, keyword_ids')
    .single();

  if (je || !job) {
    return new Response(JSON.stringify({ error: je?.message || 'Failed to create job' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      jobId: job.id,
      status: job.status,
      total: (job.keyword_ids as string[]).length,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

/** Process remaining keywords for a job (resumable, per-keyword progress). */
export async function handleProcessSerpRankJob(
  supabaseUser: Sb,
  admin: Sb,
  user: User,
  body: Json,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const jobId = typeof body['jobId'] === 'string' ? body['jobId'] : '';
  if (!jobId) {
    return new Response(JSON.stringify({ error: 'jobId required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let job = await loadJob(admin, jobId);
  if (!job || job.user_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'partial') {
    return new Response(
      JSON.stringify({ ok: true, jobId, status: job.status, ...jobProgress(job), finished: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (job.attempts >= job.max_attempts) {
    await admin
      .from('serp_rank_check_jobs')
      .update({ status: 'failed', error_message: 'Max attempts exceeded', completed_at: new Date().toISOString() })
      .eq('id', jobId);
    return new Response(
      JSON.stringify({ ok: false, jobId, status: 'failed', error: 'Max attempts exceeded' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Atomic claim: only a pending job, or a running one nobody has touched for 2 minutes
  // (worker died mid-chunk), flips to running. A concurrent poller gets claimed=false and
  // simply keeps polling — no double-processing of the same chunk.
  const now = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: claimedRows, error: claimErr } = await admin
    .from('serp_rank_check_jobs')
    .update({
      status: 'running',
      started_at: job.status === 'pending' ? now : undefined,
      updated_at: now,
    })
    .eq('id', jobId)
    .or(`status.eq.pending,and(status.eq.running,updated_at.lt.${staleCutoff})`)
    .select('id');
  if (claimErr) {
    return new Response(JSON.stringify({ error: claimErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!claimedRows || claimedRows.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, jobId, status: 'running', claimed: false, ...jobProgress(job), finished: false }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const maxPerInvocation = Math.min(
    8,
    Math.max(1, Number(Deno.env.get('SERP_RANK_JOB_CHUNK_SIZE') ?? '4')),
  );
  const completedSet = new Set(job.completed_ids || []);
  const failedMap = { ...(job.failed || {}) };
  const remaining = job.keyword_ids.filter((id) => !completedSet.has(id) && !failedMap[id]);
  const chunk = remaining.slice(0, maxPerInvocation);
  const chunkResults: Json[] = [];
  let chunkFailed = false;
  let capReached = false;

  for (const keywordId of chunk) {
    let result: SerpRankKeywordResult;
    try {
      result = await runSerpRankForKeyword(supabaseUser, admin, user, keywordId);
    } catch (e) {
      result = { keywordId, error: e instanceof Error ? e.message : String(e) };
    }
    chunkResults.push(result as unknown as Json);
    if (result.snapshotId) {
      completedSet.add(keywordId);
      delete failedMap[keywordId];
    } else if (result.skipped) {
      failedMap[keywordId] = result.reason || 'Skipped';
      chunkFailed = true;
    } else {
      failedMap[keywordId] = result.error || 'Unknown error';
      chunkFailed = true;
    }
    if (result.capReached) capReached = true;

    await admin
      .from('serp_rank_check_jobs')
      .update({
        completed_ids: [...completedSet],
        failed: failedMap,
        // attempts counts chunks that actually failed, not invocations.
        ...(chunkFailed ? { attempts: job.attempts + 1 } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    // Project cap hit (authoritative record_project_spend refusal): stop this chunk.
    if (capReached) break;
  }

  job = (await loadJob(admin, jobId))!;
  const progress = jobProgress(job);
  const allDone = progress.completed + progress.failed >= progress.total;
  let finalStatus = job.status;
  if (allDone) {
    finalStatus = finalizeJobStatus(job);
    await admin
      .from('serp_rank_check_jobs')
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);
  } else {
    await admin
      .from('serp_rank_check_jobs')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', jobId);
    finalStatus = 'pending';
  }

  return new Response(
    JSON.stringify({
      ok: true,
      jobId,
      status: finalStatus,
      ...progress,
      finished: allDone,
      results: chunkResults,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

/** Cron helper: resume jobs stuck in pending/running (e.g. client closed mid-flight). */
export async function resumeStalledSerpRankJobs(
  admin: Sb,
  supabaseUser: Sb,
  corsHeaders: Record<string, string>,
): Promise<Json[]> {
  const stallMs = Math.max(60_000, Number(Deno.env.get('SERP_RANK_JOB_STALL_MS') ?? '120000'));
  const cutoff = new Date(Date.now() - stallMs).toISOString();
  const maxJobs = Math.min(10, Math.max(1, Number(Deno.env.get('SERP_RANK_JOB_RESUME_MAX') ?? '5')));

  const { data: jobs, error } = await admin
    .from('serp_rank_check_jobs')
    .select('*')
    .in('status', ['pending', 'running'])
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(maxJobs);

  if (error || !jobs?.length) return [];

  const summary: Json[] = [];
  for (const row of jobs) {
    const job = row as SerpRankJobRow;
    const user = { id: job.user_id } as User;
    const res = await handleProcessSerpRankJob(
      supabaseUser,
      admin,
      user,
      { jobId: job.id },
      corsHeaders,
    );
    try {
      summary.push((await res.json()) as Json);
    } catch {
      summary.push({ jobId: job.id, error: 'process_failed' });
    }
  }
  return summary;
}

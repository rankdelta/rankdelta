/**
 * Visibility tracker — generate queries (OpenAI) and run prompts (DataForSEO LLM Mentions).
 * Secrets: SUPABASE_URL, the Supabase API keys resolved by _shared/supabaseKeys.ts
 * (SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS, falling back to the legacy
 * SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY), OPENAI_API_KEY,
 *          DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD
 * Cron: pg_cron `visibility-autoscan` (every 15 min) POSTs { "action": "cron_scheduled_run" } with
 *          header x-visibility-cron-secret = Vault `visibility_cron_secret` (or the
 *          VISIBILITY_CRON_SECRET env var). Each call scans the ONE most overdue paying project
 *          (visibility_schedule_enabled opt-out) in the background — see cron.ts for why. Optional
 *          projectId scopes to one project. Optional: VISIBILITY_CRON_MAX_QUERIES_PER_PROJECT (default 6),
 *          VISIBILITY_CRON_QUERY_DELAY_MS (default 2500).
 *
 * Additive analysis actions (zero cost by default; reuse stored data):
 *   mine_fanouts, get_source_gaps, get_cannibalization, get_link_intersect,
 *   get_content_gap, get_brand_sentiment
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type User } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertPayingPlan, planRequiredResponse, resolveCaller } from '../_shared/apiKeys.ts';
import { cronSecretMatches } from '../_shared/cronSecret.ts';
import { handleGetBrandSentiment } from './brand_sentiment.ts';
import { handleGetCannibalization } from './cannibalization.ts';
import { handleGetContentGap } from './content_gap.ts';
import { handleCronScheduledRun } from './cron.ts';
import { handleGenerateQueries } from './generate_queries.ts';
import { handleGetSourceGaps } from './get_source_gaps.ts';
import { handleGetLinkIntersect } from './link_intersect.ts';
import { executeLlmMentionsRun } from './llm_mentions.ts';
import { handleMineFanouts } from './mine_fanouts.ts';
import { handleScanProject } from './scan_project.ts';
import { handleRunSerpRank } from './serp_rank.ts';
import {
  handleEnqueueSerpRankJob,
  handleProcessSerpRankJob,
  resumeStalledSerpRankJobs,
} from './serp_rank_job.ts';
import {
  clampDfsLimit,
  corsHeaders,
  DEFAULT_VISIBILITY_PROVIDERS,
  filterKnownVisibilityProviders,
  type Json,
  type Sb,
} from './shared.ts';
import { publishableKey, secretKey } from '../_shared/supabaseKeys.ts';

serve(async (req) => {
  const cors = corsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = publishableKey();
    const serviceKey = secretKey();
    const admin = createClient(supabaseUrl, serviceKey);

    let body: Json = {};
    if (req.method === 'POST') {
      try {
        body = (await req.json()) as Json;
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
    }

    if (body['action'] === 'cron_scheduled_run') {
      // Cron callers are non-browser (no Origin): cors has no ACAO, which is fine here.
      const hdr = req.headers.get('x-visibility-cron-secret');
      if (!(await cronSecretMatches(admin, hdr, 'VISIBILITY_CRON_SECRET', 'visibility_cron_secret'))) {
        return new Response(JSON.stringify({ error: 'Unauthorized cron' }), {
          status: 401,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
      return await handleCronScheduledRun(admin, cors, {
        projectId: typeof body['projectId'] === 'string' ? body['projectId'] : undefined,
      });
    }

    if (body['action'] === 'resume_serp_rank_jobs') {
      const hdr = req.headers.get('x-visibility-cron-secret');
      if (!(await cronSecretMatches(admin, hdr, 'VISIBILITY_CRON_SECRET', 'visibility_cron_secret'))) {
        return new Response(JSON.stringify({ error: 'Unauthorized cron' }), {
          status: 401,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
      const resumed = await resumeStalledSerpRankJobs(admin, admin, cors);
      return new Response(JSON.stringify({ ok: true, resumed }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // MCP forwards Authorization: Bearer sk_astroseo_… — JWT-only getUser() 401s those calls.
    // resolveCaller maps a personal key to that key's user_id (or verifies a browser JWT).
    const caller = await resolveCaller(req);
    if (!caller) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    if (!(await assertPayingPlan(caller.userId))) {
      return planRequiredResponse(cors);
    }

    const user = { id: caller.userId } as User;
    // API keys are not JWTs, so RLS-as-user is unavailable. Use service role and keep
    // every data path gated on project.user_id === caller.userId (handlers already check).
    const supabaseUser: Sb =
      caller.via === 'jwt'
        ? createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: `Bearer ${caller.token}` } },
          })
        : admin;

    const action = body['action'] as string;

    if (action === 'generate_queries') {
      return await handleGenerateQueries(supabaseUser, admin, user, body, cors);
    }

    if (action === 'run_query') {
      const queryId = body['queryId'] as string;
      // Clamp the caller-supplied provider list to the known set and dedupe: duplicates (or a huge
      // array) would each trigger a separate paid DataForSEO/OpenRouter call inside one request.
      const providers = filterKnownVisibilityProviders(body['providers']);
      if (providers.length === 0) providers.push(...DEFAULT_VISIBILITY_PROVIDERS);
      const envLimit = clampDfsLimit(
        Deno.env.get('DATAFORSEO_LLM_MENTIONS_LIMIT') ?? '3',
        3,
      );
      const dfsLimit = clampDfsLimit(body['dfsLimit'], envLimit);
      const matchType =
        body['matchType'] === 'partial_match' ? 'partial_match' : 'word_match';
      const preferBrandSources = body['preferBrandSources'] === true;

      const { data: vq, error: vqe } = await supabaseUser
        .from('visibility_queries')
        .select('*')
        .eq('id', queryId)
        .single();

      if (vqe || !vq) {
        return new Response(JSON.stringify({ error: 'Query not found' }), {
          status: 404,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      const { data: project, error: projErr } = await supabaseUser
        .from('projects')
        .select('*')
        .eq('id', vq.project_id)
        .eq('user_id', user.id)
        .single();

      if (projErr || !project) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      return await executeLlmMentionsRun(
        admin,
        supabaseUser,
        user.id,
        vq as Json,
        project as Json,
        queryId,
        providers,
        dfsLimit,
        matchType,
        preferBrandSources,
        cors,
      );
    }

    if (action === 'run_serp_rank') {
      return await handleRunSerpRank(supabaseUser, admin, user, body, cors);
    }

    if (action === 'enqueue_serp_rank_job') {
      return await handleEnqueueSerpRankJob(supabaseUser, admin, user, body, cors);
    }

    if (action === 'process_serp_rank_job') {
      return await handleProcessSerpRankJob(supabaseUser, admin, user, body, cors);
    }

    if (action === 'scan_project') {
      return await handleScanProject(supabaseUser, admin, user.id, body, cors);
    }

    if (action === 'mine_fanouts') {
      return await handleMineFanouts(supabaseUser, admin, user, body, cors);
    }

    if (action === 'get_source_gaps') {
      return await handleGetSourceGaps(supabaseUser, user, body, cors);
    }

    if (action === 'get_cannibalization') {
      return await handleGetCannibalization(supabaseUser, admin, user, body, cors);
    }

    if (action === 'get_link_intersect') {
      return await handleGetLinkIntersect(supabaseUser, admin, user, body, cors);
    }

    if (action === 'get_content_gap') {
      return await handleGetContentGap(supabaseUser, admin, user, body, cors);
    }

    if (action === 'get_brand_sentiment') {
      return await handleGetBrandSentiment(supabaseUser, admin, user, body, cors);
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    // Log the detail server-side; return a generic message so DB/infra errors don't leak schema
    // or provider details to the client (same pattern as billing functions, PR #81).
    console.error('visibility-ops unhandled error:', e instanceof Error ? e.stack || e.message : String(e));
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});

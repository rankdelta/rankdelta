/**
 * mcp-api — a thin read API for the Rankdelta MCP server (mcp/index.ts). The MCP is just an API
 * client; this Edge Function is the endpoint it talks to for AI-visibility reads.
 *
 * Additive & self-host-first: it does NOT touch any existing function. Auth is a single shared
 * token (Authorization: Bearer <MCP_API_TOKEN>) — simple and correct for a single-tenant self-host
 * instance. Per-user scoping for the multi-tenant cloud is a follow-up; until then, deploy this
 * only where one account owns the data.
 *
 * Secrets: SUPABASE_URL, MCP_API_TOKEN, plus the Supabase secret key resolved by
 * _shared/supabaseKeys.ts (SUPABASE_SECRET_KEYS, falling back to SUPABASE_SERVICE_ROLE_KEY).
 *
 * Hardened (2026-08 audit):
 *  - Token compare is timing-safe (SHA-256 hash-then-compare via WebCrypto) instead of `!==`.
 *  - 500 responses return a generic message; details go to the server log only.
 *
 * Wave-2 item 7 — multi-tenant fail-closed:
 *  - When DEPLOYMENT_MODE=cloud or MCP_MULTI_TENANT=1, the shared-token mode is REFUSED (503)
 *    unless MCP_ALLOW_SHARED_TOKEN=1 is explicitly set. This prevents the known IDOR
 *    (one token reads every project) from silently reaching the multi-tenant cloud.
 *  - Optional MCP_PROJECT_ID_ALLOWLIST (comma-separated UUIDs): when set, /api/sites and all
 *    per-project visibility routes are filtered to those project IDs only — a stop-gap tenant
 *    scoping without the full per-user key redesign (#42 territory).
 *
 * Tables read (schema shared with visibility-ops):
 * projects, visibility_queries(project_id, phrase), visibility_query_runs(query_id, provider,
 * run_at), visibility_brand_mentions(query_run_id, tracked_brand_id, competitor_brand_id,
 * is_recommended), competitor_brands(id, name, project_id).
 *
 * Added CORS origin-echo allowlist for consistency with other
 * Edge Functions. While MCP is typically server-to-server, browser-based UIs may call this
 * endpoint for dashboard displays. Consistent with seo-proxy (#65), create-checkout-session,
 * cancel-subscription, create-portal-session, update-subscription, api-keys, wp-publish.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { secretKey } from '../_shared/supabaseKeys.ts';
import { allowedBrowserOrigins } from '../_shared/appOrigin.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = secretKey();
const MCP_TOKEN = Deno.env.get('MCP_API_TOKEN') ?? '';

const allowedOrigins = allowedBrowserOrigins([]);

const corsHeaders = (req: Request) => {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
  const origin = req.headers.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Vary'] = 'Origin';
  }
  return h;
};

const db = createClient(SUPABASE_URL, SERVICE_KEY);

const json = (body: unknown, status = 200, cors?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...(cors ?? {}), 'Content-Type': 'application/json' } });

/**
 * Timing-safe token check: SHA-256 both sides and compare every digest byte.
 * A plain string `!==` leaks prefix/length info through timing; comparing two
 * fixed-size digests does constant work per attempt regardless of where a
 * mismatch occurs.
 */
async function tokenMatches(presented: string): Promise<boolean> {
  if (!presented) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(presented)),
    crypto.subtle.digest('SHA-256', enc.encode(MCP_TOKEN)),
  ]);
  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

const ENGINES = [
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'perplexity', label: 'Perplexity' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'google_aio', label: 'Google AI Overview' },
];

/** Multi-tenant detection + optional allowlist (wave-2 item 7). */
// Fail CLOSED: treat as multi-tenant (shared-token mode refused) UNLESS this is an explicit
// self-host single-tenant deploy. Previously this defaulted to single-tenant when no env was set,
// so a leaked shared MCP_API_TOKEN could read every tenant's data on cloud.
const IS_SELF_HOST =
  (Deno.env.get('SELF_HOST') ?? '').toLowerCase() === 'true' ||
  (Deno.env.get('DEPLOYMENT_MODE') ?? '').toLowerCase() === 'selfhost';
const IS_MULTI_TENANT =
  !IS_SELF_HOST || (Deno.env.get('MCP_MULTI_TENANT') ?? '').toLowerCase() === '1';
const SHARED_TOKEN_ALLOWED = (Deno.env.get('MCP_ALLOW_SHARED_TOKEN') ?? '').toLowerCase() === '1';
const PROJECT_ALLOWLIST = (Deno.env.get('MCP_PROJECT_ID_ALLOWLIST') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean); // empty = no filtering (self-host default)

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Fail closed on config: unset/short token must never authenticate.
  if (!MCP_TOKEN || MCP_TOKEN.length < 16) return json({ error: 'mcp_not_configured' }, 503, cors);

  // Fail closed on multi-tenant: the shared token exposes EVERY project's data. Refuse unless
  // the operator explicitly accepted the risk via MCP_ALLOW_SHARED_TOKEN=1.
  if (IS_MULTI_TENANT && !SHARED_TOKEN_ALLOWED) {
    return json({ error: 'mcp_shared_token_disabled_multi_tenant' }, 503, cors);
  }

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token || !(await tokenMatches(token))) return json({ error: 'unauthorized' }, 401, cors);

  const rest = new URL(req.url).pathname.split('/mcp-api')[1] || '/';

  // Allowlist enforcement for per-project routes (stop-gap tenant scoping).
  const projectIdAllowed = (projectId: string) =>
    !PROJECT_ALLOWLIST.length || PROJECT_ALLOWLIST.includes(projectId);

  try {
    // GET /api/sites — the tracked projects (allowlist-filtered when configured).
    if (rest === '/api/sites') {
      let query = db.from('projects').select('id, name, website_url').order('created_at', { ascending: false });
      if (PROJECT_ALLOWLIST.length) query = query.in('id', PROJECT_ALLOWLIST);
      const { data, error } = await query;
      if (error) throw error;
      return json(data ?? [], 200, cors);
    }

    // GET /api/visibility/engines
    if (rest === '/api/visibility/engines') return json(ENGINES, 200, cors);

    // GET /api/visibility/sites/:id/dashboard — AI Share of Voice, per engine, last 30 days.
    const dash = rest.match(/^\/api\/visibility\/sites\/([^/]+)\/dashboard$/);
    if (dash) {
      const projectId = dash[1];
      if (!projectIdAllowed(projectId)) return json({ error: 'not found', path: rest }, 404, cors);
      const runs = await runsForProject(projectId);
      const runProvider = new Map(runs.map((r) => [r.id, r.provider]));
      const mentions = await mentionsForRuns([...runProvider.keys()]);

      const per: Record<string, { you: number; comp: number; rec: number }> = {};
      for (const m of mentions) {
        const eng = runProvider.get(m.query_run_id) ?? 'unknown';
        per[eng] ??= { you: 0, comp: 0, rec: 0 };
        if (m.tracked_brand_id) { per[eng].you++; if (m.is_recommended) per[eng].rec++; }
        else if (m.competitor_brand_id) per[eng].comp++;
      }
      const perEngine = Object.entries(per).map(([engine, v]) => ({
        engine, yourMentions: v.you, competitorMentions: v.comp, yourRecommended: v.rec,
        shareOfVoice: v.you + v.comp > 0 ? Math.round((v.you / (v.you + v.comp)) * 1000) / 10 : 0,
      }));
      const you = perEngine.reduce((a, e) => a + e.yourMentions, 0);
      const comp = perEngine.reduce((a, e) => a + e.competitorMentions, 0);
      return json({ overallShareOfVoice: you + comp > 0 ? Math.round((you / (you + comp)) * 1000) / 10 : 0, perEngine }, 200, cors);
    }

    // GET /api/visibility/sites/:id/competitors — who the AI recommends instead, by mention count.
    const comp = rest.match(/^\/api\/visibility\/sites\/([^/]+)\/competitors$/);
    if (comp) {
      const projectId = comp[1];
      if (!projectIdAllowed(projectId)) return json({ error: 'not found', path: rest }, 404, cors);
      const runs = await runsForProject(projectId);
      const mentions = await mentionsForRuns(runs.map((r) => r.id));
      const { data: brands } = await db.from('competitor_brands').select('id, name').eq('project_id', projectId);
      const nameById = new Map((brands ?? []).map((b) => [b.id as string, b.name as string]));
      const tally: Record<string, { mentions: number; recommended: number }> = {};
      for (const m of mentions) {
        if (!m.competitor_brand_id) continue;
        const name = nameById.get(m.competitor_brand_id) ?? 'unknown';
        tally[name] ??= { mentions: 0, recommended: 0 };
        tally[name].mentions++;
        if (m.is_recommended) tally[name].recommended++;
      }
      return json(Object.entries(tally).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.mentions - a.mentions), 200, cors);
    }

    return json({ error: 'not found', path: rest }, 404, cors);
  } catch (e) {
    // Details to the server log only — generic message out so DB/schema internals never leak.
    console.error('mcp-api error:', e instanceof Error ? e.message : String(e), 'path:', rest);
    return json({ error: 'internal error' }, 500, cors);
  }
});

interface Run { id: string; provider: string }
async function runsForProject(projectId: string): Promise<Run[]> {
  const { data: qs } = await db.from('visibility_queries').select('id').eq('project_id', projectId);
  const queryIds = (qs ?? []).map((q) => q.id as string);
  if (!queryIds.length) return [];
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data } = await db.from('visibility_query_runs').select('id, provider').in('query_id', queryIds).gte('run_at', since);
  return (data ?? []) as Run[];
}

interface Mention { query_run_id: string; tracked_brand_id: string | null; competitor_brand_id: string | null; is_recommended: boolean | null }
async function mentionsForRuns(runIds: string[]): Promise<Mention[]> {
  if (!runIds.length) return [];
  const { data } = await db.from('visibility_brand_mentions')
    .select('query_run_id, tracked_brand_id, competitor_brand_id, is_recommended').in('query_run_id', runIds);
  return (data ?? []) as Mention[];
}

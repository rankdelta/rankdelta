/**
 * Personal API keys (sk_rankdelta_…) — generate, hash, resolve Bearer → user_id,
 * plus the tiny admin/JWT helpers the MCP stack needs (avoids pulling in accountBudget).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { secretsMatch } from './secrets.ts';
import { publishableKey, secretKey } from './supabaseKeys.ts';

export type Sb = ReturnType<typeof createClient>;

/**
 * API-key prefixes ACCEPTED on inbound Bearer tokens. Rankdelta rebrand (Phase 0): new keys will
 * carry `sk_rankdelta_`, but existing `sk_astroseo_` keys must keep working forever. Validation
 * accepts ANY prefix in this list. Generation uses API_KEY_PREFIX below (`sk_rankdelta_` since the
 * Phase-1 brand flip). Never remove a prefix once shipped.
 */
export const API_KEY_PREFIXES = ['sk_rankdelta_', 'sk_astroseo_'] as const;

/** The prefix NEW keys are minted with. Flipped to 'sk_rankdelta_' at the Rankdelta cutover (14 Sep 2026); legacy sk_astroseo_ keys stay valid via API_KEY_PREFIXES. */
export const API_KEY_PREFIX = 'sk_rankdelta_';

/** Return the known prefix this token starts with, or null if it matches none. */
export function matchApiKeyPrefix(token: string): string | null {
  return API_KEY_PREFIXES.find((p) => token.startsWith(p)) ?? null;
}

export interface ResolvedApiKey {
  userId: string;
  keyId: string;
}

export function adminClient(): Sb {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = secretKey();
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/** Validate Authorization: Bearer <supabase jwt> → user id (or null). */
export async function userIdFromRequest(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader) return null;
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = publishableKey();
  if (!url || !anonKey) return null;
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/** SHA-256 hex digest of the raw key (Web Crypto — works on Deno edge). */
export async function hashApiKey(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Cryptographically random sk_rankdelta_… secret (shown once to the user). */
export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const body = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${API_KEY_PREFIX}${body}`;
}

/** Display prefix for Settings UI, e.g. sk_astroseo_abcd1234 (works for any accepted prefix). */
export function displayPrefix(raw: string): string {
  const prefix = matchApiKeyPrefix(raw) ?? API_KEY_PREFIX;
  return raw.slice(0, prefix.length + 8);
}

export function extractBearer(req: Request): string {
  return req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
}

/**
 * Resolve a Bearer token that looks like sk_rankdelta_… to { userId, keyId }.
 * Updates last_used_at (best-effort). Returns null if missing/revoked/unknown.
 */
export async function resolvePersonalApiKey(
  admin: Sb,
  token: string,
): Promise<ResolvedApiKey | null> {
  const prefix = matchApiKeyPrefix(token);
  if (!prefix || token.length < prefix.length + 16) {
    return null;
  }
  const keyHash = await hashApiKey(token);
  const { data, error } = await admin
    .from('api_keys')
    .select('id, user_id, revoked_at')
    .eq('key_hash', keyHash)
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;

  // Fire-and-forget, but a bare `void <builder>` never executes (supabase-js builders are lazy
  // thenables) — attach `.then` so the update actually runs, without blocking the auth path.
  void admin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {}, () => {});

  return { userId: data.user_id as string, keyId: data.id as string };
}

export type CallerAuth = {
  userId: string;
  /** Personal API key, Supabase session JWT, or schedule-runner internal secret */
  via: 'api_key' | 'jwt' | 'internal';
  /** Raw bearer — forward to sibling Edge Functions when via=api_key */
  token: string;
};

/**
 * Authenticate either a sk_rankdelta_… personal key or a Supabase user JWT.
 * Used by seo-proxy, visibility-ops, and the hosted MCP so agents and the web app
 * share the same spend gates.
 */
export async function resolveCaller(req: Request): Promise<CallerAuth | null> {
  const token = extractBearer(req);
  if (!token) return null;
  if (matchApiKeyPrefix(token)) {
    const resolved = await resolvePersonalApiKey(adminClient(), token);
    if (!resolved) return null;
    return { userId: resolved.userId, via: 'api_key', token };
  }
  const userId = await userIdFromRequest(req);
  if (!userId) return null;
  return { userId, via: 'jwt', token };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Schedule-runner / cron path: REPORT_SCHEDULE_CRON_SECRET + bill-to user id.
 * Service-role JWTs cannot pass resolveCaller (getUser fails); this bills spend
 * to the schedule owner instead of minting an unscoped service identity.
 */
export function resolveInternalReportCaller(req: Request): CallerAuth | null {
  const expected = Deno.env.get('REPORT_SCHEDULE_CRON_SECRET')
  const presented = req.headers.get('x-report-schedule-cron-secret')
  if (!secretsMatch(presented, expected)) return null
  const userId = req.headers.get('x-report-bill-to-user-id')?.trim() ?? ''
  if (!UUID_RE.test(userId)) return null
  return { userId, via: 'internal', token: extractBearer(req) }
}

/** Paid cloud plans. Not `free`. Agency is billed/unlimited. */
export const PAID_PLANS = ['starter', 'growth', 'pro', 'agency'] as const;
/** Card-backed live access. `trialing` is the billed Starter trial. Not incomplete/canceled. */
export const PAYING_STATUSES = ['active', 'trialing'] as const;

/**
 * Pure entitlement check — no user id allowlist.
 * Paying = plan ∈ starter|growth|pro|agency AND status ∈ active|trialing.
 */
export function isPayingSubscription(
  plan: string | null | undefined,
  status: string | null | undefined,
): boolean {
  const p = String(plan ?? '').toLowerCase();
  const s = String(status ?? '').toLowerCase();
  return (PAID_PLANS as readonly string[]).includes(p) && (PAYING_STATUSES as readonly string[]).includes(s);
}

/**
 * After resolveCaller: refuse free / no-plan / incomplete / canceled accounts so a valid
 * personal key cannot open paid Site Explorer / research spend. Self-host (BYOK) skips.
 * Fail-closed on a missing row or read error.
 */
export async function assertPayingPlan(userId: string): Promise<boolean> {
  if ((Deno.env.get('SELF_HOST') ?? '').toLowerCase() === 'true') return true;
  if (!userId) return false;
  const { data, error } = await adminClient()
    .from('subscriptions')
    .select('plan, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return false;
  if (isPayingSubscription(data.plan as string, data.status as string)) return true;
  return hasOnboardingAllowance(userId, data.status as string);
}

/**
 * Bounded free allowance for accounts that have never paid (signup trigger creates
 * status='incomplete'). Onboarding runs three paid steps (site analysis, competitor discovery,
 * prompt generation + first scan) BEFORE the trial CTA; without this every one of them 402'd and
 * the wizard silently fell back to empty results. The allowance is a hard per-account monthly
 * ceiling on real API spend (default 100 cents, `ONBOARDING_FREE_ALLOWANCE_CENTS` to tune, 0 to
 * disable). Canceled / past-due accounts are NOT eligible — only never-paid ones.
 */
export const ONBOARDING_FREE_ALLOWANCE_CENTS: number = (() => {
  const raw = Number(Deno.env.get('ONBOARDING_FREE_ALLOWANCE_CENTS'));
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 100;
})();

export function isNeverPaidStatus(status: string | null | undefined): boolean {
  return String(status ?? '').toLowerCase() === 'incomplete';
}

export async function hasOnboardingAllowance(userId: string, status: string | null | undefined): Promise<boolean> {
  if (ONBOARDING_FREE_ALLOWANCE_CENTS <= 0 || !isNeverPaidStatus(status)) return false;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data, error } = await adminClient()
    .from('visibility_api_spend_events')
    .select('cost_cents')
    .eq('user_id', userId)
    .gte('created_at', monthStart);
  if (error) return false; // fail closed
  let spent = 0;
  for (const row of (data as Array<{ cost_cents: number | null }>) ?? []) spent += Number(row.cost_cents) || 0;
  return spent < ONBOARDING_FREE_ALLOWANCE_CENTS;
}

export const PLAN_REQUIRED_CODE = 'plan_required';

export function planRequiredResponse(cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: 'Paid plan required', code: PLAN_REQUIRED_CODE }), {
    status: 402,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

const _internalCache = new Map<string, { internal: boolean; ts: number }>();
const INTERNAL_TTL_MS = 5 * 60_000;

/** Internal/owner accounts skip research lookup quota and get a higher (not unlimited) API cap. */
export async function isInternalAccount(userId: string): Promise<boolean> {
  if (!userId) return false;
  const hit = _internalCache.get(userId);
  if (hit && Date.now() - hit.ts < INTERNAL_TTL_MS) return hit.internal;
  let internal = false;
  try {
    const { data, error } = await adminClient()
      .from('subscriptions')
      .select('is_internal')
      .eq('user_id', userId)
      .maybeSingle();
    internal = !error && data?.is_internal === true;
  } catch {
    internal = false;
  }
  _internalCache.set(userId, { internal, ts: Date.now() });
  return internal;
}

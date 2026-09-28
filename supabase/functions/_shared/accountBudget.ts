// deno-lint-ignore-file no-explicit-any
/**
 * accountBudget.ts — ACCOUNT-LEVEL hard spend guardrail, shared by every Edge Function that
 * spends real money on third-party APIs (seo-proxy, visibility-ops).
 *
 * THE RULE (safety-critical): no single account may cost Rankdelta more than
 * ACCOUNT_MONTHLY_HARD_CAP_CENTS of real API spend in a calendar month. This is HARD and DEFAULT —
 * it applies to everyone, always, with no opt-out. It sits ON TOP OF the optional per-project cap
 * (projects.monthly_api_spend_cap_cents), which it does not replace.
 *
 * Design invariants:
 *   • FAIL-CLOSED. If we cannot read the current spend, we BLOCK. A monitoring gap must never
 *     become an unbounded-spend hole.
 *   • Check BEFORE spending (assertAccountBudget with a conservative estimate), log AFTER spending
 *     (logSpend with the real/observed cost, keyed on user_id). Every paid call does both.
 *   • Spend is summed from visibility_api_spend_events by user_id for the current calendar month.
 *     project_id may be NULL (see migration 018) — account-level spend without a project still counts.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isInternalAccount, isPayingSubscription, isNeverPaidStatus, ONBOARDING_FREE_ALLOWANCE_CENTS } from './apiKeys.ts';
import { publishableKey, secretKey } from './supabaseKeys.ts';

export { clampFinalCostCents } from './spendClamp.ts';

/**
 * The single number to tune. €50/month, tracked in USD cents — since USD cents ≥ EUR cents at any
 * realistic FX, 5000 USD-cents is a slightly STRICTER (safer) ceiling than €50. Overridable per
 * environment via the ACCOUNT_MONTHLY_HARD_CAP_CENTS secret without a redeploy. Keep in sync with
 * src/config/costModel.ts ACCOUNT_MONTHLY_HARD_CAP_CENTS (that copy drives the UI display).
 */
export const ACCOUNT_MONTHLY_HARD_CAP_CENTS: number = (() => {
  const raw = Number(Deno.env.get('ACCOUNT_MONTHLY_HARD_CAP_CENTS'));
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5000;
})();

/** Raised cap for subscriptions.is_internal accounts (~€200). Still enforced — not unlimited. */
export const INTERNAL_ACCOUNT_MONTHLY_CAP_CENTS: number = (() => {
  const raw = Number(Deno.env.get('INTERNAL_ACCOUNT_MONTHLY_CAP_CENTS'));
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 20_000;
})();

/**
 * Self-host (BYOK) deployments: the operator pays the providers directly, so the Rankdelta account
 * cap does not apply. Same env flag apiKeys.ts assertPayingPlan() honours.
 */
export function isSelfHost(): boolean {
  return (Deno.env.get('SELF_HOST') ?? '').toLowerCase() === 'true';
}

/** Effectively unlimited cap used when self-hosted (int4 max — reserve_account_spend takes INT). */
export const SELF_HOST_UNLIMITED_CAP_CENTS = 2_147_483_647;

/**
 * Optional per-account monthly cap on a self-host (SELF_HOST_ACCOUNT_MONTHLY_CAP_CENTS, in cents).
 * Unset: unlimited, as before. It bounds what one account can spend on the operator's provider
 * keys; the real protection for an internet-facing instance is turning sign-ups off
 * (SELF_HOSTING.md → Lock down sign-ups).
 */
export function selfHostAccountCapCents(raw: string | undefined = Deno.env.get('SELF_HOST_ACCOUNT_MONTHLY_CAP_CENTS')): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), SELF_HOST_UNLIMITED_CAP_CENTS) : SELF_HOST_UNLIMITED_CAP_CENTS;
}

/** Resolve the monthly spend cap for a user (standard vs internal; self-host: optional cap, else unlimited). */
export async function accountMonthlyCapCents(userId: string): Promise<number> {
  if (isSelfHost()) return selfHostAccountCapCents();
  if (await isInternalAccount(userId)) return INTERNAL_ACCOUNT_MONTHLY_CAP_CENTS;
  // Never-paid accounts (onboarding) are capped at the small free allowance, everyone else who
  // is not on a paying plan gets nothing (assertPayingPlan already refuses them upstream).
  try {
    const { data } = await adminClient()
      .from('subscriptions')
      .select('plan, status')
      .eq('user_id', userId)
      .maybeSingle();
    if (data && !isPayingSubscription(data.plan as string, data.status as string)) {
      return isNeverPaidStatus(data.status as string) ? ONBOARDING_FREE_ALLOWANCE_CENTS : 0;
    }
  } catch {
    /* fall through to the standard cap (fail towards the stricter of the two is not possible here) */
  }
  return ACCOUNT_MONTHLY_HARD_CAP_CENTS;
}

/** Stable machine code + human message returned on a 402 so clients can branch on it. */
export const ACCOUNT_BUDGET_ERROR_CODE = 'account_monthly_cap_reached';
export const ACCOUNT_BUDGET_MESSAGE = 'Monthly API usage limit reached';

export type Sb = ReturnType<typeof createClient>;

/** Service-role client built from the secrets Supabase injects into every Edge Function. */
export function adminClient(): Sb {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = secretKey();
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/**
 * Authenticate the caller from the request's Authorization: Bearer <jwt> header.
 * Returns the user id, or null when the token is missing / anonymous / invalid. Uses the anon
 * client so getUser() validates the JWT signature against the project.
 */
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

/** ISO timestamp for the start of the current calendar month, in UTC. */
export function monthStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** PostgREST caps un-limited selects at 1000 rows — page explicitly so a heavy account can't slip under the cap. */
const SPEND_PAGE_SIZE = 1000;

/**
 * Sum of the account's API spend (cost_cents) for the current calendar month.
 * Uses the service-role client so it sees ALL of the user's rows regardless of RLS/project.
 * Prefers the SQL-side sum (account_spend_cents_since, migration 049); falls back to a paginated
 * client-side sum on older self-host DBs without that RPC.
 * THROWS on any read error — callers must treat a throw as "block" (fail-closed).
 */
export async function accountSpendThisMonthCents(admin: Sb, userId: string): Promise<number> {
  const since = monthStartIso();
  const { data: rpcSum, error: rpcError } = await admin.rpc('account_spend_cents_since', {
    p_user_id: userId,
    p_since: since,
  });
  if (!rpcError) {
    const n = Number(rpcSum);
    if (Number.isFinite(n)) return n;
  }
  // Fallback: paginate the raw events (the RPC is missing on DBs without migration 049).
  let sum = 0;
  for (let from = 0; ; from += SPEND_PAGE_SIZE) {
    const { data, error } = await admin
      .from('visibility_api_spend_events')
      .select('cost_cents')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(from, from + SPEND_PAGE_SIZE - 1);
    if (error) throw new Error(`accountBudget read failed: ${error.message}`);
    const rows = (data as Array<{ cost_cents: number | null }>) ?? [];
    for (const row of rows) {
      sum += Number(row.cost_cents) || 0;
    }
    if (rows.length < SPEND_PAGE_SIZE) break;
  }
  return sum;
}

export interface BudgetCheck {
  allowed: boolean;
  spentCents: number;
  capCents: number;
  addCents: number;
  reason?: string;
  eventId?: string;
}

/**
 * Decide whether `addCents` of new spend is permitted for this account right now.
 * FAIL-CLOSED: if the current spend cannot be read, returns allowed=false. Callers MUST NOT spend
 * when allowed is false.
 */
export async function assertAccountBudget(
  admin: Sb,
  userId: string,
  addCents: number,
): Promise<BudgetCheck> {
  const cap = await accountMonthlyCapCents(userId);
  const add = Math.max(0, Math.round(addCents) || 0);
  let spent: number;
  try {
    spent = await accountSpendThisMonthCents(admin, userId);
  } catch (_e) {
    // Fail closed: we could not verify spend, so we refuse rather than risk an unbounded call.
    return { allowed: false, spentCents: cap, capCents: cap, addCents: add, reason: 'budget_read_failed' };
  }
  if (spent + add > cap) {
    return { allowed: false, spentCents: spent, capCents: cap, addCents: add, reason: ACCOUNT_BUDGET_ERROR_CODE };
  }
  return { allowed: true, spentCents: spent, capCents: cap, addCents: add };
}

/**
 * Atomically reserve account spend (check + insert in one DB transaction) — closes the seo-proxy
 * TOCTOU between assertAccountBudget and logSpend. Returns eventId when allowed.
 */
export async function reserveAccountSpend(
  admin: Sb,
  userId: string,
  addCents: number,
  action: string,
  metadata?: Record<string, unknown>,
  provider?: string | null,
): Promise<BudgetCheck> {
  const cap = await accountMonthlyCapCents(userId);
  const add = Math.max(0, Math.round(addCents) || 0);
  try {
    const { data, error } = await admin.rpc('reserve_account_spend', {
      p_user_id: userId,
      p_cost_cents: add,
      p_cap_cents: cap,
      p_action: action,
      p_provider: provider ?? null,
      p_metadata: metadata ?? {},
    });
    if (error) {
      return { allowed: false, spentCents: cap, capCents: cap, addCents: add, reason: 'budget_read_failed' };
    }
    const out = data as { allowed?: boolean; spent_cents?: number; cap_cents?: number; reason?: string; event_id?: string };
    if (!out?.allowed) {
      return {
        allowed: false,
        spentCents: Number(out.spent_cents) || cap,
        capCents: Number(out.cap_cents) || cap,
        addCents: add,
        reason: out.reason ?? ACCOUNT_BUDGET_ERROR_CODE,
      };
    }
    return {
      allowed: true,
      spentCents: Number(out.spent_cents) || 0,
      capCents: Number(out.cap_cents) || cap,
      addCents: add,
      eventId: typeof out.event_id === 'string' ? out.event_id : undefined,
    };
  } catch (_e) {
    return { allowed: false, spentCents: cap, capCents: cap, addCents: add, reason: 'budget_read_failed' };
  }
}

export async function finalizeAccountSpend(
  admin: Sb,
  eventId: string | undefined,
  costCents: number,
  costUsd?: number,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (!eventId) return;
  try {
    await admin.rpc('finalize_account_spend', {
      p_event_id: eventId,
      p_cost_cents: Math.max(0, Math.round(costCents) || 0),
      p_cost_usd: costUsd ?? null,
      p_metadata: metadata ?? null,
    });
  } catch (e) {
    console.error('accountBudget.finalizeAccountSpend threw:', e instanceof Error ? e.message : String(e));
  }
}

export async function releaseAccountSpend(admin: Sb, eventId: string | undefined): Promise<void> {
  if (!eventId) return;
  try {
    await admin.rpc('release_account_spend', { p_event_id: eventId });
  } catch (e) {
    console.error('accountBudget.releaseAccountSpend threw:', e instanceof Error ? e.message : String(e));
  }
}

/** Build the standard 402 Response for a blocked call. */
export function budgetBlockedResponse(check: BudgetCheck, corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      error: ACCOUNT_BUDGET_MESSAGE,
      code: ACCOUNT_BUDGET_ERROR_CODE,
      spent_cents: check.spentCents,
      cap_cents: check.capCents,
    }),
    { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

/**
 * Record spend AFTER a paid call. Best-effort by design: a logging failure must never break the
 * user's request — but note that unlogged spend is invisible to the cap, so failures are surfaced
 * to the function logs for monitoring. project_id may be null for account-level (project-less) spend.
 */
export async function logSpend(
  admin: Sb,
  args: {
    userId: string;
    projectId?: string | null;
    provider?: string | null;
    action: string;
    costCents: number;
    costUsd?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    // The service-role client is untyped (no generated Database types in Deno), so `.from().insert()`
    // infers `never` for the row. Cast the builder to keep the insert while staying type-safe elsewhere.
    const { error } = await (admin.from('visibility_api_spend_events') as any).insert({
      project_id: args.projectId ?? null,
      user_id: args.userId,
      provider: args.provider ?? null,
      action: args.action,
      cost_cents: Math.max(0, Math.round(args.costCents) || 0),
      cost_usd: args.costUsd ?? null,
      metadata: args.metadata ?? {},
    });
    if (error) console.error('accountBudget.logSpend insert error:', error.message);
  } catch (e) {
    console.error('accountBudget.logSpend threw:', e instanceof Error ? e.message : String(e));
  }
}

// ── Cost estimation ──────────────────────────────────────────────────────────
// Pre-call estimates are deliberately conservative (over- rather than under-estimate) so the cap
// can never be blown between the check and the log. Post-call costs use the provider's reported
// figures when available.

/** Blended USD per 1M tokens by model family — high side, for a safety cap. */
function llmRatePerMTokens(model: string): number {
  const m = (model || '').toLowerCase();
  if (m.includes('gpt-4o-mini') || m.includes('mini')) return 0.6;
  if (m.includes('gpt-4o') || m.includes('gpt-4')) return 10;
  if (m.includes('kimi')) return 2.5;
  if (m.includes('sonar') || m.includes('perplexity')) return 3;
  if (m.includes('gemini')) return 0.5;
  if (m.includes('claude') || m.includes('sonnet') || m.includes('opus')) return 12;
  return 6; // unknown model → conservative default
}

/** Conservative pre-call estimate (cents) for an LLM chat completion from its request body. */
export function estimateLlmCostCents(body: { model?: string; max_tokens?: number; messages?: unknown[] }): number {
  const rate = llmRatePerMTokens(typeof body?.model === 'string' ? body.model : '');
  const maxOut = typeof body?.max_tokens === 'number' && body.max_tokens > 0 ? body.max_tokens : 4096;
  // Assume prompt roughly as large as a full context window slice; add the max output. Over-estimate.
  const promptGuess = 6000;
  const totalTokens = promptGuess + maxOut;
  const usd = (totalTokens / 1_000_000) * rate;
  return Math.max(1, Math.ceil(usd * 100));
}

/** Post-call LLM cost (cents) from the provider's usage block; falls back to the pre-estimate. */
export function llmCostCentsFromResponse(
  data: any,
  body: { model?: string; max_tokens?: number },
): number {
  const usage = data?.usage;
  const total = Number(usage?.total_tokens);
  if (Number.isFinite(total) && total > 0) {
    const rate = llmRatePerMTokens(typeof body?.model === 'string' ? body.model : '');
    return Math.max(1, Math.ceil((total / 1_000_000) * rate * 100));
  }
  return estimateLlmCostCents(body);
}

/** Conservative pre-call estimate (cents) for a DataForSEO task before the real cost is known. */
export const DATAFORSEO_PRECHECK_CENTS = 10;

/** Post-call DataForSEO cost (cents) from the response's reported `cost` (USD), top-level or per-task. */
export function dataForSeoCostCentsFromResponse(data: any): number {
  const taskCost = Array.isArray(data?.tasks) ? Number(data.tasks[0]?.cost) : NaN;
  const topCost = Number(data?.cost);
  const usd = Number.isFinite(taskCost) && taskCost > 0
    ? taskCost
    : Number.isFinite(topCost) && topCost > 0
      ? topCost
      : 0;
  // Always attribute at least 1 cent so a mis-reported $0 call still shows up against the cap.
  return Math.max(1, Math.round(usd * 100));
}

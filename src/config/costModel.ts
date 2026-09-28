/**
 * costModel.ts — per-action API unit costs and the per-account hard spend cap.
 *
 * All figures USD. Unit costs are estimates; real spend is recorded in
 * `visibility_api_spend_events`.
 */

// ─── Account-level hard spend cap (SAFETY) ────────────────────────────────────
/**
 * Hard ceiling on real API spend PER ACCOUNT PER CALENDAR MONTH, in USD cents. Enforced
 * server-side, fail-closed, on every paid call (see supabase/functions/_shared/accountBudget.ts,
 * which mirrors this value and can override it via the ACCOUNT_MONTHLY_HARD_CAP_CENTS secret).
 * This copy is the UI-facing source of truth for the "€X / €50" usage display. €50, tracked in
 * USD cents: since USD cents ≥ EUR cents, 5000 is a slightly stricter ceiling than €50.
 */
export const ACCOUNT_MONTHLY_HARD_CAP_CENTS = 5000

// ─── Per-unit API cost (USD) ──────────────────────────────────────────────────
export const UNIT_COST_USD = {
  /** Full article pipeline: body+expand+framework, proofread+meta, sources, fact-check, DataForSEO SERP+kw. */
  article: 0.085,
  /** One visibility check = 1 prompt × 1 engine, via OpenRouter. */
  visibilityTask: 0.01,
  /** One DataForSEO SERP Google-organic rank check (1 keyword). */
  serpRankCheck: 0.002,
  /** One research "lookup" = one DataForSEO call from Site Explorer / Keyword Research / Bulk. */
  researchLookup: 0.03,
} as const

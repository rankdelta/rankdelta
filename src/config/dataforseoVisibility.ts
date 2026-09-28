/**
 * DataForSEO LLM Mentions Search Live — cost & request tuning.
 * @see https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/search/live/
 * @see https://dataforseo.com/pricing/ai-optimization/llm-mentions
 *
 * Billing combines a base task fee and per-row pricing; fewer `limit` rows = lower cost.
 * Verify live rates in your DataForSEO dashboard; tune env on the Edge Function if needed.
 */
export const DATAFORSEO_DOCS_LLM_SEARCH =
	'https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/search/live/';

/** Suggested default rows per task (we only need the first answer + sources for visibility). */
export const DFS_LLM_MENTIONS_LIMIT_DEFAULT = 3;

/** Up to 1000 per DataForSEO docs; higher rows increase cost. */
export const DFS_LLM_MENTIONS_LIMIT_OPTIONS = [1, 3, 5, 10, 15, 20, 50] as const;

/** Max Google SERP checks per Edge invocation batch (keyword rows). */
export const VISIBILITY_SERP_BATCH_MAX_KEYWORDS = 12;

export const VISIBILITY_SERP_BATCH_DELAY_MS = 500;

/**
 * Conservative USD ceiling for pre-flight cap checks (one provider = one task).
 * Override with Edge secret DATAFORSEO_ESTIMATE_MAX_USD_PER_TASK if your account differs.
 */
export const DFS_ESTIMATE_MAX_USD_PER_TASK = 0.15;

/** Max prompts per "Run selected" batch (client-side sequential calls; respects Edge cap each time). */
export const VISIBILITY_BATCH_MAX_QUERIES = 20;

/** Pause between batch runs to stay under DataForSEO rate limits (~2000/min; sequential is safe). */
export const VISIBILITY_BATCH_DELAY_MS = 450;

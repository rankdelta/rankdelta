/**
 * Narrative grounding: every number cited in the LLM narrative must exist in the assembled data JSON.
 */

/** Extract numeric literals from text (integers and decimals). */
export function extractNumbersFromText(text: string): number[] {
  const matches = text.match(/-?\d+(?:\.\d+)?/g) ?? [];
  return matches.map((m) => Number(m)).filter((n) => Number.isFinite(n));
}

/** Recursively collect all finite numbers from a JSON value. */
export function collectNumbersFromData(value: unknown, out: Set<number> = new Set()): Set<number> {
  if (value == null) return out;
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.add(value);
    // Also store rounded forms for float tolerance
    out.add(Math.round(value * 10) / 10);
    out.add(Math.round(value));
    return out;
  }
  if (typeof value === 'string') {
    for (const n of extractNumbersFromText(value)) out.add(n);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumbersFromData(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectNumbersFromData(v, out);
    }
  }
  return out;
}

/** Numbers that are structural (years, small ordinals) and should not require grounding. */
const EXEMPT_NUMBERS = new Set([0, 1, 2, 3, 4, 5, 7, 14, 28, 90, 100, 2024, 2025, 2026]);

export interface NarrativeGroundingResult {
  grounded: boolean;
  ungrounded: number[];
}

/**
 * Verify every number in the narrative JSON exists in the data JSON.
 * Skips exempt structural constants and null narrative.
 */
export function checkNarrativeGrounding(
  narrative: unknown,
  data: unknown,
  opts?: { exempt?: Set<number> },
): NarrativeGroundingResult {
  const exempt = opts?.exempt ?? EXEMPT_NUMBERS;
  const allowed = collectNumbersFromData(data);
  const narrativeNums = collectNumbersFromData(narrative);
  const ungrounded: number[] = [];

  for (const n of narrativeNums) {
    if (exempt.has(n)) continue;
    if (allowed.has(n)) continue;
    // Tolerance for rounded percentages (e.g. narrative says 12.5, data has 12.48)
    const rounded = Math.round(n * 10) / 10;
    if (allowed.has(rounded) || allowed.has(Math.round(n))) continue;
    ungrounded.push(n);
  }

  return { grounded: ungrounded.length === 0, ungrounded };
}

export interface ReportNarrative {
  executiveSummary: string;
  sections: Record<string, string>;
  nextActions: string[];
  locale?: string;
}

/**
 * Parse an LLM narrative completion into a JSON object.
 *
 * Narrative models (e.g. kimi-k2) frequently wrap their JSON in a ```json … ```
 * markdown fence and/or add surrounding prose. A raw JSON.parse then throws and
 * the entire completion — fence and all — gets dumped verbatim into the report's
 * executive summary. Strip the fence, fall back to the outermost { … } span, and
 * only then parse. Returns null when no JSON object can be recovered.
 *
 * Mirrors parseNarrativeContent in supabase/functions/_shared/reportBuild.ts.
 */
export function parseNarrativeContent(content: unknown): Record<string, unknown> | null {
  if (typeof content !== 'string') return null;
  let s = content.trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const inner = fenced?.[1];
  if (inner !== undefined) s = inner.trim();
  if (!s.startsWith('{')) {
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last > first) s = s.slice(first, last + 1);
  }
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export const NARRATIVE_LLM_MAX_ATTEMPTS = 2;
export const NARRATIVE_LLM_TIMEOUT_MS = 30_000;
const NARRATIVE_LLM_RETRY_BACKOFF_MS = 750;

export type NarrativeLlmFailureReason =
  | 'llm_http_error'
  | 'missing_content'
  | 'unparseable_narrative'
  | 'empty_executive_summary'
  | 'fetch_error'
  | 'timeout';

export function isEmptyExecutiveSummary(parsed: Record<string, unknown>): boolean {
  const summary = parsed['executiveSummary'];
  return typeof summary !== 'string' || summary.trim().length === 0;
}

export function classifyNarrativeLlmResponse(
  res: Response,
  llmBody: unknown,
): { ok: true; parsed: Record<string, unknown> } | { ok: false; reason: NarrativeLlmFailureReason } {
  if (!res.ok) return { ok: false, reason: 'llm_http_error' };

  const content = (llmBody as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message
    ?.content;
  if (typeof content !== 'string') return { ok: false, reason: 'missing_content' };

  const parsed = parseNarrativeContent(content);
  if (!parsed) return { ok: false, reason: 'unparseable_narrative' };
  if (isEmptyExecutiveSummary(parsed)) return { ok: false, reason: 'empty_executive_summary' };

  return { ok: true, parsed };
}

export interface NarrativeLlmRequest {
  supabaseUrl: string;
  headers: Record<string, string>;
  systemPrompt: string;
  userPrompt: string;
}

export interface NarrativeLlmRetryDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  timeoutMs?: number;
  backoffMs?: number;
  logPrefix?: string;
}

/** Mirrors fetchNarrativeWithRetries in supabase/functions/_shared/reportBuild.ts. */
export async function fetchNarrativeWithRetries(
  request: NarrativeLlmRequest,
  deps: NarrativeLlmRetryDeps = {},
): Promise<
  | { ok: true; parsed: Record<string, unknown> }
  | { ok: false; reason: NarrativeLlmFailureReason }
> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = deps.maxAttempts ?? NARRATIVE_LLM_MAX_ATTEMPTS;
  const timeoutMs = deps.timeoutMs ?? NARRATIVE_LLM_TIMEOUT_MS;
  const backoffMs = deps.backoffMs ?? NARRATIVE_LLM_RETRY_BACKOFF_MS;

  const url = `${request.supabaseUrl}/functions/v1/seo-proxy`;
  const body = JSON.stringify({
    action: 'llm',
    model: 'moonshotai/kimi-k2',
    temperature: 0.3,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userPrompt },
    ],
  });

  let lastReason: NarrativeLlmFailureReason = 'fetch_error';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          ...request.headers,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      });

      const llmBody = await res.json().catch(() => ({}));
      const classified = classifyNarrativeLlmResponse(res, llmBody);
      if (classified.ok) return classified;

      lastReason = classified.reason;
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      lastReason = isTimeout ? 'timeout' : 'fetch_error';
    } finally {
      clearTimeout(timeoutId);
    }

    if (attempt < maxAttempts) {
      await sleep(backoffMs * attempt);
    }
  }

  return { ok: false, reason: lastReason };
}

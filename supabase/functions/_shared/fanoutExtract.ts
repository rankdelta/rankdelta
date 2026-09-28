/**
 * fanoutExtract — pull candidate sub-questions from ALREADY-STORED visibility payloads.
 *
 * Sources (all zero-cost except an optional later LLM parse of answer_text):
 *   1. DataForSEO Google SERP `people_also_ask` / `related_searches` blocks on raw_response
 *      (google_aio runs persist the full SERP envelope; PAA titles are present without a
 *      new API call even when click-depth was not expanded).
 *   2. Explicit "?" questions already written in answer_text (ChatGPT / Perplexity / Gemini).
 *   3. Questions parsed from a cheap structured-extraction LLM response (caller makes the
 *      call; this module only validates / dedupes the JSON). Never invents questions.
 *
 * No Deno/Node APIs — same module is unit-tested from vitest.
 */

export const FANOUT_SOURCES = [
  'people_also_ask',
  'related_searches',
  'people_also_search',
  'ai_overview_related',
  'answer_explicit',
  'llm_extract',
] as const;

export type FanoutSource = (typeof FANOUT_SOURCES)[number];

export interface FanoutCandidate {
  question: string;
  source: FanoutSource;
}

export interface FanoutRow {
  query_id: string;
  engine: string;
  question: string;
  source: FanoutSource;
}

/** gpt-4o-mini OpenRouter list prices (USD / 1M tokens). Used only for the hard cap check. */
export const FANOUT_LLM_RATES = { inPerM: 0.15, outPerM: 0.6 };
export const FANOUT_MAX_INPUT_TOKENS = 4000;
export const FANOUT_MAX_OUTPUT_TOKENS = 400;
export const FANOUT_COST_CAP_USD = 0.02;
export const FANOUT_MAX_ANSWER_CHARS = 12_000;
export const FANOUT_MAX_PER_ENGINE = 20;

const MIN_Q = 8;
const MAX_Q = 240;

export function normalizeFanoutQuestion(raw: string): string {
  return String(raw ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fanoutDedupeKey(raw: string): string {
  return normalizeFanoutQuestion(raw)
    .toLowerCase()
    .replace(/[¿?]+$/g, '')
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isPlausibleFanoutQuestion(raw: string): boolean {
  const q = normalizeFanoutQuestion(raw);
  if (q.length < MIN_Q || q.length > MAX_Q) return false;
  // Must look like a question or a short search-style subquery, not a paragraph.
  const words = q.split(' ').length;
  if (words < 2 || words > 32) return false;
  if (/https?:\/\//i.test(q)) return false;
  return true;
}

export function estimateFanoutLlmCostUsd(
  inputTokens = FANOUT_MAX_INPUT_TOKENS,
  outputTokens = FANOUT_MAX_OUTPUT_TOKENS,
): number {
  return (inputTokens * FANOUT_LLM_RATES.inPerM + outputTokens * FANOUT_LLM_RATES.outPerM) / 1_000_000;
}

export function fanoutLlmWithinCap(estimateUsd = estimateFanoutLlmCostUsd()): boolean {
  return estimateUsd <= FANOUT_COST_CAP_USD;
}

function pushCandidate(out: FanoutCandidate[], question: unknown, source: FanoutSource) {
  if (typeof question !== 'string') return;
  const q = normalizeFanoutQuestion(question);
  if (!isPlausibleFanoutQuestion(q)) return;
  out.push({ question: q, source });
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Walk any JSON tree and collect objects (used to find SERP feature blocks regardless of envelope). */
function walkObjects(node: unknown, visit: (obj: Record<string, unknown>) => void, seen = new Set<unknown>()) {
  if (node == null || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const el of node) walkObjects(el, visit, seen);
    return;
  }
  const obj = node as Record<string, unknown>;
  visit(obj);
  for (const v of Object.values(obj)) walkObjects(v, visit, seen);
}

function extractFromSerpBlock(block: Record<string, unknown>, source: FanoutSource, out: FanoutCandidate[]) {
  const items = Array.isArray(block['items']) ? (block['items'] as unknown[]) : [];
  if (items.length === 0 && typeof block['title'] === 'string') {
    pushCandidate(out, block['title'], source);
  }
  for (const it of items) {
    if (typeof it === 'string') {
      pushCandidate(out, it, source);
      continue;
    }
    const rec = asRecord(it);
    if (!rec) continue;
    pushCandidate(out, rec['title'] ?? rec['question'] ?? rec['query'] ?? rec['keyword'], source);
  }
}

/**
 * Extract PAA / related-search / AIO-related questions from a stored raw_response.
 * Returns [] when the payload has no such blocks — never fabricates.
 */
export function extractStructuralFanouts(rawResponse: unknown): FanoutCandidate[] {
  if (rawResponse == null) return [];
  const out: FanoutCandidate[] = [];

  walkObjects(rawResponse, (obj) => {
    const type = typeof obj['type'] === 'string' ? obj['type'] : '';
    if (type === 'people_also_ask' || type === 'people_also_ask_element') {
      extractFromSerpBlock(obj, 'people_also_ask', out);
    } else if (type === 'related_searches' || type === 'related_searches_element') {
      extractFromSerpBlock(obj, 'related_searches', out);
    } else if (type === 'people_also_search' || type === 'people_also_search_element') {
      extractFromSerpBlock(obj, 'people_also_search', out);
    } else if (type === 'ai_overview') {
      // Only take nested question-like titles, never the overview body paragraphs.
      const items = Array.isArray(obj['items']) ? (obj['items'] as unknown[]) : [];
      for (const it of items) {
        const rec = asRecord(it);
        if (!rec) continue;
        const nestedType = typeof rec['type'] === 'string' ? rec['type'] : '';
        if (nestedType === 'people_also_ask' || nestedType === 'people_also_ask_element') {
          extractFromSerpBlock(rec, 'people_also_ask', out);
        }
        const title = rec['title'];
        if (typeof title === 'string' && title.includes('?')) {
          pushCandidate(out, title, 'ai_overview_related');
        }
      }
    }
  });

  return dedupeFanouts(out);
}

/**
 * Pull questions the stored answer already wrote (trailing "?"). Zero cost, no invention.
 */
export function extractExplicitQuestions(answerText: string | null | undefined): FanoutCandidate[] {
  const text = String(answerText ?? '');
  if (!text.trim()) return [];
  const out: FanoutCandidate[] = [];
  const chunks = text.split(/\n+/);
  for (const chunk of chunks) {
    const line = chunk.replace(/^\s*(?:#{1,6}\s*|[-*•]\s*|\d+[.)]\s*)/, '').trim();
    if (line.includes('?')) {
      const parts = line.split(/(?<=\?)/);
      for (const part of parts) {
        const q = normalizeFanoutQuestion(part);
        if (q.includes('?')) pushCandidate(out, q, 'answer_explicit');
      }
    }
  }
  return dedupeFanouts(out);
}

/**
 * Parse a cheap structured-extraction model response. Rejects anything that isn't a
 * JSON object with a questions[] of strings. Does not invent a fallback list.
 */
export function parseLlmFanoutContent(content: string | null | undefined): FanoutCandidate[] {
  if (!content || !String(content).trim()) return [];
  const stripped = String(content)
    .replace(/```json\n?|\n?```/g, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  const obj = asRecord(parsed);
  const rawList = obj?.['questions'];
  if (!Array.isArray(rawList)) return [];
  const out: FanoutCandidate[] = [];
  for (const q of rawList) {
    if (typeof q === 'string') pushCandidate(out, q, 'llm_extract');
  }
  return dedupeFanouts(out);
}

export function dedupeFanouts(candidates: FanoutCandidate[], parentQuery?: string): FanoutCandidate[] {
  const seen = new Set<string>();
  const parentKey = parentQuery ? fanoutDedupeKey(parentQuery) : '';
  const out: FanoutCandidate[] = [];
  for (const c of candidates) {
    const q = normalizeFanoutQuestion(c.question);
    if (!isPlausibleFanoutQuestion(q)) continue;
    const key = fanoutDedupeKey(q);
    if (!key || seen.has(key)) continue;
    if (parentKey && key === parentKey) continue;
    seen.add(key);
    out.push({ question: q, source: c.source });
  }
  return out;
}

/** Compose stored-payload fanouts + optional LLM extracts, cap per engine. */
export function collectFanoutsForRun(input: {
  queryId: string;
  engine: string;
  rawResponse?: unknown;
  answerText?: string | null;
  parentQuery?: string;
  llmQuestions?: FanoutCandidate[];
}): FanoutRow[] {
  const merged = dedupeFanouts(
    [
      ...extractStructuralFanouts(input.rawResponse),
      ...extractExplicitQuestions(input.answerText),
      ...(input.llmQuestions ?? []),
    ],
    input.parentQuery,
  );
  return merged.slice(0, FANOUT_MAX_PER_ENGINE).map((c) => ({
    query_id: input.queryId,
    engine: input.engine,
    question: c.question,
    source: c.source,
  }));
}

export const FANOUT_LLM_SYSTEM = `You extract follow-up search questions that are already present or clearly answered in the text.
Return ONLY JSON: {"questions":["..."]}
Rules:
- Copy or lightly rephrase questions the text poses or answers. Do not invent new topics.
- If the text has no extractable questions, return {"questions":[]}.
- Maximum 8 short questions. No markdown.`;

export function buildFanoutLlmUserPrompt(queryText: string, answerText: string): string {
  const clipped = answerText.length > FANOUT_MAX_ANSWER_CHARS
    ? `${answerText.slice(0, FANOUT_MAX_ANSWER_CHARS)}\n…`
    : answerText;
  return `Parent query: ${queryText}\n\nStored answer:\n${clipped}`;
}

/**
 * brandSentiment — classify stored visibility answer_text as pos/neg/neu.
 *
 * Pure helpers (no Deno/fetch) so vitest can import this file.
 * Paid LLM calls are made only by the Edge handler when classify=true and dry_run is false.
 */
export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export type BrandSentimentLabel = (typeof SENTIMENTS)[number];

/** gpt-4o-mini OpenRouter list prices (USD / 1M tokens). */
export const BRAND_SENTIMENT_RATES = { inPerM: 0.15, outPerM: 0.6 };
export const BRAND_SENTIMENT_MAX_INPUT_TOKENS = 1500;
export const BRAND_SENTIMENT_MAX_OUTPUT_TOKENS = 200;
export const BRAND_SENTIMENT_COST_CAP_USD = 0.05;
export const BRAND_SENTIMENT_MAX_ANSWER_CHARS = 4000;
export const BRAND_SENTIMENT_MAX_ANSWERS = 40;
/** Below this many brand-mentioning answers we refuse to invent percentages. */
export const BRAND_SENTIMENT_MIN_ANSWERS = 3;

export interface TrackedBrandInput {
  name: string;
  aliases?: string[] | null;
}

export interface StoredAnswerInput {
  run_id: string;
  engine: string;
  answer_text: string | null;
  run_at: string;
}

export interface SentimentClassification {
  run_id: string;
  engine: string;
  brand_name: string;
  sentiment: BrandSentimentLabel;
  accuracy: number;
}

export interface EngineSentimentRollup {
  engine: string;
  answers: number;
  classified: number;
  positive: number;
  negative: number;
  neutral: number;
  avg_accuracy: number;
}

export function foldForSentiment(input: string): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function brandNamesOf(brand: TrackedBrandInput): string[] {
  return [brand.name, ...(brand.aliases ?? [])].filter((n): n is string => !!n && n.trim().length >= 2);
}

export function answerMentionsBrand(answerText: string | null | undefined, brand: TrackedBrandInput): boolean {
  const folded = foldForSentiment(answerText ?? '');
  if (!folded) return false;
  return brandNamesOf(brand).some((n) => folded.includes(foldForSentiment(n)));
}

export function answersMentioningAnyBrand(
  answers: StoredAnswerInput[],
  brands: TrackedBrandInput[],
): StoredAnswerInput[] {
  return answers.filter((a) => brands.some((b) => answerMentionsBrand(a.answer_text, b)));
}

export function estimateBrandSentimentCostUsd(
  inputTokens = BRAND_SENTIMENT_MAX_INPUT_TOKENS,
  outputTokens = BRAND_SENTIMENT_MAX_OUTPUT_TOKENS,
): number {
  return (inputTokens * BRAND_SENTIMENT_RATES.inPerM + outputTokens * BRAND_SENTIMENT_RATES.outPerM) / 1_000_000;
}

export function brandSentimentWithinCap(
  alreadyUsd: number,
  nextEstimateUsd: number,
  capUsd = BRAND_SENTIMENT_COST_CAP_USD,
): boolean {
  return alreadyUsd + nextEstimateUsd <= capUsd + 1e-9;
}

export function clampDays(raw: unknown, fallback = 30): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(180, Math.max(1, n));
}

export function clampAccuracy(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

export function parseSentimentLabel(raw: unknown): BrandSentimentLabel | null {
  const s = String(raw ?? '').toLowerCase().trim();
  if (s === 'positive' || s === 'pos' || s === 'positivo') return 'positive';
  if (s === 'negative' || s === 'neg' || s === 'negativo') return 'negative';
  if (s === 'neutral' || s === 'neu' || s === 'neutro') return 'neutral';
  return null;
}

/**
 * Parse a cheap structured-extraction model response.
 * Accepts {"sentiment":"positive","accuracy":0.8} or {"items":[{brand,sentiment,accuracy}]}.
 * Garbage / missing JSON → [].
 */
export function parseBrandSentimentContent(
  content: string | null | undefined,
  fallbackBrand: string,
): Array<{ brand_name: string; sentiment: BrandSentimentLabel; accuracy: number }> {
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
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const obj = parsed as Record<string, unknown>;
  const items = Array.isArray(obj['items']) ? obj['items'] : [obj];
  const out: Array<{ brand_name: string; sentiment: BrandSentimentLabel; accuracy: number }> = [];
  for (const it of items) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
    const row = it as Record<string, unknown>;
    const sentiment = parseSentimentLabel(row['sentiment']);
    if (!sentiment) continue;
    const brand = String(row['brand'] ?? row['brand_name'] ?? fallbackBrand).trim() || fallbackBrand;
    out.push({
      brand_name: brand,
      sentiment,
      accuracy: clampAccuracy(row['accuracy'] ?? row['confidence']),
    });
  }
  return out;
}

export function aggregateByEngine(rows: SentimentClassification[]): EngineSentimentRollup[] {
  const by = new Map<string, SentimentClassification[]>();
  for (const r of rows) {
    const list = by.get(r.engine) ?? [];
    list.push(r);
    by.set(r.engine, list);
  }
  const engines = [...by.keys()].sort();
  return engines.map((engine) => {
    const list = by.get(engine) ?? [];
    const n = list.length;
    const pos = list.filter((x) => x.sentiment === 'positive').length;
    const neg = list.filter((x) => x.sentiment === 'negative').length;
    const neu = list.filter((x) => x.sentiment === 'neutral').length;
    const acc = list.reduce((s, x) => s + x.accuracy, 0);
    const answers = new Set(list.map((x) => x.run_id)).size;
    return {
      engine,
      answers,
      classified: n,
      positive: n ? Math.round((pos / n) * 1000) / 1000 : 0,
      negative: n ? Math.round((neg / n) * 1000) / 1000 : 0,
      neutral: n ? Math.round((neu / n) * 1000) / 1000 : 0,
      avg_accuracy: n ? Math.round((acc / n) * 1000) / 1000 : 0,
    };
  });
}

export function insufficientDataPayload(siteId: string, days: number, classifiable: number) {
  return {
    ok: true,
    status: 'insufficient_data' as const,
    site_id: siteId,
    days,
    classifiable_answers: classifiable,
    min_answers: BRAND_SENTIMENT_MIN_ANSWERS,
    cost_usd: 0,
    executed: false,
    per_engine: [] as EngineSentimentRollup[],
    message:
      'Too few stored brand mentions in this window to report sentiment percentages. Run more visibility scans, then retry.',
  };
}

export const BRAND_SENTIMENT_SYSTEM = `You classify how an AI answer talks about a brand.
Return ONLY JSON: {"sentiment":"positive"|"neutral"|"negative","accuracy":0.0}
Rules:
- positive: recommends, praises, or prefers the brand.
- negative: warns against, criticizes, or prefers alternatives over the brand.
- neutral: mentions the brand without a clear stance.
- accuracy is your confidence 0–1.
- Do not invent brands. If the brand is not actually discussed, return {"sentiment":"neutral","accuracy":0.2}.`;

export function buildBrandSentimentUserPrompt(brandName: string, answerText: string): string {
  const clipped = answerText.length > BRAND_SENTIMENT_MAX_ANSWER_CHARS
    ? `${answerText.slice(0, BRAND_SENTIMENT_MAX_ANSWER_CHARS)}\n…`
    : answerText;
  return `Brand: ${brandName}\n\nStored AI answer:\n${clipped}`;
}

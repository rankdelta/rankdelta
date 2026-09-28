/**
 * Visibility query generation — pure prompts, validation, and batching helpers.
 *
 * Share of Voice requires BRAND-ELICITING prompts (recommendation/list/comparison queries
 * where LLMs name brands). Informative how-to prompts structurally yield 0% SoV even with
 * perfect detection. No Deno APIs — vitest imports from src/lib/.
 */

import { buildCategorySeeds, type ProjectCategorySignals } from './category_seeds.ts';

export type QueryIntentType = 'brand' | 'category' | 'comparison' | 'use_case' | 'problem';

export type GeneratedQuery = { text: string; intent_type: QueryIntentType };

export type QueryGenProjectContext = ProjectCategorySignals & {
  language?: string | null;
  primary_language?: string | null;
  market?: string | null;
  vertical?: string | null;
  name?: string | null;
  website_url?: string | null;
  store_platform?: string | null;
  catalog_notes?: string | null;
  author_bio?: string | null;
  metadata?: Record<string, unknown> | null;
};

const SUPPORTED_LANGS = new Set(['it', 'en', 'de', 'fr', 'es', 'pt']);

export const PROMPT_LANG_LABEL: Record<string, string> = {
  it: 'ITALIANO',
  en: 'ENGLISH',
  de: 'DEUTSCH',
  fr: 'FRANÇAIS',
  es: 'ESPAÑOL',
  pt: 'PORTUGUÊS',
};

const INTENT_OK = new Set<string>(['brand', 'category', 'comparison', 'use_case', 'problem']);

/** Minimum share of brand-eliciting intents we ask the model to produce. */
export const BRAND_ELICITING_INTENT_MIN_RATIO = 0.65;

/** Max queries per single LLM call — avoids truncated JSON on large batches. */
export const MAX_QUERIES_PER_LLM_CALL = 25;

const LANG_MARKERS: Record<string, RegExp[]> = {
  es: [/\b(qué|cómo|cuál|dónde|mejor|para el|bodas|españa|español)\b/i, /[áéíóúñ¿¡]/],
  it: [/\b(miglior|migliori|come|per|della|delle|dove|quale|italia|consigli|matrimonio)\b/i],
  en: [/\b(best|top|recommend|which|where|what|leading|alternatives|vs\.?|compare)\b/i],
  de: [/\b(welche|beste|wie|für|deutschland|empfehl|alternativen)\b/i],
  fr: [/\b(meilleur|meilleurs|comment|pour|quelle|france|recommand)\b/i],
  pt: [/\b(melhor|melhores|como|para|qual|portugal|recomend)\b/i],
};

export function mapLangToCode(code: string | null | undefined): string {
  const normalized = (code ?? 'en').toLowerCase().split('-')[0] ?? 'en';
  return SUPPORTED_LANGS.has(normalized) ? normalized : 'en';
}

/** Visibility query language: project.language wins over primary_language (UI/content default). */
export function resolveQueryLanguage(project: Pick<QueryGenProjectContext, 'language' | 'primary_language'>): string {
  return mapLangToCode(project.language || project.primary_language);
}

/** City/area the business serves — projects.metadata.locality set in onboarding ("Milano"). */
export function resolveLocality(project: Pick<QueryGenProjectContext, 'metadata'>): string {
  const raw = project.metadata && typeof project.metadata === 'object' ? (project.metadata as Record<string, unknown>)['locality'] : null;
  return typeof raw === 'string' ? raw.trim().slice(0, 60) : '';
}

/** Minimum share of prompts that must name the locality for a local business. */
export const LOCAL_PROMPT_MIN_RATIO = 0.4;

export function marketLocalityLabel(market: string | null | undefined, lang: string): string {
  const code = mapLangToCode(lang);
  const m = (market ?? '').toUpperCase();
  // Global: no country or region to add. The generator must not invent one.
  if (!m || m === 'GLOBAL') return '';
  const byMarket: Record<string, Record<string, string>> = {
    IT: { it: 'Italia', en: 'Italy' },
    US: { it: 'Stati Uniti', en: 'United States' },
    DE: { it: 'Germania', en: 'Germany' },
    FR: { it: 'Francia', en: 'France' },
    ES: { it: 'Spagna', en: 'Spain' },
    PT: { it: 'Portogallo', en: 'Portugal' },
  };
  const row = byMarket[m];
  return row?.[code] ?? row?.['en'] ?? m;
}

export function queryGenerationChunks(total: number, maxPerCall = MAX_QUERIES_PER_LLM_CALL): number[] {
  const chunks: number[] = [];
  let remaining = Math.max(1, total);
  while (remaining > 0) {
    const n = Math.min(maxPerCall, remaining);
    chunks.push(n);
    remaining -= n;
  }
  return chunks;
}

export function normalizeIntentType(raw: string | undefined): QueryIntentType {
  const v = (raw ?? '').trim();
  return INTENT_OK.has(v) ? (v as QueryIntentType) : 'category';
}

export function parseGeneratedQueries(content: string): GeneratedQuery[] {
  const cleaned = content.replace(/```json\n?|\n?```/g, '').trim();
  const parsed = JSON.parse(cleaned) as { queries?: Array<{ text?: string; intent_type?: string }> };
  return (parsed.queries ?? [])
    .map((q) => ({
      text: (q.text ?? '').trim(),
      intent_type: normalizeIntentType(q.intent_type),
    }))
    .filter((q) => q.text.length > 0);
}

function languageMarkerScores(text: string): Record<string, number> {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {};
  for (const [lang, patterns] of Object.entries(LANG_MARKERS)) {
    scores[lang] = patterns.reduce((n, re) => n + (re.test(lower) ? 1 : 0), 0);
  }
  return scores;
}

/** Reject queries whose wording clearly belongs to another supported language. */
export function isQueryLanguageValid(text: string, expectedLang: string): boolean {
  const expected = mapLangToCode(expectedLang);
  const scores = languageMarkerScores(text);
  const expectedScore = scores[expected] ?? 0;
  const otherScores = Object.entries(scores)
    .filter(([lang]) => lang !== expected)
    .map(([, score]) => score);
  const maxOther = otherScores.length ? Math.max(...otherScores) : 0;
  if (maxOther > expectedScore) return false;
  if (expected !== 'en' && expectedScore === 0 && maxOther > 0) return false;
  return true;
}

export function dedupeQueries(rows: GeneratedQuery[]): GeneratedQuery[] {
  const seen = new Set<string>();
  const out: GeneratedQuery[] = [];
  for (const row of rows) {
    const key = row.text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function isBrandElicitingIntent(intent: QueryIntentType): boolean {
  return intent === 'brand' || intent === 'comparison' || intent === 'category' || intent === 'use_case';
}

export function brandElicitingRatio(rows: GeneratedQuery[]): number {
  if (rows.length === 0) return 0;
  const n = rows.filter((r) => isBrandElicitingIntent(r.intent_type)).length;
  return n / rows.length;
}

const GEO_HINT =
  /\b(sicily|sicilia|tuscany|toscana|italy|italia|amalfi|california|texas|germany|deutschland|france|spain|portugal|united states)\b/i;

/** Pick a locale/market phrase from project signals (catalog > seeds > market label). */
export function extractLocaleHint(seeds: string[], catalogNotes: string, marketLabel: string): string {
  for (const source of [catalogNotes, ...seeds, marketLabel]) {
    const m = source.match(GEO_HINT);
    if (m) return m[0];
  }
  return marketLabel;
}

/** Project-derived brand-eliciting guidance — no fixed few-shot query strings. */
/**
 * The place to put in brand-eliciting patterns, or '' when the project has none. A service area
 * wins; then a place named in the project's own seeds/catalog; then the market, but not for SaaS
 * (people ask "best SEO software", not "best SEO software in Italy").
 */
export function patternLocale(args: { seeds: string[]; catalogNotes: string; marketLabel: string; vertical?: string; locality?: string }): string {
  if (args.locality?.trim()) return args.locality.trim();
  const hinted = extractLocaleHint(args.seeds, args.catalogNotes, '');
  if (hinted) return hinted;
  return args.vertical === 'saas' ? '' : args.marketLabel;
}

export function buildBrandElicitingGuidance(args: {
  lang: string;
  brandName: string;
  compNames: string[];
  seeds: string[];
  marketLabel: string;
  catalogNotes: string;
  vertical?: string;
  locality?: string;
}): string {
  const code = mapLangToCode(args.lang);
  const category =
    args.seeds.find((s) => s.trim())?.trim() ||
    (code === 'it' ? 'fornitori nella categoria' : 'providers in this category');
  const locale = patternLocale(args);
  const comp = args.compNames[0];

  if (code === 'it') {
    const where = locale ? ` in ${locale}` : '';
    const patterns = comp
      ? `"migliori ${category}${where}", "consigli ${category}${locale ? ` ${locale}` : ''}", "${args.brandName} vs ${comp}", "alternative a ${comp} per ${category}"`
      : `"migliori ${category}${where}", "top ${category}${locale ? ` ${locale}` : ''}", "chi consigliate per ${category}${where}"`;
    return `Pattern brand-eliciting (obbligatori, adattati a categoria/mercato del progetto): ${patterns}.
Evita domande how-to/timeline/definizione generiche sulla categoria — raramente citano brand (0% SoV).`;
  }

  const where = locale ? ` in ${locale}` : '';
  const patterns = comp
    ? `"best ${category}${where}", "recommend ${category}${where}", "${args.brandName} vs ${comp}", "alternatives to ${comp} for ${category}"`
    : `"best ${category}${where}", "top ${category}${where}", "leading ${category}${where}"`;
  return `Required brand-eliciting patterns (adapted to this project's category/market): ${patterns}.
Skip generic how-to/timeline/definition questions about the category — they rarely cite brands (0% SoV).`;
}

/**
 * When a project has no category signal (no primary keyword, topic or seeds), one cheap LLM call
 * reads what the homepage says and names the category, the buyer and the kind of business. Without
 * it the generator only saw the brand name and a default "saas" vertical, and produced prompts
 * about SaaS vendors for a travel site.
 */
export type BusinessType = 'saas' | 'ecommerce' | 'local' | 'other';
export type BusinessProfile = { category: string; audience: string; businessType: BusinessType; serviceArea: string };

export function businessProfilePrompt(args: { siteUrl: string; siteSummary: string; lang: string }): string {
  const label = PROMPT_LANG_LABEL[mapLangToCode(args.lang)] || 'ENGLISH';
  return `Website: ${args.siteUrl || 'n/a'}
Homepage: ${args.siteSummary || '(could not be read)'}

What does this business offer, and to whom? Reply with JSON only:
{"category": "<what a buyer would search for, 2-5 words, in ${label}, e.g. the product or service type>",
 "audience": "<who buys it, 1-4 words, in ${label}>",
 "business_type": "saas" | "ecommerce" | "local" | "other",
 "service_area": "<the city or region it serves, only if business_type is local, else empty>"}
Use "local" for a business that serves one place (hotel, tour operator, clinic, restaurant, venue). Base the answer only on the homepage; if it says too little, give your best reading of the domain but never invent a niche.`;
}

const BUSINESS_TYPES: ReadonlySet<string> = new Set(['saas', 'ecommerce', 'local', 'other']);

export function parseBusinessProfile(content: string | null | undefined): BusinessProfile | null {
  if (!content) return null;
  const raw = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { data = JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
  }
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const category = text(data['category'], 60);
  if (category.length < 3) return null;
  const type = text(data['business_type'], 12).toLowerCase();
  const businessType = (BUSINESS_TYPES.has(type) ? type : 'other') as BusinessType;
  return {
    category,
    audience: text(data['audience'], 40),
    businessType,
    serviceArea: businessType === 'local' ? text(data['service_area'], 60) : '',
  };
}

/** projects.vertical only knows saas / ecommerce / other. */
export function verticalForBusinessType(t: BusinessType): 'saas' | 'ecommerce' | 'other' {
  return t === 'saas' || t === 'ecommerce' ? t : 'other';
}

export function queryGenSystem(lang: string, brandName: string): string {
  const code = mapLangToCode(lang);
  const label = PROMPT_LANG_LABEL[code] || 'ENGLISH';
  const pct = Math.round(BRAND_ELICITING_INTENT_MIN_RATIO * 100);

  if (code === 'it') {
    return `Sei un esperto di prompt per la visibilità AI (Share of Voice). Output SOLO JSON valido, senza markdown.

REGOLA CRITICA — BRAND-ELICITING vs INFORMATIVO:
Lo Share of Voice si misura quando un LLM NOMINA brand/fornitori/negozi nella risposta.
Almeno ${pct}% dei prompt DEVE essere BRAND-ELICITING (intent raccomandazione/lista/confronto): domande dove ChatGPT/Perplexity tipicamente elenca o confronta brand nominati.
Pattern: "migliori [categoria] in [mercato]", "X vs Y", "alternative a [competitor]", "leader di [categoria] in [mercato]".
Massimo ${100 - pct}% può essere puramente informativo (how-to/definizioni) — produce raramente menzioni brand.

PROMPT NON BRANDIZZATI (~75%): la maggior parte NON deve contenere "${brandName}" nel testo. Brand-eliciting ≠ brandizzato. Preferisci "migliori X in Y" non "è ${brandName} affidabile?" per la maggioranza.
~15-25% può citare "${brandName}" (recensioni, fiducia, vs competitor).

LINGUA OBBLIGATORIA: ogni query SOLO in ${label}. Vietato mescolare altre lingue.

JSON: {"queries":[{"text":"...","intent_type":"brand|category|comparison|use_case|problem"}]}
Mix intent: brand ~15%, comparison ~25%, category ~25% (solo best/top/lista), use_case ~20% (consiglia/raccomanda), problem max ~15% (fiducia/acquisto, non how-to puri).`;
  }

  return `You are an expert at AI-search visibility (Share of Voice) prompts in ${label}. Output ONLY valid JSON, no markdown.

CRITICAL — BRAND-ELICITING vs INFORMATIVE:
Share of Voice is measured when an LLM NAMES brands/providers/stores in the answer.
At least ${pct}% of prompts MUST be BRAND-ELICITING (recommendation/list/comparison intent): queries where ChatGPT/Perplexity typically lists or compares named brands.
Patterns: "best [category] in [market]", "top [category] brands", "X vs Y", "alternatives to [competitor]", "leading [category] in [market]".
At most ${100 - pct}% may be purely informational (how-to/definitions) — these rarely produce brand mentions.

UNBRANDED QUERIES (~75%): most prompts must NOT contain "${brandName}" in the text. Brand-eliciting ≠ branded. Prefer "best X in Y" over "is ${brandName} good?" for the majority.
~15-25% may mention "${brandName}" (reviews, trust, vs competitor).

MANDATORY LANGUAGE: every query ONLY in ${label}. Never mix languages.

JSON: {"queries":[{"text":"...","intent_type":"brand|category|comparison|use_case|problem"}]}
Intent mix: brand ~15%, comparison ~25%, category ~25% (best/top/list only), use_case ~20% (recommend-for), problem max ~15% (trust/purchase, not pure how-to).`;
}

export function queryGenUserPrompt(args: {
  lang: string;
  count: number;
  brandName: string;
  compNames: string[];
  seeds: string[];
  vertical: string;
  storePlatform: string;
  catalogNotes: string;
  siteUrl: string;
  marketLabel: string;
  avoidTexts?: string[];
  /** City/area served (local business). When set, a share of prompts must name it. */
  locality?: string;
  /** Free-text business profile (author bio) — lets the model spot a service area itself. */
  profileNotes?: string;
  /** What the homepage says the business does (siteSummary.ts). Grounds the category. */
  siteSummary?: string;
}): string {
  const {
    lang,
    count,
    brandName,
    compNames,
    seeds,
    vertical,
    storePlatform,
    catalogNotes,
    siteUrl,
    marketLabel,
    avoidTexts = [],
    locality: locality_ = '',
    profileNotes = '',
    siteSummary = '',
  } = args;

  const code = mapLangToCode(lang);
  const label = PROMPT_LANG_LABEL[code] || 'ENGLISH';
  const comp = compNames.join(', ') || (code === 'it' ? 'nessuno' : 'none');
  const seed = seeds.join(', ') || (code === 'it' ? 'nessuno' : 'none');
  const pct = Math.round(BRAND_ELICITING_INTENT_MIN_RATIO * 100);

  const competitorBlock =
    compNames.length > 0
      ? code === 'it'
        ? `COMPETITOR (obbligatorio): genera query esplicite di confronto e alternative — "${brandName} vs ${compNames[0]}", "alternative a ${compNames[0]}", "migliori [categoria] ${brandName} o ${compNames[0]}", "top brand [categoria] vs ${compNames.slice(0, 2).join(' / ')}". Almeno ${Math.max(3, Math.round(count * 0.2))} query con un competitor nel testo.`
        : `COMPETITORS (required): generate explicit comparison and alternative queries — "${brandName} vs ${compNames[0]}", "alternatives to ${compNames[0]}", "best [category] ${brandName} or ${compNames[0]}", "top [category] brands vs ${compNames.slice(0, 2).join(' / ')}". At least ${Math.max(3, Math.round(count * 0.2))} queries must name a competitor.`
      : '';

  const brandElicitingGuidance = buildBrandElicitingGuidance({
    lang,
    brandName,
    compNames,
    seeds,
    marketLabel,
    catalogNotes,
    vertical,
    locality: locality_,
  });

  const siteBlock = siteSummary.trim()
    ? code === 'it'
      ? `SITO (cosa fa davvero il business, dalla sua homepage): ${siteSummary.trim()}\nOgni query deve riguardare ciò che questo sito offre. Non inventare una categoria che il sito non supporta.\n`
      : `SITE (what the business actually does, from its homepage): ${siteSummary.trim()}\nEvery query must be about what this site offers. Never invent a category the site doesn't support.\n`
    : '';

  const avoidBlock =
    avoidTexts.length > 0
      ? (code === 'it'
          ? `\nNON ripetere queste query già generate:\n${avoidTexts.slice(-40).map((t) => `- ${t}`).join('\n')}`
          : `\nDo NOT repeat these already-generated queries:\n${avoidTexts.slice(-40).map((t) => `- ${t}`).join('\n')}`)
      : '';

  const exactCount =
    code === 'it'
      ? `Genera ESATTAMENTE ${count} query diverse (non meno, non di più).`
      : `Generate EXACTLY ${count} distinct queries (no fewer, no more).`;

  const localPct = Math.round(LOCAL_PROMPT_MIN_RATIO * 100);
  const profileHint = profileNotes.trim()
    ? code === 'it'
      ? `\nPROFILO: ${profileNotes.trim().slice(0, 300)} — se il profilo indica una città o zona servita, trattala come AREA SERVITA (vedi sopra).`
      : `\nPROFILE: ${profileNotes.trim().slice(0, 300)} — if the profile names a city or area the business serves, treat it as the SERVICE AREA (see above).`
    : '';
  const rest = marketLabel || (code === 'it' ? 'il mercato nazionale o globale' : 'the national or global market');
  const locality = locality_
    ? code === 'it'
      ? `AREA SERVITA (vincolante): ${locality_}. Il business è locale: almeno ${localPct}% delle query deve contenere "${locality_}" (es. "migliori X a ${locality_}", "X vicino a ${locality_}", "chi consiglia X a ${locality_}"); le altre possono riferirsi a ${rest}.${profileHint}`
      : `SERVICE AREA (binding): ${locality_}. The business is local: at least ${localPct}% of the queries must contain "${locality_}" (e.g. "best X in ${locality_}", "X near ${locality_}", "who recommends X in ${locality_}"); the rest may refer to ${rest}.${profileHint}`
    : marketLabel
      ? code === 'it'
        ? `MERCATO: ${marketLabel}. Nominalo solo dove lo farebbe un acquirente vero (servizi locali, negozi nazionali); non forzare un luogo in ogni query. Se il business serve chiaramente una città o zona precisa, almeno ${localPct}% delle query deve nominarla.${profileHint}`
        : `MARKET: ${marketLabel}. Mention it only where a real buyer would (local services, national shops); don't force a place into every query. If the business clearly serves one city or area, at least ${localPct}% of the queries must name it.${profileHint}`
      : code === 'it'
        ? `MERCATO: globale. Non aggiungere paesi, regioni o città alle query, a meno che il business non serva chiaramente un luogo preciso.${profileHint}`
        : `MARKET: global. Don't add a country, region or city to the queries unless the business clearly serves one place.${profileHint}`;

  if (code === 'it') {
    if (vertical === 'ecommerce') {
      return `Workspace E-COMMERCE: brand "${brandName}". Competitor: ${comp}. Categoria/prodotto: ${seed}.
Sito: ${siteUrl || 'n/d'} | Store: ${storePlatform || 'n/d'} | Catalogo: ${catalogNotes || 'n/d'}
${siteBlock}${locality}
${competitorBlock}
${brandElicitingGuidance}
${exactCount} Almeno ${pct}% brand-eliciting (best/top/raccomanda/confronta/alternative). Lingua: SOLO ${label}.
Prompt come li scrive un acquirente che vuole COMPRARE e confrontare brand (non how-to puri).
Rispondi con JSON: {"queries":[{"text":"...","intent_type":"brand|category|comparison|use_case|problem"}]}${avoidBlock}`;
    }
    return `Workspace: verticale "${vertical}", brand "${brandName}". Sito: ${siteUrl || 'n/d'}. Categoria (vincolante): ${seed}. Competitor: ${comp}.
${siteBlock}${locality}
${competitorBlock}
${brandElicitingGuidance}
${exactCount} Almeno ${pct}% brand-eliciting. OGNI query sulla categoria sopra — NON il significato letterale del brand name.
Lingua: SOLO ${label}.
Rispondi con JSON: {"queries":[{"text":"...","intent_type":"brand|category|comparison|use_case|problem"}]}${avoidBlock}`;
  }

  if (vertical === 'ecommerce') {
    return `E-COMMERCE workspace: brand "${brandName}". Competitors: ${comp}. Category/product: ${seed}.
Site: ${siteUrl || 'n/a'} | Store: ${storePlatform || 'n/a'} | Catalog: ${catalogNotes || 'none'}
${siteBlock}${locality}
${competitorBlock}
${brandElicitingGuidance}
${exactCount} At least ${pct}% brand-eliciting (best/top/recommend/compare/alternatives). Language: ${label} ONLY.
Shopper prompts that compare and list brands (not pure how-to).
Respond with JSON: {"queries":[{"text":"...","intent_type":"brand|category|comparison|use_case|problem"}]}${avoidBlock}`;
  }

  return `Workspace: vertical "${vertical}", brand "${brandName}". Site: ${siteUrl || 'n/a'}. PRODUCT/CATEGORY (binding): ${seed}. Competitors: ${comp}.
${siteBlock}${locality}
${competitorBlock}
${brandElicitingGuidance}
${exactCount} At least ${pct}% brand-eliciting. Every query about the category above — NOT the literal brand-name meaning.
Language: ${label} ONLY.
Respond with JSON: {"queries":[{"text":"...","intent_type":"brand|category|comparison|use_case|problem"}]}${avoidBlock}`;
}

export { buildCategorySeeds };

/**
 * Language guard for the public AI-visibility check.
 *
 * The check infers brand/category/query from the site. Without a requested language that is the
 * right call (probe the market the site targets). But when the caller asks for one (`lang: 'en'`,
 * `lang: 'it'`) the probe MUST be in that language: an English audience checked with a German
 * query is a wrong-language result, not an "absent" verdict.
 * Pure helpers (no Deno APIs) so vitest can import them from src/lib.
 */

export const SUPPORTED_CHECK_LANGS = ['it', 'en'] as const
export type CheckLang = (typeof SUPPORTED_CHECK_LANGS)[number]

export const LANGUAGE_NAMES: Record<string, string> = {
  it: 'Italian',
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
}

/** Normalise "en-US", " EN " → "en"; anything unusable → "". */
export function normalizeLang(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase().split(/[-_]/)[0]?.slice(0, 2) ?? ''
}

/** Requested language, or "" when the caller did not ask for one (site-detected mode). */
export function requestedCheckLang(raw: unknown): CheckLang | '' {
  const l = normalizeLang(raw)
  return (SUPPORTED_CHECK_LANGS as readonly string[]).includes(l) ? (l as CheckLang) : ''
}

/** Cache is per domain; when a language is requested the entry must be per (domain, language). */
export function publicCheckCacheKey(domain: string, lang: string): string {
  return lang ? `v2:${domain}:${lang}` : `v2:${domain}`
}

/** True when the caller asked for a language and the observed one is a different, known language. */
export function languageMismatch(requested: string, observed: unknown): boolean {
  const want = normalizeLang(requested)
  const got = normalizeLang(observed)
  if (!want || !got) return false
  return want !== got
}

/** Extra instruction for the profile prompt when a language is requested. */
export function forcedLanguageInstruction(lang: string, strict = false): string {
  const name = LANGUAGE_NAMES[normalizeLang(lang)] ?? 'English'
  const base = `Write "category" and "query" in ${name}, regardless of the language the website is in, and set "lang" to "${normalizeLang(lang)}".`
  return strict
    ? `${base} This is mandatory: the previous attempt came back in another language. Translate the category if needed; the query must read like a native ${name} speaker asking an AI assistant.`
    : base
}

/** Machine-readable refusal body for a wrong-language probe (HTTP 422). */
export function wrongLanguageBody(requested: string, detected: string, query: string) {
  return {
    error: 'wrong_language',
    message: `The probe query came back in "${detected}" although "${requested}" was requested; result discarded.`,
    requested,
    detected,
    query,
  }
}

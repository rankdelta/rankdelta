/**
 * Pick a new project's content language and SEO market when the user didn't say.
 * Pure (no Deno/DOM APIs) so the web app and the Edge functions share one rule:
 *
 *   language: explicit → the site's <html lang> → a /xx/ path prefix or country TLD → English
 *   market:   explicit → the country TLD → the language's home market → global
 *
 * English/global is the default everywhere — an unknown site is never assumed Italian.
 */

export const SITE_LANGUAGES = ['en', 'it', 'de', 'fr', 'es', 'pt'] as const
export type SiteLanguage = (typeof SITE_LANGUAGES)[number]

/**
 * `workspace_market` values present in BOTH the migrations and the hosted database (the hosted enum
 * has 'UK' where the migrations have 'GB'), so a UK site maps to 'global' — English research.
 */
export const SITE_MARKETS = ['global', 'US', 'IT', 'DE', 'FR', 'ES', 'CH', 'PT'] as const
export type SiteMarket = (typeof SITE_MARKETS)[number]

const TLD_MARKET: Record<string, SiteMarket> = {
  it: 'IT',
  de: 'DE',
  at: 'DE',
  fr: 'FR',
  es: 'ES',
  ch: 'CH',
  pt: 'PT',
  us: 'US',
}

/** Country TLDs with one dominant language (.ch is multilingual → no hint). */
const TLD_LANGUAGE: Record<string, SiteLanguage> = {
  it: 'it',
  de: 'de',
  at: 'de',
  fr: 'fr',
  es: 'es',
  pt: 'pt',
  uk: 'en',
  us: 'en',
}

const LANGUAGE_MARKET: Record<SiteLanguage, SiteMarket> = {
  en: 'global',
  it: 'IT',
  de: 'DE',
  fr: 'FR',
  es: 'ES',
  pt: 'PT',
}

export function normalizeSiteLanguage(input?: string | null): SiteLanguage | null {
  const code = (input ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? ''
  return (SITE_LANGUAGES as readonly string[]).includes(code) ? (code as SiteLanguage) : null
}

export function normalizeSiteMarket(input?: string | null): SiteMarket | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  const upper = raw.toUpperCase()
  if (upper === 'GLOBAL' || upper === 'WORLDWIDE' || upper === 'INTERNATIONAL') return 'global'
  if (upper === 'GB' || upper === 'UK') return 'global'
  return (SITE_MARKETS as readonly string[]).includes(upper) ? (upper as SiteMarket) : null
}

/** `<html lang="…">`, falling back to `og:locale`. */
export function htmlLanguage(html: string): SiteLanguage | null {
  const lang =
    html.match(/<html[^>]*\blang=["']?([a-z]{2})(?:[-_][a-zA-Z]{2,4})?["'\s>]/i)?.[1] ??
    html.match(/property=["']og:locale["'][^>]*content=["']([a-z]{2})/i)?.[1]
  return normalizeSiteLanguage(lang)
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
}

function tld(url: URL): string {
  return url.hostname.toLowerCase().split('.').pop() ?? ''
}

/** Language implied by the URL alone: a `/it/`-style path prefix, else a country TLD. */
export function urlLanguage(rawUrl: string): SiteLanguage | null {
  const url = parseUrl(rawUrl)
  if (!url) return null
  const firstSegment = url.pathname.split('/').filter(Boolean)[0]
  return normalizeSiteLanguage(firstSegment && firstSegment.length === 2 ? firstSegment : null) ?? TLD_LANGUAGE[tld(url)] ?? null
}

export function urlMarket(rawUrl: string): SiteMarket | null {
  const url = parseUrl(rawUrl)
  return url ? (TLD_MARKET[tld(url)] ?? null) : null
}

export function inferSiteLocale(opts: {
  url: string
  html?: string | null
  language?: string | null
  market?: string | null
}): { language: SiteLanguage; market: SiteMarket } {
  const language =
    normalizeSiteLanguage(opts.language) ??
    (opts.html ? htmlLanguage(opts.html) : null) ??
    urlLanguage(opts.url) ??
    'en'
  const market = normalizeSiteMarket(opts.market) ?? urlMarket(opts.url) ?? LANGUAGE_MARKET[language]
  return { language, market }
}

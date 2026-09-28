/**
 * schemaGenerator.ts — DETERMINISTIC, zero-cost structured-data (JSON-LD) generator.
 *
 * Positioning: this is the "schema FAQ ed altro nell'audit" deliverable — Adobe LLM Optimizer
 * parity for the part that matters most to AI citation (FAQPage / Article / Organization) — WITHOUT
 * any LLM or paid-API cost. It converts a page's EXISTING content + metadata into paste-ready
 * JSON-LD with cheap regex parsing, the same way `siteAudit.ts` derives its GEO signals.
 *
 * Cost: one HTML fetch through the `seo-proxy` Edge Function (`proxyFetchText`) — no DataForSEO,
 * no LLM, no new dependencies. When `opts.html` is supplied the fetch is skipped entirely, which
 * also makes every helper unit-testable fully offline.
 *
 * What it emits, purely from what's already on the page:
 *   1. FAQPage      — question-style H2/H3 headings + their following answer text (>=2 clean pairs).
 *   2. Article      — headline (<title>/og:title), author, datePublished (JSON-LD or visible byline),
 *                     dateModified = now.
 *   3. Organization — name (og:site_name/title brand), url (origin), logo (og:image/favicon),
 *                     sameAs (social profile links found on the page).
 *
 * A future LLM-powered v2 could *write* missing answers; this v1 only *structures what exists*, so
 * it never fabricates and never costs a cent.
 */

import { normalizeContentLanguage, prefersEnglishUi } from '../lib/contentLanguages'
import { proxyFetchText } from './edgeProxy'

// --- Public shape -------------------------------------------------------------

export type SchemaType = 'FAQPage' | 'Article' | 'Organization'

export interface GeneratedSchema {
  type: SchemaType
  /** A valid schema.org node with `@context: "https://schema.org"`, ready to paste in a script tag. */
  jsonLd: object
  /** Human-readable, localized (it/en) one-liner describing what was generated. */
  summary: string
}

export interface SchemaGenerationResult {
  url: string
  generated: GeneratedSchema[]
  /** Blocks that could NOT be generated, each with a localized reason (e.g. too few FAQ pairs). */
  skipped: { type: SchemaType; reason: string }[]
}

export interface FaqPair {
  question: string
  answer: string
}

export interface ArticleMeta {
  headline: string
  author?: string
  /** ISO-8601 string recovered from existing JSON-LD or a visible byline; undefined if none. */
  datePublished?: string
}

export interface OrgProfile {
  name?: string
  url: string
  logo?: string
  sameAs: string[]
}

// --- Text helpers -------------------------------------------------------------

/** Decode the handful of HTML entities that show up in headings/paragraphs. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;|&#x0*27;/gi, "'")
    .replace(/&#0*160;/gi, ' ')
}

/**
 * Flatten a block of HTML to clean, single-spaced plain text: block-level tags and <br> become
 * spaces (so `<li>a</li><li>b</li>` reads "a b", not "ab"), remaining tags are stripped, entities
 * decoded, whitespace collapsed.
 */
export function htmlToText(html: string): string {
  const spaced = html
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|td|th|section|article|header|footer|blockquote)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(spaced).replace(/\s+/g, ' ').trim()
}

/** Strip `<script>` and `<style>` blocks so their contents never leak into extracted text. */
function stripScriptsAndStyles(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
}

/**
 * Is a heading text a question? True when it ends with "?" or opens with a question word (IT + EN).
 * Diacritics are stripped first so "Perche..." matches regardless of precomposed/decomposed encoding.
 */
export function isQuestionHeading(text: string): boolean {
  const clean = text.trim()
  if (!clean) return false
  if (/\?\s*$/.test(clean)) return true
  const ascii = clean.normalize('NFD').replace(/[̀-ͯ]/g, '')
  const QUESTION_OPENER =
    /^(come|cosa|quando|perche|quali|quale|chi|dove|quant[oiae]|conviene|vale|how|what|why|when|which|who|where|can|should|is|are|do|does|will|would)\b/i
  return QUESTION_OPENER.test(ascii)
}

// --- FAQ extraction -----------------------------------------------------------

/**
 * Pull question->answer pairs from page HTML: each question-style H2/H3 heading, with the
 * paragraph/list text that follows it up to the NEXT heading (of any level) as the answer.
 * A pair is dropped when the answer is empty or too short to be a real answer.
 */
export function extractFaqPairs(html: string): FaqPair[] {
  const body = stripScriptsAndStyles(html)
  const pairs: FaqPair[] = []
  const seen = new Set<string>()
  // Heading (h2/h3) ... then everything up to the next heading of any level (or end of document).
  const re = /<h([23])[^>]*>([\s\S]*?)<\/h\1>([\s\S]*?)(?=<h[1-6][\s>]|$)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const question = htmlToText(m[2] ?? '')
    if (!question || !isQuestionHeading(question)) continue
    const answer = htmlToText(m[3] ?? '').slice(0, 700).trim()
    // Skip empty / too-short answers: a bare "?" heading with no prose beneath is not a FAQ.
    if (answer.length < 20) continue
    const key = question.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push({ question, answer })
    if (pairs.length >= 12) break
  }
  return pairs
}

// --- Article meta extraction --------------------------------------------------

function firstMatch(html: string, re: RegExp): string | undefined {
  const m = html.match(re)
  const v = m?.[1]
  return v ? decodeEntities(v).trim() || undefined : undefined
}

/** The page's <title>, with a trailing " | Brand" / " - Brand" style suffix left intact. */
function extractTitle(html: string): string | undefined {
  const raw = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
  return raw ? raw.replace(/\s+/g, ' ').trim() || undefined : undefined
}

function extractMetaContent(html: string, property: string): string | undefined {
  // Handle both attribute orders: content-before-name and name-before-content.
  const esc = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const a = firstMatch(
    html,
    new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*\\bcontent=["']([^"']+)["']`, 'i'),
  )
  if (a) return a
  return firstMatch(
    html,
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${esc}["']`, 'i'),
  )
}

/** Author name from meta[name=author], rel=author link, JSON-LD Person, or a `.author` element. */
export function extractAuthor(html: string): string | undefined {
  const meta = extractMetaContent(html, 'author')
  if (meta && meta.length <= 80) return meta

  const relAuthor = firstMatch(html, /<a[^>]+rel=["']author["'][^>]*>([\s\S]*?)<\/a>/i)
  if (relAuthor) {
    const t = htmlToText(relAuthor)
    if (t && t.length <= 80) return t
  }

  // JSON-LD Person, either attribute order.
  const personAfter = firstMatch(html, /"@type"\s*:\s*"Person"[\s\S]{0,120}?"name"\s*:\s*"([^"]+)"/i)
  if (personAfter && personAfter.length <= 80) return personAfter
  const personBefore = firstMatch(html, /"name"\s*:\s*"([^"]+)"[\s\S]{0,120}?"@type"\s*:\s*"Person"/i)
  if (personBefore && personBefore.length <= 80) return personBefore

  const classAuthor = firstMatch(html, /<[^>]+class=["'][^"']*\bauthor\b[^"']*["'][^>]*>([\s\S]*?)<\//i)
  if (classAuthor) {
    const t = htmlToText(classAuthor)
    // A real name, not a whole "by ... | 5 min read" container.
    if (t && t.length >= 2 && t.length <= 60) return t
  }
  return undefined
}

/**
 * Recover the page's publish date as an ISO string. Tries existing Article JSON-LD `datePublished`
 * first (most reliable), then a visible "Pubblicato/Published/Aggiornato/Updated: dd/mm/yyyy" byline
 * (and an ISO-form byline). Returns undefined when nothing parseable is present.
 */
export function recoverPublishDate(html: string): string | undefined {
  const jsonLd = html.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1]
  if (jsonLd) {
    const t = Date.parse(jsonLd)
    if (!Number.isNaN(t)) return new Date(t).toISOString()
  }
  const dmy = html.match(
    /(?:Pubblicat[oa]|Published|Aggiornat[oa]|Updated)[^0-9]{0,12}(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i,
  )
  if (dmy) {
    const [, d, mo, y] = dmy
    const year = (y ?? '').length === 2 ? `20${y}` : (y ?? '')
    const t = Date.parse(`${year}-${(mo ?? '').padStart(2, '0')}-${(d ?? '').padStart(2, '0')}`)
    if (!Number.isNaN(t)) return new Date(t).toISOString()
  }
  const iso = html
    .match(/(?:Pubblicat[oa]|Published|Aggiornat[oa]|Updated)[^0-9]{0,12}(\d{4}-\d{2}-\d{2})/i)?.[1]
  if (iso) {
    const t = Date.parse(iso)
    if (!Number.isNaN(t)) return new Date(t).toISOString()
  }
  return undefined
}

/** Headline + author + publish date from the page. `headline` is empty when none is found. */
export function extractArticleMeta(html: string): ArticleMeta {
  const headline = extractMetaContent(html, 'og:title') ?? extractTitle(html) ?? ''
  const author = extractAuthor(html)
  const datePublished = recoverPublishDate(html)
  const meta: ArticleMeta = { headline }
  if (author) meta.author = author
  if (datePublished) meta.datePublished = datePublished
  return meta
}

// --- Organization / social profile extraction ---------------------------------

const SOCIAL_HOSTS = /(?:twitter\.com|x\.com|linkedin\.com|facebook\.com|instagram\.com|youtube\.com)/i
// Share / intent / plugin endpoints are NOT the brand's own profile.
const SOCIAL_NOISE = /(?:\/(?:intent|share|sharer|shareArticle|dialog|plugins|widgets|embed)\b|\/share\b)/i

/**
 * Collect the brand's own social profile URLs (twitter/x, linkedin, facebook, instagram, youtube)
 * from page hrefs. Share/intent endpoints are excluded; results are de-duplicated and order-stable.
 */
export function extractSocialLinks(html: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    let href = (m[1] ?? '').trim()
    if (!href || href.startsWith('#')) continue
    if (href.startsWith('//')) href = `https:${href}`
    if (!/^https?:\/\//i.test(href)) continue
    if (!SOCIAL_HOSTS.test(href) || SOCIAL_NOISE.test(href)) continue
    const key = href.replace(/\/+$/, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(href)
    if (out.length >= 8) break
  }
  return out
}

function absoluteUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined
  try {
    return new URL(href, base).href
  } catch {
    return undefined
  }
}

/** Best-effort brand name from a page title like "Page - Brand" / "Brand: Page". */
function brandFromTitle(title: string | undefined): string | undefined {
  if (!title) return undefined
  const parts = title.split(/\s+[|–—·:-]\s+/).map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return undefined
  // The shorter of the first/last segment is almost always the brand, not the article title.
  const first = parts[0]!
  const last = parts[parts.length - 1]!
  const brand = last.length <= first.length ? last : first
  return brand.length >= 2 && brand.length <= 60 ? brand : undefined
}

function extractLogo(html: string, base: string): string | undefined {
  const og = extractMetaContent(html, 'og:image')
  if (og) return absoluteUrl(og, base)
  const icon = firstMatch(
    html,
    /<link[^>]+rel=["'][^"']*(?:apple-touch-icon|shortcut icon|icon)[^"']*["'][^>]*href=["']([^"']+)["']/i,
  )
  return absoluteUrl(icon, base)
}

/** Organization profile: name, origin URL, logo and social `sameAs`. `name` may be undefined. */
export function extractOrgProfile(html: string, url: string): OrgProfile {
  let origin = url
  try {
    origin = new URL(url).origin
  } catch {
    /* keep the raw url as a best effort */
  }
  const name = extractMetaContent(html, 'og:site_name') ?? brandFromTitle(extractTitle(html))
  const logo = extractLogo(html, origin)
  const profile: OrgProfile = { url: origin, sameAs: extractSocialLinks(html) }
  if (name) profile.name = name
  if (logo) profile.logo = logo
  return profile
}

// --- JSON-LD builders ---------------------------------------------------------

const CONTEXT = 'https://schema.org' as const

export function buildFaqJsonLd(pairs: FaqPair[]): object {
  return {
    '@context': CONTEXT,
    '@type': 'FAQPage',
    mainEntity: pairs.map((p) => ({
      '@type': 'Question',
      name: p.question,
      acceptedAnswer: { '@type': 'Answer', text: p.answer },
    })),
  }
}

export function buildArticleJsonLd(meta: ArticleMeta, url: string, org: OrgProfile): object {
  const node: Record<string, unknown> = {
    '@context': CONTEXT,
    '@type': 'Article',
    headline: meta.headline,
    url,
    dateModified: new Date().toISOString(),
  }
  if (meta.datePublished) node['datePublished'] = meta.datePublished
  if (meta.author) node['author'] = { '@type': 'Person', name: meta.author }
  if (org.name) {
    const publisher: Record<string, unknown> = { '@type': 'Organization', name: org.name, url: org.url }
    if (org.logo) publisher['logo'] = { '@type': 'ImageObject', url: org.logo }
    node['publisher'] = publisher
  }
  return node
}

export function buildOrgJsonLd(org: OrgProfile): object {
  const node: Record<string, unknown> = {
    '@context': CONTEXT,
    '@type': 'Organization',
    name: org.name,
    url: org.url,
  }
  if (org.logo) node['logo'] = org.logo
  if (org.sameAs.length > 0) node['sameAs'] = org.sameAs
  return node
}

// --- Orchestration ------------------------------------------------------------

function faqSummary(count: number, en: boolean): string {
  return en
    ? `FAQPage schema built from ${count} question/answer pairs already on the page.`
    : `Schema FAQPage costruito da ${count} coppie domanda/risposta gia presenti nella pagina.`
}

function articleSummary(meta: ArticleMeta, en: boolean): string {
  const bits: string[] = []
  if (meta.author) bits.push(en ? `author ${meta.author}` : `autore ${meta.author}`)
  if (meta.datePublished) {
    const d = meta.datePublished.slice(0, 10)
    bits.push(en ? `published ${d}` : `pubblicato ${d}`)
  }
  const extra = bits.length ? ` (${bits.join(', ')})` : ''
  return en
    ? `Article schema from the page headline${extra}.`
    : `Schema Article dal titolo della pagina${extra}.`
}

function orgSummary(org: OrgProfile, en: boolean): string {
  const bits: string[] = []
  if (org.logo) bits.push('logo')
  if (org.sameAs.length) bits.push(en ? `${org.sameAs.length} social profiles` : `${org.sameAs.length} profili social`)
  const extra = bits.length ? ` + ${bits.join(', ')}` : ''
  return en
    ? `Organization schema: name + URL${extra}.`
    : `Schema Organization: nome + URL${extra}.`
}

/**
 * Generate paste-ready JSON-LD for a URL from its EXISTING content. Deterministic and free: no LLM,
 * no DataForSEO. Pass `opts.html` to skip the network fetch entirely (tests, or pre-fetched HTML).
 */
export async function generateSchemaForUrl(
  url: string,
  opts?: { language?: string; html?: string },
): Promise<SchemaGenerationResult> {
  const en = prefersEnglishUi(normalizeContentLanguage(opts?.language))
  const html = opts?.html ?? (await proxyFetchText(url))

  const generated: GeneratedSchema[] = []
  const skipped: { type: SchemaType; reason: string }[] = []

  if (!html || html.trim().length === 0) {
    const reason = en ? 'page HTML could not be fetched' : 'HTML della pagina non recuperabile'
    return {
      url,
      generated: [],
      skipped: [
        { type: 'FAQPage', reason },
        { type: 'Article', reason },
        { type: 'Organization', reason },
      ],
    }
  }

  const org = extractOrgProfile(html, url)

  // 1. FAQPage
  const pairs = extractFaqPairs(html)
  if (pairs.length >= 2) {
    generated.push({ type: 'FAQPage', jsonLd: buildFaqJsonLd(pairs), summary: faqSummary(pairs.length, en) })
  } else {
    skipped.push({
      type: 'FAQPage',
      reason: en
        ? `only ${pairs.length} FAQ pair(s) found (min 2)`
        : `solo ${pairs.length} copp${pairs.length === 1 ? 'ia' : 'ie'} FAQ trovat${pairs.length === 1 ? 'a' : 'e'} (min 2)`,
    })
  }

  // 2. Article
  const meta = extractArticleMeta(html)
  if (meta.headline) {
    generated.push({ type: 'Article', jsonLd: buildArticleJsonLd(meta, url, org), summary: articleSummary(meta, en) })
  } else {
    skipped.push({
      type: 'Article',
      reason: en ? 'no page title/headline found' : 'nessun titolo/headline trovato nella pagina',
    })
  }

  // 3. Organization
  if (org.name && org.url) {
    generated.push({ type: 'Organization', jsonLd: buildOrgJsonLd(org), summary: orgSummary(org, en) })
  } else {
    skipped.push({
      type: 'Organization',
      reason: en
        ? 'organization name could not be resolved (no og:site_name or title brand)'
        : 'nome organizzazione non risolto (nessun og:site_name o brand nel title)',
    })
  }

  return { url, generated, skipped }
}

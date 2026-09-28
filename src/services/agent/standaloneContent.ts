/**
 * Standalone content — the platform's connector-LESS content path.
 *
 * The platform must deliver value WITHOUT WordPress/Shopify: generate a skill-grade,
 * GEO-optimized article from just a keyword + public site URL, run it through the same
 * quality gate, and hand back ready-to-use EXPORTS (Gutenberg, clean HTML, Markdown).
 * Publishing connectors (WordPress now, Shopify later) become an optional last step.
 */

import { getSerpInsights, resolveLocale } from '../dataforseo'
import { searchPexelsImages } from '../imageService'
import { orchestrate, complete } from '../openrouter'
import { WordPressClient } from '../wordpress'
import { supabase } from '../../lib/supabaseClient'
import { verifyExternalSources, scoreDomainAuthority } from './citationVerifier'
import { isProxyEnabled, proxyFetchText } from '../edgeProxy'
import { runWritingAgent, runAugmentAgent } from './writingAgent'
import { finalizeArticle } from './contentFinalizer'
import { validateArticle, type ValidationStats } from './contentValidator'
import type { ResearchResult, InternalLink, ExternalSource, ArticleContent, SiteAuditResult } from './types'
import type { ValidationResult } from './contentValidator'
import { defaultBlogCategoryName, langName, normalizeContentLanguage, pexelsCaptionLabels, prefersEnglishUi } from '../../lib/contentLanguages'
import { jsonLdScript } from './schemaGenerator'
import { rankMoneyPagesForKeyword, ensureMoneyPageLink, boostMoneyPagesIntoResearch, type MoneyPage } from '../moneyPages'

const SOURCE_PROPOSAL_PROMPT = `Sei un ricercatore esperto. Data una keyword, proponi 3-4 fonti autorevoli REALI e verificabili (preferisci fonti primarie: enti pubblici .gov/.edu, PubMed, ISTAT, Eurostat, documentazione ufficiale, grandi testate). Rispondi con JSON: [{url, title, domain, isAuthoritative, snippet}]. Solo JSON.`

function humanizeSlug(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/$/, '')
    const last = path.split('/').filter(Boolean).pop() ?? ''
    return last.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim() || url
  } catch {
    return url
  }
}

/** A sitemap page entry with its optional last-modified date (freshness signal for GEO). */
export interface SitemapEntry {
  url: string
  /** Raw `<lastmod>` value from the sitemap, or null when the sitemap omits it. */
  lastmod: string | null
}

/** Bound how far we follow a sitemap index, to keep the audit fast and cheap. */
const MAX_CHILD_SITEMAPS = 12
const MAX_SITEMAP_PAGES = 600

/**
 * Parse a sitemap document into page entries and child-sitemap URLs. A sitemap INDEX
 * (`sitemap_index.xml`, the default for Yoast/RankMath/most WP) contains only `<sitemap>` blocks
 * whose `<loc>` points to child .xml sitemaps — no page `<url>` blocks. We must follow those
 * children to reach the actual pages, so we return both rather than silently dropping the index.
 */
function parseSitemapDoc(xml: string): { pages: SitemapEntry[]; children: string[] } {
  const pages: SitemapEntry[] = []
  const children: string[] = []
  const blockRe = /<(url|sitemap)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(xml)) !== null) {
    const tag = (m[1] ?? '').toLowerCase()
    const loc = (m[2] ?? '').match(/<loc>(.*?)<\/loc>/i)?.[1]?.trim() ?? ''
    if (!loc) continue
    if (tag === 'sitemap' || loc.endsWith('.xml')) {
      children.push(loc)
    } else {
      const lastmod = (m[2] ?? '').match(/<lastmod>(.*?)<\/lastmod>/i)?.[1]?.trim() || null
      pages.push({ url: loc, lastmod })
    }
  }
  return { pages, children }
}

/**
 * Get site pages from the public sitemap WITH their lastmod dates — via the Edge proxy when
 * enabled, else direct. Follows one level of sitemap index (the common WP case) so freshness/
 * stale-content discovery works on real sites. Freshness matters for GEO (AI citations decay
 * ~14 days after a page stops being updated), so we surface lastmod rather than discarding it.
 */
export async function getSitemapEntries(siteUrl: string): Promise<SitemapEntry[]> {
  const base = siteUrl.replace(/\/$/, '')
  if (isProxyEnabled()) {
    for (const path of ['/sitemap_index.xml', '/sitemap.xml', '/wp-sitemap.xml']) {
      try {
        const xml = await proxyFetchText(base + path)
        const { pages, children } = parseSitemapDoc(xml)
        if (pages.length) return pages.slice(0, MAX_SITEMAP_PAGES)
        if (children.length) {
          // It's a sitemap index — fetch the child sitemaps (bounded, in parallel) and aggregate.
          const docs = await Promise.allSettled(
            children.slice(0, MAX_CHILD_SITEMAPS).map((child) => proxyFetchText(child)),
          )
          const out: SitemapEntry[] = []
          for (const d of docs) {
            if (d.status === 'fulfilled') out.push(...parseSitemapDoc(d.value).pages)
          }
          if (out.length) return out.slice(0, MAX_SITEMAP_PAGES)
        }
      } catch {
        /* try next path */
      }
    }
    return []
  }
  const client = new WordPressClient({ id: 'tmp', siteUrl, username: '', appPassword: '' })
  return (await client.getSitemapUrls()).map((e) => ({ url: e.url, lastmod: e.lastmod ?? null }))
}

/** Get site URLs from the public sitemap — via the Edge proxy when enabled, else direct. */
async function getSitemapUrls(siteUrl: string): Promise<string[]> {
  return (await getSitemapEntries(siteUrl)).map((e) => e.url)
}

/**
 * Pick the 6-10 most topically relevant internal links via a cheap LLM call (gpt-4o-mini).
 * The naive slug-token match misses semantic matches ("carta prepagata" ≠ a page about "conto online");
 * this reads the humanized slugs as titles and selects by meaning, returning natural anchor text.
 * Token-prefilters huge sitemaps to keep the prompt small; falls back to token-match on any failure.
 */
async function selectInternalLinks(keyword: string, urls: string[], language: string): Promise<InternalLink[]> {
  if (urls.length === 0) return []
  const tokens = keyword.toLowerCase().split(/\s+/).filter((t) => t.length > 3)
  const scored = urls.map((url) => {
    const slug = url.toLowerCase()
    const score = tokens.reduce((s, t) => s + (slug.includes(t) ? 1 : 0), 0)
    return { url, title: humanizeSlug(url), score }
  })
  // Token-match fallback (used if the LLM pick fails or returns nothing).
  const tokenMatch: InternalLink[] = scored
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((c) => ({ url: c.url, anchorText: c.title, relevanceScore: c.score }))

  // Candidate pool for the LLM: keyword-matching pages first, then fill up to 60 with the rest.
  const pool = [...scored].sort((a, b) => b.score - a.score).slice(0, 60)
  try {
    const list = pool.map((c, i) => `${i + 1}. ${c.title} -> ${c.url}`).join('\n')
    const raw = await complete(
      [{
        role: 'user',
        content: `Keyword dell'articolo: "${keyword}".\nEcco le pagine interne del sito (titolo -> url). Scegli le 6-10 PIÙ pertinenti tematicamente da linkare naturalmente nell'articolo. Per ognuna scrivi un anchor text naturale in ${langName(language)}. Se NESSUNA è pertinente, restituisci [].\n\n${list}\n\nRispondi SOLO con JSON: [{"url":"...","anchorText":"..."}]`,
      }],
      { model: 'openai/gpt-4o-mini', temperature: 0.2, maxTokens: 800, timeoutMs: 30_000 }
    )
    const m = raw.match(/\[[\s\S]*\]/)
    const picked = JSON.parse(m?.[0] ?? '[]') as Array<{ url?: string; anchorText?: string }>
    const valid = new Set(pool.map((c) => c.url))
    const result = picked
      .filter((p) => p.url && valid.has(p.url))
      .slice(0, 10)
      .map((p) => ({ url: p.url!, anchorText: (p.anchorText || humanizeSlug(p.url!)).trim(), relevanceScore: 1 }))
    return result.length > 0 ? result : tokenMatch
  } catch (e) {
    console.warn('[Standalone] LLM internal-link selection failed, using token match:', e)
    return tokenMatch
  }
}

/**
 * Scrape the H2/H3 headings from the top SERP pages → the real heading-level coverage the article
 * must match or beat (true content-gap analysis, not just keyword/PAA). Best-effort + bounded:
 * a few pages in parallel, short per-page timeout, junk/nav headings filtered. Never throws.
 */
export async function extractCompetitorHeadings(urls: string[], maxPages = 3, maxHeadings = 16): Promise<string[]> {
  if (!isProxyEnabled() || urls.length === 0) return []
  const docs = await Promise.allSettled(
    urls.slice(0, maxPages).map((u) =>
      Promise.race([
        proxyFetchText(u),
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error('heading fetch timeout')), 12_000)),
      ]),
    ),
  )
  const seen = new Set<string>()
  const out: string[] = []
  const JUNK = /^(menu|cerca|search|cookie|newsletter|condividi|share|categorie|category|tag|commenti|comments|related|articoli correlati|indice|sommario|table of contents|navigation|footer|seguici|follow us)$/i
  for (const d of docs) {
    if (d.status !== 'fulfilled') continue
    for (const m of d.value.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)) {
      const text = (m[1] ?? '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
      const key = text.toLowerCase()
      if (text.length < 8 || text.length > 90 || JUNK.test(text) || seen.has(key)) continue
      seen.add(key)
      out.push(text)
      if (out.length >= maxHeadings) return out
    }
  }
  return out
}

/**
 * Detect the site's REAL content language from its homepage `<html lang="...">` attribute
 * (falling back to `og:locale`). Ground truth for what language generated articles must be in:
 * an English site must never receive an Italian article, whatever the workspace defaults say
 * (without it, a caller that omits `language` falls back to the engine default and an English
 * site can get an Italian article). Best-effort: null on any failure.
 */
export async function detectSiteLanguage(siteUrl: string): Promise<string | null> {
  if (!isProxyEnabled() || !siteUrl) return null
  try {
    const html = await Promise.race([
      proxyFetchText(siteUrl.replace(/\/$/, '') + '/'),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('language detect timeout')), 10_000)),
    ])
    const lang =
      html.match(/<html[^>]*\blang=["']?([a-z]{2})(?:[-_][a-zA-Z]{2,4})?["'\s>]/i)?.[1] ??
      html.match(/property=["']og:locale["'][^>]*content=["']([a-z]{2})/i)?.[1]
    return lang ? lang.toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * Extract the brand's REAL social/profile URLs from its homepage → Organization `sameAs` in the
 * Article schema. The strongest entity/E-E-A-T signal we can ship automatically for EVERY client
 * without inventing people. Best-effort + bounded; returns [] on any failure.
 */
export async function extractBrandProfiles(siteUrl: string): Promise<string[]> {
  if (!isProxyEnabled() || !siteUrl) return []
  const base = siteUrl.replace(/\/$/, '')
  let html = ''
  try {
    html = await Promise.race([
      proxyFetchText(base + '/'),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('brand profiles fetch timeout')), 10_000)),
    ])
  } catch {
    return []
  }
  const PLATFORM = /(?:facebook|instagram|linkedin|twitter|youtube|tiktok|pinterest|github)\.com$|(?:^|\.)x\.com$/i
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of html.matchAll(/href=["'](https?:\/\/[^"'\s]+)["']/gi)) {
    try {
      const u = new URL(m[1] ?? '')
      const host = u.hostname.replace(/^www\./i, '').toLowerCase()
      if (!PLATFORM.test(host)) continue
      const path = u.pathname.replace(/\/+$/, '')
      if (!path || /\/(sharer|share|intent|dialog|plugins)\b/i.test(path)) continue // share/intent, not a profile
      const clean = `${u.protocol}//${host}${path}`
      if (seen.has(clean.toLowerCase())) continue
      seen.add(clean.toLowerCase())
      out.push(clean)
      if (out.length >= 8) break
    } catch {
      /* skip malformed */
    }
  }
  return out
}

/**
 * When REFRESHING existing content, recover its ORIGINAL publish date so the schema keeps a real
 * `datePublished` (and `dateModified`=now signals "updated"). Tries existing Article JSON-LD, then a
 * visible "Pubblicato: DD/MM/YYYY" / "Published: ..." byline. Returns an ISO string or undefined.
 */
function extractOriginalPublishDate(html: string): string | undefined {
  // 1. Existing Article schema datePublished (most reliable).
  const jsonLd = html.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1]
  if (jsonLd) {
    const t = Date.parse(jsonLd)
    if (!Number.isNaN(t)) return new Date(t).toISOString()
  }
  // 2. Visible byline date: "Pubblicato: 15/01/2025" / "Published: 2025-01-15" / "15 gennaio 2025".
  const dmy = html.match(/(?:Pubblicat[oa]|Published|Aggiornat[oa]|Updated)[^0-9]{0,12}(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i)
  if (dmy) {
    const [, d, m, y] = dmy
    const year = (y ?? '').length === 2 ? `20${y}` : y
    const t = Date.parse(`${year}-${(m ?? '').padStart(2, '0')}-${(d ?? '').padStart(2, '0')}`)
    if (!Number.isNaN(t)) return new Date(t).toISOString()
  }
  const iso = html.match(/(?:Pubblicat[oa]|Published)[^0-9]{0,12}(\d{4})-(\d{2})-(\d{2})/i)?.[0]?.match(/\d{4}-\d{2}-\d{2}/)?.[0]
  if (iso) {
    const t = Date.parse(iso)
    if (!Number.isNaN(t)) return new Date(t).toISOString()
  }
  return undefined
}

/** Connector-less research: SERP via DataForSEO + internal links from the PUBLIC sitemap. */
async function researchStandalone(
  keyword: string,
  siteUrl: string,
  language: string,
  market?: string
): Promise<ResearchResult> {
  const { locationCode, languageCode } = resolveLocale(market, language)

  let serpTopUrls: string[] = []
  let serpOrganic: Array<{ title: string; url: string }> = []
  let peopleAlsoAsk: string[] = []
  let relatedKeywords: string[] = []
  const competitorWordCounts: number[] = []

  try {
    // Race the SERP call against a 25s cap: SERP enriches research but isn't required (internal links
    // + verified sources carry the article). When the proxy is slow/unavailable we degrade fast
    // instead of hanging the whole content run on a 60s proxy timeout.
    const serp = await Promise.race([
      getSerpInsights(keyword, locationCode, languageCode),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SERP race timeout (25s)')), 25_000)),
    ])
    serpOrganic = serp.organic.map((r) => ({ title: r.title, url: r.url }))
    serpTopUrls = serpOrganic.map((r) => r.url).slice(0, 10)
    peopleAlsoAsk = serp.peopleAlsoAsk.slice(0, 8).map((q) => q.question)
    relatedKeywords = serp.relatedSearches.slice(0, 10)
  } catch (e) {
    console.warn('[Standalone] SERP failed/slow — continuing without it:', e)
  }

  // Heading-level competitor gap: scrape the top SERP pages' H2/H3 concurrently with the rest of
  // research (don't await yet) so it adds ~no serial latency.
  const competitorHeadingsPromise = extractCompetitorHeadings(serpTopUrls).catch(() => [] as string[])

  // Internal links from the public sitemap — ranked by keyword overlap.
  // Uses the Edge proxy when enabled (no CORS), else direct fetch (dev only).
  let internalLinks: InternalLink[] = []
  try {
    const urls = await getSitemapUrls(siteUrl)
    internalLinks = await selectInternalLinks(keyword, urls, language)
  } catch (e) {
    console.warn('[Standalone] sitemap internal links failed:', e)
  }

  // External sources — REAL-first + VERIFY. We combine authoritative pages that ALREADY rank for
  // the keyword (from the live SERP — real by construction) with LLM-proposed sources, then run the
  // 2-step verification. We NEVER fall back to unverified LLM citations (skill rule: "when in doubt,
  // cut the citation, not the verification step"). If verification can't run / passes none, we keep
  // ONLY the real SERP-authoritative pages — an invented authoritative link is the worst outcome.
  let externalSources: ExternalSource[] = []
  try {
    const serpAuthoritative: ExternalSource[] = serpOrganic
      .map((r) => ({ r, auth: scoreDomainAuthority(r.url) }))
      .filter(({ auth }) => auth.isAuthoritative)
      .map(({ r, auth }) => ({ url: r.url, title: r.title, domain: auth.domain, snippet: '', isAuthoritative: true }))

    let proposed: ExternalSource[] = []
    try {
      const raw = await orchestrate(SOURCE_PROPOSAL_PROMPT, `Keyword: "${keyword}"\nLingua: ${language}\nSito: ${siteUrl}`)
      const m = raw.match(/\[[\s\S]*\]/)
      proposed = (JSON.parse(m?.[0] ?? '[]') as ExternalSource[]).map((s) => {
        const auth = scoreDomainAuthority(s.url || s.domain || '')
        return { ...s, domain: s.domain || auth.domain, isAuthoritative: auth.isAuthoritative }
      })
    } catch {
      /* LLM proposals are optional — SERP-authoritative sources carry the article on their own */
    }

    // Dedupe by host, real SERP sources first.
    const seen = new Set<string>()
    const pool = [...serpAuthoritative, ...proposed].filter((s) => {
      const host = (s.domain || s.url).toLowerCase()
      if (!host || seen.has(host)) return false
      seen.add(host)
      return true
    })

    const checks = await verifyExternalSources(pool, keyword, language)
    const verified = pool.filter((_, i) => checks[i]?.verified && pool[i]?.isAuthoritative)
    externalSources = verified.length > 0 ? verified.slice(0, 4) : serpAuthoritative.slice(0, 3)
  } catch (e) {
    console.warn('[Standalone] external sources failed:', e)
  }

  return {
    keyword,
    serpTopUrls,
    peopleAlsoAsk,
    relatedKeywords,
    internalLinks,
    externalSources,
    competitorWordCounts,
    competitorHeadings: await competitorHeadingsPromise,
    recommendedWordCount: 2800,
  }
}

// ─── EXPORTS ───────────────────────────────────────────────────────────────────

/** Strip Gutenberg block comments → clean, portable HTML. */
export function toCleanHtml(gutenberg: string): string {
  return gutenberg
    .replace(/<!--\s*\/?wp:[\s\S]*?-->/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Best-effort HTML → Markdown for portability (headings, lists, links, emphasis, tables stripped to text). */
export function toMarkdown(gutenberg: string): string {
  let html = toCleanHtml(gutenberg)
  // drop style/script and infographic wp:html blocks' raw CSS
  html = html.replace(/<style[\s\S]*?<\/style>/gi, '')
  const rules: Array<[RegExp, string | ((...m: string[]) => string)]> = [
    [/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, t: string) => `\n# ${strip(t)}\n`],
    [/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, t: string) => `\n## ${strip(t)}\n`],
    [/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, t: string) => `\n### ${strip(t)}\n`],
    [/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_m, t: string) => `\n#### ${strip(t)}\n`],
    [/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t: string) => `- ${strip(t)}\n`],
    [/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, t: string) => `[${strip(t)}](${href})`],
    [/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, (_m, _t1: string, t: string) => `**${strip(t)}**`],
    [/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, (_m, _t1: string, t: string) => `*${strip(t)}*`],
    [/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, t: string) => `\n${strip(t)}\n`],
  ]
  for (const [re, rep] of rules) html = html.replace(re, rep as any)
  return html.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

function strip(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim()
}

// ─── IMAGES (Pexels → Gutenberg blocks) ─────────────────────────────────────────

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Build a real Gutenberg image block with a Pexels-attribution figcaption (license requirement). */
function gutenbergImageBlock(
  url: string,
  alt: string,
  credit: string,
  creditUrl: string,
  language: string
): string {
  const { by, on } = pexelsCaptionLabels(language)
  const caption = creditUrl
    ? `${by} <a href="${escapeAttr(creditUrl)}" target="_blank" rel="noopener nofollow">${escapeAttr(credit)}</a> ${on} <a href="https://www.pexels.com" target="_blank" rel="noopener nofollow">Pexels</a>`
    : `${by} ${escapeAttr(credit)} ${on} Pexels`
  return (
    `\n<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->\n` +
    `<figure class="wp-block-image size-large"><img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}"/>` +
    `<figcaption class="wp-element-caption">${caption}</figcaption></figure>\n` +
    `<!-- /wp:image -->\n`
  )
}

/**
 * Add real images to the article: a featured/hero image at the top + in-article images placed
 * after section H2s (skipping Quick-Answer / FAQ / Fonti / Note headings). Sourced from Pexels
 * with proper photographer attribution. Fully graceful: if no Pexels key or no results, the
 * article is returned unchanged — images are an enhancement, never a hard dependency.
 */
async function integrateImages(article: ArticleContent, keyword: string, language: string): Promise<ArticleContent> {
  // Distinct search subjects: the model's suggested terms first, then the keyword as a fallback.
  const terms = [...new Set([...(article.imageSearchTerms ?? []), keyword].map((t) => t?.trim()).filter(Boolean))].slice(0, 5)
  if (terms.length === 0) return article

  // Bound the whole image step: the Pexels/image fetches have no internal timeout, so a stalled
  // request must not hang generation. If image search doesn't finish in time, ship without images.
  let pools: Awaited<ReturnType<typeof searchPexelsImages>>[] = []
  try {
    pools = await Promise.race([
      Promise.all(terms.map((t) => searchPexelsImages(t, 2))),
      new Promise<typeof pools>((resolve) => setTimeout(() => resolve([]), 25_000)),
    ])
  } catch (e) {
    console.warn('[Standalone] Pexels image search failed:', e)
    return article
  }

  // Dedupe by URL, preserve term order for topical relevance.
  const seen = new Set<string>()
  const images = pools.flat().filter((img) => img?.url && !seen.has(img.url) && seen.add(img.url))
  if (images.length === 0) {
    console.warn('[Standalone] No Pexels images found (key missing or no results) — article without images.')
    return article
  }

  const featured = images[0]!
  const inArticle = images.slice(1)

  let html = article.gutenbergContent

  // Place in-article images after eligible H2 sections. Match full heading-2 Gutenberg blocks.
  const headingRe = /<!-- wp:heading[^>]*-->\s*<h2[\s\S]*?<\/h2>\s*<!-- \/wp:heading -->/g
  const skip = /risposta\s+rapida|quick\s+answer|domande\s+frequent|frequently\s+asked|fonti|sources|references|note?\s+espert|expert\s+note/i
  const positions: number[] = []
  let m: RegExpExecArray | null
  while ((m = headingRe.exec(html)) !== null) {
    if (skip.test(m[0])) continue
    positions.push(m.index + m[0].length)
  }

  // How many in-article images: ~1 per 700 words, 2–3, capped by what we actually fetched.
  const target = Math.min(inArticle.length, positions.length, Math.max(2, Math.min(3, Math.floor(article.wordCount / 700))))
  if (target > 0 && positions.length > 0) {
    // Evenly spaced insertion points; insert back-to-front so earlier indices stay valid.
    const chosen = Array.from({ length: target }, (_, i) =>
      positions[Math.min(positions.length - 1, Math.round((i + 1) * (positions.length / (target + 1))))]!
    )
    const uniqueSorted = [...new Set(chosen)].sort((a, b) => b - a)
    uniqueSorted.forEach((pos, idx) => {
      const img = inArticle[idx]
      if (!img) return
      const block = gutenbergImageBlock(img.url, img.alt || keyword, img.credit, img.creditUrl, language)
      html = html.slice(0, pos) + block + html.slice(pos)
    })
  }

  // Featured/hero image at the very top (also used as WP featured_media on publish).
  const heroAlt = `${keyword}`
  html = gutenbergImageBlock(featured.url, featured.alt || heroAlt, featured.credit, featured.creditUrl, language) + html

  return {
    ...article,
    gutenbergContent: html,
    featuredImageUrl: featured.url,
    featuredImageCredit: { name: featured.credit, url: featured.creditUrl },
  }
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────

export interface StandaloneOptions {
  keyword: string
  siteUrl: string
  siteName: string
  niche: string
  /** Explicit article language — skips site detection entirely. */
  language?: string
  /** Project-metadata language (primary_language/language) — fallback when site detection fails. */
  languageHint?: string
  market?: string
  targetWordCount?: number
  ctaHtml?: string
  authorLine?: string
  /** When set, the generated article is auto-saved to the project's content history (never lost). */
  projectId?: string
  /** Commercial pages the article must funnel authority to (from project.metadata.money_pages). */
  moneyPages?: MoneyPage[]
}

export interface StandaloneResult {
  article: ArticleContent
  validation: ValidationResult
  exports: { gutenberg: string; html: string; markdown: string }
  /** id of the persisted `content` row, when projectId was provided and the save succeeded. */
  savedContentId?: string
}

/**
 * Best-effort persistence of a generated/refreshed article into the `content` table so the user's
 * work survives navigation, tab close and reloads. NEVER throws — losing the save must not lose
 * the in-memory result the user is looking at.
 */
async function saveGeneratedContent(
  projectId: string,
  article: ArticleContent,
  meta: Record<string, unknown>,
): Promise<string | undefined> {
  try {
    const { data, error } = await supabase
      .from('content')
      .insert({
        project_id: projectId,
        title: article.title,
        slug: article.slug,
        body: article.gutenbergContent,
        topic: article.focusKeyword,
        seo_score: article.seoScore,
        status: 'generated',
        metadata: {
          geoScore: article.geoScore,
          wordCount: article.wordCount,
          metaTitle: article.metaTitle,
          metaDescription: article.metaDescription,
          language: article.language,
          ...meta,
        },
      })
      .select('id')
      .single()
    if (error) throw error
    return (data as { id: string } | null)?.id
  } catch (e) {
    console.warn('[Standalone] auto-save to content history failed (result still available):', e)
    return undefined
  }
}

/**
 * Generate a publishable, skill-grade article from a keyword + public site URL —
 * no CMS connection required. Returns the article, the QA verdict, and ready exports.
 */
export async function generateStandaloneArticle(opts: StandaloneOptions): Promise<StandaloneResult> {
  // Language: explicit override > the site's REAL language (<html lang>) > project metadata > English.
  // The article gets published ON the site, so the site's own language is the ground truth.
  const language = opts.language ?? (await detectSiteLanguage(opts.siteUrl)) ?? opts.languageHint ?? 'en'
  const targetWordCount = opts.targetWordCount ?? 2800

  // Brand profiles (Organization sameAs) — fetch concurrently; the writing/augment agent (~100s) hides the latency.
  const brandProfilesPromise = extractBrandProfiles(opts.siteUrl)
  const research = await researchStandalone(opts.keyword, opts.siteUrl, language, opts.market)

  // Money pages backstop: also surface them as top-relevance internal-link candidates, so even
  // if the model overlooks the dedicated prompt section, the links are in the standard pool.
  const rankedMoney = rankMoneyPagesForKeyword(opts.moneyPages ?? [], opts.keyword)
  boostMoneyPagesIntoResearch(research, rankedMoney)

  const audit: SiteAuditResult = {
    siteUrl: opts.siteUrl,
    totalPages: 0,
    indexedUrls: [],
    existingTopics: [],
    contentGaps: [],
    technicalIssues: [],
    competitors: [],
    language,
    niche: opts.niche,
    auditedAt: new Date().toISOString(),
  }

  const writingConfig = {
    siteName: opts.siteName,
    siteUrl: opts.siteUrl,
    niche: opts.niche,
    language,
    targetWordCount,
    ctaHtml: opts.ctaHtml,
    authorLine: opts.authorLine,
    moneyPages: opts.moneyPages,
  }
  let article = await runWritingAgent(opts.keyword, research, audit, writingConfig)

  // A draft under 60% of target is a FAILED run (truncated/confused output that even the
  // expansion pass couldn't recover — prod shipped a 173/2800-word article). One full retry
  // is the only fix; keep whichever draft came out longer so a bad retry can't make it worse.
  if (article.wordCount < targetWordCount * 0.6) {
    console.warn(`[Standalone] draft severely short (${article.wordCount}/${targetWordCount} words) — regenerating once`)
    try {
      const retry = await runWritingAgent(opts.keyword, research, audit, writingConfig)
      if (retry.wordCount > article.wordCount) article = retry
    } catch (e) {
      console.warn('[Standalone] regeneration failed — keeping first draft:', e)
    }
  }

  const finalize = await finalizeArticle(article, research, {
    siteName: opts.siteName,
    siteUrl: opts.siteUrl,
    niche: opts.niche,
    targetWordCount,
    publishDateIso: new Date().toISOString(),
    isPillar: targetWordCount >= 3000,
    brandProfiles: await brandProfilesPromise,
  })

  // Money-page guarantee: the prompt instruction is probabilistic — if the model skipped the
  // link, insert it deterministically (keyword wrap, else editorial pointer after the first H2).
  const contentWithMoney = rankedMoney.length > 0
    ? ensureMoneyPageLink(finalize.content, rankedMoney, language)
    : finalize.content

  const finalArticle: ArticleContent = {
    ...article,
    gutenbergContent: contentWithMoney,
    seoScore: finalize.validation.seoScore,
    geoScore: finalize.validation.geoScore,
  }

  // Add real images (Pexels) as the last step — featured hero + in-article, with attribution.
  const withImages = await integrateImages(finalArticle, opts.keyword, language)

  // Auto-save: the user's work must survive navigation/tab close (best-effort, non-blocking).
  const savedContentId = opts.projectId
    ? await saveGeneratedContent(opts.projectId, withImages, { source: 'generate', keyword: opts.keyword })
    : undefined

  return {
    article: withImages,
    validation: finalize.validation,
    savedContentId,
    exports: {
      gutenberg: withImages.gutenbergContent,
      html: toCleanHtml(withImages.gutenbergContent),
      markdown: toMarkdown(withImages.gutenbergContent),
    },
  }
}

// ─── REFRESH / AUGMENT EXISTING CONTENT ─────────────────────────────────────────

export interface AugmentOptions {
  /** The existing article HTML (Gutenberg or plain HTML, pasted or fetched). */
  existingContent: string
  keyword: string
  siteUrl: string
  siteName: string
  niche: string
  /** Explicit article language — skips site detection entirely. */
  language?: string
  /** Project-metadata language (primary_language/language) — fallback when site detection fails. */
  languageHint?: string
  market?: string
  targetWordCount?: number
  authorLine?: string
  /** When set, the refreshed article is auto-saved to the project's content history (never lost). */
  projectId?: string
  /** The page URL this refresh came from (recorded in history metadata). */
  sourceUrl?: string
  /** Commercial pages the refreshed article must funnel authority to (from project.metadata.money_pages). */
  moneyPages?: MoneyPage[]
}

export interface AugmentResult extends StandaloneResult {
  /** SEO/GEO scores of the ORIGINAL article, before enrichment. */
  before: { seoScore: number; geoScore: number }
  /** Human-readable list of GEO/SEO elements that were added by the refresh. */
  addedElements: string[]
}

/** Build a minimal ArticleContent wrapper so we can score raw pasted HTML through the validator. */
function wrapForValidation(html: string, keyword: string, language: string): ArticleContent {
  return {
    title: keyword,
    slug: keyword,
    metaTitle: keyword,
    metaDescription: '',
    focusKeyword: keyword,
    gutenbergContent: html,
    wordCount: html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
    seoScore: 0,
    geoScore: 0,
    language,
    authorLine: '',
    imageSearchTerms: [keyword],
  }
}

/** Compare before/after validation stats → friendly labels for the GEO/SEO elements newly added. */
function diffAddedElements(before: ValidationStats, after: ValidationStats): string[] {
  const added: string[] = []
  const gained = (was: boolean, now: boolean) => !was && now
  if (gained(before.hasQuickAnswer, after.hasQuickAnswer)) added.push('Box "Risposta rapida"')
  if (gained(before.hasFaq, after.hasFaq)) added.push('Sezione FAQ')
  if (gained(before.hasFaqSchemaBlock, after.hasFaqSchemaBlock)) added.push('Schema FAQ (JSON-LD)')
  if (gained(before.hasFonti, after.hasFonti)) added.push('Sezione Fonti')
  if (gained(before.hasFramework, after.hasFramework)) added.push('Framework proprietario')
  if (gained(before.hasInfographic, after.hasInfographic)) added.push('Infografica')
  if (gained(before.hasStripesTable, after.hasStripesTable)) added.push('Tabella comparativa')
  if (gained(before.hasAuthorLine, after.hasAuthorLine)) added.push('Riga autore')
  if (after.internalLinkCount > before.internalLinkCount)
    added.push(`+${after.internalLinkCount - before.internalLinkCount} link interni`)
  if (after.authoritativeExternalCount > before.authoritativeExternalCount)
    added.push(`+${after.authoritativeExternalCount - before.authoritativeExternalCount} fonti autorevoli`)
  if (after.faqCount > before.faqCount && before.hasFaq)
    added.push(`+${after.faqCount - before.faqCount} domande FAQ`)
  return added
}

/**
 * Refresh an EXISTING article to the seo-geo skill standard: keep the good body, add missing GEO/SEO
 * elements (Risposta rapida, FAQ + schema, nota-esperto + fonti reali, framework, link interni) and
 * deepen thin sections. Returns the enriched article, QA verdict, exports, the BEFORE scores, and a
 * list of what was added. Same no-fabrication guards as a fresh write.
 */
export async function augmentStandaloneArticle(opts: AugmentOptions): Promise<AugmentResult> {
  // Same derivation as generateStandaloneArticle: the site's real language is the ground truth.
  const language = opts.language ?? (await detectSiteLanguage(opts.siteUrl)) ?? opts.languageHint ?? 'en'
  const targetWordCount = opts.targetWordCount ?? 2800

  // Brand profiles (Organization sameAs) — fetch concurrently; the writing/augment agent (~100s) hides the latency.
  const brandProfilesPromise = extractBrandProfiles(opts.siteUrl)
  const research = await researchStandalone(opts.keyword, opts.siteUrl, language, opts.market)

  // Money pages — same mechanic as generation: prompt section + internal-link backstop +
  // deterministic guarantee post-finalize. Never anchor a page to ITSELF: when the page being
  // refreshed is one of the money pages, drop it from the candidates (the others still apply).
  const self = (opts.sourceUrl ?? '').replace(/\/$/, '')
  const rankedMoney = rankMoneyPagesForKeyword(
    (opts.moneyPages ?? []).filter((mp) => !self || mp.url.replace(/\/$/, '') !== self),
    opts.keyword,
  )
  boostMoneyPagesIntoResearch(research, rankedMoney)

  const audit: SiteAuditResult = {
    siteUrl: opts.siteUrl,
    totalPages: 0,
    indexedUrls: [],
    existingTopics: [],
    contentGaps: [],
    technicalIssues: [],
    competitors: [],
    language,
    niche: opts.niche,
    auditedAt: new Date().toISOString(),
  }

  // BEFORE: score the original as-is.
  const beforeValidation = validateArticle(wrapForValidation(opts.existingContent, opts.keyword, language), research, {
    targetWordCount,
    siteUrl: opts.siteUrl,
  })

  // ENRICH: keep the body, add missing elements + depth (no fabrication).
  const article = await runAugmentAgent(opts.existingContent, opts.keyword, research, audit, {
    siteName: opts.siteName,
    siteUrl: opts.siteUrl,
    niche: opts.niche,
    language,
    targetWordCount,
    authorLine: opts.authorLine,
    moneyPages: rankedMoney,
  })

  // FINALIZE: deterministic schema + framework + (pillar) infographic injection + final validation.
  const finalize = await finalizeArticle(article, research, {
    siteName: opts.siteName,
    siteUrl: opts.siteUrl,
    niche: opts.niche,
    targetWordCount,
    publishDateIso: new Date().toISOString(),
    // Refresh: keep the page's real datePublished, let dateModified=now signal a genuine update.
    originalPublishDateIso: extractOriginalPublishDate(opts.existingContent),
    isPillar: targetWordCount >= 3000,
    brandProfiles: await brandProfilesPromise,
  })

  // Money-page guarantee: same deterministic backstop as generation — if neither the original
  // article nor the model added the link, insert it (keyword wrap, else editorial pointer).
  const contentWithMoney = rankedMoney.length > 0
    ? ensureMoneyPageLink(finalize.content, rankedMoney, language)
    : finalize.content

  const finalArticle: ArticleContent = {
    ...article,
    gutenbergContent: contentWithMoney,
    seoScore: finalize.validation.seoScore,
    geoScore: finalize.validation.geoScore,
  }

  const before = { seoScore: beforeValidation.seoScore, geoScore: beforeValidation.geoScore }
  const addedElements = diffAddedElements(beforeValidation.stats, finalize.validation.stats)

  // Auto-save: the user's refreshed article must survive navigation/tab close (best-effort).
  const savedContentId = opts.projectId
    ? await saveGeneratedContent(opts.projectId, finalArticle, {
        source: 'refresh',
        keyword: opts.keyword,
        sourceUrl: opts.sourceUrl ?? null,
        before,
        addedElements,
      })
    : undefined

  return {
    article: finalArticle,
    validation: finalize.validation,
    before,
    addedElements,
    savedContentId,
    exports: {
      gutenberg: finalArticle.gutenbergContent,
      html: toCleanHtml(finalArticle.gutenbergContent),
      markdown: toMarkdown(finalArticle.gutenbergContent),
    },
  }
}

// ─── AUTOMATED DISCOVERY: crawl sitemap → scrape → find stale/weak content ───────

/** Fetch a page's raw HTML — via the Edge proxy when enabled (no CORS), else direct (dev). */
async function fetchPageHtml(url: string): Promise<string> {
  if (isProxyEnabled()) return proxyFetchText(url)
  const res = await fetch(url)
  return res.text()
}

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

export interface ScrapedPage {
  url: string
  title: string
  /** Main article HTML (chrome stripped) — fed straight into the augment engine. */
  contentHtml: string
  wordCount: number
}

/** Scrape a public URL and extract its main article content (no DOM — resilient regex extraction). */
export async function scrapePageContent(url: string): Promise<ScrapedPage> {
  const raw = await fetchPageHtml(url)
  const cleaned = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')

  const h1 = raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const titleTag = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const title = stripTags(h1 || titleTag || url) || url

  // Prefer the semantic article/main region; fall back to <body>, then whole doc.
  const region =
    cleaned.match(/<article[\s\S]*?<\/article>/i)?.[0] ||
    cleaned.match(/<main[\s\S]*?<\/main>/i)?.[0] ||
    cleaned.match(/<body[\s\S]*?<\/body>/i)?.[0] ||
    cleaned

  const contentHtml = region
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .trim()

  return { url, title, contentHtml, wordCount: stripTags(contentHtml).split(/\s+/).filter(Boolean).length }
}

export interface StaleCandidate {
  url: string
  title: string
  wordCount: number
  seoScore: number
  geoScore: number
  /** Human labels of GEO/SEO elements the page is missing. */
  missing: string[]
  /** Raw `<lastmod>` from the sitemap for this URL, or null when unknown/unparseable. */
  lastmod: string | null
  /** Days since the page was last modified (floor), or null when lastmod is missing/unparseable. */
  ageDays: number | null
  /** Higher = bigger refresh opportunity (low scores / many gaps / thin / stale). */
  priority: number
}

const EMPTY_RESEARCH: ResearchResult = {
  keyword: '',
  serpTopUrls: [],
  peopleAlsoAsk: [],
  relatedKeywords: [],
  internalLinks: [],
  externalSources: [],
  competitorWordCounts: [],
  competitorHeadings: [],
  recommendedWordCount: 2800,
}

/** Run at most `concurrency` async tasks at a time. */
async function pLimitLocal<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let i = 0
  const worker = async () => {
    while (i < tasks.length) {
      const cur = i++
      results[cur] = await tasks[cur]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))
  return results
}

/**
 * Crawl the public sitemap, scrape a sample of real article pages, score each against the SEO/GEO
 * checklist, and return the ones with the biggest refresh opportunity (lowest GEO score / most gaps
 * / thinnest), ranked. Connector-less: works on any public site. One click from here → augment.
 */
/**
 * Format-agnostic GEO citability score (0–100) for an EXISTING third-party page.
 *
 * The authored-content validator (validateArticle.geoScore) deliberately rewards the seo-geo skill's
 * OWN template — the proprietary `astroseo-framework` block, the infographic pattern, the exact
 * quick-answer box. That's correct when grading content WE generate, but it unfairly penalises good
 * external pages that simply use a different format (they'd always lose the framework/infographic
 * points and score ~5/100). When auditing someone's existing site we instead score the GENERIC
 * signals a real GEO expert looks for — answer-up-front, FAQ, cited sources, depth, author/E-E-A-T,
 * structured data, integrity — with NO penalty for not matching our house style.
 */
function externalCitabilityScore(s: ValidationStats, ageDays: number | null): number {
  let score = 0
  if (s.hasQuickAnswer) score += 22 // a direct answer up front = the #1 extractable/citable signal
  if (s.hasFaq || s.hasFaqSchemaBlock) score += 14 // Q&A structure AI can lift verbatim
  if (s.hasFaqSchemaBlock) score += 8 // structured data → rich results + easier machine citation
  if (s.hasFonti) score += 12 // an explicit sources/references section
  score += Math.min(s.authoritativeExternalCount * 4, 12) // outbound authoritative citations (.gov/.edu/etc.)
  if (s.wordCount >= 1500) score += 12
  else if (s.wordCount >= 900) score += 7
  if (s.hasAuthorLine) score += 8 // E-E-A-T / authorship trust signal
  if (s.internalLinkCount >= 3) score += 5
  if (s.hasStripesTable) score += 4 // comparison/data table = extractable structured content
  if (s.suspectedFabricatedStats.length === 0) score += 5 // no unsourced/fabricated-looking stats
  score -= s.placeholderLinks.length * 5 // broken/placeholder links erode trust
  // Freshness decay: AI citations fade once a page goes stale, so age caps the ceiling slightly.
  if (ageDays != null && ageDays > 365) score -= 8
  else if (ageDays != null && ageDays > 180) score -= 4
  return Math.min(Math.max(Math.round(score), 0), 100)
}

export async function findStaleContent(
  siteUrl: string,
  opts?: { limit?: number; language?: string; uiLanguage?: string },
): Promise<StaleCandidate[]> {
  const limit = opts?.limit ?? 15
  const language = normalizeContentLanguage(opts?.language)
  // `missing[]` labels are shown to the user, so they follow the UI locale, not the site's
  // content language. Fall back to content language when uiLanguage is unset (back-compat).
  const en = prefersEnglishUi(opts?.uiLanguage ?? language)
  const base = siteUrl.replace(/\/$/, '').toLowerCase()

  const entries = await getSitemapEntries(siteUrl)
  // Index lastmod by URL so each scanned page can carry its freshness signal.
  const lastmodByUrl = new Map(entries.map((e) => [e.url, e.lastmod]))
  const articles = entries
    .map((e) => e.url)
    .filter((u) => {
      const p = u.toLowerCase()
      return (
        !/\/(tag|tags|category|categoria|categorie|author|autore|page|feed|cart|checkout|account)\//.test(p) &&
        !/\.(xml|jpe?g|png|gif|webp|svg|pdf|zip|css|js)$/.test(p) &&
        p !== base &&
        p !== base + '/'
      )
    })
    .slice(0, limit)

  const now = new Date()

  const tasks = articles.map((url) => async (): Promise<StaleCandidate | null> => {
    try {
      const page = await scrapePageContent(url)
      if (page.wordCount < 80) return null // nav-only / non-article page
      const v = validateArticle(wrapForValidation(page.contentHtml, page.title, language), EMPTY_RESEARCH, {
        targetWordCount: 1800,
        siteUrl,
      })
      const s = v.stats

      // Freshness: AI citations decay once a page stops being updated, so factor age in.
      const lastmod = lastmodByUrl.get(url) ?? null
      let ageDays: number | null = null
      if (lastmod) {
        const t = Date.parse(lastmod)
        if (!Number.isNaN(t)) ageDays = Math.floor((now.getTime() - t) / 86_400_000)
      }

      // Fair, format-agnostic citability for an existing page (NOT graded against our house template).
      const geoScore = externalCitabilityScore(s, ageDays)

      // Actionable gaps — only generic, format-agnostic signals (no "Framework": that's our own house
      // style, never a fair criticism of someone's existing page).
      const missing: string[] = []
      if (!s.hasQuickAnswer) missing.push(en ? 'Direct answer up top' : 'Risposta diretta in cima')
      if (!s.hasFaq && !s.hasFaqSchemaBlock) missing.push('FAQ')
      if (!s.hasFaqSchemaBlock) missing.push(en ? 'FAQ schema' : 'Schema FAQ')
      if (!s.hasFonti && s.authoritativeExternalCount === 0) missing.push(en ? 'Authoritative sources' : 'Fonti autorevoli')
      if (!s.hasAuthorLine) missing.push(en ? 'Author / E-E-A-T' : 'Autore / E-E-A-T')
      if (s.internalLinkCount < 3) missing.push(en ? 'Internal links' : 'Link interni')
      if (s.wordCount < 1200) missing.push(en ? 'Depth' : 'Profondità')
      if (ageDays != null && ageDays > 120) missing.push(en ? 'Freshness' : 'Freschezza')

      let priority = 100 - geoScore + missing.length * 5 + (s.wordCount < 1000 ? 20 : 0)
      if (ageDays != null && ageDays > 90) priority += 15
      else if (ageDays != null && ageDays > 30) priority += 8

      return { url, title: page.title, wordCount: page.wordCount, seoScore: v.seoScore, geoScore, missing, lastmod, ageDays, priority }
    } catch {
      return null
    }
  })

  const results = await pLimitLocal(tasks, 4)
  return (results.filter(Boolean) as StaleCandidate[]).sort((a, b) => b.priority - a.priority)
}

/** Scrape a public URL and run the full refresh/augment on it in one step. */
export async function augmentFromUrl(opts: {
  url: string
  keyword?: string
  siteUrl: string
  siteName: string
  niche: string
  language?: string
  languageHint?: string
  market?: string
  targetWordCount?: number
  authorLine?: string
  projectId?: string
  /** Commercial pages the refreshed article must funnel authority to (from project.metadata.money_pages). */
  moneyPages?: MoneyPage[]
}): Promise<AugmentResult> {
  const page = await scrapePageContent(opts.url)
  if (page.wordCount < 80) {
    throw new Error('Pagina troppo corta o non leggibile — impossibile estrarre il contenuto da aggiornare.')
  }
  return augmentStandaloneArticle({
    existingContent: page.contentHtml,
    keyword: opts.keyword?.trim() || page.title,
    siteUrl: opts.siteUrl,
    siteName: opts.siteName,
    niche: opts.niche,
    language: opts.language,
    languageHint: opts.languageHint,
    market: opts.market,
    targetWordCount: opts.targetWordCount,
    authorLine: opts.authorLine,
    projectId: opts.projectId,
    sourceUrl: opts.url,
    moneyPages: opts.moneyPages,
  })
}

// ─── SCHEMA GENERATION (premium action behind "missing schema" findings) ─────────

export interface GeneratedSchema {
  url: string
  title: string
  /** Raw <script type="application/ld+json"> Article block, ready to paste in <head>. */
  articleJsonLd: string
  /** Raw FAQPage JSON-LD when the page exposes Q&A, else null. */
  faqJsonLd: string | null
  faqCount: number
}

/** Pull simple FAQ pairs from arbitrary article HTML: a "...?" heading followed by its answer text. */
function extractFaqPairs(html: string): Array<{ q: string; a: string }> {
  const faqs: Array<{ q: string; a: string }> = []
  const re = /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>([\s\S]*?)(?=<h[2-4][^>]*>|$)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && faqs.length < 10) {
    const q = stripTags(m[1] ?? '')
    const a = stripTags(m[2] ?? '').slice(0, 700)
    if (q.endsWith('?') && a.length > 30) faqs.push({ q, a })
  }
  return faqs
}

/**
 * Generate ready-to-paste structured data for a real page: scrape it, then emit Article + (when
 * present) FAQPage JSON-LD using the page's REAL title / description / Q&A — no fabrication.
 */
export async function generateSchemaForUrl(opts: {
  url: string
  siteName: string
  siteUrl: string
  authorLine?: string
}): Promise<GeneratedSchema> {
  const page = await scrapePageContent(opts.url)
  if (page.wordCount < 40) throw new Error('Pagina troppo corta o non leggibile per generare lo schema.')

  const description = stripTags(page.contentHtml).slice(0, 155)
  const author =
    opts.authorLine?.split('|')[0]?.replace(/^A cura (di|del)\s*/i, '').trim() || opts.siteName
  const nowIso = new Date().toISOString()

  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: page.title,
    description,
    author: { '@type': 'Person', name: author },
    publisher: { '@type': 'Organization', name: opts.siteName, url: opts.siteUrl.replace(/\/$/, '') },
    url: opts.url,
    dateModified: nowIso,
  }

  const faqs = extractFaqPairs(page.contentHtml)
  const faqJsonLd =
    faqs.length >= 2
      ? jsonLdScript({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faqs.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        })
      : null

  return { url: opts.url, title: page.title, articleJsonLd: jsonLdScript(article), faqJsonLd, faqCount: faqs.length }
}

// ─── OPTIONAL PUBLISH (when a WordPress channel is connected) ────────────────────

export interface PublishStandaloneResult {
  wpPostId: number
  wpPostUrl: string
}

/**
 * Publish an already-generated article to the project's connected WordPress site.
 * Connector-optional: only callable when a wp_connections row exists for the project.
 */
export async function publishStandaloneArticle(
  projectId: string,
  article: ArticleContent,
  status: 'publish' | 'draft' = 'draft'
): Promise<PublishStandaloneResult> {
  // Publishing runs server-side (wp-publish edge function): the WordPress application password is
  // column-locked for browser clients (migration 027) and must never reach the client. The function
  // uploads the featured image, ensures the category and writes the Rank Math meta itself.
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean
    postId?: number
    postUrl?: string
    error?: string
  }>('wp-publish', {
    body: {
      projectId,
      status,
      article: {
        title: article.title,
        slug: article.slug,
        contentHtml: article.gutenbergContent,
        excerpt: article.metaDescription,
        featuredImageUrl: article.featuredImageUrl,
        categoryName: defaultBlogCategoryName(article.language),
        rankMath: {
          title: article.metaTitle,
          description: article.metaDescription,
          focusKeyword: article.focusKeyword,
        },
      },
    },
  })

  if (error) {
    // FunctionsHttpError carries the response; surface the server's error code when present.
    let code = ''
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const body = (await ctx.json()) as { error?: unknown } | null
        code = String(body?.error ?? '')
      }
    } catch {
      /* ignore */
    }
    if (code === 'no_connection') throw new Error('Nessun sito WordPress collegato a questo progetto.')
    if (code === 'redirect_not_allowed') throw new Error('Il sito WordPress risponde con un redirect: controlla l’URL del sito (http/https, www).')
    throw new Error(code ? `Pubblicazione WordPress fallita (${code})` : 'Pubblicazione WordPress fallita')
  }
  if (!data?.ok || typeof data.postId !== 'number') {
    throw new Error(data?.error ? `Pubblicazione WordPress fallita (${data.error})` : 'Pubblicazione WordPress fallita')
  }

  return { wpPostId: data.postId, wpPostUrl: data.postUrl ?? '' }
}

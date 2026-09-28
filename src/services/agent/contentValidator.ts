/**
 * contentValidator.ts — Pre-publish quality gate for the Rankdelta pipeline.
 *
 * Enforces the GEO/SEO requirements defined by the seo-geo-content skill.
 * Runs pure regex/string analysis on Gutenberg block HTML — no DOM, no side-effects.
 *
 * Usage:
 *   const result = validateArticle(article, research, { targetWordCount: 2000, siteUrl: 'https://mysite.it' })
 *   if (!result.passed) console.error(result.issues.filter(i => i.severity === 'error'))
 */

import type { ArticleContent, ResearchResult } from './types'
import { scoreDomainAuthority } from './citationVerifier'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ValidationIssue {
  severity: 'error' | 'warning'
  /** Machine-readable code, e.g. 'missing_quick_answer' */
  code: string
  /** Human-readable message in Italian */
  message: string
}

export interface ValidationStats {
  wordCount: number
  h2Count: number
  h3Count: number
  /** <a href> pointing to the same site (relative or matching siteUrl host) */
  internalLinkCount: number
  /** <a href> pointing to external domains */
  externalLinkCount: number
  /** External links whose domain is authoritative (.gov, .edu, PubMed, etc.) */
  authoritativeExternalCount: number
  hasQuickAnswer: boolean
  hasFaq: boolean
  faqCount: number
  /** rank-math/faq-block Gutenberg comment present */
  hasFaqSchemaBlock: boolean
  hasStripesTable: boolean
  hasFonti: boolean
  hasAuthorLine: boolean
  /** wp:html block that contains a scoped <style> tag (infographic pattern) */
  hasInfographic: boolean
  /** Proprietary brand-owned framework block (strongest GEO signal — original, citable) */
  hasFramework: boolean
  /** Placeholder link patterns: [link…], LINK:, href="#", "esempio.com", etc. */
  placeholderLinks: string[]
  /** Percentages / "N su N" patterns not near a citation signal — heuristic */
  suspectedFabricatedStats: string[]
}

export interface ValidationResult {
  /** false if any issue has severity 'error' */
  passed: boolean
  issues: ValidationIssue[]
  /** 0-100 SEO score derived from real content signals */
  seoScore: number
  /** 0-100 GEO score derived from real content signals */
  geoScore: number
  stats: ValidationStats
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip all HTML tags and collapse whitespace to count words. */
function stripTagsAndCount(html: string): number {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .split(/\s+/)
    .filter(Boolean).length
}

/** Extract the hostname from a URL string; returns '' on failure. */
function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

// Fast path-based signal (catches e.g. pubmed/ncbi article IDs that live in the URL path).
const AUTHORITATIVE_RE =
  /pubmed|ncbi|nih\.gov|who\.int|\.gov\.|\.gov$|\.edu\.|\.edu$/i

/**
 * A link is authoritative if its path carries a known signal OR its domain is classified as
 * authoritative by the shared scorer in citationVerifier (the single source of truth — recognises
 * .gov/.edu, PubMed/WHO/Nature, ECB/Eurostat, national institutions like Banca d'Italia/ISTAT,
 * and major publishers). Keeping both modules in agreement avoids the gate rejecting a legit
 * citation the research step already verified.
 */
function isAuthoritative(href: string): boolean {
  if (AUTHORITATIVE_RE.test(href)) return true
  const host = extractHostname(href)
  if (!host) return false
  if (host.endsWith('.gov') || host.endsWith('.edu')) return true
  return scoreDomainAuthority(host).isAuthoritative
}

/** Determine if a link href is internal relative to siteUrl. */
function isInternalLink(href: string, siteHost: string): boolean {
  if (href.startsWith('/') && !href.startsWith('//')) return true
  if (!siteHost) return false
  const host = extractHostname(href)
  return host !== '' && (host === siteHost || host.endsWith('.' + siteHost))
}

// Regex: match all <a href="..."> values
const HREF_RE = /<a\s[^>]*href="([^"]*)"[^>]*>/gi

/** Collect all placeholder link patterns found in the HTML. */
function findPlaceholderLinks(html: string): string[] {
  const found: string[] = []
  // [link ...] or [LINK...]
  const bracketRe = /\[link[^\]]*\]/gi
  let m: RegExpExecArray | null
  while ((m = bracketRe.exec(html)) !== null) found.push(m[0])
  // LINK: pattern
  const colonRe = /\bLINK:[^\s<"]+/g
  while ((m = colonRe.exec(html)) !== null) found.push(m[0])
  // href="#" (anchor-only placeholder)
  const anchorRe = /href="#"/gi
  while ((m = anchorRe.exec(html)) !== null) found.push(m[0])
  // common placeholder domains
  const exampleRe = /href="[^"]*esempio\.com[^"]*"/gi
  while ((m = exampleRe.exec(html)) !== null) found.push(m[0])
  const exampleCom = /href="[^"]*example\.com[^"]*"/gi
  while ((m = exampleCom.exec(html)) !== null) found.push(m[0])
  // template URLs copied from the prompt (e.g. https://URL-FONTE-1, https://URL-SOURCE-2)
  for (const t of html.matchAll(/href="[^"]*\bURL[-_](?:FONTE|FONTI|SOURCE|SOURCES)\b[^"]*"/gi)) found.push(t[0])
  return [...new Set(found)]
}

/**
 * Heuristic: find "NN%" or "N su N" patterns that are NOT within ~200 chars
 * of a citation signal (a link, "fonte", "secondo", "studio", "ricerca").
 */
function findSuspectedFabricatedStats(html: string): string[] {
  const suspected: string[] = []
  const statRe = /\b(\d[\d.,]*\s*%|\d+\s+su\s+\d+)\b/gi
  const citationSignal = /href=|fonte|secondo|studio|ricerca|report|survey|dati/i
  let m: RegExpExecArray | null
  while ((m = statRe.exec(html)) !== null) {
    const start = Math.max(0, m.index - 200)
    const end = Math.min(html.length, m.index + m[0].length + 200)
    const context = html.slice(start, end)
    if (!citationSignal.test(context)) {
      suspected.push(m[0])
    }
  }
  return [...new Set(suspected)]
}

/** Heading text that marks a FAQ section, in IT or EN (the model sometimes emits either). */
const FAQ_LABEL = `(?:FAQ|[Dd]omande\\s+[Ff]requenti|[Dd]omande|[Ff]requently\\s+[Aa]sked\\s+[Qq]uestions)`

/** Count FAQ <dt> or <li> items inside a FAQ section. */
function countFaqItems(html: string): number {
  // rank-math faq-block pattern
  const rmMatches = html.match(/class="[^"]*rank-math-faq[^"]*"/gi)
  if (rmMatches) {
    // count dt or question divs
    const dtCount = (html.match(/<dt[\s>]/gi) || []).length
    const questionDivCount = (html.match(/class="[^"]*rank-math-faq-q[^"]*"/gi) || []).length
    if (dtCount > 0) return dtCount
    if (questionDivCount > 0) return questionDivCount
  }
  // generic FAQ: look for <h3> inside a section tagged FAQ / Domande / Frequently Asked Questions
  const faqSectionRe = new RegExp(`(?:## FAQ|<h2[^>]*>[^<]*${FAQ_LABEL}[^<]*<\\/h2>)([\\s\\S]{0,4000}?)(?=<h2|$)`, 'i')
  const faqSection = faqSectionRe.exec(html)
  if (faqSection) {
    const faqBody = faqSection[1] ?? ''
    const h3Count = (faqBody.match(/<h3[\s>]/gi) || []).length
    const dtCount2 = (faqBody.match(/<dt[\s>]/gi) || []).length
    return Math.max(h3Count, dtCount2)
  }
  // fallback: count any FAQ-labelled headings
  const faqHeadings = (html.match(new RegExp(`<h[23][^>]*>[^<]*${FAQ_LABEL}[^<]*<\\/h[23]>`, 'gi')) || []).length
  return faqHeadings
}

// ─── Core export ──────────────────────────────────────────────────────────────

/**
 * Validate an article against the SEO/GEO publishing requirements.
 *
 * @param content     - The fully assembled ArticleContent from the writing agent.
 * @param research    - The ResearchResult for this article (used for Fonti check).
 * @param opts.targetWordCount  - Minimum target word count (default 1800).
 * @param opts.isPillar         - Pillar articles (or targetWordCount >= 3000) must have an infographic.
 * @param opts.siteUrl          - Used to classify internal vs. external links.
 */
export function validateArticle(
  content: ArticleContent,
  research: ResearchResult,
  opts?: { targetWordCount?: number; isPillar?: boolean; siteUrl?: string }
): ValidationResult {
  const targetWordCount = opts?.targetWordCount ?? 1800
  const isPillar = opts?.isPillar ?? targetWordCount >= 3000
  const siteUrl = opts?.siteUrl ?? ''
  const siteHost = siteUrl ? extractHostname(siteUrl) : ''

  const html = content.gutenbergContent

  // ── Compute stats ──────────────────────────────────────────────────────────

  const wordCount = stripTagsAndCount(html)

  const h2Count = (html.match(/<h2[\s>]/gi) || []).length
  const h3Count = (html.match(/<h3[\s>]/gi) || []).length

  // Collect all hrefs
  let internalLinkCount = 0
  let externalLinkCount = 0
  let authoritativeExternalCount = 0
  const hrefReCopy = new RegExp(HREF_RE.source, 'gi')
  let hrefMatch: RegExpExecArray | null
  while ((hrefMatch = hrefReCopy.exec(html)) !== null) {
    const href = hrefMatch[1]
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) continue
    if (isInternalLink(href, siteHost)) {
      internalLinkCount++
    } else {
      externalLinkCount++
      if (isAuthoritative(href)) authoritativeExternalCount++
    }
  }

  const hasQuickAnswer =
    /class="[^"]*quick-answer-box[^"]*"/.test(html) ||
    /Risposta\s+[Rr]apida/.test(html) ||
    /Quick\s+Answer/i.test(html)

  const hasFaqSchemaBlock =
    /<!--\s*wp:rank-math\/faq-block/.test(html) ||
    /<!--\s*wp:yoast\/faq-block/.test(html) ||
    /class="[^"]*rank-math-faq[^"]*"/.test(html)

  const hasFaq =
    hasFaqSchemaBlock ||
    new RegExp(`<h[23][^>]*>[^<]*${FAQ_LABEL}[^<]*<\\/h[23]>`, 'i').test(html) ||
    /\bFAQ\b/.test(html)

  const faqCount = hasFaq ? Math.max(countFaqItems(html), hasFaq ? 1 : 0) : 0

  const hasStripesTable = /is-style-stripes/.test(html)

  // "Fonti" (IT) or "Sources"/"References" (EN) — English articles must not be penalized.
  const FONTI_LABEL = '(?:Fonti|Sources|References)'
  const hasFonti =
    new RegExp(`<h2[^>]*>[^<]*${FONTI_LABEL}[^<]*</h2>`, 'i').test(html) ||
    new RegExp(`<h3[^>]*>[^<]*${FONTI_LABEL}[^<]*</h3>`, 'i').test(html) ||
    new RegExp(`##\\s*${FONTI_LABEL}`, 'i').test(html) ||
    /id="(?:fonti|sources)"/i.test(html)

  const hasAuthorLine =
    !!content.authorLine ||
    /A\s+cura\s+del\s+team/i.test(html) ||
    /Pubblicato:/i.test(html) ||
    /By\s+the\s+.{1,60}\s+Team/i.test(html) ||
    /Published:/i.test(html)

  // Proprietary framework block (its own GEO signal — original, brand-owned, citable).
  const hasFramework = /class="astroseo-framework"/i.test(html)

  // Infographic: a wp:html block containing a <style scoped> or a data-viz / infographic class.
  // Exclude the proprietary framework so it isn't double-counted (it's a styled wp:html block too).
  const htmlSansFramework = html.replace(
    /<!--\s*wp:html\s*-->[\s\S]*?class="astroseo-framework"[\s\S]*?<!--\s*\/wp:html\s*-->/gi,
    ''
  )
  const hasInfographic =
    /<!--\s*wp:html\s*-->[\s\S]{0,2000}?<style[\s>][\s\S]{0,500}?<!--\s*\/wp:html\s*-->/i.test(htmlSansFramework) ||
    /class="[^"]*infographic[^"]*"/.test(htmlSansFramework) ||
    /class="[^"]*data-viz[^"]*"/.test(htmlSansFramework)

  const placeholderLinks = findPlaceholderLinks(html)
  const suspectedFabricatedStats = findSuspectedFabricatedStats(html)

  const stats: ValidationStats = {
    wordCount,
    h2Count,
    h3Count,
    internalLinkCount,
    externalLinkCount,
    authoritativeExternalCount,
    hasQuickAnswer,
    hasFaq,
    faqCount,
    hasFaqSchemaBlock,
    hasStripesTable,
    hasFonti,
    hasAuthorLine,
    hasInfographic,
    hasFramework,
    placeholderLinks,
    suspectedFabricatedStats,
  }

  // ── Collect issues ─────────────────────────────────────────────────────────

  const issues: ValidationIssue[] = []

  const err = (code: string, message: string): void => {
    issues.push({ severity: 'error', code, message })
  }
  const warn = (code: string, message: string): void => {
    issues.push({ severity: 'warning', code, message })
  }

  // ERRORS
  if (!hasQuickAnswer) {
    err('missing_quick_answer', 'Manca il box Risposta Rapida (quick-answer-box)')
  }

  if (!hasFaq) {
    err('missing_faq', 'Manca la sezione FAQ')
  } else if (faqCount < 5) {
    err(
      'insufficient_faq_questions',
      `La sezione FAQ ha solo ${faqCount} domanda/e (minimo 5 richieste)`
    )
  }

  const wordCountThreshold = Math.round(targetWordCount * 0.6)
  if (wordCount < wordCountThreshold) {
    err(
      'word_count_too_low',
      `Il conteggio parole è ${wordCount}, inferiore al 60% del target (${wordCountThreshold} su ${targetWordCount})`
    )
  }

  if (internalLinkCount < 6) {
    err(
      'insufficient_internal_links',
      `Trovati solo ${internalLinkCount} link interni (minimo 6 richiesti)`
    )
  }

  // A warning, not an error: when research yields fewer than 2 verified sources the article must
  // go out without citations rather than with invented ones (no-fabrication rule).
  if (authoritativeExternalCount < 2) {
    warn(
      'insufficient_authoritative_externals',
      `Trovati solo ${authoritativeExternalCount} link esterni autorevoli (.gov/.edu/PubMed/ecc.) — minimo 2 richiesti`
    )
  }

  if (placeholderLinks.length > 0) {
    err(
      'placeholder_links_present',
      `Trovati ${placeholderLinks.length} link placeholder: ${placeholderLinks.slice(0, 3).join(', ')}`
    )
  }

  // WARNINGS
  if (h2Count + h3Count < 10) {
    warn(
      'insufficient_headings',
      `Solo ${h2Count} H2 e ${h3Count} H3 (totale ${h2Count + h3Count}) — si consiglia almeno 10 titoli H2+H3`
    )
  }

  if (!hasStripesTable) {
    warn('missing_stripes_table', 'Manca la tabella is-style-stripes con dati comparativi')
  }

  const hasExternalSourcesInResearch = research.externalSources.length > 0
  if (hasExternalSourcesInResearch && !hasFonti) {
    warn(
      'missing_fonti_section',
      'Le fonti esterne sono presenti nella ricerca ma manca la sezione "Fonti" nell\'articolo'
    )
  }

  if (!hasAuthorLine) {
    warn('missing_author_line', 'Manca la riga autore ("A cura del team …")')
  }

  if (isPillar && !hasInfographic) {
    warn(
      'missing_infographic',
      'Gli articoli pillar (3000+ parole) richiedono almeno un blocco infografica (wp:html con stile scoped)'
    )
  }

  if (!hasFramework) {
    warn(
      'missing_framework',
      'Manca un framework proprietario di marca (metodo/checklist/rubrica originale) — è il segnale GEO più forte per farsi citare dalle AI'
    )
  }

  if (suspectedFabricatedStats.length > 0) {
    warn(
      'suspected_fabricated_stats',
      `${suspectedFabricatedStats.length} statistica/e sospette senza fonte vicina: ${suspectedFabricatedStats.slice(0, 3).join(', ')}`
    )
  }

  // ── Scores ─────────────────────────────────────────────────────────────────

  // SEO score (0-100): keyword presence, headings, table, internal links, length
  let seoScore = 0
  // Keyword in content (up to 15 pts)
  if (content.focusKeyword) {
    const kw = content.focusKeyword.toLowerCase()
    const htmlLower = html.toLowerCase()
    if (htmlLower.includes(kw)) seoScore += 10
    // keyword in first 500 chars = bonus
    if (htmlLower.slice(0, 500).includes(kw)) seoScore += 5
  }
  // Headings (up to 20 pts)
  seoScore += Math.min(h2Count * 2, 10)
  seoScore += Math.min(h3Count * 1, 10)
  // Stripes table (10 pts)
  if (hasStripesTable) seoScore += 10
  // Internal links (up to 20 pts)
  seoScore += Math.min(internalLinkCount * 2, 20)
  // Word count (up to 25 pts)
  const wordRatio = Math.min(wordCount / targetWordCount, 1.5)
  seoScore += Math.round(wordRatio * 25)
  // Meta completeness (10 pts)
  if (content.metaTitle && content.metaDescription) seoScore += 5
  if (content.metaTitle?.length >= 30 && content.metaTitle.length <= 65) seoScore += 5

  seoScore = Math.min(Math.max(seoScore, 0), 100)

  // GEO score (0-100): quick-answer, FAQ+schema, Fonti, authoritative externals, infographic
  let geoScore = 0
  // Quick answer box (20 pts)
  if (hasQuickAnswer) geoScore += 20
  // FAQ section (15 pts) + schema block bonus (10 pts)
  if (hasFaq) {
    geoScore += 10
    const faqBonus = Math.min((faqCount - 1) * 2, 5)
    geoScore += faqBonus
  }
  if (hasFaqSchemaBlock) geoScore += 10
  // Fonti section (15 pts)
  if (hasFonti) geoScore += 15
  // Authoritative external links (up to 15 pts)
  geoScore += Math.min(authoritativeExternalCount * 5, 15)
  // Infographic (10 pts)
  if (hasInfographic) geoScore += 10
  // Proprietary framework — the skill's strongest GEO signal (original, brand-owned, citable) (10 pts)
  if (hasFramework) geoScore += 10
  // Author line (5 pts)
  if (hasAuthorLine) geoScore += 5
  // No fabricated stats (bonus 5 pts if clean)
  if (suspectedFabricatedStats.length === 0) geoScore += 5
  // Penalty for placeholder links
  geoScore -= placeholderLinks.length * 5

  geoScore = Math.min(Math.max(geoScore, 0), 100)

  // ── Result ────────────────────────────────────────────────────────────────

  const passed = !issues.some((i) => i.severity === 'error')

  return { passed, issues, seoScore, geoScore, stats }
}

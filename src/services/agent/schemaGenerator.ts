/**
 * schemaGenerator.ts
 *
 * Pure functions that generate structured-data markup for AI citation and SEO.
 * All functions return strings of Gutenberg block HTML suitable for appending or
 * inserting into an ArticleContent.gutenbergContent field.
 *
 * Two FAQ strategies are supported:
 *  - Rank Math FAQ block (`rank-math/faq-block`) — preferred in WP + Rank Math installs;
 *    Rank Math auto-generates FAQPage JSON-LD from the block attributes.
 *  - Plain JSON-LD inside a `wp:html` block — fallback for non-Rank-Math sites.
 *
 * No dependencies outside the standard library. Math.random is not used; ids are
 * derived deterministically from the question text.
 */

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface FaqItem {
  question: string
  /** May contain inline HTML (e.g. <strong>, <a>). Preserved in Rank Math block; stripped for JSON-LD text values. */
  answer: string
}

export interface ArticleSchemaInput {
  headline: string
  description?: string
  authorName: string
  /** schema.org type of the author: a team/brand byline is an Organization (default Person). */
  authorType?: 'Person' | 'Organization'
  /** ISO-8601 date string, e.g. "2026-01-15" */
  datePublished: string
  /** ISO-8601 date string; defaults to datePublished when absent */
  dateModified?: string
  publisherName: string
  publisherUrl: string
  /** The brand's real profile/social URLs (Organization sameAs) — strongest entity/E-E-A-T signal. */
  sameAs?: string[]
  imageUrl?: string
  articleUrl?: string
}

export interface HowToStep {
  name: string
  text: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simple deterministic hash → 8 hex chars — no crypto dependency needed. */
function simpleHash(str: string): string {
  let h = 0x811c9dc5 // FNV offset basis (32-bit)
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h * 0x01000193) >>> 0 // FNV prime, keep 32-bit unsigned
  }
  return h.toString(16).padStart(8, '0')
}

/** Generate a deterministic FAQ id from index + question text. */
function faqId(index: number, question: string): string {
  return `faq-${index.toString().padStart(2, '0')}${simpleHash(question).slice(0, 6)}`
}

/** HTML-escape a plain string for safe use inside HTML / JSON-LD string values. */
function htmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Strip HTML tags from a string, leaving only text content. */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

/** Drop script/style/iframe and inline handlers from FAQ answer HTML. */
export function sanitizeFaqHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<\/?(?:iframe|object|embed|link|meta|base)\b[^>]*>/gi, '')
}

/**
 * Serialize JSON-LD so `</script>` in a string value cannot break out of the
 * wrapping `<script type="application/ld+json">` tag.
 */
export function jsonLdScript(payload: unknown): string {
  const json = JSON.stringify(payload, null, 2).replace(/</g, '\\u003c')
  return `<script type="application/ld+json">\n${json}\n</script>`
}

/** Wrap a JSON-LD script in a Gutenberg wp:html block. */
function wrapInHtmlBlock(scriptContent: string): string {
  const safe = scriptContent.replace(/</g, '\\u003c')
  return (
    `<!-- wp:html -->\n` +
    `<script type="application/ld+json">${safe}</script>\n` +
    `<!-- /wp:html -->`
  )
}

// ─── Exported functions ───────────────────────────────────────────────────────

/**
 * Build a Rank Math FAQ Gutenberg block.
 *
 * Rank Math reads the `questions` array from the block comment and auto-generates
 * a FAQPage JSON-LD schema — no separate schema markup is needed when this block
 * is present. The inner HTML mirrors what Rank Math renders on the frontend.
 *
 * IDs are generated deterministically from position + a hash of the question text
 * so repeated calls with identical input are stable (no Math.random).
 */
export function buildFaqRankMathBlock(faqs: FaqItem[]): string {
  if (faqs.length === 0) return ''

  // Build the questions array that goes into the block comment attribute
  const questions = faqs.map((faq, i) => ({
    id: faqId(i, faq.question),
    title: htmlEscape(faq.question),
    // answer must be wrapped in <p> per Rank Math spec
    content: faq.answer.trimStart().startsWith('<p')
      ? sanitizeFaqHtml(faq.answer)
      : `<p>${sanitizeFaqHtml(faq.answer)}</p>`,
    visible: true,
  }))

  const questionsJson = JSON.stringify(questions)

  // Inner HTML list items — one per FAQ
  const listItems = questions
    .map(
      (q) =>
        `<div class="rank-math-list-item">\n` +
        `<h3 class="rank-math-question">${q.title}</h3>\n` +
        `<div class="rank-math-answer">${q.content}</div>\n` +
        `</div>`
    )
    .join('\n')

  return (
    `<!-- wp:rank-math/faq-block {"questions":${questionsJson}} -->\n` +
    `<div class="wp-block-rank-math-faq-block"><div class="rank-math-faq-list">\n` +
    listItems +
    `\n</div></div>\n` +
    `<!-- /wp:rank-math/faq-block -->`
  )
}

/**
 * Build a plain FAQPage JSON-LD script wrapped in a `wp:html` Gutenberg block.
 *
 * Use this as a fallback when Rank Math is not installed or the FAQ block cannot
 * be used. HTML tags are stripped from answer text inside JSON-LD values.
 */
export function buildFaqJsonLdBlock(faqs: FaqItem[]): string {
  if (faqs.length === 0) return ''

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: htmlEscape(faq.question),
      acceptedAnswer: {
        '@type': 'Answer',
        text: htmlEscape(stripTags(faq.answer)),
      },
    })),
  }

  return wrapInHtmlBlock(JSON.stringify(schema, null, 2))
}

/**
 * Build an Article (or BlogPosting) JSON-LD script inside a `wp:html` block.
 *
 * Sets `@type` to "Article" — callers may post-process the string to replace
 * with "BlogPosting" or "NewsArticle" if needed.
 */
export function buildArticleSchemaBlock(input: ArticleSchemaInput): string {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: htmlEscape(input.headline),
    ...(input.description ? { description: htmlEscape(input.description) } : {}),
    author: {
      '@type': input.authorType ?? 'Person',
      name: htmlEscape(input.authorName),
    },
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    publisher: {
      '@type': 'Organization',
      name: htmlEscape(input.publisherName),
      url: input.publisherUrl,
      ...(input.sameAs && input.sameAs.length > 0 ? { sameAs: input.sameAs } : {}),
    },
    ...(input.imageUrl
      ? {
          image: {
            '@type': 'ImageObject',
            url: input.imageUrl,
          },
        }
      : {}),
    ...(input.articleUrl ? { url: input.articleUrl } : {}),
  }

  return wrapInHtmlBlock(JSON.stringify(schema, null, 2))
}

/**
 * Build a HowTo JSON-LD script inside a `wp:html` block.
 *
 * @param name         The name/title of the how-to procedure.
 * @param steps        Ordered list of steps, each with a short name and longer text.
 * @param totalTimeISO Optional ISO-8601 duration string, e.g. "PT30M" for 30 minutes.
 */
export function buildHowToSchemaBlock(
  name: string,
  steps: HowToStep[],
  totalTimeISO?: string
): string {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: htmlEscape(name),
    ...(totalTimeISO ? { totalTime: totalTimeISO } : {}),
    step: steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: htmlEscape(s.name),
      text: htmlEscape(stripTags(s.text)),
    })),
  }

  return wrapInHtmlBlock(JSON.stringify(schema, null, 2))
}

/**
 * Extract FAQ Q/A pairs from Gutenberg HTML.
 *
 * Handles two formats:
 *  1. Rank Math `rank-math/faq-block` — parses the `questions` JSON from the block comment.
 *  2. Plain Gutenberg H3+paragraph pairs that appear after a heading whose text matches
 *     "FAQ", "Domande frequenti", "Frequently asked questions" (case-insensitive).
 *
 * Best-effort: malformed or unexpected markup is silently skipped.
 */
export function extractFaqsFromContent(gutenbergHtml: string): FaqItem[] {
  // ── Strategy 1: Rank Math block ────────────────────────────────────────────
  const rmMatch = gutenbergHtml.match(
    /<!--\s*wp:rank-math\/faq-block\s+(\{[\s\S]*?\})\s*-->/
  )
  if (rmMatch) {
    try {
      const rawAttr = rmMatch[1]
      if (rawAttr) {
        const parsed = JSON.parse(rawAttr) as {
          questions?: Array<{ title?: string; content?: string }>
        }
        if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
          const items: FaqItem[] = []
          for (const q of parsed.questions) {
            if (q.title && q.content) {
              items.push({
                question: stripTags(q.title).trim(),
                answer: q.content.trim(),
              })
            }
          }
          if (items.length > 0) return items
        }
      }
    } catch (_err) {
      // fall through to strategy 2
    }
  }

  // ── Strategy 2: H3+paragraph pairs after a FAQ heading ────────────────────
  // Find the last occurrence of a FAQ-style heading (tolerant to TOC duplication).
  // Supported heading text patterns (case-insensitive):
  //   "FAQ", "Domande frequenti", "Frequently asked questions", "Preguntas frecuentes"
  const faqHeadingPattern =
    /domande\s+frequenti|frequently\s+asked\s+questions?|preguntas\s+frecuentes|\bfaq\b/i

  // Find all heading positions and pick the last one that matches the FAQ pattern
  const headingRegex = /<!--\s*wp:heading[^>]*-->\s*<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>\s*<!--\s*\/wp:heading\s*-->/gi
  let faqStart = -1
  let match: RegExpExecArray | null

  while ((match = headingRegex.exec(gutenbergHtml)) !== null) {
    const cap = match[1]
    if (cap !== undefined) {
      const headingText = stripTags(cap)
      if (faqHeadingPattern.test(headingText)) {
        faqStart = match.index + match[0].length
      }
    }
  }

  if (faqStart === -1) return []

  const faqRegion = gutenbergHtml.slice(faqStart)

  // Extract H3 blocks followed immediately by paragraph blocks
  const h3BlockPattern =
    /<!--\s*wp:heading\s*(?:\{[^}]*\})?\s*-->\s*<h3[^>]*>([\s\S]*?)<\/h3>\s*<!--\s*\/wp:heading\s*-->/g
  const paraBlockPattern =
    /<!--\s*wp:paragraph[^>]*-->\s*(<p[\s\S]*?<\/p>)\s*<!--\s*\/wp:paragraph\s*-->/g

  const h3Matches: Array<{ question: string; endIndex: number }> = []
  let h3Match: RegExpExecArray | null
  while ((h3Match = h3BlockPattern.exec(faqRegion)) !== null) {
    const cap1 = h3Match[1]
    if (cap1 !== undefined) {
      h3Matches.push({
        question: stripTags(cap1).trim(),
        endIndex: h3Match.index + h3Match[0].length,
      })
    }
  }

  if (h3Matches.length === 0) return []

  const faqs: FaqItem[] = []

  for (let i = 0; i < h3Matches.length; i++) {
    const current = h3Matches[i]
    if (current === undefined) continue
    const nextItem = h3Matches[i + 1]
    // The region to search for answer paragraphs ends at the next H3 (or end of faqRegion)
    const nextStart = nextItem !== undefined ? nextItem.endIndex : faqRegion.length
    const betweenHeadings = faqRegion.slice(current.endIndex, nextStart)

    // Collect all paragraph blocks between this H3 and the next one
    const answerParts: string[] = []
    paraBlockPattern.lastIndex = 0
    let paraMatch: RegExpExecArray | null
    while ((paraMatch = paraBlockPattern.exec(betweenHeadings)) !== null) {
      const pcap = paraMatch[1]
      if (pcap !== undefined) {
        answerParts.push(pcap.trim())
      }
    }

    if (answerParts.length > 0) {
      faqs.push({
        question: current.question,
        answer: answerParts.join('\n'),
      })
    }
  }

  return faqs
}

/**
 * Returns true if the Gutenberg HTML already contains a `rank-math/faq-block`.
 * Use this to avoid inserting a duplicate FAQ schema block.
 */
export function hasFaqSchemaBlock(gutenbergHtml: string): boolean {
  return /<!--\s*wp:rank-math\/faq-block\b/.test(gutenbergHtml)
}

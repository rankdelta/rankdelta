/**
 * Content Finalizer — the quality gate between WRITE and PUBLISH.
 *
 * Turns the seo-geo skill's checklist into an ENFORCED, deterministic step:
 *   1. Validate the article against the skill (Quick Answer, FAQ, Fonti, links, length…)
 *   2. Inject structured data the LLM can't be trusted to format: FAQPage JSON-LD +
 *      Article JSON-LD (Rank Math also picks up the visible FAQ).
 *   3. For pillar content, generate + insert ID-scoped HTML infographics if missing.
 *   4. Return the finalized Gutenberg content + the validation verdict (so the
 *      orchestrator can publish as draft / flag for review when it fails).
 */

import type { ArticleContent, ResearchResult } from './types'
import { validateArticle, type ValidationResult } from './contentValidator'
import {
  buildFaqJsonLdBlock,
  buildArticleSchemaBlock,
  extractFaqsFromContent,
  hasFaqSchemaBlock,
} from './schemaGenerator'
import { generateInfographicBlocks, type InfographicBrand } from './infographics'
import { generateFrameworkBlock } from './proprietaryFramework'
import { authorFromByline } from '../../lib/contentLanguages'

export interface FinalizeConfig {
  siteName: string
  siteUrl: string
  niche: string
  targetWordCount: number
  publishDateIso: string
  /** when true, generate infographics + enforce pillar-grade length */
  isPillar?: boolean
  brandColors?: { primary?: string; accent?: string }
  /** The brand's real profile/social URLs → Organization sameAs in the Article schema (brand E-E-A-T). */
  brandProfiles?: string[]
  /** ORIGINAL publish date (ISO) when REFRESHING existing content — keeps datePublished real and lets
   *  dateModified=now signal "updated" (freshness). Omit for brand-new articles (then published=now). */
  originalPublishDateIso?: string
}

export interface FinalizeResult {
  content: string
  validation: ValidationResult
  addedFaqSchema: boolean
  addedArticleSchema: boolean
  addedInfographics: number
  addedFramework: boolean
}

/** Insert blocks after the Nth `<!-- /wp:heading -->` occurrence (1-based). Falls back to append. */
function insertAfterHeading(content: string, block: string, headingOrdinal: number): string {
  const marker = '<!-- /wp:heading -->'
  let idx = -1
  let count = 0
  let from = 0
  while (count < headingOrdinal) {
    const next = content.indexOf(marker, from)
    if (next === -1) break
    idx = next
    from = next + marker.length
    count++
  }
  if (idx === -1) return content + '\n' + block
  const pos = idx + marker.length
  return content.slice(0, pos) + '\n' + block + '\n' + content.slice(pos)
}

export async function finalizeArticle(
  article: ArticleContent,
  research: ResearchResult,
  config: FinalizeConfig
): Promise<FinalizeResult> {
  let content = article.gutenbergContent
  let addedFaqSchema = false
  let addedArticleSchema = false
  let addedInfographics = 0
  let addedFramework = false

  // ── 1. FAQ schema (invisible JSON-LD; keeps the existing visible FAQ as-is) ──
  try {
    if (!hasFaqSchemaBlock(content)) {
      const faqs = extractFaqsFromContent(content)
      if (faqs.length >= 3) {
        content += '\n' + buildFaqJsonLdBlock(faqs)
        addedFaqSchema = true
      }
    }
  } catch (e) {
    console.warn('[Finalize] FAQ schema injection failed:', e)
  }

  // ── 2. Article JSON-LD ──
  try {
    // "By the X Team" / "A cura del team X" is a brand, not a person → Organization author.
    const author = authorFromByline(article.authorLine, config.siteName)
    content += '\n' + buildArticleSchemaBlock({
      headline: article.title,
      description: article.metaDescription,
      authorName: author.name,
      authorType: author.type,
      datePublished: config.originalPublishDateIso ?? config.publishDateIso,
      dateModified: config.publishDateIso,
      publisherName: config.siteName,
      publisherUrl: config.siteUrl,
      ...(config.brandProfiles && config.brandProfiles.length > 0 ? { sameAs: config.brandProfiles } : {}),
    })
    addedArticleSchema = true
  } catch (e) {
    console.warn('[Finalize] Article schema injection failed:', e)
  }

  // ── 3. Infographics for pillar content (skill: 2 per pillar) ──
  const isPillar = config.isPillar ?? config.targetWordCount >= 3000
  if (isPillar && !content.includes('<!-- wp:html -->')) {
    try {
      const brand: InfographicBrand = {
        siteName: config.siteName,
        siteUrl: config.siteUrl,
        primaryColor: config.brandColors?.primary,
        accentColor: config.brandColors?.accent,
      }
      const blocks = await generateInfographicBlocks(article.focusKeyword, research, config.niche, brand, {
        count: 2,
        language: article.language,
      })
      // insert after the 2nd and 4th H2-ish headings so they're spread through the body
      blocks.forEach((b, i) => {
        content = insertAfterHeading(content, b.html, (i + 1) * 2)
        addedInfographics++
      })
    } catch (e) {
      console.warn('[Finalize] Infographic generation failed:', e)
    }
  }

  // ── 3b. Proprietary framework (strongest GEO signal: original, brand-owned, citable) ──
  try {
    const block = await generateFrameworkBlock(article.focusKeyword, config.niche, {
      siteName: config.siteName,
      primaryColor: config.brandColors?.primary,
      accentColor: config.brandColors?.accent,
    }, article.language)
    if (block) {
      // Place early (after the 1st section heading) for visibility + extractability.
      content = insertAfterHeading(content, block, 1)
      addedFramework = true
    }
  } catch (e) {
    console.warn('[Finalize] framework generation failed:', e)
  }

  // ── 4. Validate the FINAL content ──
  const finalArticle: ArticleContent = { ...article, gutenbergContent: content }
  const validation = validateArticle(finalArticle, research, {
    targetWordCount: config.targetWordCount,
    isPillar,
    siteUrl: config.siteUrl,
  })

  return { content, validation, addedFaqSchema, addedArticleSchema, addedInfographics, addedFramework }
}

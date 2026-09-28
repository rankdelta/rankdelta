/**
 * websiteAnalysis.ts — "Generate with AI" from a URL.
 *
 * The activation move every competitor makes (BabyLoveGrowth, RankYak): the user types their URL
 * and we pre-fill the whole project profile by reading the site, so setup is correct (= the data
 * the whole product depends on) with near-zero effort. The user still REVIEWS/EDITS before saving
 * ("AI proposes → you confirm"), which is also a data-quality safeguard.
 *
 * Best-effort + resilient: scrape can fail (CORS/proxy), the LLM can wobble — we always return a
 * partial profile (possibly empty fields), never throw.
 */

import { type ContentLanguage, defaultUiContentLanguage, promptLangName } from '../lib/contentLanguages'
import { complete } from './openrouter'
import { scrapePageContent } from './agent/standaloneContent'

export interface WebsiteProfile {
  brandName: string
  /** 2–3 sentence business description (→ author bio / context). */
  description: string
  /** 3–5 audience segments. */
  targetAudience: string[]
  /** The primary search term the business should rank for. */
  primaryKeyword: string
  /** Broad content category/topic. */
  mainTopic: string
  /** Niche/expertise category for E-E-A-T (e.g. "Cybersecurity", "Finanza personale"). */
  expertise: string
  /** Content language for generated profile fields. */
  language: ContentLanguage
  /** City / area the business serves when it is clearly local (e.g. "Milano"); empty otherwise. */
  locality?: string
}

/**
 * Build the extraction prompt for a given OUTPUT language. The source site may be in any
 * language, but every human-readable field (description, audience, topic, keyword, expertise)
 * must be written in `outLang` — otherwise an English-speaking user who points us at an Italian
 * site gets an Italian profile they can't read. brandName stays as the real brand (not translated).
 */
function buildSystemPrompt(outLang: ContentLanguage): string {
  const languageName = promptLangName(outLang)
  return `You are a marketing analyst. You receive the homepage content of a website (which may be in any language). Extract a structured, REAL business profile faithful to the site (no inventions).

IMPORTANT: Write every text value — description, targetAudience, primaryKeyword, mainTopic, expertise — in ${languageName}, translating from the source language if needed. Do NOT echo the site's language; always output in ${languageName}. Keep "brandName" as the real brand name (do not translate it). Set "language" to "${outLang}".

Respond with VALID JSON only:
{"brandName":"...","description":"2-3 sentences on what the business does","targetAudience":["segment 1","segment 2","segment 3"],"primaryKeyword":"the main search query it should rank for (2-4 words)","mainTopic":"broad content category","expertise":"niche category for E-E-A-T (1-3 words)","locality":"the city or area the business serves if it is clearly local (e.g. Milano, Provincia di Bergamo); empty string if national or online-only","language":"${outLang}"}`
}

/**
 * Analyze a public URL and return a pre-filled project profile. Never throws.
 * @param outputLanguage Language the profile text should be written in (defaults to Italian, the
 *   majority audience). Pass the app's current UI language so the user reads the profile in their
 *   own language regardless of the site's language.
 */
export async function analyzeWebsite(siteUrl: string, outputLanguage: ContentLanguage = defaultUiContentLanguage('it')): Promise<WebsiteProfile> {
  const empty: WebsiteProfile = {
    brandName: '',
    description: '',
    targetAudience: [],
    primaryKeyword: '',
    mainTopic: '',
    expertise: '',
    language: outputLanguage,
  }

  let title = ''
  let text = ''
  try {
    const page = await scrapePageContent(siteUrl)
    title = page.title
    text = page.contentHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3500)
  } catch (e) {
    console.warn('[WebsiteAnalysis] scrape failed:', e)
  }
  if (text.length < 60) {
    // Nothing readable — return brand name guessed from the host so the form isn't empty.
    try {
      const host = new URL(siteUrl.includes('://') ? siteUrl : `https://${siteUrl}`).hostname.replace(/^www\./, '')
      empty.brandName = (host.split('.')[0] ?? '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    } catch {
      /* ignore */
    }
    return empty
  }

  try {
    const raw = await complete(
      [{ role: 'user', content: `URL: ${siteUrl}\nTitle: ${title}\n\nHomepage content:\n${text}` }],
      { model: 'openai/gpt-4o-mini', temperature: 0.3, maxTokens: 600, systemPrompt: buildSystemPrompt(outputLanguage), timeoutMs: 30_000 },
    )
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as Partial<WebsiteProfile>
    return {
      brandName: (parsed.brandName || empty.brandName || title.split(/[-|–—:]/)[0] || '').trim(),
      description: (parsed.description || '').trim(),
      targetAudience: Array.isArray(parsed.targetAudience) ? parsed.targetAudience.filter(Boolean).slice(0, 5) : [],
      primaryKeyword: (parsed.primaryKeyword || '').trim(),
      mainTopic: (parsed.mainTopic || '').trim(),
      expertise: (parsed.expertise || '').trim(),
      locality: (parsed.locality || '').trim().slice(0, 60),
      // We instructed the model to write in `outputLanguage`; trust that over a stray detected value.
      language: outputLanguage,
    }
  } catch (e) {
    console.warn('[WebsiteAnalysis] LLM extraction failed:', e)
    return empty
  }
}

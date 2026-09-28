/**
 * Audit Agent — Stage 1 of the pipeline.
 *
 * Given a site URL, it:
 *   1. Fetches the sitemap and collects all indexed URLs
 *   2. Analyzes existing content to map covered topics
 *   3. Runs keyword gap analysis via DataForSEO
 *   4. Identifies the top 10 content opportunities
 *   5. Detects niche, language, and competitor landscape
 *
 * Output feeds the Planning Agent.
 */

import { orchestrate } from '../openrouter'
import { getEnrichedKeywordData } from '../dataforseo'
import type { SiteAuditResult, ContentGap, TechnicalIssue } from './types'
import { createPublicWPClient } from '../wordpress'
import type { WPSiteInfo } from '../wordpress'
import { detectSiteLanguage } from './standaloneContent'
import { languageCodeFromInput, promptLangName, resolveContentLanguage, type ContentLanguage } from '../../lib/contentLanguages'
import { projectResearchLocale, researchMarketByCode } from '../../lib/seoMarkets'

/** Where the autopilot's content language and keyword market come from. */
export interface AuditLocaleContext {
  /** wp_connections.site_language */
  siteLanguage?: string | null
  /** projects.language */
  projectLanguage?: string | null
  /** projects.market (WorkspaceMarket, e.g. 'IT', 'US', 'global') */
  projectMarket?: string | null
}

/**
 * The language the autopilot writes in, by priority: the site's own `<html lang>` (ground truth),
 * then the WordPress connection's stored language, then the project language, then the audit
 * LLM's guess, then English. Never Italian by default.
 */
export async function resolveAutopilotLanguage(
  siteUrl: string,
  ctx: AuditLocaleContext,
  llmLanguage?: string | null
): Promise<ContentLanguage> {
  const detected = await detectSiteLanguage(siteUrl)
  return resolveContentLanguage([detected, ctx.siteLanguage, ctx.projectLanguage, llmLanguage])
}

function auditSystemPrompt(language: ContentLanguage | null, marketName: string | null): string {
  const market = marketName ? `the ${marketName} market` : "the site's target market"
  const lang = language
    ? `The site is written in ${promptLangName(language)}: write every keyword in ${promptLangName(language)}.`
    : 'Write every keyword in the language the site is written in.'
  return `You are an SEO expert for ${market}.
Analyze the data provided about a website and:
1. Identify the main niche and the site's language
2. Identify the topics already covered
3. Suggest the 10 keywords/topics with the most potential that are not yet covered
4. Assess competitiveness and search intent

${lang}
"language" must be the site's ISO 639-1 code (e.g. "en", "it", "de"), never a language name.

ALWAYS answer with valid JSON only, no text outside the JSON:
{"niche":"...","language":"en","coveredTopics":["..."],"competitors":["..."],"contentGaps":[{"keyword":"...","intent":"informational|commercial|transactional|navigational","priority":"high|medium|low","rationale":"..."}]}`
}

interface AuditLLMOutput {
  niche: string
  language: string
  coveredTopics: string[]
  competitors: string[]
  contentGaps: Array<{
    keyword: string
    intent: 'informational' | 'commercial' | 'transactional' | 'navigational'
    priority: 'high' | 'medium' | 'low'
    rationale: string
  }>
}

export async function runAuditAgent(
  wpConnection: Pick<WPSiteInfo, 'siteUrl'>,
  _projectId: string,
  locale: AuditLocaleContext = {}
): Promise<SiteAuditResult> {
  // Public reads only (sitemap + published posts): no credentials exist in the browser.
  const client = createPublicWPClient(wpConnection)

  // 0. Language BEFORE the LLM: the site's own signal, then stored settings (see resolveAutopilotLanguage).
  const detected = await detectSiteLanguage(wpConnection.siteUrl)
  const knownLanguage =
    languageCodeFromInput(detected) ??
    languageCodeFromInput(locale.siteLanguage) ??
    languageCodeFromInput(locale.projectLanguage)
  const knownContentLanguage = knownLanguage ? resolveContentLanguage([knownLanguage]) : null
  const marketName = researchMarketByCode(locale.projectMarket)?.name ?? null

  // 1. Fetch all URLs from sitemap
  console.log('[Audit] Fetching sitemap...')
  const sitemapEntries = await client.getSitemapUrls()
  const indexedUrls = sitemapEntries.map((e) => e.url)

  // 2. Get existing posts to understand covered topics
  console.log('[Audit] Fetching existing posts...')
  const posts = await client.getPosts()
  const existingTopics = posts.map((p) => p.title.rendered).filter(Boolean)

  // 3. Ask LLM to analyze and find gaps
  const siteContext = `
Site URL: ${wpConnection.siteUrl}
Indexed pages (${indexedUrls.length} total, first 30 shown):
${indexedUrls.slice(0, 30).join('\n')}

Existing articles (${existingTopics.length} total):
${existingTopics.slice(0, 50).join('\n')}
`

  console.log('[Audit] Analyzing content gaps with AI...')
  const rawAnalysis = await orchestrate(
    auditSystemPrompt(knownContentLanguage, marketName),
    `Analyze this website and find its content gaps:\n${siteContext}`
  )

  let analysis: AuditLLMOutput
  try {
    const jsonMatch = rawAnalysis.match(/\{[\s\S]*\}/)
    analysis = JSON.parse(jsonMatch?.[0] ?? rawAnalysis) as AuditLLMOutput
  } catch {
    throw new Error('Audit LLM returned invalid JSON')
  }

  const language = resolveContentLanguage([knownLanguage, analysis.language])

  // 4. Enrich content gaps with real DataForSEO metrics — in the project's market and the
  //    site's language (never a hardcoded Italy/it).
  console.log('[Audit] Fetching keyword metrics from DataForSEO...')
  const gapKeywords = analysis.contentGaps.map((g) => g.keyword)
  let enrichedGaps: ContentGap[] = analysis.contentGaps.map((g) => ({
    keyword: g.keyword,
    estimatedVolume: 0,
    difficulty: 50,
    intent: g.intent,
    priority: g.priority,
    rationale: g.rationale,
  }))

  try {
    const { locationCode, languageCode } = projectResearchLocale({ market: locale.projectMarket, language })
    const metrics = await getEnrichedKeywordData(gapKeywords, locationCode, languageCode)
    enrichedGaps = enrichedGaps.map((gap) => {
      const m = metrics.find(
        (k: { keyword: string }) => k.keyword.toLowerCase() === gap.keyword.toLowerCase()
      )
      return m
        ? { ...gap, estimatedVolume: m.search_volume ?? 0, difficulty: m.difficulty ?? 50 }
        : gap
    })
  } catch (e) {
    console.warn('[Audit] DataForSEO metrics failed, using defaults:', e)
  }

  // Sort by priority + volume
  enrichedGaps.sort((a, b) => {
    const priorityScore = { high: 3, medium: 2, low: 1 }
    const pDiff = priorityScore[b.priority] - priorityScore[a.priority]
    return pDiff !== 0 ? pDiff : b.estimatedVolume - a.estimatedVolume
  })

  // 5. Basic technical issues check
  const technicalIssues: TechnicalIssue[] = []
  if (posts.length < 10) {
    technicalIssues.push({
      type: 'thin_content',
      url: wpConnection.siteUrl,
      description:
        language === 'it'
          ? `Il sito ha solo ${posts.length} articoli pubblicati. Poca massa critica per posizionarsi.`
          : `The site has only ${posts.length} published articles: not enough depth to rank.`,
      severity: 'warning',
    })
  }

  return {
    siteUrl: wpConnection.siteUrl,
    totalPages: indexedUrls.length,
    indexedUrls,
    existingTopics,
    contentGaps: enrichedGaps.slice(0, 10),
    technicalIssues,
    competitors: analysis.competitors ?? [],
    language,
    niche: analysis.niche ?? 'general',
    auditedAt: new Date().toISOString(),
  }
}

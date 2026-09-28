/**
 * Research Agent — Stage 3 of the pipeline.
 *
 * For a given keyword + site, it:
 *   1. Pulls SERP top-10 + People-Also-Ask + Related searches in ONE DataForSEO call
 *   2. Best-effort measures real competitor word counts (CORS-graceful)
 *   3. Finds internal link opportunities from REAL existing site content
 *   4. Proposes external sources, then VERIFIES them (2-step) + scores authority;
 *      falls back ONLY to authoritative pages ranking in the SERP, never to unverified proposals
 *   5. Computes a recommended word count
 *
 * The skill SEO/GEO framework requires:
 *   - 6-10 real internal links (no placeholders) — sourced from the site's own posts
 *   - 2-3 external authoritative sources, VERIFIED (no fabricated citations; fewer is a warning)
 *   - PAA questions for the FAQ block
 */

import { getSerpInsights, resolveLocale } from '../dataforseo'
import { orchestrate } from '../openrouter'
import { verifyExternalSources, scoreDomainAuthority } from './citationVerifier'
import { extractCompetitorHeadings } from './standaloneContent'
import type { ResearchResult, InternalLink, ExternalSource } from './types'
import type { WPSiteInfo } from '../wordpress'
import { createPublicWPClient } from '../wordpress'

const INTERNAL_LINK_SYSTEM_PROMPT = `Sei un esperto di internal linking SEO.
Data una keyword target e una lista di articoli esistenti sul sito, identifica quali articoli sono più rilevanti come link interni per il nuovo articolo.
Per ogni link suggerito, suggerisci anche l'anchor text naturale e descrittivo (mai "clicca qui").
Rispondi con JSON array: [{url, anchorText, relevanceScore}] dove relevanceScore è 0-1.
Massimo 10 link. Solo JSON, nient'altro.`

const SOURCE_PROPOSAL_PROMPT = `Sei un ricercatore esperto. Data una keyword, proponi 3-4 fonti autorevoli REALI e verificabili che potrebbero essere citate in un articolo su questo topic. Preferisci fonti primarie:
- Salute/scienza: PubMed, NIH, ISS, OMS/WHO, università
- Finanza: Banca d'Italia, Consob, IVASS, BCE
- Diritto: Gazzetta Ufficiale, Normattiva
- Dati/statistica: ISTAT, Eurostat
- Tecnologia: IEEE, ACM, documentazione ufficiale
Proponi SOLO URL che sei certo esistano: ogni URL verrà aperto e verificato, quelli inesistenti vengono scartati. Rispondi con JSON: [{url, title, domain, isAuthoritative, snippet}]. Solo JSON.`

/** Best-effort: fetch a page and count its words. Returns null on CORS/network failure. */
async function fetchWordCount(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const html = await res.text()
    // strip scripts/styles then tags
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
    const words = text.split(/\s+/).filter(Boolean).length
    return words > 200 ? words : null // ignore blocked/empty shells
  } catch {
    return null
  }
}

export async function runResearchAgent(
  keyword: string,
  siteUrl: string,
  wpConnection: Pick<WPSiteInfo, 'siteUrl'>,
  language = 'it',
  market?: string
): Promise<ResearchResult> {
  console.log(`[Research] Starting research for: "${keyword}"`)
  const { locationCode, languageCode } = resolveLocale(market, language)

  // 1. SERP + PAA + Related — ONE call (was 3 identical paid calls)
  let serpTopUrls: string[] = []
  let serpOrganic: Array<{ url: string; title: string }> = []
  let peopleAlsoAsk: string[] = []
  let relatedKeywords: string[] = []
  let competitorWordCounts: number[] = []

  try {
    const serp = await getSerpInsights(keyword, locationCode, languageCode)
    serpTopUrls = serp.organic.map((r) => r.url).slice(0, 10)
    serpOrganic = serp.organic.slice(0, 10).map((r) => ({ url: r.url, title: r.title }))
    peopleAlsoAsk = serp.peopleAlsoAsk.slice(0, 8).map((q) => q.question)
    relatedKeywords = serp.relatedSearches.slice(0, 10)

    // 2. Real competitor word counts — best effort, CORS-graceful
    const topUrls = serp.organic.slice(0, 5).map((r) => r.url)
    const counts = await Promise.all(topUrls.map((u) => fetchWordCount(u)))
    competitorWordCounts = counts.filter((c): c is number => c != null)
  } catch (e) {
    console.warn('[Research] SERP analysis failed:', e)
  }

  // recommended length: beat the measured average by 20%, else a strong pillar default
  const measuredAvg =
    competitorWordCounts.length > 0
      ? competitorWordCounts.reduce((a, b) => a + b, 0) / competitorWordCounts.length
      : null
  const recommendedWordCount = measuredAvg
    ? Math.max(2200, Math.round(measuredAvg * 1.2))
    : 2800

  // 3. Internal links from REAL existing site content (valid by construction)
  // Public read of published posts — no credentials in the browser.
  const client = createPublicWPClient(wpConnection)
  let internalLinks: InternalLink[] = []

  try {
    const posts = await client.getPosts()
    const postsContext = posts
      .slice(0, 60)
      .map((p) => `${p.link} | ${p.title.rendered}`)
      .join('\n')

    const rawLinks = await orchestrate(
      INTERNAL_LINK_SYSTEM_PROMPT,
      `Keyword target: "${keyword}"\n\nArticoli esistenti sul sito:\n${postsContext}`
    )
    const jsonMatch = rawLinks.match(/\[[\s\S]*\]/)
    const parsed = JSON.parse(jsonMatch?.[0] ?? '[]') as InternalLink[]
    // keep only links that point to real posts we actually fetched
    const realUrls = new Set(posts.map((p) => p.link))
    internalLinks = parsed
      .filter((l) => realUrls.has(l.url))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 10)
    // if the model dropped real URLs, backfill from posts so we always have ≥6
    if (internalLinks.length < 6) {
      for (const p of posts) {
        if (internalLinks.length >= 8) break
        if (!internalLinks.some((l) => l.url === p.link)) {
          internalLinks.push({ url: p.link, anchorText: p.title.rendered, relevanceScore: 0.3 })
        }
      }
    }
  } catch (e) {
    console.warn('[Research] Internal link analysis failed:', e)
  }

  // 4. External sources — ONLY verified or SERP-derived. LLM-proposed URLs are used only if they pass
  // the 2-step verification (page fetched + Perplexity support). If too few verify, we top up with
  // authoritative pages that actually rank for the keyword (real by construction) — never with raw
  // LLM proposals. Fewer than 2 sources is a validator WARNING, not a reason to invent citations.
  let externalSources: ExternalSource[] = []
  const serpAuthoritative: ExternalSource[] = serpOrganic
    .map((r) => ({ r, auth: scoreDomainAuthority(r.url) }))
    .filter(({ auth }) => auth.isAuthoritative)
    .map(({ r, auth }) => ({ url: r.url, title: r.title, domain: auth.domain, snippet: '', isAuthoritative: true }))
  try {
    const rawSources = await orchestrate(
      SOURCE_PROPOSAL_PROMPT,
      `Keyword: "${keyword}"\nLingua: ${language}\nNicchia del sito: ${siteUrl}`
    )
    const jsonMatch = rawSources.match(/\[[\s\S]*\]/)
    const proposed = (JSON.parse(jsonMatch?.[0] ?? '[]') as ExternalSource[]).map((s) => {
      const auth = scoreDomainAuthority(s.url || s.domain || '')
      return { ...s, domain: s.domain || auth.domain, isAuthoritative: auth.isAuthoritative }
    })

    // verify against the live web; keep only sources that actually check out
    const checks = await verifyExternalSources(proposed, keyword, language)
    externalSources = proposed
      .filter((_, i) => checks[i]?.verified)
      .filter((s) => s.isAuthoritative)
      .slice(0, 4)
  } catch (e) {
    console.warn('[Research] External sources failed:', e)
  }
  if (externalSources.length < 2) {
    const seen = new Set(externalSources.map((s) => (s.domain || s.url).toLowerCase()))
    for (const s of serpAuthoritative) {
      if (externalSources.length >= 3) break
      const host = (s.domain || s.url).toLowerCase()
      if (seen.has(host)) continue
      seen.add(host)
      externalSources.push(s)
    }
  }

  console.log(
    `[Research] Done: ${internalLinks.length} internal, ${externalSources.length} verified external, ${peopleAlsoAsk.length} PAA, ${competitorWordCounts.length} real competitor counts`
  )

  return {
    keyword,
    serpTopUrls,
    peopleAlsoAsk,
    relatedKeywords,
    internalLinks,
    externalSources,
    competitorWordCounts,
    competitorHeadings: await extractCompetitorHeadings(serpTopUrls).catch(() => [] as string[]),
    recommendedWordCount,
  }
}

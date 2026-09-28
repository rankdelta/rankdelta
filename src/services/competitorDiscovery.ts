/**
 * competitorDiscovery.ts — auto-discover a brand's real competitors from just its URL.
 *
 * This is the "magic onboarding" move (AirOps/Profound do it): the user shouldn't have to think
 * of competitors — we infer them. Two real signals, merged:
 *   1. SERP: who actually ranks for the brand's core keyword (real competing domains).
 *   2. LLM: named direct competitors for the brand's niche, with domains.
 * We exclude the brand's own domain and generic platforms (wikipedia, amazon, social, review
 * aggregators…) that are never "competitors". Returns a clean, deduped, ready-to-save list.
 */

import { complete } from './openrouter'
import { getSerpInsights, resolveLocale } from './dataforseo'
import { scoreDomainAuthority } from './agent/citationVerifier'

export interface DiscoveredCompetitor {
  name: string
  domain: string
}

/** Domains that are platforms/aggregators, never direct competitors. */
const GENERIC_HOSTS = [
  'wikipedia.org', 'amazon.', 'youtube.com', 'reddit.com', 'facebook.com', 'linkedin.com',
  'twitter.com', 'x.com', 'instagram.com', 'pinterest.', 'medium.com', 'quora.com', 'g2.com',
  'capterra.com', 'trustpilot.', 'getapp.com', 'producthunt.com', 'glassdoor.', 'indeed.com',
  'tripadvisor.', 'yelp.', 'booking.com', 'gov', 'wordpress.org', 'github.com', 'apple.com',
  'play.google.com', 'apps.apple.com', 'forbes.com', 'gartner.com',
  // Mega-tech platforms whose pages rank for almost any query (support/learn/docs), so they
  // leak in as false "competitors" for niche brands (e.g. "Microsoft" on a niche SaaS). Never a
  // realistic same-scale SoV peer; a user can still add one manually if it genuinely applies.
  'microsoft.com', 'google.com', 'bing.com', 'ibm.com', 'oracle.com', 'sap.com',
]

function hostOf(urlOrDomain: string): string {
  try {
    const u = urlOrDomain.includes('://') ? urlOrDomain : `https://${urlOrDomain}`
    return new URL(u).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return urlOrDomain.replace(/^https?:\/\//, '').replace(/^www\./i, '').split('/')[0]?.toLowerCase() ?? ''
  }
}

export const isGeneric = (host: string) => GENERIC_HOSTS.some((g) => (g.endsWith('.') ? host.includes(g) : host === g || host.endsWith(`.${g}`) || host.includes(g)))

/** Title-case a bare domain into a readable brand name ("compass-security.com" → "Compass Security"). */
function nameFromDomain(domain: string): string {
  const core = domain.replace(/\.(com|net|org|io|ai|co|it|ch|de|fr|es|uk|eu)(\.[a-z]{2})?$/i, '').split('.').pop() ?? domain
  return core.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim() || domain
}

export interface DiscoverCompetitorsOptions {
  siteUrl: string
  brandName?: string
  /** A primary keyword / topic that describes what the brand does. */
  keyword?: string
  niche?: string
  language?: string
  market?: string
  /** Max competitors to return (default 5). */
  limit?: number
}

/**
 * Discover up to `limit` real competitors for a brand. Best-effort and resilient: if SERP or the
 * LLM is unavailable it returns whatever it found (possibly []), never throws.
 */
export async function discoverCompetitors(opts: DiscoverCompetitorsOptions): Promise<DiscoveredCompetitor[]> {
  const limit = opts.limit ?? 5
  const language = opts.language ?? 'it'
  const ownHost = hostOf(opts.siteUrl)
  const brandName = opts.brandName || nameFromDomain(ownHost)
  const seen = new Set<string>([ownHost])
  const out: DiscoveredCompetitor[] = []

  const add = (name: string, domain: string) => {
    const host = hostOf(domain)
    if (!host || seen.has(host) || isGeneric(host)) return
    seen.add(host)
    // A competitor is a BRAND, not a sentence. SERP titles ("Servizi di consulenza Cybersecurity…")
    // and over-long LLM strings are never brand names and never match in AI answers — fall back to
    // the brand name derived from the registrable domain (the real, matchable identity).
    const clean = name.trim()
    const looksLikeBrand = clean && clean.split(/\s+/).length <= 3 && clean.length <= 40
    out.push({ name: looksLikeBrand ? clean : nameFromDomain(host), domain: host })
  }

  // 1. SERP — domains that actually rank for the brand's core query. This is the strongest signal
  //    for *direct, same-scale* competitors (who you really compete with in your market), as opposed
  //    to the famous global leaders an LLM tends to name. Names come from the DOMAIN, not the result
  //    title, so a generic keyword can't seed junk "brands".
  const serpQuery = opts.keyword || opts.niche
  if (serpQuery) {
    try {
      const { locationCode, languageCode } = resolveLocale(opts.market, language)
      const serp = await getSerpInsights(serpQuery, locationCode, languageCode)
      for (const r of serp.organic.slice(0, 12)) {
        const host = hostOf(r.url)
        if (!host || isGeneric(host)) continue
        add(nameFromDomain(host), host)
        if (out.length >= limit) break
      }
    } catch (e) {
      console.warn('[Competitors] SERP discovery failed:', e)
    }
  }

  // 2. LLM — named competitors to FILL remaining slots when SERP is thin. Tuned to the brand's real
  //    SCALE and MARKET so it doesn't just return global market leaders (e.g. naming Palo Alto /
  //    CrowdStrike for a small local IT-consulting firm), which would never be realistic SoV peers.
  if (out.length < limit) {
    try {
      const SYSTEM = `You are a market analyst. List a brand's REAL DIRECT COMPETITORS — companies of SIMILAR SIZE serving the SAME market/country and the same kind of customer. Match the brand's scale: if it's a small or local/regional firm, name small/local competitors, NOT global market leaders. Do NOT list household-name giants unless the brand is itself a global leader. NEVER name mega-tech platforms (Microsoft, Google, Apple, Amazon, Meta, IBM, Oracle, SAP) unless the brand is itself a global platform of that exact scale — for a niche or mid-market product they are not real competitors. Each must be a real, verifiable company with its official website domain, using the actual brand NAME (never a generic service phrase). NO platforms (Wikipedia, Amazon, social, review sites). Reply with JSON ONLY: [{"name":"...","domain":"example.com"}]. Max ${limit} items.`
      const user = `Brand: ${brandName}\nSite: ${opts.siteUrl}\nSector/niche: ${opts.niche || opts.keyword || 'n/a'}\nMarket/country: ${opts.market || language}\n\nList same-scale, same-market direct competitor brands with their domain.`
      const raw = await complete([{ role: 'user', content: user }], {
        model: 'openai/gpt-4o-mini',
        temperature: 0.3,
        maxTokens: 500,
        systemPrompt: SYSTEM,
        timeoutMs: 30_000,
      })
      const arr = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as Array<{ name?: string; domain?: string }>
      for (const c of arr) {
        if (!c.domain) continue
        add(c.name || nameFromDomain(hostOf(c.domain)), c.domain)
        if (out.length >= limit) break
      }
    } catch (e) {
      console.warn('[Competitors] LLM discovery failed:', e)
    }
  }

  // Rank: prefer real, non-authority-aggregator brand sites; keep order stable otherwise.
  return out
    .slice(0, limit)
    .sort((a, b) => scoreDomainAuthority(a.domain).score - scoreDomainAuthority(b.domain).score)
}

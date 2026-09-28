/**
 * citationVerifier.ts
 *
 * MANDATORY 2-step citation verification for the Rankdelta agent pipeline.
 * Ensures NO fabricated or unsupported source reaches published content.
 *
 * Step 1 — Existence check: the URL is fetched through the seo-proxy Edge
 *           Function and must return a 2xx page with content.
 * Step 2 — Relevance check: Perplexity (live-web search) must confirm, with
 *           enough confidence, that the source supports the topic.
 *
 * Also provides a deterministic, synchronous domain-authority scorer for
 * GEO / E-E-A-T trust-tier classification.
 *
 * Concurrency: sources are verified in parallel, capped at 4 simultaneous
 * Perplexity calls to stay within rate limits.
 *
 * Graceful degradation: if Perplexity is not configured the whole batch
 * returns verified:false with an honest explanation — we NEVER hallucinate
 * a positive verification result.
 */

import type { ExternalSource } from './types'
import { prefersEnglishUi } from '../../lib/contentLanguages'
import { proxyFetchPage } from '../edgeProxy'
import {
  isPerplexityAvailable,
  verifyClaimWithPerplexity,
} from '../perplexity'

// ─── Domain Authority ─────────────────────────────────────────────────────────

export type AuthorityTier =
  | 'gov'
  | 'edu'
  | 'academic'
  | 'major_publisher'
  | 'official_org'
  | 'unknown'

export interface DomainAuthority {
  domain: string
  tier: AuthorityTier
  isAuthoritative: boolean
  /** 0-100 trust score */
  score: number
}

/** Lowercase hostname list for fast O(1) lookup */
const ACADEMIC_HOSTS = new Set([
  'pubmed.ncbi.nlm.nih.gov',
  'ncbi.nlm.nih.gov',
  'www.ncbi.nlm.nih.gov',
  'who.int',
  'www.who.int',
  'scholar.google.com',
  'scholar.google.it',
  'www.sciencedirect.com',
  'sciencedirect.com',
  'nature.com',
  'www.nature.com',
])

const MAJOR_PUBLISHER_HOSTS = new Set([
  'reuters.com',
  'www.reuters.com',
  'ft.com',
  'www.ft.com',
  'nytimes.com',
  'www.nytimes.com',
  'bbc.com',
  'www.bbc.com',
  'bbc.co.uk',
  'www.bbc.co.uk',
  'theguardian.com',
  'www.theguardian.com',
  'economist.com',
  'www.economist.com',
  'bloomberg.com',
  'www.bloomberg.com',
  'wsj.com',
  'www.wsj.com',
  'apnews.com',
  'www.apnews.com',
  'corriere.it',
  'www.corriere.it',
  'repubblica.it',
  'www.repubblica.it',
  'sole24ore.com',
  'www.sole24ore.com',
])

const OFFICIAL_ORG_HOSTS = new Set([
  'istat.it',
  'www.istat.it',
  'bancaditalia.it',
  'www.bancaditalia.it',
  'ecb.europa.eu',
  'www.ecb.europa.eu',
  'federalreserve.gov',
  'www.federalreserve.gov',
  'worldbank.org',
  'www.worldbank.org',
  'imf.org',
  'www.imf.org',
  'oecd.org',
  'www.oecd.org',
  'un.org',
  'www.un.org',
  'unicef.org',
  'www.unicef.org',
  'avma.org',
  'www.avma.org',
  'fao.org',
  'www.fao.org',
])

/** Extract the lowercase hostname from a URL or bare domain string. */
function extractHost(urlOrDomain: string): string {
  try {
    const withScheme = urlOrDomain.startsWith('http')
      ? urlOrDomain
      : `https://${urlOrDomain}`
    return new URL(withScheme).hostname.toLowerCase()
  } catch {
    return urlOrDomain.toLowerCase().replace(/^https?:\/\//, '').split('/')[0] ?? urlOrDomain.toLowerCase()
  }
}

/**
 * Pure, synchronous. Classifies a domain by trust tier for GEO/E-E-A-T.
 * No network calls — uses deterministic pattern matching.
 */
export function scoreDomainAuthority(urlOrDomain: string): DomainAuthority {
  const host = extractHost(urlOrDomain)
  // Bare domain for TLD checks (strip leading www.)
  const bare = host.replace(/^www\./, '')

  let tier: AuthorityTier = 'unknown'
  let score = 20

  // 1. Government: ends with .gov or country-level .gov.xx (e.g. .gov.uk, .gov.au)
  if (/\.gov$/.test(bare) || /\.gov\.[a-z]{2}$/.test(bare)) {
    tier = 'gov'
    score = 97
  }

  // 2. Education: ends with .edu or country-level .edu.xx, or *.ac.uk
  else if (/\.edu$/.test(bare) || /\.edu\.[a-z]{2}$/.test(bare) || /\.ac\.uk$/.test(bare)) {
    tier = 'edu'
    score = 93
  }

  // 3. Academic hosts: PubMed, NIH, WHO, scholar.google, ScienceDirect, Nature…
  else if (
    ACADEMIC_HOSTS.has(host) ||
    // *.nih.gov
    /\.nih\.gov$/.test(bare) ||
    // *.europa.eu (EMA, EFSA, Eurostat …)
    /\.europa\.eu$/.test(bare)
  ) {
    tier = 'academic'
    score = 88
  }

  // 4. Major news publishers
  else if (MAJOR_PUBLISHER_HOSTS.has(host)) {
    tier = 'major_publisher'
    score = 75
  }

  // 5. Recognisable official organisations
  else if (OFFICIAL_ORG_HOSTS.has(host)) {
    tier = 'official_org'
    score = 68
  }

  // 6. Generic .org — medium trust but not authoritative on its own
  else if (/\.org$/.test(bare)) {
    tier = 'official_org'
    score = 55
  }

  const isAuthoritative = tier !== 'unknown' && score >= 60

  return { domain: host, tier, isAuthoritative, score }
}

// ─── Citation Verification ────────────────────────────────────────────────────

export interface CitationCheck {
  source: ExternalSource
  /** Step 1: the source/page exists and is findable on the live web */
  exists: boolean
  /** Step 2: the source actually supports the claim/topic */
  supportsClaim: boolean
  /** exists && supportsClaim */
  verified: boolean
  /** 0-1 composite confidence */
  confidence: number
  /** Short explanation of the decision */
  note: string
}

/** Minimum Perplexity confidence (0-100) for "the source supports the topic". */
export const MIN_SUPPORT_CONFIDENCE = 60

/**
 * Statement handed to the Perplexity claim verifier: it answers {isVerified, confidence} about
 * whether THIS statement is true, so the statement itself is the relevance check.
 */
export function buildVerificationClaim(source: ExternalSource, topicOrClaims: string): string {
  return (
    `The web page "${source.title}" at ${source.url} exists and contains information that ` +
    `directly supports an article about "${topicOrClaims}".`
  )
}

/** A fetch through the proxy that returned a 2xx page with a non-empty body. */
export function isSuccessfulFetch(page: { ok: boolean; status: number; body: string } | null): boolean {
  return !!page && page.ok && page.status >= 200 && page.status < 300 && page.body.trim().length > 0
}

/**
 * Pure decision for one source.
 *  Step 1 (exists): the URL was fetched successfully through the proxy — Perplexity's opinion
 *          alone is not proof that a page exists.
 *  Step 2 (supportsClaim): Perplexity's structured verdict `isVerified` with enough confidence.
 * Anything missing or ambiguous → NOT verified.
 */
export function decideCitationVerification(input: {
  fetchOk: boolean
  fetchStatus?: number
  perplexity: { isVerified: boolean; confidence: number; explanation?: string } | null
}): { exists: boolean; supportsClaim: boolean; verified: boolean; confidence: number; note: string } {
  const exists = input.fetchOk
  const conf = input.perplexity ? Math.max(0, Math.min(100, input.perplexity.confidence)) : 0
  const supportsClaim = !!input.perplexity?.isVerified && conf >= MIN_SUPPORT_CONFIDENCE
  const verified = exists && supportsClaim
  const note = !exists
    ? `Page could not be fetched${input.fetchStatus ? ` (HTTP ${input.fetchStatus})` : ''}.`
    : !supportsClaim
      ? (input.perplexity?.explanation || 'The source does not clearly support the topic.').slice(0, 200)
      : (input.perplexity?.explanation || 'Page fetched and supports the topic.').slice(0, 200)
  return { exists, supportsClaim, verified, confidence: verified ? conf / 100 : 0, note }
}

/** Run at most `concurrency` promises at a time from `tasks`. */
async function pLimit<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let index = 0

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const current = index++
      // tasks[current] is always defined — index is guarded by while condition
      results[current] = await tasks[current]!()
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker)
  await Promise.all(workers)
  return results
}

/**
 * Verify a list of external sources against a topic/claims using Perplexity
 * (live-web search). Falls back gracefully (verified:false, honest note) if
 * Perplexity is unavailable or throws.
 *
 * Sources are checked in parallel, capped at 4 concurrent calls.
 */
export async function verifyExternalSources(
  sources: ExternalSource[],
  topicOrClaims: string,
  language: string = 'it'
): Promise<CitationCheck[]> {
  if (sources.length === 0) return []

  // Perplexity not configured — return honest failures for all
  if (!isPerplexityAvailable()) {
    const note =
      prefersEnglishUi(language)
        ? 'Verification skipped: Perplexity not configured (PERPLEXITY_API_KEY edge secret missing).'
        : 'Verifica non eseguita: Perplexity non configurata (secret PERPLEXITY_API_KEY sulla edge function).'

    return sources.map((source) => ({
      source,
      exists: false,
      supportsClaim: false,
      verified: false,
      confidence: 0,
      note,
    }))
  }

  const tasks = sources.map((source) => async (): Promise<CitationCheck> => {
    try {
      const claim = buildVerificationClaim(source, topicOrClaims)
      // Step 1 (fetch the real page) and step 2 (Perplexity live-web verdict) run in parallel.
      // verifyClaimWithPerplexity returns { isVerified, confidence, explanation, … }.
      const [page, result] = await Promise.all([
        proxyFetchPage(source.url).catch(() => null),
        verifyClaimWithPerplexity(claim, topicOrClaims),
      ])

      const decision = decideCitationVerification({
        fetchOk: isSuccessfulFetch(page),
        fetchStatus: page?.status,
        perplexity: result,
      })

      return { source, ...decision }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return {
        source,
        exists: false,
        supportsClaim: false,
        verified: false,
        confidence: 0,
        note:
          prefersEnglishUi(language)
            ? `Verification error: ${errMsg}`
            : `Errore durante la verifica: ${errMsg}`,
      }
    }
  })

  return pLimit(tasks, 4)
}

/**
 * Convenience wrapper: keep only sources that pass both verification steps,
 * then re-rank them by authority score (highest first) and confidence.
 */
export async function filterVerifiedSources(
  sources: ExternalSource[],
  topicOrClaims: string,
  language: string = 'it'
): Promise<ExternalSource[]> {
  const checks = await verifyExternalSources(sources, topicOrClaims, language)

  return checks
    .filter((c) => c.verified)
    .sort((a, b) => {
      const scoreA = scoreDomainAuthority(a.source.url).score + a.confidence * 10
      const scoreB = scoreDomainAuthority(b.source.url).score + b.confidence * 10
      return scoreB - scoreA
    })
    .map((c) => c.source)
}

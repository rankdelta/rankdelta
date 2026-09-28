/**
 * guidedAudit.ts — the product's front door: a single diagnosis that not only SCORES the site
 * but tells the user EXACTLY what to do next, in priority order, with a one-click action behind
 * every finding.
 *
 * It orchestrates two engines we already have:
 *   1. runSiteAudit()      → technical SEO (DataForSEO OnPage) + GEO-readiness sample + issues.
 *   2. findStaleContent()  → sitemap-wide scan of real pages → which articles are weak/outdated
 *                            (missing schema/FAQ/Risposta rapida/Fonti, thin, low GEO).
 *
 * …then fuses them into ONE health score with three honest dimensions (Tecnico · GEO · Freschezza)
 * and a ranked action plan. Each action carries WHY it matters and a `kind` the UI maps to a
 * one-click action (generate content, refresh a page, add schema, fix technical).
 */

import { normalizeContentLanguage, prefersEnglishUi } from '../../lib/contentLanguages'
import { runSiteAudit, type SiteAuditResult, type IssueSeverity } from '../siteAudit'
import { findStaleContent, type StaleCandidate } from './standaloneContent'

export type ActionKind =
  | 'refresh_page' // scrape + augment an existing weak/stale page
  | 'add_schema' // generate JSON-LD for pages missing structured data
  | 'generate_content' // write new content (gap / thin coverage)
  | 'improve_citability' // raise per-page GEO/E-E-A-T citability
  | 'fix_technical' // manual fix on the site, then re-audit

export interface GuidedAction {
  id: string
  title: string
  /** Plain-language reason this matters for Google AND AI citations. */
  why: string
  severity: IssueSeverity
  dimension: 'seo' | 'geo' | 'freshness'
  kind: ActionKind
  /** A page URL (refresh/schema/citability) or a topic (generate_content), when relevant. */
  target?: string
  /** Higher = do sooner. */
  priority: number
  /** Affected page count, when known. */
  count?: number
  /**
   * Pages the finding was actually found on, when it is page-level.
   *
   * `count` alone ("H1 mancante ×12") tells the user a number but not where to act, which made
   * page-level findings impossible to resolve. Absent for site-wide checks (robots.txt, llms.txt,
   * crawler access), where no page list exists by nature.
   */
  affectedUrls?: string[]
}

export interface GuidedAudit extends SiteAuditResult {
  /** 0–100 content-freshness/quality score from the sitemap scan (avg GEO of scanned pages). */
  freshnessScore: number | null
  /** Real pages scanned from the sitemap, ranked by refresh opportunity. */
  staleContent: StaleCandidate[]
  /** How many scanned pages are clearly weak (GEO < 50 or 2+ missing elements). */
  weakPageCount: number
  /** Blended health incl. freshness when available (else equals healthScore). */
  compositeHealth: number
  /** The ranked "do this next" plan. */
  plan: GuidedAction[]
}

const SEV_RANK: Record<IssueSeverity, number> = { critical: 0, warning: 1, opportunity: 2 }

/**
 * Page-QUALITY defects on EXISTING pages the content engine can fix by enriching the page
 * (NOT by writing a new article — that would create duplicates). These map to a refresh action.
 */
const PAGE_QUALITY_FIXABLE = new Set(['low_content_rate', 'small_page_size', 'geo_no_article_faq', 'no_h1_tag'])

export interface RunGuidedAuditOptions {
  siteUrl: string
  language?: string
  /**
   * UI locale (react-i18next `i18n.language`) for the user-facing action labels — kept SEPARATE
   * from `language` (the site's content language). An English UI on an Italian-content site must
   * still read the plan in English. Falls back to `language` when unset (back-compat).
   */
  uiLanguage?: string
  maxPages?: number
  /** How many sitemap pages to scrape for the content-freshness scan. */
  contentScanLimit?: number
}

export async function runGuidedAudit(opts: RunGuidedAuditOptions): Promise<GuidedAudit> {
  const language = normalizeContentLanguage(opts.language)
  // Labels follow the UI locale, not the content language. Fall back to content language when unset.
  const uiLanguage = opts.uiLanguage ?? opts.language

  // Run the technical/GEO audit and the content-freshness scan in parallel — neither blocks the other.
  const [auditRes, staleRes] = await Promise.allSettled([
    runSiteAudit({ siteUrl: opts.siteUrl, maxPages: opts.maxPages, language }),
    findStaleContent(opts.siteUrl, { language, uiLanguage, limit: opts.contentScanLimit ?? 16 }),
  ])

  if (auditRes.status === 'rejected') throw auditRes.reason
  const audit = auditRes.value
  const staleContent = staleRes.status === 'fulfilled' ? staleRes.value : []

  // Freshness score = average GEO score of the real pages we scanned (higher = healthier content).
  const freshnessScore =
    staleContent.length > 0
      ? Math.round(staleContent.reduce((s, c) => s + c.geoScore, 0) / staleContent.length)
      : null
  const weakPageCount = staleContent.filter((c) => c.geoScore < 50 || c.missing.length >= 2).length

  // Composite health: blend in freshness when we have it (content quality is half the GEO battle).
  const compositeHealth =
    freshnessScore != null
      ? Math.round(0.5 * audit.technicalScore + 0.25 * audit.geoReadinessScore + 0.25 * freshnessScore)
      : audit.healthScore

  const plan = buildActionPlan(audit, staleContent, uiLanguage)

  return {
    ...audit,
    freshnessScore,
    staleContent,
    weakPageCount,
    compositeHealth,
    plan,
  }
}

/**
 * Fuse audit issues + weak pages into one ranked, actionable plan.
 * `uiLanguage` drives the user-facing label locale (NOT the site's content language).
 * Exported for unit testing.
 */
export function buildActionPlan(audit: SiteAuditResult, stale: StaleCandidate[], uiLanguage?: string): GuidedAction[] {
  const en = prefersEnglishUi(uiLanguage)
  const actions: GuidedAction[] = []

  // 1. Site-wide GEO gap: schema markup missing → one decisive action (generate schema).
  const schemaIssue = audit.issues.find((i) => i.code === 'geo_no_schema')
  if (schemaIssue) {
    actions.push({
      id: 'add_schema_sitewide',
      title: en
        ? `Add structured data (schema) — ${schemaIssue.count} pages without JSON-LD`
        : `Aggiungi i dati strutturati (schema) — ${schemaIssue.count} pagine senza JSON-LD`,
      why: en
        ? 'Without schema markup, AI struggles to understand and cite your pages: it’s the most underrated GEO signal. We generate it for you.'
        : 'Senza schema markup le AI faticano a capire e citare le tue pagine: è il segnale GEO più sottovalutato. Lo generiamo noi.',
      severity: 'warning',
      dimension: 'geo',
      kind: 'add_schema',
      priority: 86,
      count: schemaIssue.count,
    })
  }

  // 2. Weak/outdated pages from the real sitemap scan → one refresh action each (top ones).
  const weak = stale.filter((c) => c.geoScore < 60 || c.missing.length >= 2).slice(0, 6)
  for (const c of weak) {
    actions.push({
      id: `refresh:${c.url}`,
      title: en ? `Update "${c.title}"` : `Aggiorna "${c.title}"`,
      why: en
        ? `GEO ${c.geoScore}/100${c.missing.length ? ` · missing: ${c.missing.slice(0, 3).join(', ')}` : ''}. ` +
          'We’ll enrich the page with the missing GEO/SEO elements while keeping what works.'
        : `GEO ${c.geoScore}/100${c.missing.length ? ` · manca: ${c.missing.slice(0, 3).join(', ')}` : ''}. ` +
          'Arricchiamo la pagina con gli elementi GEO/SEO mancanti mantenendo ciò che funziona.',
      severity: c.geoScore < 30 ? 'critical' : c.geoScore < 50 ? 'warning' : 'opportunity',
      dimension: 'freshness',
      kind: 'refresh_page',
      target: c.url,
      priority: 75 - Math.round(c.geoScore / 4) + Math.min(c.missing.length, 6),
      count: 1,
    })
  }

  // 3. Per-page citability lift for thin GEO scores not covered above.
  const lowCitability = stale.filter((c) => c.geoScore < 70 && !weak.includes(c)).slice(0, 3)
  for (const c of lowCitability) {
    actions.push({
      id: `citability:${c.url}`,
      title: en ? `Improve the AI citability of "${c.title}"` : `Migliora la citabilità AI di "${c.title}"`,
      why: en
        ? 'Low citability score: few AIs would cite you. Let’s see what to add (experience, data, E-E-A-T).'
        : 'Punteggio di citabilità basso: poche AI ti citerebbero. Vediamo cosa aggiungere (esperienza, dati, E-E-A-T).',
      severity: 'opportunity',
      dimension: 'geo',
      kind: 'improve_citability',
      target: c.url,
      priority: 50,
      count: 1,
    })
  }

  // 4. Remaining audit issues. Page-quality defects (thin content, missing H1, no Article/FAQ) are
  //    fixed by ENRICHING the affected page (refresh) — never by writing a new article, which would
  //    duplicate. When a single page is affected it's almost always the audited home/landing page, so
  //    we target audit.siteUrl for a direct deep-link; multi-page issues route to Diagnosi to pick the
  //    page. Everything else is technical guidance the user applies site-side, then re-audits.
  for (const iss of audit.issues) {
    if (iss.code === 'geo_no_schema') continue // already handled
    const isPageQuality = PAGE_QUALITY_FIXABLE.has(iss.code)
    // Prefer the pages the audit actually flagged. The old fallback guessed `audit.siteUrl` for a
    // single-page issue, which silently pointed at the wrong page whenever the crawl had sampled
    // anything other than the homepage — and gave no target at all once count > 1.
    const affected = iss.urls ?? []
    const singlePageTarget = isPageQuality && affected.length === 1 ? affected[0] : undefined
    actions.push({
      id: `issue:${iss.code}`,
      title: iss.label + (iss.count ? ` (${iss.count})` : ''),
      why: iss.why,
      severity: iss.severity,
      dimension: iss.dimension,
      kind: isPageQuality ? 'refresh_page' : 'fix_technical',
      ...(singlePageTarget ? { target: singlePageTarget } : {}),
      // Every page the finding covers, so a multi-page issue is still resolvable. Empty for
      // site-wide checks, where there is no page list by nature.
      ...(affected.length ? { affectedUrls: affected } : {}),
      priority: (100 - SEV_RANK[iss.severity] * 25) - 30 + Math.min(iss.count ?? 0, 10),
      count: iss.count,
    })
  }

  return actions.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.priority - a.priority)
}

/**
 * siteAudit.ts — technical SEO + GEO-readiness audit with a 0–100 health score.
 *
 * Positioning: NOT a Screaming-Frog clone. It's the audit that tells you what blocks BOTH
 * Google rankings AND AI citations, then feeds the closed loop (issues → fixes/content tasks).
 *
 * Engine: DataForSEO OnPage `instant_pages` (live, ~$0.00125/page) via the seo-proxy Edge Function
 * (DataForSEO is CORS-blocked from the browser). On top of the raw technical `checks` + `onpage_score`
 * we layer GEO-readiness signals (structured data, author/E-E-A-T, content depth, answer-ability)
 * derived from the page HTML — the part the pure-SEO crawlers don't measure.
 *
 * Cost: ~$0.00125/page + a cheap HTML fetch on a small sample. A 20-page audit ≈ $0.03 raw.
 */

import { normalizeContentLanguage, prefersEnglishUi } from '../lib/contentLanguages'
import { validatePageHtml } from '../lib/auditValidators'
import { isProxyEnabled, proxyDataForSEO, proxyFetchText } from './edgeProxy'
import { getSitemapEntries } from './agent/standaloneContent'
import { supabase } from '../lib/supabaseClient'

/** A piece of user-facing text available in both Italian and English. */
type Localized = { it: string; en: string }

export type IssueSeverity = 'critical' | 'warning' | 'opportunity'

export interface SiteAuditIssue {
  code: string
  severity: IssueSeverity
  /** How many audited pages have this issue. */
  count: number
  /**
   * The specific pages carrying this issue, so a finding is actionable instead of just a number.
   *
   * `count` says "H1 missing × 12"; without the URLs the user cannot tell *which* 12 pages to fix,
   * which made page-level findings unactionable in the client audit. Order is stable (the same
   * deterministic page order the crawl used). Absent/empty for site-wide checks (robots.txt,
   * llms.txt, crawler access) where a page list does not exist — those are fixed site-side, and
   * callers must not render "0 pages" for them.
   */
  urls?: string[]
  /** Italian, human-readable. */
  label: string
  /** Why it matters for SEO AND AI citations. */
  why: string
  /** 'seo' | 'geo' — which dimension it hurts. */
  dimension: 'seo' | 'geo'
}

export interface SiteAuditResult {
  siteUrl: string
  pagesAudited: number
  /** 0–100 overall: 70% technical (DataForSEO onpage_score) + 30% GEO-readiness. */
  healthScore: number
  technicalScore: number
  geoReadinessScore: number
  issues: SiteAuditIssue[]
  /** Quick GEO-readiness facts sampled from page HTML. */
  geoSignals: {
    pagesWithSchema: number
    pagesWithArticleOrFaqSchema: number
    pagesWithAuthorSignal: number
    /** Sampled pages carrying an Organization/LocalBusiness entity node (knowledge-graph signal). */
    pagesWithOrgSchema: number
    /** Sampled pages with AI-extractable structure (a real list or a data/comparison table). */
    pagesWithExtractableStructure: number
    /** Sampled pages with at least one question-style H2/H3 (FAQ-like answerability). */
    pagesWithQuestionHeadings: number
    sampledForGeo: number
    /** Search/citation AI crawlers fully blocked in robots.txt (empty = none). */
    aiCrawlerBlocked: string[]
    /** Search/citation AI crawlers blocked for some paths but not the whole site. */
    aiSearchPartiallyRestricted: string[]
    /** Training/model opt-outs in place (a publisher choice, not a visibility defect). */
    aiTrainingOptOuts: string[]
    /** Neutral, localized notes explaining each training opt-out. */
    aiTrainingOptOutNotes: string[]
    /** Whether the site publishes an llms.txt (emerging GEO standard). */
    hasLlmsTxt: boolean
  }
  auditedAt: string
}

/**
 * Curated map of high-impact DataForSEO OnPage `checks` flags (true = problem present) →
 * issue metadata. Kept deliberately small: the 15 that actually move rankings/citations.
 */
type CheckMeta = {
  code: string
  severity: IssueSeverity
  dimension: 'seo' | 'geo'
  label: Localized
  why: Localized
}

const CHECK_MAP: Record<string, CheckMeta> = {
  is_broken:            { code: 'is_broken', severity: 'critical', dimension: 'seo', label: { it: 'Pagine non raggiungibili (link rotti)', en: 'Unreachable pages (broken links)' }, why: { it: 'Bloccano crawler e utenti; sprecano crawl budget e perdono autorità.', en: 'They block crawlers and users; waste crawl budget and leak link authority.' } },
  is_4xx_code:          { code: 'is_4xx_code', severity: 'critical', dimension: 'seo', label: { it: 'Errori 4xx', en: '4xx errors' }, why: { it: 'Pagine mancanti: niente ranking né citazioni AI.', en: 'Missing pages: no rankings and no AI citations.' } },
  is_5xx_code:          { code: 'is_5xx_code', severity: 'critical', dimension: 'seo', label: { it: 'Errori server 5xx', en: '5xx server errors' }, why: { it: 'Il sito non risponde: crawler e AI non possono leggere il contenuto.', en: 'The site fails to respond: crawlers and AI cannot read the content.' } },
  no_title:             { code: 'no_title', severity: 'critical', dimension: 'seo', label: { it: 'Title mancante', en: 'Missing title tag' }, why: { it: 'Il title è il segnale di rilevanza #1 per Google e per gli snippet AI.', en: 'The title is the #1 relevance signal for Google and for AI snippets.' } },
  no_description:       { code: 'no_description', severity: 'warning', dimension: 'seo', label: { it: 'Meta description mancante', en: 'Missing meta description' }, why: { it: 'Riduce CTR e priva l’AI di un riassunto pronto da citare.', en: 'Lowers CTR and deprives AI of a ready-made summary to cite.' } },
  no_h1_tag:            { code: 'no_h1_tag', severity: 'warning', dimension: 'seo', label: { it: 'H1 mancante', en: 'Missing H1' }, why: { it: 'L’H1 definisce il tema della pagina per motori e LLM.', en: 'The H1 defines the page topic for search engines and LLMs.' } },
  duplicate_title_tag:  { code: 'duplicate_title_tag', severity: 'warning', dimension: 'seo', label: { it: 'Title duplicati', en: 'Duplicate titles' }, why: { it: 'Cannibalizzazione: Google non sa quale pagina premiare.', en: 'Cannibalization: Google can’t tell which page to reward.' } },
  duplicate_description: { code: 'duplicate_description', severity: 'warning', dimension: 'seo', label: { it: 'Description duplicate', en: 'Duplicate descriptions' }, why: { it: 'Segnale di contenuto non differenziato.', en: 'A signal of undifferentiated content.' } },
  title_too_long:       { code: 'title_too_long', severity: 'opportunity', dimension: 'seo', label: { it: 'Title troppo lunghi', en: 'Titles too long' }, why: { it: 'Vengono troncati in SERP, perdendo keyword e CTR.', en: 'They get truncated in the SERP, losing keywords and CTR.' } },
  high_loading_time:    { code: 'high_loading_time', severity: 'warning', dimension: 'seo', label: { it: 'Caricamento lento', en: 'Slow loading' }, why: { it: 'Core Web Vitals scarsi penalizzano ranking ed esperienza.', en: 'Poor Core Web Vitals hurt both rankings and user experience.' } },
  no_image_alt:         { code: 'no_image_alt', severity: 'opportunity', dimension: 'seo', label: { it: 'Immagini senza alt', en: 'Images without alt text' }, why: { it: 'Accessibilità e contesto immagine per ricerca/AI.', en: 'Accessibility and image context for search and AI.' } },
  low_content_rate:     { code: 'low_content_rate', severity: 'warning', dimension: 'geo', label: { it: 'Poco testo rispetto al codice', en: 'Low text-to-code ratio' }, why: { it: 'Contenuto sottile: poco materiale citabile dall’AI.', en: 'Thin content: little material for AI to cite.' } },
  small_page_size:      { code: 'small_page_size', severity: 'opportunity', dimension: 'geo', label: { it: 'Pagine molto corte', en: 'Very short pages' }, why: { it: 'Contenuto thin: difficile rankare o essere citati.', en: 'Thin content: hard to rank or get cited.' } },
  canonical:            { code: 'canonical', severity: 'opportunity', dimension: 'seo', label: { it: 'Canonical assente su alcune pagine', en: 'Canonical missing on some pages' }, why: { it: 'Aiuta a consolidare i segnali ed evitare duplicati.', en: 'It helps consolidate signals and avoid duplicates.' } },
  no_favicon:           { code: 'no_favicon', severity: 'opportunity', dimension: 'seo', label: { it: 'Favicon mancante', en: 'Missing favicon' }, why: { it: 'Segnale minore di cura/brand; appare negli snippet.', en: 'A minor brand/care signal; it shows up in snippets.' } },
}

interface OnPageItem {
  onpage_score?: number
  checks?: Record<string, boolean>
  meta?: { content?: { plain_text_word_count?: number } }
  /** Attached by auditPage — DataForSEO's instant_pages echoes no URL of its own. */
  url?: string
}

/** Max pages for the live OnPage technical crawl (bounded COGS + stable score). */
const TECHNICAL_AUDIT_PAGE_CAP = 5

/** Stable 32-bit hash for deterministic URL ordering (same site → same sample every run). */
function stableHash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function orderPagesDeterministic(siteUrl: string, urls: string[]): string[] {
  const base = siteUrl.replace(/\/$/, '')
  const home = `${base}/`
  const unique = [...new Set(urls)]
  const rest = unique.filter((u) => u !== home && u !== base)
  rest.sort((a, b) => {
    const d = stableHash(`${siteUrl}|${a}`) - stableHash(`${siteUrl}|${b}`)
    return d !== 0 ? d : a.localeCompare(b)
  })
  return [home, ...rest]
}

/**
 * Pull top-N page URLs to audit (homepage always included). Uses the shared `getSitemapEntries`,
 * which FOLLOWS sitemap indexes (the common WP/Yoast/RankMath case where /sitemap.xml is an index of
 * child sitemaps). The old inline parser dropped every `.xml` <loc>, so on indexed sitemaps it found
 * zero pages and the technical score was computed on the homepage alone (pagesAudited=1).
 */
async function pickPages(siteUrl: string, maxPages: number): Promise<string[]> {
  const urls = new Set<string>()
  const base = siteUrl.replace(/\/$/, '')
  urls.add(`${base}/`)
  try {
    for (const e of await getSitemapEntries(siteUrl)) {
      urls.add(e.url)
    }
  } catch {
    /* homepage-only fallback when the sitemap is missing/unreachable */
  }
  return orderPagesDeterministic(siteUrl, [...urls]).slice(0, maxPages)
}

/** One OnPage instant_pages call (via proxy) → the page item, or null. */
async function auditPage(url: string): Promise<OnPageItem | null> {
  try {
    // seo-proxy contract: endpoint needs a leading slash and the payload is a single task OBJECT
    // (the proxy wraps it in [payload] before POSTing to DataForSEO).
    const raw = (await proxyDataForSEO('/on_page/instant_pages', { url, enable_javascript: false })) as {
      tasks?: Array<{ result?: Array<{ items?: OnPageItem[] }> }>
    }
    const item = raw?.tasks?.[0]?.result?.[0]?.items?.[0]
    // The response does not echo the requested URL, and the crawl runs concurrently — without
    // stashing it here the per-page results become unidentifiable once they are collected.
    return item ? { ...item, url } : null
  } catch (e) {
    console.warn('[SiteAudit] instant_pages failed for', url, e)
    return null
  }
}

/**
 * Answer-extractability (Adobe LLM Optimizer "answerability"): AI engines lift lists, tables and
 * step blocks far more readily than walls of prose. True when the page has a real list (≥1 <li>) or
 * a data/comparison table — the structure that survives being pulled into an AI answer.
 */
export function htmlHasExtractableStructure(html: string): boolean {
  if (/<table[\s>][\s\S]*?<t[dh][\s>]/i.test(html)) return true
  return /<(ul|ol)[\s>][\s\S]*?<li[\s>]/i.test(html)
}

/**
 * Question-style H2/H3 headings signal FAQ-like, directly-answerable structure — the format AI
 * answer engines quote verbatim. Detects headings ending in "?" or opening with a question word
 * (IT + EN).
 */
export function htmlHasQuestionHeading(html: string): boolean {
  const QUESTION_OPENER = /^(come|cosa|quando|perche|quali|quale|chi|dove|quant[oiae]|how|what|why|when|which|who|where|can|should|is|are|do|does)\b/i
  for (const m of html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)) {
    const text = m[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!text) continue
    // Strip diacritics so "Perché" matches regardless of precomposed/decomposed encoding.
    const ascii = text.normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (/\?\s*$/.test(text) || QUESTION_OPENER.test(ascii)) return true
  }
  return false
}

/** Lightweight GEO-readiness + validator signals from raw HTML. */
async function geoSignalsForPage(
  url: string,
  siteUrl: string,
): Promise<{
  schema: boolean
  articleOrFaq: boolean
  author: boolean
  orgSchema: boolean
  extractableStructure: boolean
  questionHeading: boolean
  invalidJsonLd: boolean
  multipleH1: boolean
  internalLinkIssueCount: number
  /** The page this signal belongs to — carried through so issues can name it. */
  url: string
}> {
  try {
    const html = await proxyFetchText(url)
    const v = validatePageHtml(html, siteUrl)
    const schema = v.jsonLd.blockCount > 0 && v.jsonLd.validBlocks > 0
    const articleOrFaq = /"@type"\s*:\s*"(FAQPage|Article|NewsArticle|BlogPosting|HowTo)"/i.test(html)
    const author = /rel=["']author["']|"@type"\s*:\s*"Person"|class=["'][^"']*author/i.test(html)
    // Entity / knowledge-graph signal: an Organization (or LocalBusiness/Store) node is what lets
    // AI engines resolve "who is this brand" — the backbone Adobe LLM Optimizer optimises for.
    const orgSchema = /"@type"\s*:\s*"(Organization|LocalBusiness|[A-Za-z]*Business|Corporation|OnlineStore|Store|NGO)"/i.test(html)
    return {
      url,
      schema,
      articleOrFaq,
      author,
      orgSchema,
      extractableStructure: htmlHasExtractableStructure(html),
      questionHeading: htmlHasQuestionHeading(html),
      invalidJsonLd: v.jsonLd.invalidBlocks > 0,
      multipleH1: v.h1.count > 1,
      internalLinkIssueCount: v.internalLinkIssues.length,
    }
  } catch {
    return { url, schema: false, articleOrFaq: false, author: false, orgSchema: false, extractableStructure: false, questionHeading: false, invalidJsonLd: false, multipleH1: false, internalLinkIssueCount: 0 }
  }
}

/**
 * AI-crawler taxonomy. These tokens are INDEPENDENT controls — blocking one does not mean the same
 * thing as blocking another. We split them into three categories so the audit never conflates a
 * training opt-out (a legitimate, documented publisher choice) with losing AI visibility.
 *
 * SEARCH / CITATION bots — blocking these genuinely reduces surfacing or citation in a specific
 * AI search surface.
 */
const SEARCH_CRAWLERS = ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'Googlebot'] as const

/**
 * TRAINING / model-development opt-outs — blocking these is a publisher choice about whether
 * crawled content may be used to train or ground models, NOT an AI-visibility defect.
 * Note: Google-Extended also covers grounding in Gemini Apps / Vertex AI, and is NOT the control
 * for Google Search / AI Overviews eligibility (that is Googlebot).
 */
const TRAINING_CRAWLERS = ['GPTBot', 'ClaudeBot', 'Google-Extended'] as const

/**
 * USER-INITIATED fetchers — these respond to a user's direct request and generally ignore
 * robots.txt ("may not apply"), so robots.txt is not a reliable control for them. We never report
 * a blocked-crawler issue for these.
 */
const USER_CRAWLERS = ['ChatGPT-User', 'Claude-User', 'Perplexity-User'] as const

/** Structured result: distinguish "blocked entirely" from "blocked except some paths". */
export interface RobotsAccess {
  /** The bot is disallowed from the root (`Disallow: /`) with no `Allow:` path re-opened. */
  fullyBlocked: boolean
  /** The bot is disallowed from some paths but not the whole site. */
  partiallyRestricted: boolean
}

interface RobotsRule {
  type: 'allow' | 'disallow'
  path: string
}

interface RobotsGroup {
  agents: string[]
  rules: RobotsRule[]
}

/** Parse robots.txt into user-agent groups (comments + blank lines ignored anywhere). */
function parseRobots(robots: string): RobotsGroup[] {
  const lines = robots
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter((l) => l.length > 0)
  const groups: RobotsGroup[] = []
  let i = 0
  while (i < lines.length) {
    if (!/^user-agent:/i.test(lines[i]!)) { i++; continue }
    const agents: string[] = []
    while (i < lines.length && /^user-agent:/i.test(lines[i]!)) {
      agents.push(lines[i]!.slice(lines[i]!.indexOf(':') + 1).trim().toLowerCase())
      i++
    }
    const rules: RobotsRule[] = []
    while (i < lines.length && !/^user-agent:/i.test(lines[i]!)) {
      const disallow = lines[i]!.match(/^disallow:\s*(.*)$/i)
      const allow = lines[i]!.match(/^allow:\s*(.*)$/i)
      if (disallow && disallow[1]!.trim()) rules.push({ type: 'disallow', path: disallow[1]!.trim() })
      else if (allow && allow[1]!.trim()) rules.push({ type: 'allow', path: allow[1]!.trim() })
      i++
    }
    groups.push({ agents, rules })
  }
  return groups
}

/** Whether a robots rule path matches a URL path (prefix match on path segments). */
function ruleMatches(rulePath: string, path: string): boolean {
  if (rulePath === '/') return true
  const rp = rulePath.endsWith('/') ? rulePath.slice(0, -1) : rulePath
  if (rp === '') return true
  return path === rp || path.startsWith(rp + '/')
}

/** True when `path` is allowed under the given rules — most-specific (longest) match wins, ties go to allow. */
function pathIsAllowed(rules: RobotsRule[], path: string): boolean {
  let best: RobotsRule | null = null
  for (const r of rules) {
    if (!ruleMatches(r.path, path)) continue
    if (!best || r.path.length > best.path.length) best = r
    else if (r.path.length === best.path.length && r.type === 'allow') best = r
  }
  return best ? best.type === 'allow' : true
}

/** Effective access for a group's rules: fully blocked vs. partially restricted. */
function groupAccess(rules: RobotsRule[]): RobotsAccess {
  if (rules.length === 0) return { fullyBlocked: false, partiallyRestricted: false }
  const rootAllowed = pathIsAllowed(rules, '/')
  const hasAllow = rules.some((r) => r.type === 'allow')
  const fullyBlocked = !rootAllowed && !hasAllow
  const hasEffectiveDisallow = rules.some((r) => r.type === 'disallow' && !pathIsAllowed(rules, r.path))
  const partiallyRestricted = !fullyBlocked && hasEffectiveDisallow
  return { fullyBlocked, partiallyRestricted }
}

/**
 * The bot's effective access in robots.txt. The `*` wildcard group applies only when no group
 * matches the specific bot; when several matching groups exist their rules are combined.
 */
export function robotsAccessForBot(robots: string, bot: string): RobotsAccess {
  const groups = parseRobots(robots)
  const target = bot.toLowerCase()
  const exact = groups.filter((g) => g.agents.includes(target))
  const picked = exact.length ? exact : groups.filter((g) => g.agents.includes('*'))
  return groupAccess(picked.flatMap((g) => g.rules))
}

type SearchCrawlerMeta = {
  code: string
  partialCode: string
  label: Localized
  why: Localized
  partialLabel: Localized
  partialWhy: Localized
}

const SEARCH_CRAWLER_META: Record<(typeof SEARCH_CRAWLERS)[number], SearchCrawlerMeta> = {
  'OAI-SearchBot': {
    code: 'geo_search_blocked_chatgpt',
    partialCode: 'geo_search_partial_chatgpt',
    label: { en: 'ChatGPT Search can’t surface your site', it: 'ChatGPT Search non può mostrare il tuo sito' },
    why: {
      en: 'OAI-SearchBot is blocked, so your pages won’t be shown in ChatGPT search answers (they can still appear as navigational links). This affects only ChatGPT search and is independent of the GPTBot training opt-out.',
      it: 'OAI-SearchBot è bloccato: le tue pagine non compariranno nelle risposte di ricerca di ChatGPT (possono comunque apparire come link di navigazione). Riguarda solo la ricerca di ChatGPT ed è indipendente dall’opt-out di addestramento GPTBot.',
    },
    partialLabel: { en: 'ChatGPT Search is partially blocked', it: 'ChatGPT Search è parzialmente bloccato' },
    partialWhy: {
      en: 'OAI-SearchBot is disallowed for some paths, so only part of the site can be shown in ChatGPT search answers.',
      it: 'OAI-SearchBot è bloccato per alcuni percorsi: solo una parte del sito può comparire nelle risposte di ricerca di ChatGPT.',
    },
  },
  'Claude-SearchBot': {
    code: 'geo_search_blocked_claude',
    partialCode: 'geo_search_partial_claude',
    label: { en: 'Claude Search can’t surface your site', it: 'Claude Search non può mostrare il tuo sito' },
    why: {
      en: 'Claude-SearchBot is blocked, so Claude may not index or surface your pages in its search results. This affects only Claude’s search surface and is independent of the ClaudeBot training opt-out.',
      it: 'Claude-SearchBot è bloccato: Claude potrebbe non indicizzare o mostrare le tue pagine nei suoi risultati di ricerca. Riguarda solo la ricerca di Claude ed è indipendente dall’opt-out di addestramento ClaudeBot.',
    },
    partialLabel: { en: 'Claude Search is partially blocked', it: 'Claude Search è parzialmente bloccato' },
    partialWhy: {
      en: 'Claude-SearchBot is disallowed for some paths, so only part of the site can be indexed for Claude search.',
      it: 'Claude-SearchBot è bloccato per alcuni percorsi: solo una parte del sito può essere indicizzata per la ricerca di Claude.',
    },
  },
  'PerplexityBot': {
    code: 'geo_search_blocked_perplexity',
    partialCode: 'geo_search_partial_perplexity',
    label: { en: 'Perplexity can’t surface your site', it: 'Perplexity non può mostrare il tuo sito' },
    why: {
      en: 'PerplexityBot is blocked, so your pages may not be surfaced or linked in Perplexity search results. PerplexityBot is a search/surfacing crawler — it is not used to crawl content for AI foundation models.',
      it: 'PerplexityBot è bloccato: le tue pagine potrebbero non essere mostrate o collegate nei risultati di ricerca di Perplexity. PerplexityBot è un crawler di ricerca/surfacing — non viene usato per acquisire contenuti per i foundation model.',
    },
    partialLabel: { en: 'Perplexity is partially blocked', it: 'Perplexity è parzialmente bloccato' },
    partialWhy: {
      en: 'PerplexityBot is disallowed for some paths, so only part of the site can be surfaced or linked in Perplexity search results.',
      it: 'PerplexityBot è bloccato per alcuni percorsi: solo una parte del sito può essere mostrata o collegata nei risultati di ricerca di Perplexity.',
    },
  },
  'Googlebot': {
    code: 'geo_search_blocked_google',
    partialCode: 'geo_search_partial_google',
    label: { en: 'Google Search can’t index your site', it: 'Google Search non può indicizzare il tuo sito' },
    why: {
      en: 'Googlebot is blocked, so Google Search (including its AI features) cannot index the site. This is separate from Google-Extended, which only controls AI training/grounding — not Search eligibility.',
      it: 'Googlebot è bloccato: Google Search (incluse le sue funzioni AI) non può indicizzare il sito. È separato da Google-Extended, che controlla solo addestramento/grounding AI — non l’eleggibilità per la Ricerca.',
    },
    partialLabel: { en: 'Google Search is partially blocked', it: 'Google Search è parzialmente bloccato' },
    partialWhy: {
      en: 'Googlebot is disallowed for some paths, so only part of the site can be indexed by Google Search.',
      it: 'Googlebot è bloccato per alcuni percorsi: solo una parte del sito può essere indicizzata da Google Search.',
    },
  },
}

/** Neutral, factual copy for training opt-outs — a publisher choice, never a defect. */
const TRAINING_OPTOUT_META: Record<(typeof TRAINING_CRAWLERS)[number], Localized> = {
  GPTBot: {
    en: 'GPTBot is disallowed, so your content won’t be used to train OpenAI’s foundation models. This is a training opt-out, not a visibility defect — it is independent of ChatGPT search (controlled by OAI-SearchBot), so it does not by itself prevent the site being cited.',
    it: 'GPTBot è bloccato: i tuoi contenuti non verranno usati per addestrare i foundation model di OpenAI. È un opt-out di addestramento, non un difetto di visibilità — è indipendente dalla ricerca di ChatGPT (controllata da OAI-SearchBot), quindi di per sé non impedisce di essere citati.',
  },
  ClaudeBot: {
    en: 'ClaudeBot is disallowed, so your content won’t be collected for Anthropic model training. This is a training opt-out, not a visibility defect — it is independent of Claude search (Claude-SearchBot), so it does not by itself prevent the site being cited.',
    it: 'ClaudeBot è bloccato: i tuoi contenuti non verranno raccolti per l’addestramento dei modelli Anthropic. È un opt-out di addestramento, non un difetto di visibilità — è indipendente dalla ricerca di Claude (Claude-SearchBot), quindi di per sé non impedisce di essere citati.',
  },
  'Google-Extended': {
    en: 'Google-Extended is disallowed, so your content won’t be used for training future Gemini models or for grounding in Gemini Apps / Vertex AI. This is a training/grounding opt-out, not the control for Google Search or AI Overviews eligibility — that is Googlebot, so this does not by itself prevent the site being indexed or cited.',
    it: 'Google-Extended è bloccato: i tuoi contenuti non verranno usati per addestrare i futuri modelli Gemini né per il grounding in Gemini Apps / Vertex AI. È un opt-out di addestramento/grounding, non il controllo per Google Search o per AI Overviews — quello è Googlebot, quindi di per sé non impedisce di essere indicizzati o citati.',
  },
}

/** Result of assessing a robots.txt against the crawler taxonomy. */
export interface AiCrawlerFindings {
  /** Scoped issues for search/citation bots (critical = fully blocked, warning = partial). */
  issues: SiteAuditIssue[]
  /** Neutral, localized notes for training opt-outs — NOT defects. */
  trainingOptOutNotes: string[]
  /** Tokens for the geoSignals snapshot. */
  blockedSearch: string[]
  partiallyRestrictedSearch: string[]
  trainingOptOuts: string[]
}

/** Pure mapping of a robots.txt to scoped issues + neutral training-opt-out notes. */
export function aiCrawlerFindings(robots: string, en: boolean): AiCrawlerFindings {
  const issues: SiteAuditIssue[] = []
  const trainingOptOutNotes: string[] = []
  const blockedSearch: string[] = []
  const partiallyRestrictedSearch: string[] = []
  const trainingOptOuts: string[] = []

  for (const token of SEARCH_CRAWLERS) {
    const access = robotsAccessForBot(robots, token)
    const meta = SEARCH_CRAWLER_META[token]
    if (access.fullyBlocked) {
      blockedSearch.push(token)
      issues.push({
        code: meta.code,
        severity: 'critical',
        count: 1,
        dimension: 'geo',
        label: en ? meta.label.en : meta.label.it,
        why: en ? meta.why.en : meta.why.it,
      })
    } else if (access.partiallyRestricted) {
      partiallyRestrictedSearch.push(token)
      issues.push({
        code: meta.partialCode,
        severity: 'warning',
        count: 1,
        dimension: 'geo',
        label: en ? meta.partialLabel.en : meta.partialLabel.it,
        why: en ? meta.partialWhy.en : meta.partialWhy.it,
      })
    }
  }

  for (const token of TRAINING_CRAWLERS) {
    if (robotsAccessForBot(robots, token).fullyBlocked) {
      trainingOptOuts.push(token)
      trainingOptOutNotes.push(en ? TRAINING_OPTOUT_META[token].en : TRAINING_OPTOUT_META[token].it)
    }
  }

  // USER_CRAWLERS are intentionally never reported: robots.txt is not a reliable control for them.
  void USER_CRAWLERS

  return { issues, trainingOptOutNotes, blockedSearch, partiallyRestrictedSearch, trainingOptOuts }
}

/**
 * AI-crawler accessibility: fetch robots.txt + llms.txt once per audit. Blocked search/citation
 * crawlers are surfaced as scoped issues; training opt-outs are neutral context. Best-effort: an
 * unreachable robots.txt is treated as "unknown" (nothing flagged) rather than a false positive.
 */
async function checkAiCrawlerAccess(siteUrl: string, en: boolean): Promise<{ findings: AiCrawlerFindings; hasLlmsTxt: boolean }> {
  let robots = ''
  try {
    robots = await proxyFetchText(`${siteUrl}/robots.txt`)
    // A real robots.txt is plain text; a soft-404 HTML page is not — don't parse the latter.
    if (!robots || /^\s*<(?:!doctype|html)/i.test(robots.slice(0, 200))) robots = ''
  } catch { /* robots unreachable → unknown, flag nothing */ }
  let hasLlmsTxt = false
  try {
    const llms = await proxyFetchText(`${siteUrl}/llms.txt`)
    hasLlmsTxt = /\S/.test(llms) && !/^\s*<(?:!doctype|html)/i.test(llms.slice(0, 200))
  } catch { /* absent */ }
  return { findings: aiCrawlerFindings(robots, en), hasLlmsTxt }
}

export interface RunSiteAuditOptions {
  siteUrl: string
  /** Max pages to crawl (plan-capped: Basic 100 / Pro 500 / Advanced 2000 — V1 samples up to this). */
  maxPages?: number
  /** How many pages to deep-check for GEO HTML signals (bounded for cost). */
  geoSampleSize?: number
  /** Language for the user-facing issue text ('it' default, 'en…' → English). */
  language?: string
}

export async function runSiteAudit(opts: RunSiteAuditOptions): Promise<SiteAuditResult> {
  if (!isProxyEnabled()) {
    throw new Error('Audit non disponibile: il proxy server-side (VITE_USE_SUPABASE_PROXY) non è attivo.')
  }
  const siteUrl = opts.siteUrl.replace(/\/$/, '')
  const en = prefersEnglishUi(normalizeContentLanguage(opts.language))
  const maxPages = Math.min(opts.maxPages ?? TECHNICAL_AUDIT_PAGE_CAP, TECHNICAL_AUDIT_PAGE_CAP)
  const geoSampleSize = Math.min(opts.geoSampleSize ?? maxPages, maxPages)

  const cacheKey = `astroseo:site-audit:${siteUrl}:${maxPages}:${new Date().toISOString().slice(0, 10)}`
  if (typeof sessionStorage !== 'undefined') {
    try {
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) return JSON.parse(cached) as SiteAuditResult
    } catch { /* ignore corrupt cache */ }
  }

  const pages = await pickPages(siteUrl, maxPages)
  if (pages.length === 0) {
    throw new Error('Nessuna pagina trovata (sitemap mancante o sito irraggiungibile).')
  }

  // Technical crawl (DataForSEO OnPage) — bounded-concurrent so a 25-page audit finishes in ~5 batches
  // (~15s) instead of 25 serial round-trips (~75s), while staying gentle on proxy/DataForSEO limits.
  const items: OnPageItem[] = []
  let crawlIdx = 0
  const crawlWorker = async () => {
    while (crawlIdx < pages.length) {
      const url = pages[crawlIdx++]!
      const item = await auditPage(url)
      if (item) items.push(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, pages.length) }, crawlWorker))
  if (items.length === 0) throw new Error('Audit fallito: nessun dato OnPage ricevuto.')

  // Technical score = average DataForSEO onpage_score.
  const scores = items.map((i) => (typeof i.onpage_score === 'number' ? i.onpage_score : 0))
  const technicalScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)

  // Aggregate issues from the curated check map, keeping the offending URLs.
  //
  // The crawl worker pushes items in completion order, so `items` is NOT in page order — pair each
  // item back to its URL via the `url` auditPage now returns, then bucket by issue. A plain count
  // told the user "12 pages" with no way to find them.
  const issueUrls = new Map<string, string[]>()
  for (const item of items) {
    const checks = item.checks ?? {}
    const url = item.url
    for (const code of Object.keys(CHECK_MAP)) {
      if (checks[code] === true && url) {
        const list = issueUrls.get(code)
        if (list) list.push(url)
        else issueUrls.set(code, [url])
      }
    }
  }
  const issues: SiteAuditIssue[] = [...issueUrls.entries()]
    .map(([code, urls]) => {
      const m = CHECK_MAP[code]!
      return { code: m.code, severity: m.severity, dimension: m.dimension, count: urls.length, urls: [...urls].sort(), label: en ? m.label.en : m.label.it, why: en ? m.why.en : m.why.it }
    })
    .sort((a, b) => {
      const rank = { critical: 0, warning: 1, opportunity: 2 }
      return rank[a.severity] - rank[b.severity] || b.count - a.count
    })

  // GEO-readiness: sample pages' HTML for schema/author signals, and check AI-crawler access once
  // for the whole site — both cheap HTML fetches, run in parallel so neither adds serial latency.
  const sample = pages.slice(0, geoSampleSize)
  const [geo, aiAccess] = await Promise.all([
    Promise.all(sample.map((u) => geoSignalsForPage(u, siteUrl))),
    checkAiCrawlerAccess(siteUrl, en),
  ])
  // Pages carrying each signal, URLs included — the counts feed the score, the URLs make the
  // finding actionable ("schema missing on these 4 pages" instead of "on 4 pages").
  const urlsWhere = (pred: (g: (typeof geo)[number]) => boolean): string[] =>
    geo.filter(pred).map((g) => g.url).sort()
  const pagesWithSchema = geo.filter((g) => g.schema).length
  const pagesWithArticleOrFaqSchema = geo.filter((g) => g.articleOrFaq).length
  const pagesWithAuthorSignal = geo.filter((g) => g.author).length
  const pagesWithOrgSchema = geo.filter((g) => g.orgSchema).length
  const pagesWithExtractableStructure = geo.filter((g) => g.extractableStructure).length
  const pagesWithQuestionHeadings = geo.filter((g) => g.questionHeading).length
  const urlsMissingSchema = urlsWhere((g) => !g.schema)
  const urlsMissingArticleOrFaq = urlsWhere((g) => !g.articleOrFaq)
  const urlsMissingOrgSchema = urlsWhere((g) => !g.orgSchema)
  const urlsMissingAuthor = urlsWhere((g) => !g.author)
  const urlsMissingAnswerability = urlsWhere((g) => !g.extractableStructure && !g.questionHeading)
  const urlsInvalidJsonLd = urlsWhere((g) => g.invalidJsonLd)
  const urlsWithMultipleH1 = urlsWhere((g) => g.multipleH1)
  const sampledForGeo = sample.length || 1

  // GEO-readiness score: schema 45% + article/FAQ schema 30% + author 25%.
  const geoReadinessScore = Math.round(
    100 * (
      0.45 * (pagesWithSchema / sampledForGeo) +
      0.30 * (pagesWithArticleOrFaqSchema / sampledForGeo) +
      0.25 * (pagesWithAuthorSignal / sampledForGeo)
    )
  )

  // Surface GEO gaps as issues too.
  if (pagesWithSchema / sampledForGeo < 0.5) {
    issues.push({ code: 'geo_no_schema', severity: 'warning', count: sampledForGeo - pagesWithSchema, urls: urlsMissingSchema, dimension: 'geo',
      label: en ? 'Structured data (schema) missing' : 'Dati strutturati (schema) assenti',
      why: en ? 'Without JSON-LD, AI struggles to understand and cite the content. It’s the most underrated GEO signal.' : 'Senza JSON-LD le AI faticano a capire e citare il contenuto. È il segnale GEO più sottovalutato.' })
  }
  if (pagesWithArticleOrFaqSchema / sampledForGeo < 0.3) {
    issues.push({ code: 'geo_no_article_faq', severity: 'opportunity', count: sampledForGeo - pagesWithArticleOrFaqSchema, urls: urlsMissingArticleOrFaq, dimension: 'geo',
      label: en ? 'Article/FAQ schema missing' : 'Schema Article/FAQ mancante',
      why: en ? 'Article/FAQPage JSON-LD boosts rich results and citability in AI answers.' : 'Article/FAQPage JSON-LD aumenta rich results e citabilità nelle risposte AI.' })
  }
  if (pagesWithAuthorSignal / sampledForGeo < 0.3) {
    issues.push({ code: 'geo_no_author', severity: 'opportunity', count: sampledForGeo - pagesWithAuthorSignal, urls: urlsMissingAuthor, dimension: 'geo',
      label: en ? 'Weak author / E-E-A-T signals' : 'Segnali di autore/E-E-A-T deboli',
      why: en ? 'Author and credentials raise the trust AI and Google assign to the content.' : 'Autore e credenziali aumentano la fiducia che AI e Google assegnano al contenuto.' })
  }

  const invalidJsonLdPages = geo.filter((g) => g.invalidJsonLd).length
  if (invalidJsonLdPages > 0) {
    issues.push({
      code: 'invalid_jsonld', urls: urlsInvalidJsonLd,
      severity: 'warning',
      count: invalidJsonLdPages,
      dimension: 'geo',
      label: en ? 'Corrupt JSON-LD (parse failed)' : 'JSON-LD corrotto (parse fallito)',
      why: en
        ? 'WordPress wpautop often injects <br/> inside FAQ schema scripts — invisible in view-source but breaks structured data.'
        : 'wpautop di WordPress spesso inietta <br/> negli script FAQ — invisibile ma rompe i dati strutturati.',
    })
  }
  const multiH1Pages = geo.filter((g) => g.multipleH1).length
  if (multiH1Pages > 0) {
    issues.push({
      code: 'multiple_h1',
      severity: 'warning',
      count: multiH1Pages,
      urls: urlsWithMultipleH1,
      dimension: 'seo',
      label: en ? 'Multiple H1 tags' : 'Più tag H1',
      why: en ? 'A single H1 clarifies page topic for Google and LLMs.' : 'Un solo H1 chiarisce il tema della pagina per Google e LLM.',
    })
  }
  const linkIssuePages = geo.filter((g) => g.internalLinkIssueCount > 0).length
  if (linkIssuePages > 0) {
    issues.push({
      code: 'internal_link_issues',
      severity: 'opportunity',
      count: linkIssuePages,
      dimension: 'seo',
      label: en ? 'Internal link issues (sample)' : 'Problemi link interni (campione)',
      why: en
        ? 'Empty, duplicate, or competitor links in content hurt crawl paths and user trust.'
        : 'Link vuoti, duplicati o verso competitor nel contenuto danneggiano crawl e fiducia.',
    })
  }

  // Entity / knowledge-graph: no Organization schema anywhere in the sample → AI can't reliably
  // resolve the brand as an entity. Site-level, so flag once (not per page).
  if (pagesWithOrgSchema === 0) {
    issues.push({
      code: 'geo_no_org_schema', urls: urlsMissingOrgSchema,
      severity: 'opportunity',
      count: 1,
      dimension: 'geo',
      label: en ? 'Organization schema missing' : 'Schema Organization assente',
      why: en
        ? 'An Organization (or LocalBusiness) JSON-LD node with name, logo and sameAs is how AI engines resolve who your brand is and link it to its knowledge-graph entity — the backbone of AI brand recognition.'
        : 'Un nodo JSON-LD Organization (o LocalBusiness) con nome, logo e sameAs è ciò che permette alle AI di capire chi è il tuo brand e collegarlo alla sua entità nel knowledge graph — la base del riconoscimento del brand da parte dell’AI.',
    })
  }

  // Answerability (Adobe LLM Optimizer "answer optimization"): if most sampled pages are walls of
  // prose with no list/table and no question-style heading, AI engines have little to lift verbatim.
  if (pagesWithExtractableStructure / sampledForGeo < 0.5 && pagesWithQuestionHeadings / sampledForGeo < 0.5) {
    issues.push({
      code: 'geo_low_answerability', urls: urlsMissingAnswerability,
      severity: 'opportunity',
      count: sampledForGeo - Math.max(pagesWithExtractableStructure, pagesWithQuestionHeadings),
      dimension: 'geo',
      label: en ? 'Content not structured for AI extraction' : 'Contenuto poco estraibile dall’AI',
      why: en
        ? 'Answer engines lift lists, tables and question-style headings far more readily than walls of prose. Adding extractable structure (bullet lists, comparison tables, FAQ-style H2/H3) makes each page much easier to quote in an AI answer.'
        : 'I motori di risposta estraggono liste, tabelle e titoli in forma di domanda molto più facilmente del testo in blocco. Aggiungere struttura estraibile (elenchi puntati, tabelle di confronto, H2/H3 in stile FAQ) rende ogni pagina molto più citabile in una risposta AI.',
    })
  }

  // AI-crawler accessibility: fully/partially blocked search bots are scoped, provider-specific
  // issues; training opt-outs are neutral context (never a defect).
  issues.unshift(...aiAccess.findings.issues)
  if (!aiAccess.hasLlmsTxt) {
    issues.push({
      code: 'geo_no_llms_txt',
      severity: 'opportunity',
      count: 1,
      dimension: 'geo',
      label: en ? 'llms.txt missing' : 'llms.txt assente',
      why: en
        ? 'An llms.txt gives AI assistants a curated map of your best content to read and cite — an emerging GEO standard. Rankdelta can generate one for you.'
        : 'Un file llms.txt offre agli assistenti AI una mappa curata dei tuoi contenuti migliori da leggere e citare — standard GEO emergente. Rankdelta può generarlo per te.',
    })
  }

  const healthScore = Math.round(0.7 * technicalScore + 0.3 * geoReadinessScore)

  const result: SiteAuditResult = {
    siteUrl,
    pagesAudited: items.length,
    healthScore,
    technicalScore,
    geoReadinessScore,
    issues,
    geoSignals: {
      pagesWithSchema,
      pagesWithArticleOrFaqSchema,
      pagesWithAuthorSignal,
      pagesWithOrgSchema,
      pagesWithExtractableStructure,
      pagesWithQuestionHeadings,
      sampledForGeo,
      aiCrawlerBlocked: aiAccess.findings.blockedSearch,
      aiSearchPartiallyRestricted: aiAccess.findings.partiallyRestrictedSearch,
      aiTrainingOptOuts: aiAccess.findings.trainingOptOuts,
      aiTrainingOptOutNotes: aiAccess.findings.trainingOptOutNotes,
      hasLlmsTxt: aiAccess.hasLlmsTxt,
    },
    auditedAt: new Date().toISOString(),
  }

  if (typeof sessionStorage !== 'undefined') {
    try { sessionStorage.setItem(cacheKey, JSON.stringify(result)) } catch { /* quota */ }
  }

  return result
}

/** A single compact score snapshot for the health-over-time trend. */
export interface SiteAuditHistoryPoint {
  composite: number
  technical: number | null
  geo_structure: number | null
  geo_content: number | null
  audited_at: string
}

/** Persist an audit result to the site_audits table (jsonb) + append a history snapshot. */
export async function saveSiteAudit(projectId: string, result: SiteAuditResult): Promise<void> {
  // site_audits has a UNIQUE(project_id): one current audit per project. Upsert so re-running the
  // diagnosis overwrites the stored result instead of failing on the duplicate-key constraint.
  const { error } = await supabase
    .from('site_audits')
    .upsert({ project_id: projectId, result, audited_at: result.auditedAt }, { onConflict: 'project_id' })
  if (error) throw error

  // Append a compact snapshot so the user can SEE health improve over time (the "track results" proof).
  // The actual object is a GuidedAudit (superset) — read its extra score fields when present.
  // Best-effort: a history-write failure must never break the main audit save.
  const g = result as SiteAuditResult & { compositeHealth?: number; freshnessScore?: number | null; weakPageCount?: number }
  const { error: histErr } = await supabase.from('site_audit_history').insert({
    project_id: projectId,
    composite: g.compositeHealth ?? result.healthScore,
    technical: result.technicalScore,
    geo_structure: result.geoReadinessScore,
    geo_content: g.freshnessScore ?? null,
    weak_pages: g.weakPageCount ?? null,
    pages_audited: result.pagesAudited,
    audited_at: result.auditedAt,
  })
  if (histErr) console.warn('[SiteAudit] history snapshot write failed (non-fatal):', histErr.message)
}

/** Score snapshots over time for a project (oldest → newest), for the progress trend. */
export async function getSiteAuditHistory(projectId: string, limit = 20): Promise<SiteAuditHistoryPoint[]> {
  const { data, error } = await supabase
    .from('site_audit_history')
    .select('composite, technical, geo_structure, geo_content, audited_at')
    .eq('project_id', projectId)
    .order('audited_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as SiteAuditHistoryPoint[]
}

/** Latest stored audit for a project, or null. */
export async function getLatestSiteAudit(projectId: string): Promise<SiteAuditResult | null> {
  const { data } = await supabase
    .from('site_audits')
    .select('result')
    .eq('project_id', projectId)
    .order('audited_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.result as SiteAuditResult) ?? null
}

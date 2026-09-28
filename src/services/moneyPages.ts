/**
 * Money Pages — the 3-5 commercial pages (services, product/category, B2B) that a project's
 * content engine must funnel authority to. Stored in `projects.metadata.money_pages` (JSONB,
 * no migration needed) and woven by the writing pipeline into every generated article as
 * priority internal links.
 *
 * Why: informational articles rank, but revenue lives on commercial pages. Anchoring every
 * cluster/article to a money page is how a blog grows COMMERCIAL keywords, not just traffic.
 */

import type { Project } from '../types/database'
import type { InternalLink, ResearchResult } from './agent/types'
import { prefersEnglishUi } from '../lib/contentLanguages'

export interface MoneyPage {
  /** Absolute URL of the commercial page (must be absolute — WP publish passes <a href> through as-is). */
  url: string
  /** The commercial keyword this page targets (e.g. "produzione cosmetici conto terzi"). */
  keyword: string
  /** Optional human label shown in the UI (e.g. "Pagina servizi B2B"). */
  label?: string
}

export const MAX_MONEY_PAGES = 5

/** Read + sanitize money pages from a project's metadata. Never throws; bad entries are dropped. */
export function getMoneyPages(project: Pick<Project, 'metadata'> | null | undefined): MoneyPage[] {
  const raw = project?.metadata?.['money_pages']
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      url: typeof e['url'] === 'string' ? e['url'].trim() : '',
      keyword: typeof e['keyword'] === 'string' ? e['keyword'].trim() : '',
      label: typeof e['label'] === 'string' && e['label'].trim() ? e['label'].trim() : undefined,
    }))
    .filter((e) => /^https?:\/\//i.test(e.url) && e.keyword.length > 0)
    .slice(0, MAX_MONEY_PAGES)
}

/**
 * Rank money pages by textual affinity with the article keyword (shared words, ignoring
 * short stopwords). All pages are still returned — the writing prompt shows the most
 * pertinent first so the LLM links that one — but never zero, so every article funnels
 * authority somewhere even when no page overlaps textually.
 */
export function rankMoneyPagesForKeyword(pages: MoneyPage[], articleKeyword: string): MoneyPage[] {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-zà-ú0-9]+/i)
        .filter((w) => w.length > 3),
    )
  const kw = words(articleKeyword)
  const score = (p: MoneyPage) => {
    let n = 0
    for (const w of words(`${p.keyword} ${p.label ?? ''}`)) if (kw.has(w)) n++
    return n
  }
  return [...pages].sort((a, b) => score(b) - score(a))
}

/**
 * Read a project's money pages straight from the DB — for the headless engine paths
 * (orchestrator pipeline, refresh loop) that receive only a projectId and can't rely on the
 * UI passing them in. Never throws: any failure just means "no money pages".
 */
export async function getProjectMoneyPages(projectId: string): Promise<MoneyPage[]> {
  try {
    const { supabase } = await import('../lib/supabaseClient')
    const { data } = await supabase.from('projects').select('metadata').eq('id', projectId).maybeSingle()
    return getMoneyPages(data as Pick<Project, 'metadata'> | null)
  } catch {
    return []
  }
}

/**
 * Backstop for the writing prompts: surface the ranked money pages as top-relevance internal-link
 * candidates, so even when a model overlooks the dedicated money-pages prompt section, the links
 * are still in the standard internal-link pool it draws from. Mutates `research.internalLinks`.
 */
export function boostMoneyPagesIntoResearch(research: ResearchResult, rankedMoney: MoneyPage[]): void {
  if (rankedMoney.length === 0) return
  const already = new Set(research.internalLinks.map((l) => l.url.replace(/\/$/, '')))
  const boosted: InternalLink[] = rankedMoney
    .filter((mp) => !already.has(mp.url.replace(/\/$/, '')))
    .map((mp) => ({ url: mp.url, anchorText: mp.keyword, relevanceScore: 100 }))
  research.internalLinks = [...boosted, ...research.internalLinks]
}

/**
 * Wrap the first plain-TEXT occurrence of `keyword` inside a paragraph's inner HTML with a link.
 * Inline markup (<strong>/<em>/…) is fine — the keyword is matched inside individual text nodes —
 * but anything already inside an <a>…</a> is skipped whole, so we can never nest anchors.
 * Returns the rewritten inner HTML, or null when the keyword occurs in no linkable text node.
 */
function linkKeywordInInnerHtml(inner: string, keyword: string, url: string): string | null {
  const kwEsc = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const kwRe = new RegExp(`(${kwEsc})`, 'i')
  // Segment the inner HTML: whole existing anchors (untouchable) and any other single tag.
  const tokenRe = /<a\b[\s\S]*?<\/a\s*>|<[^>]+>/gi
  let out = ''
  let last = 0
  let done = false
  const wrap = (text: string) => {
    if (done || !kwRe.test(text)) return text
    done = true
    return text.replace(kwRe, `<a href="${url}">$1</a>`)
  }
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(inner)) !== null) {
    out += wrap(inner.slice(last, m.index)) + m[0]
    last = m.index + m[0].length
  }
  out += wrap(inner.slice(last))
  return done ? out : null
}

/**
 * Deterministic guarantee: make sure the article HTML actually links a money page.
 * The prompt instruction is probabilistic — if the LLM ignored it, we insert the link
 * ourselves: first by wrapping a natural occurrence of the page keyword in a paragraph,
 * else by appending a short "learn more" line after the first H2 section. Returns the
 * (possibly modified) HTML — never throws, never duplicates an existing link.
 */
export function ensureMoneyPageLink(html: string, pages: MoneyPage[], language = 'it'): string {
  if (!pages.length) return html
  // Already linked? (any of the configured pages, with or without trailing slash)
  const has = (u: string) => html.includes(`href="${u}"`) || html.includes(`href="${u.replace(/\/$/, '')}"`) || html.includes(`href="${u.endsWith('/') ? u : u + '/'}"`)
  if (pages.some((p) => has(p.url))) return html

  const target = pages[0]
  if (!target) return html

  // 1) Wrap the first text occurrence of the keyword inside a paragraph — inline markup
  //    (<strong>/<em>/…) is allowed, existing anchors are never wrapped or nested.
  const paraRe = /(<p(?:\s[^>]*)?>)([\s\S]*?)(<\/p>)/gi
  let done = false
  const out = html.replace(paraRe, (m, open: string, inner: string, close: string) => {
    if (done) return m
    const linked = linkKeywordInInnerHtml(inner, target.keyword, target.url)
    if (linked == null) return m
    done = true
    return open + linked + close
  })
  if (done) return out

  // 2) Fallback: append a short editorial pointer right after the first H2 section's first paragraph.
  const line =
    prefersEnglishUi(language)
      ? `<!-- wp:paragraph --><p>To go deeper, see our page on <a href="${target.url}">${target.keyword}</a>.</p><!-- /wp:paragraph -->`
      : `<!-- wp:paragraph --><p>Per approfondire, visita la nostra pagina su <a href="${target.url}">${target.keyword}</a>.</p><!-- /wp:paragraph -->`
  const anchorIdx = out.indexOf('<!-- /wp:paragraph -->', out.indexOf('<!-- wp:heading'))
  if (anchorIdx !== -1) {
    const insertAt = anchorIdx + '<!-- /wp:paragraph -->'.length
    return out.slice(0, insertAt) + '\n' + line + out.slice(insertAt)
  }
  return out + '\n' + line
}

/** Commercial-looking URL patterns — used to auto-suggest money pages from the saved sitemap. */
const COMMERCIAL_PATH_RE = /\/(servizi|services|prodotti|products?|shop|store|pricing|prezzi|piani|plans|b2b|soluzioni|solutions|catalogo|catalog|offerte|listino|preventivo|quote|consulenza|formulazione)(\/|$)/i
const NOISE_PATH_RE = /\/(blog|news|articoli|category|tag|author|privacy|cookie|terms|contatti|contact|about|chi-siamo|faq|login|cart|checkout|account|wp-)/i

/**
 * Suggest money-page candidates from the project's saved sitemap (metadata.sitemap_pages /
 * sitemap_urls) — commercial-looking paths, noise filtered, already-configured pages excluded.
 * Pure heuristic, zero API cost: good enough to turn a blank form into one-click adds.
 */
export function suggestMoneyPages(
  project: Pick<Project, 'metadata'> | null | undefined,
  existing: MoneyPage[],
  max = 4,
): MoneyPage[] {
  const meta = project?.metadata ?? {}
  const urls: string[] = []
  const pagesRaw = meta['sitemap_pages']
  if (Array.isArray(pagesRaw)) {
    for (const e of pagesRaw) {
      const u = typeof e === 'string' ? e : (e && typeof e === 'object' && typeof (e as Record<string, unknown>)['url'] === 'string' ? String((e as Record<string, unknown>)['url']) : '')
      if (u) urls.push(u)
    }
  }
  const urlsRaw = meta['sitemap_urls']
  if (Array.isArray(urlsRaw)) for (const u of urlsRaw) if (typeof u === 'string') urls.push(u)

  const taken = new Set(existing.map((p) => p.url.replace(/\/$/, '')))
  const out: MoneyPage[] = []
  for (const u of urls) {
    const clean = u.replace(/\/$/, '')
    if (taken.has(clean) || out.some((o) => o.url === u)) continue
    let path = ''
    try { path = new URL(u).pathname } catch { continue }
    if (!COMMERCIAL_PATH_RE.test(path) || NOISE_PATH_RE.test(path)) continue
    // Keyword guess: humanized slug of the last path segment.
    const slug = path.replace(/\/$/, '').split('/').filter(Boolean).pop() ?? ''
    const keyword = slug.replace(/[-_]+/g, ' ').trim().toLowerCase()
    if (!keyword) continue
    out.push({ url: u, keyword })
    if (out.length >= max) break
  }
  return out
}

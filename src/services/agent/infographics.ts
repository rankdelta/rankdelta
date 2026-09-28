/**
 * infographics.ts — HTML Infographic Block Generator for Rankdelta pillar articles.
 *
 * Generates 1-2 embeddable, ID-scoped `<!-- wp:html -->` infographic blocks suitable
 * for WordPress Gutenberg. Each block is self-contained (inline `<style>` + markup),
 * uses Inter via Google Fonts, scopes ALL CSS selectors under a unique wrapper ID,
 * and ends with a branded footer.
 *
 * Pipeline:
 *   generateInfographicBlocks()
 *     → LLM (kimi-k2) produces structured JSON spec
 *     → renderInfographicBlock() converts each spec to a wp:html string
 *
 * @module infographics
 */

import type { ResearchResult } from './types'
import { complete } from '../openrouter'
import { infographicKeyPointsSubtitle, infographicQuickGuideTitle } from '../../lib/contentLanguages'

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface InfographicBrand {
  siteName: string
  siteUrl: string
  primaryColor?: string  // defaults to #7c3aed
  accentColor?: string   // defaults to #4f46e5
}

export interface InfographicResult {
  type: string
  title: string
  html: string // full <!-- wp:html --> block
}

// Internal spec shape parsed from LLM output
interface InfographicSpec {
  kind: 'classification' | 'checklist' | 'comparison' | 'steps'
  title: string
  subtitle?: string
  items: Array<{ label: string; value?: string; note?: string }>
}

interface LLMInfographicsResponse {
  infographics: InfographicSpec[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Escape HTML special characters in text content */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Derive a deterministic slug-based ID from keyword + index.
 * e.g. "Creatina Monoidrato" + 0 → "as-creatina-monoidrato-0"
 */
function toInfographicId(keyword: string, index: number): string {
  const slug = keyword
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
  return `as-${slug}-${index}`
}

/**
 * Robustly extract the first JSON object from a raw LLM response string.
 * Returns null if no valid JSON object is found.
 */
function extractJson(raw: string): LLMInfographicsResponse | null {
  // Try the full string first
  try {
    return JSON.parse(raw) as LLMInfographicsResponse
  } catch {
    // Find first { ... } block
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return null
    try {
      return JSON.parse(raw.slice(start, end + 1)) as LLMInfographicsResponse
    } catch {
      return null
    }
  }
}

/**
 * Build a fallback checklist spec from research data when LLM JSON fails to parse.
 */
function buildFallbackSpec(
  keyword: string,
  research: ResearchResult,
  language: string
): InfographicSpec {
  const sources = [
    ...research.peopleAlsoAsk.slice(0, 5),
    ...research.relatedKeywords.slice(0, 3),
  ]
  const items = sources.slice(0, 8).map((s) => ({
    label: s.replace(/\?$/, '').trim(),
  }))
  if (items.length === 0) {
    items.push({ label: keyword })
  }
  return {
    kind: 'checklist',
    title: infographicQuickGuideTitle(keyword, language),
    subtitle: infographicKeyPointsSubtitle(language),
    items,
  }
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

/**
 * Pure renderer: turns a structured infographic spec into a scoped wp:html block.
 *
 * - ALL CSS selectors are prefixed with `#${id}` — no bare class selectors
 * - Uses Inter font via Google Fonts @import
 * - Gradient header in brand.primaryColor → brand.accentColor
 * - Responsive max-width: 850px; margin: 2em auto
 * - Subtle brand footer with siteName · siteUrl
 * - Content layout adapts to `kind`: checklist grid / classification cards /
 *   comparison rows / numbered steps
 */
export function renderInfographicBlock(spec: {
  kind: 'classification' | 'checklist' | 'comparison' | 'steps'
  id: string
  title: string
  subtitle?: string
  items: Array<{ label: string; value?: string; note?: string }>
  brand: InfographicBrand
}): string {
  const { kind, id, title, subtitle, items, brand } = spec
  const primary = brand.primaryColor ?? '#7c3aed'
  const accent = brand.accentColor ?? '#4f46e5'
  const siteNameSafe = escapeHtml(brand.siteName)
  const siteUrlSafe = escapeHtml(brand.siteUrl)
  const titleSafe = escapeHtml(title)
  const subtitleSafe = subtitle ? escapeHtml(subtitle) : ''

  // ── CSS ──────────────────────────────────────────────────────────────────
  const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
#${id}{font-family:'Inter',sans-serif;max-width:850px;margin:2em auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);background:#fff;}
#${id} *{box-sizing:border-box;margin:0;padding:0;}
#${id} .infog-header{background:linear-gradient(135deg,${primary},${accent});padding:28px 32px 22px;color:#fff;}
#${id} .infog-header h2{font-size:1.35rem;font-weight:800;letter-spacing:-.01em;line-height:1.25;}
#${id} .infog-header p{font-size:.88rem;opacity:.88;margin-top:6px;font-weight:400;}
#${id} .infog-body{padding:24px 28px;}
#${id} .infog-footer{background:#f5f3ff;border-top:1px solid #ede9fe;padding:10px 28px;display:flex;align-items:center;justify-content:flex-end;font-size:.75rem;color:#6b7280;gap:6px;}
#${id} .infog-footer a{color:${primary};text-decoration:none;font-weight:600;}
${kindCss(id, kind, primary, accent)}
`.trim()

  // ── Body markup ──────────────────────────────────────────────────────────
  const bodyHtml = kindBody(id, kind, items, primary)

  const block = `<!-- wp:html -->
<style>${css}</style>
<div id="${id}">
  <div class="infog-header">
    <h2>${titleSafe}</h2>
    ${subtitleSafe ? `<p>${subtitleSafe}</p>` : ''}
  </div>
  <div class="infog-body">${bodyHtml}</div>
  <div class="infog-footer">
    <span>${siteNameSafe}</span>
    <span>·</span>
    <a href="${siteUrlSafe}" rel="noopener">${siteUrlSafe}</a>
  </div>
</div>
<!-- /wp:html -->`

  return block
}

// ─── Kind-specific CSS ────────────────────────────────────────────────────────

function kindCss(
  id: string,
  kind: InfographicSpec['kind'],
  primary: string,
  accent: string
): string {
  switch (kind) {
    case 'checklist':
      return `
#${id} .infog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;}
#${id} .infog-card{background:#faf9ff;border:1.5px solid #ede9fe;border-radius:10px;padding:16px 16px 14px;display:flex;flex-direction:column;gap:6px;}
#${id} .infog-card .ic-check{width:22px;height:22px;background:${primary};border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
#${id} .infog-card .ic-check svg{width:12px;height:12px;fill:none;stroke:#fff;stroke-width:2.5;}
#${id} .infog-card .ic-label{font-size:.87rem;font-weight:700;color:#1e1b4b;line-height:1.3;}
#${id} .infog-card .ic-note{font-size:.78rem;color:#6b7280;line-height:1.4;}
`.trim()

    case 'classification':
      return `
#${id} .infog-classify{display:flex;flex-direction:column;gap:10px;}
#${id} .infog-classify .cls-row{display:grid;grid-template-columns:180px 1fr;gap:0;border-radius:9px;overflow:hidden;border:1.5px solid #ede9fe;}
#${id} .infog-classify .cls-label{background:${primary};color:#fff;font-size:.84rem;font-weight:700;padding:13px 14px;display:flex;align-items:center;}
#${id} .infog-classify .cls-value{background:#faf9ff;font-size:.84rem;color:#374151;padding:13px 16px;display:flex;flex-direction:column;justify-content:center;gap:3px;}
#${id} .infog-classify .cls-note{font-size:.76rem;color:#6b7280;}
@media(max-width:500px){#${id} .infog-classify .cls-row{grid-template-columns:1fr;} #${id} .infog-classify .cls-label{border-radius:0;}}
`.trim()

    case 'comparison':
      return `
#${id} .infog-compare{overflow-x:auto;}
#${id} .infog-compare table{width:100%;border-collapse:collapse;font-size:.85rem;}
#${id} .infog-compare th{background:${primary};color:#fff;font-weight:700;padding:11px 14px;text-align:left;}
#${id} .infog-compare td{padding:11px 14px;border-bottom:1px solid #ede9fe;color:#374151;vertical-align:top;}
#${id} .infog-compare tr:last-child td{border-bottom:none;}
#${id} .infog-compare tr:nth-child(even) td{background:#faf9ff;}
#${id} .infog-compare .cmp-note{font-size:.76rem;color:#6b7280;margin-top:3px;}
`.trim()

    case 'steps':
      return `
#${id} .infog-steps{display:flex;flex-direction:column;gap:0;}
#${id} .infog-steps .stp-row{display:grid;grid-template-columns:50px 1fr;gap:0;position:relative;}
#${id} .infog-steps .stp-row:not(:last-child)::before{content:'';position:absolute;left:24px;top:44px;bottom:-8px;width:2px;background:${accent};opacity:.25;}
#${id} .infog-steps .stp-num{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,${primary},${accent});color:#fff;font-weight:800;font-size:.95rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;}
#${id} .infog-steps .stp-content{padding:4px 0 22px 6px;}
#${id} .infog-steps .stp-label{font-size:.9rem;font-weight:700;color:#1e1b4b;line-height:1.3;}
#${id} .infog-steps .stp-note{font-size:.78rem;color:#6b7280;margin-top:4px;line-height:1.4;}
`.trim()
  }
}

// ─── Kind-specific body HTML ──────────────────────────────────────────────────

function kindBody(
  _id: string,
  kind: InfographicSpec['kind'],
  items: Array<{ label: string; value?: string; note?: string }>,
  _primary: string
): string {
  switch (kind) {
    case 'checklist':
      return `<div class="infog-grid">${items
        .map(
          (it) => `<div class="infog-card">
  <div class="ic-check"><svg viewBox="0 0 14 14"><polyline points="2,7 6,11 12,3"/></svg></div>
  <div class="ic-label">${escapeHtml(it.label)}</div>
  ${it.note ? `<div class="ic-note">${escapeHtml(it.note)}</div>` : ''}
</div>`
        )
        .join('')}</div>`

    case 'classification':
      return `<div class="infog-classify">${items
        .map(
          (it) => `<div class="cls-row">
  <div class="cls-label">${escapeHtml(it.label)}</div>
  <div class="cls-value">
    ${it.value ? `<span>${escapeHtml(it.value)}</span>` : ''}
    ${it.note ? `<span class="cls-note">${escapeHtml(it.note)}</span>` : ''}
  </div>
</div>`
        )
        .join('')}</div>`

    case 'comparison':
      return `<div class="infog-compare"><table>
  <thead><tr><th>Opzione</th><th>Dettaglio</th><th>Note</th></tr></thead>
  <tbody>${items
    .map(
      (it) => `<tr>
    <td><strong>${escapeHtml(it.label)}</strong></td>
    <td>${it.value ? escapeHtml(it.value) : ''}</td>
    <td class="cmp-note">${it.note ? escapeHtml(it.note) : ''}</td>
  </tr>`
    )
    .join('')}</tbody>
</table></div>`

    case 'steps':
      return `<div class="infog-steps">${items
        .map(
          (it, i) => `<div class="stp-row">
  <div class="stp-num">${i + 1}</div>
  <div class="stp-content">
    <div class="stp-label">${escapeHtml(it.label)}</div>
    ${it.note ? `<div class="stp-note">${escapeHtml(it.note)}</div>` : ''}
  </div>
</div>`
        )
        .join('')}</div>`
  }
}

// ─── Main generator ───────────────────────────────────────────────────────────

/**
 * Ask the LLM (kimi-k2 via `complete`) to design infographic DATA for the given
 * keyword/niche/research context, then render self-contained, ID-scoped HTML
 * `<!-- wp:html -->` blocks.
 *
 * Returns `opts.count` blocks (default 2 for pillar articles).
 *
 * On LLM JSON parse failure, gracefully falls back to a checklist derived from
 * `research.peopleAlsoAsk` / `research.relatedKeywords` — so this function
 * **never returns an empty array**.
 *
 * @param keyword      - The primary focus keyword for the article
 * @param research     - Full ResearchResult from the research stage
 * @param niche        - Site niche (e.g. "salute", "finanza", "viaggi")
 * @param brand        - Brand identity (name, URL, optional colors)
 * @param opts.count   - Number of infographics to generate (default 2)
 * @param opts.language - Output language ISO 639-1 code (default 'it')
 */
export async function generateInfographicBlocks(
  keyword: string,
  research: ResearchResult,
  niche: string,
  brand: InfographicBrand,
  opts?: { count?: number; language?: string }
): Promise<InfographicResult[]> {
  const count = opts?.count ?? 2
  const language = opts?.language ?? 'it'

  const paaContext =
    research.peopleAlsoAsk.slice(0, 6).join(' | ') || '—'
  const relatedContext =
    research.relatedKeywords.slice(0, 8).join(', ') || '—'

  const systemPrompt = `You are an expert infographic data architect for SEO pillar articles.
Return ONLY valid JSON — no explanation, no markdown fences.
The JSON must match this schema:
{
  "infographics": [
    {
      "kind": "classification" | "checklist" | "comparison" | "steps",
      "title": "string (max 65 chars)",
      "subtitle": "string (optional, max 90 chars)",
      "items": [
        { "label": "string", "value": "string (optional)", "note": "string (optional)" }
      ]
    }
  ]
}
Rules:
- Provide exactly ${count} infographic object(s).
- Each infographic must have 5–8 items.
- First infographic: prefer "classification" or "comparison" (diagnostic/staging visual).
- Second infographic (if count≥2): prefer "checklist" or "steps" (action-oriented).
- Language for all text fields: ${language}.
- All text content must be factually relevant to the keyword and niche provided.`

  const userPrompt = `Keyword: "${keyword}"
Niche: ${niche}
People Also Ask: ${paaContext}
Related keywords: ${relatedContext}

Design ${count} infographic(s) that would add maximum visual value to a pillar article about "${keyword}".`

  let specs: InfographicSpec[] = []

  try {
    const raw = await complete(
      [{ role: 'user', content: userPrompt }],
      {
        model: 'moonshotai/kimi-k2',
        temperature: 0.4,
        maxTokens: 2048,
        systemPrompt,
      }
    )

    const parsed = extractJson(raw)
    if (
      parsed &&
      Array.isArray(parsed.infographics) &&
      parsed.infographics.length > 0
    ) {
      specs = parsed.infographics.slice(0, count)
    }
  } catch {
    // LLM call failed — fall through to fallback below
  }

  // Fallback: build a sensible checklist from research data
  if (specs.length === 0) {
    specs = [buildFallbackSpec(keyword, research, language)]
  }

  // Render each spec
  return specs.map((spec, i) => {
    const id = toInfographicId(keyword, i)
    const html = renderInfographicBlock({ ...spec, id, brand })
    return {
      type: spec.kind,
      title: spec.title,
      html,
    }
  })
}

/**
 * proprietaryFramework.ts — generate ORIGINAL, brand-owned frameworks for an article.
 *
 * Per the seo-geo-content skill, the single strongest GEO signal is content that exists
 * nowhere else: a proprietary method, scoring system, or checklist that AI engines can only
 * cite from this source because it can't be paraphrased from competitors.
 *
 * CRITICAL: a framework is original METHODOLOGY (steps, criteria, a named rubric) — NOT invented
 * data. We never fabricate statistics or test results here; we synthesise a memorable, reusable
 * way to think about the topic, branded to the site. Rendered as a distinctive, ID-scoped
 * Gutenberg `wp:html` block so it stands out and is easy for AI to extract verbatim.
 */

import { complete } from '../openrouter'
import { frameworkBlockLabels, promptLangName } from '../../lib/contentLanguages'

export interface FrameworkBrand {
  siteName: string
  primaryColor?: string
  accentColor?: string
}

interface FrameworkSpec {
  name: string
  type: 'metodo' | 'checklist' | 'punteggio' | 'matrice'
  intro: string
  items: Array<{ label: string; description: string }>
  howToUse: string
}

const SYSTEM = (lang: string) => `Sei uno stratega di contenuti esperto. Crei un FRAMEWORK ORIGINALE e di marca — qualcosa che esiste solo su questo sito e che le AI (ChatGPT, Perplexity, Google AI Overviews) possono citare come fonte unica.

REGOLE FERREE:
- È METODOLOGIA originale: un metodo a step, una checklist operativa, un sistema di punteggio (rubrica) o una matrice decisionale. NON sono dati: NON inventare statistiche, percentuali, numeri di studi o risultati di test.
- Deve essere realmente UTILE e applicabile dal lettore, specifico per l'argomento (niente generico).
- Dagli un NOME memorabile legato al brand (es. "Il Metodo {brand} in 5 passi", "{brand} Score", "Check-list {brand}").
- 4-6 elementi, ognuno con label breve e descrizione concreta (1-2 frasi).
- Lingua: scrivi TUTTI i testi (name, intro, items, howToUse) in ${promptLangName(lang)}.

Rispondi SOLO con JSON valido (nessun altro testo):
{"name":"...","type":"metodo|checklist|punteggio|matrice","intro":"1-2 frasi che presentano il framework","items":[{"label":"...","description":"..."}],"howToUse":"1 frase su come usarlo"}`

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Render the framework as a distinctive, ID-scoped Gutenberg wp:html block. */
function renderFrameworkBlock(spec: FrameworkSpec, brand: FrameworkBrand, language: string): string {
  const labels = frameworkBlockLabels(language)
  const primary = brand.primaryColor || '#7c3aed'
  const accent = brand.accentColor || '#4f46e5'
  const id = 'asfw-' + spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
  const numbered = spec.type === 'metodo'
  const items = spec.items
    .map((it, i) => {
      const badge = numbered ? `<span class="${id}-num">${i + 1}</span>` : `<span class="${id}-dot">◆</span>`
      return `<li class="${id}-item">${badge}<div><strong>${escapeHtml(it.label)}</strong><p>${escapeHtml(it.description)}</p></div></li>`
    })
    .join('')
  return `<!-- wp:html -->
<div id="${id}" class="astroseo-framework">
<style>
#${id}{border:1px solid #e6e6ef;border-radius:16px;padding:28px;margin:32px 0;background:linear-gradient(180deg,#ffffff,#faf9ff);font-family:inherit}
#${id} .${id}-kicker{display:inline-block;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:${primary};font-weight:700;margin-bottom:8px}
#${id} h3{margin:0 0 6px;font-size:1.4rem;line-height:1.2;color:#0f0f17}
#${id} .${id}-intro{margin:0 0 18px;color:#44444f}
#${id} ul{list-style:none;margin:0;padding:0;display:grid;gap:14px}
#${id} .${id}-item{display:flex;gap:14px;align-items:flex-start}
#${id} .${id}-num{flex:0 0 30px;height:30px;border-radius:50%;background:${primary};color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:.9rem}
#${id} .${id}-dot{flex:0 0 30px;height:30px;display:flex;align-items:center;justify-content:center;color:${accent};font-size:1.1rem}
#${id} .${id}-item strong{display:block;color:#0f0f17;font-size:1rem}
#${id} .${id}-item p{margin:2px 0 0;color:#55555f;font-size:.94rem;line-height:1.5}
#${id} .${id}-how{margin:18px 0 0;padding-top:14px;border-top:1px dashed #e0e0ea;font-size:.9rem;color:#44444f}
#${id} .${id}-how b{color:${primary}}
</style>
<span class="${id}-kicker">${escapeHtml(brand.siteName)} · ${labels.kicker}</span>
<h3>${escapeHtml(spec.name)}</h3>
<p class="${id}-intro">${escapeHtml(spec.intro)}</p>
<ul>${items}</ul>
<p class="${id}-how"><b>${labels.howToUse}</b> ${escapeHtml(spec.howToUse)}</p>
</div>
<!-- /wp:html -->`
}

/**
 * Generate one original, brand-owned framework block for the article. Returns the Gutenberg
 * HTML block, or null if generation fails / the model returns something unusable (graceful).
 */
export async function generateFrameworkBlock(
  keyword: string,
  niche: string,
  brand: FrameworkBrand,
  language: string = 'en'
): Promise<string | null> {
  try {
    const raw = await complete(
      [
        {
          role: 'user',
          content: `Argomento dell'articolo: "${keyword}"\nNicchia/settore: ${niche}\nBrand: ${brand.siteName}\n\nCrea un framework originale e di marca, davvero utile per chi legge questo articolo.`,
        },
      ],
      // 2400 tokens: a 6-item framework with descriptions + howToUse routinely exceeded 1200,
      // truncating the JSON mid-string and failing the parse (the framework — our strongest GEO
      // signal — then silently went missing). Headroom fixes it.
      // gpt-4o (not kimi): reliably finishes well within the Edge proxy window so the framework —
      // our strongest GEO signal — actually gets added instead of timing out and going missing.
      { model: 'openai/gpt-4o', temperature: 0.5, maxTokens: 2400, systemPrompt: SYSTEM(language), timeoutMs: 90_000 }
    )
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) return null
    let spec: FrameworkSpec
    try {
      spec = JSON.parse(match[0]) as FrameworkSpec
    } catch {
      // Last-ditch repair: if the JSON was still truncated mid-array, close it at the last complete item.
      const repaired = match[0].replace(/,\s*\{[^}]*$/, '').replace(/\]?\s*\}?\s*$/, '') + ']}'
      try {
        spec = JSON.parse(repaired) as FrameworkSpec
      } catch {
        return null
      }
    }
    if (!spec?.name || !Array.isArray(spec.items) || spec.items.length < 3) return null
    // Defensive: trim to 6 items, drop malformed ones.
    spec.items = spec.items.filter((i) => i?.label && i?.description).slice(0, 6)
    if (spec.items.length < 3) return null
    if (!['metodo', 'checklist', 'punteggio', 'matrice'].includes(spec.type)) spec.type = 'metodo'
    return renderFrameworkBlock(spec, brand, language)
  } catch (e) {
    console.warn('[Framework] generation failed:', e)
    return null
  }
}

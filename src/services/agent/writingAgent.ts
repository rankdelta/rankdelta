/**
 * Writing Agent — Stage 4 of the pipeline. This is the core differentiator.
 *
 * Produces articles that rank on Google AND get cited by AI systems
 * (ChatGPT, Perplexity, Google AI Overviews) using the GEO framework.
 *
 * GEO Framework (non-negotiable elements):
 *   1. Author line — "A cura del team [SiteName] | Pubblicato: [date]"
 *   2. Quick Answer Box — 150-200 words answering the question immediately
 *   3. Structured headings (H2/H3) — specific, not generic
 *   4. Short paragraphs (2-4 sentences)
 *   5. Stripes table (is-style-stripes) with comparison/data
 *   6. Expert note — verified external source citation (ONLY when research has verified sources)
 *   7. FAQ block — 5-7 questions from People Also Ask
 *   8. Fonti section — numbered citations of the verified sources (ONLY when there are any)
 *   9. Internal links — 6-10 real URLs from the site
 *   10. External links — 2-3 authoritative sources
 *   11. Infographic blocks (HTML) — for 3000+ word articles
 *   12. CTA block — if monetized (affiliate, lead gen)
 *
 * Uses Kimi K2 for content (cheap), Claude Sonnet for quality checks.
 */

import { complete } from '../openrouter'
import {
  defaultAuthorLine,
  defaultMetaDescription,
  faqSectionTitle,
  formatPublishDate,
  langName,
  quickAnswerTitle,
  sourcesSectionTitle,
} from '../../lib/contentLanguages'
import type { ArticleContent, ResearchResult, SiteAuditResult } from './types'
import { rankMoneyPagesForKeyword, type MoneyPage } from '../moneyPages'
import { noFabricationRules, sourceNeededLabel, sourceNeededPlaceholder } from '../../lib/contentIntegrity'

interface WritingConfig {
  siteName: string
  siteUrl: string
  niche: string
  language: string
  tone?: string
  targetWordCount: number
  ctaHtml?: string  // optional CTA block (for monetized sites)
  authorLine?: string
  /**
   * The project's commercial pages (services/product/B2B). When present, every article MUST
   * link the most pertinent one — informational content exists to funnel authority to these.
   */
  moneyPages?: MoneyPage[]
}

export const WRITING_SYSTEM_PROMPT = (config: WritingConfig, hasSources: boolean) => `
Sei un esperto copywriter SEO/GEO specializzato in contenuti in ${langName(config.language)} che si posizionano sia su Google che vengono citati da sistemi AI (ChatGPT, Perplexity, Google AI Overviews).

SITO: ${config.siteUrl}
NICCHIA: ${config.niche}
TONO: ${config.tone ?? 'professionale ma accessibile'}
LINGUA DELL'ARTICOLO: ${langName(config.language)} (${config.language}) — TUTTO l'articolo (titoli, testo, tabelle, FAQ, didascalie, sezione fonti) DEVE essere scritto in questa lingua. MAI in un'altra.
LUNGHEZZA TARGET: ${config.targetWordCount}+ parole

REGOLE ASSOLUTE (mai violarle):
1. NIENTE statistiche inventate. MAI inventare percentuali, cifre, "+43%", "98,4%", prezzi o numeri precisi se non ti sono stati forniti come dati reali e verificabili. Senza un dato verificato: descrivi in modo qualitativo SENZA attribuirlo a nessuno ("esperti", "studi", "ricerche"), oppure inserisci un placeholder visibile "[${sourceNeededLabel(config.language)}: …]".
2. NIENTE CASE STUDY, STORIE DI SUCCESSO, CLIENTI o AZIENDE inventati. Questo è l'errore più grave: NON scrivere mai "un retailer italiano con 2,3 milioni di installazioni ha migrato e ha ottenuto +43%", NON inventare clienti, migrazioni, test A/B, risultati prima/dopo, ore risparmiate o qualsiasi aneddoto specifico che non ti sia stato fornito come reale. Un case study inventato è una FRODE e distrugge la credibilità del brand. Se vuoi illustrare un beneficio, fallo in modo ESPLICITAMENTE generico/ipotetico ("ad esempio, un e-commerce che usa i deep link può ridurre i passaggi verso la scheda prodotto") oppure qualitativo, MAI con un'azienda e numeri precisi spacciati per reali.
3. NIENTE autori o esperti inventati. Usa sempre "${config.authorLine ?? defaultAuthorLine(config.siteName, config.language)}"
4. NIENTE link placeholder come [link qui] o LINK:slug — usa solo URL reali forniti
5. Cita SOLO le fonti esterne elencate nel prompt (URL verificati). MAI citare studi, riviste, enti, esperti o URL a memoria, nemmeno se sei sicuro che esistano: dove servirebbe una fonte che non hai, inserisci "[${sourceNeededLabel(config.language)}: …]".
6. La tabella deve confrontare caratteristiche/criteri REALI e verificabili (es. funzioni, piani, supporto piattaforme). NON riempirla con metriche di performance inventate.
7. OUTPUT: SOLO HTML in blocchi Gutenberg. NIENTE JSON, NIENTE \`\`\`, NIENTE testo prima o dopo. Inizia direttamente con il primo blocco <!-- wp:paragraph -->.

${noFabricationRules(config.language)}

STRUTTURA OBBLIGATORIA:
- Quick Answer Box (primo blocco dopo autore)
- Intro coinvolgente (200-300 parole)
- Almeno 8 H2 con H3 descrittivi
- Tabella is-style-stripes con dati reali
${hasSources ? '- Blocco note-esperto che cita e linka una delle fonti esterne fornite\n' : ''}- Sezione FAQ con titolo H2 ESATTAMENTE "${faqSectionTitle(config.language)}", con ALMENO 5-7 domande (H3 = domanda, paragrafo = risposta di 60-120 parole). MAI meno di 5 domande.
${hasSources ? `- Sezione "${sourcesSectionTitle(config.language)}" con citazioni numerate delle fonti esterne fornite\n` : `- NESSUN blocco note-esperto e NESSUNA sezione "${sourcesSectionTitle(config.language)}": non ci sono fonti verificate\n`}- I link interni distribuiti naturalmente nel testo

REQUISITO DI LUNGHEZZA (vincolante): l'articolo deve raggiungere ALMENO ${config.targetWordCount} parole di testo reale. Scrivi in modo approfondito e completo, sviluppa ogni H2 con più paragrafi. NON fermarti prima di aver raggiunto la lunghezza richiesta.

OUTPUT: restituisci SOLO l'HTML completo dell'articolo in blocchi Gutenberg (es. <!-- wp:paragraph --><p>…</p><!-- /wp:paragraph -->, <!-- wp:heading {"level":2} -->…). Nessun JSON, nessun commento, nessun markdown fence.
`

/**
 * Prompt section for the project's money pages — shared by the write AND augment prompts, so
 * every engine path funnels authority to the same commercial pages. Ranked by affinity with
 * the article keyword so the LLM links the most pertinent one first. Empty string when the
 * project has no money pages configured.
 */
function moneyPagesPromptSection(keyword: string, config: WritingConfig): string {
  const ranked = rankMoneyPagesForKeyword(config.moneyPages ?? [], keyword)
  const text = ranked
    .map((mp, i) => `${i + 1}. ${mp.url} — pagina commerciale per "${mp.keyword}"${mp.label ? ` (${mp.label})` : ''}`)
    .join('\n')
  return text
    ? `
PAGINE COMMERCIALI DEL SITO (money pages) — PRIORITÀ MASSIMA:
${text}
REGOLE: inserisci nel corpo dell'articolo ALMENO 1 link (massimo 2) alla pagina commerciale PIÙ PERTINENTE tra quelle elencate (la n.1 è la più affine al tema). Il link deve essere un vero <a href="URL">anchor</a> con anchor text naturale e descrittivo legato alla keyword della pagina (MAI "clicca qui"). Inseriscilo dove il lettore ha un intento d'azione (es. dopo aver spiegato un beneficio o un criterio di scelta), in modo editoriale e non pubblicitario. Questi link hanno priorità sugli altri link interni. Se un link a una di queste pagine è GIÀ presente, non duplicarlo.
`
    : ''
}

export function buildWritingPrompt(
  keyword: string,
  research: ResearchResult,
  config: WritingConfig,
  publishDate: string
): string {
  const authorLine = config.authorLine ?? defaultAuthorLine(config.siteName, config.language, publishDate)

  const internalLinksText = research.internalLinks
    .slice(0, 10)
    .map((l) => `- ${l.url} (anchor suggerito: "${l.anchorText}")`)
    .join('\n')

  const moneyPagesSection = moneyPagesPromptSection(keyword, config)

  const externalSourcesText = research.externalSources
    .map((s) => `- ${s.url} — ${s.title}`)
    .join('\n')
  const hasSources = research.externalSources.length > 0

  const faqQuestionsText = research.peopleAlsoAsk
    .slice(0, 7)
    .map((q, i) => `${i + 1}. ${q}`)
    .join('\n')

  // Sources block of the template: built from the REAL verified sources (no "URL-FONTE" stand-ins
  // the model could copy), and omitted entirely when there are none.
  const sourcesTemplate = hasSources
    ? `SEZIONE FONTI (in fondo — ogni voce è una delle fonti verificate, come link <a href> reale):
<!-- wp:heading {"level":2} -->
<h2>${sourcesSectionTitle(config.language)}</h2>
<!-- /wp:heading -->
<!-- wp:list {"ordered":true} -->
<ol>
${research.externalSources.map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.title}</a></li>`).join('\n')}
</ol>
<!-- /wp:list -->`
    : `NESSUNA SEZIONE FONTI e NESSUN blocco note-esperto: non ci sono fonti verificate. Dove una fonte servirebbe, usa il placeholder "[${sourceNeededLabel(config.language)}: …]".`

  // SERP gap signal: the related searches are the adjacent sub-topics/entities the top-ranking pages
  // (and users) expect covered — covering them is what makes the article out-rank/out-cite the SERP.
  const relatedTopicsText = research.relatedKeywords
    .slice(0, 10)
    .map((k) => `- ${k}`)
    .join('\n')

  const avgCompetitorWords = Math.round(
    research.competitorWordCounts.reduce((a, b) => a + b, 0) / Math.max(research.competitorWordCounts.length, 1),
  )

  // Real heading-level gap: the sections the top-ranking pages actually cover. Match the relevant
  // ones AND go deeper / add what they miss — this is how you out-rank, not just out-write.
  const competitorHeadingsText = (research.competitorHeadings ?? [])
    .slice(0, 16)
    .map((h) => `- ${h}`)
    .join('\n')

  const ctaSection = config.ctaHtml
    ? `\nCTA BLOCK (da inserire top, middle, bottom):\n${config.ctaHtml}\n\nTRASPARENZA (obbligatoria quando consigli prodotti/servizi monetizzati): inserisci UNA volta, vicino alla prima CTA, una riga onesta tipo "Trasparenza: questo articolo contiene link affiliati; ${config.siteName} può ricevere una commissione, senza costi aggiuntivi per te. Consigliamo solo ciò in cui crediamo." Non fingere di "scoprire" il prodotto: il lettore sa che è il tuo sito.`
    : ''

  return `
Scrivi un articolo completo su: "${keyword}"
Data di pubblicazione: ${publishDate}
Autore: ${authorLine}
Lunghezza target: ${config.targetWordCount}+ parole

LINK INTERNI DA USARE (inseriscili naturalmente nel testo, come <a href="URL">anchor</a>):
${internalLinksText || '(NESSUN link interno pertinente disponibile — NON inventare URL interni, NON inserire link interni a caso. Scrivi l\'articolo senza link interni.)'}
${moneyPagesSection}
FONTI ESTERNE VERIFICATE${hasSources ? ' — OBBLIGATORIO linkarle come veri tag <a>' : ''}:
${externalSourcesText || `(NESSUNA fonte verificata disponibile — NON inventare URL o citazioni a memoria e NON attribuire affermazioni a "esperti", "studi" o "fonti istituzionali". Scrivi in modo qualitativo senza attribuzioni e, dove una fonte servirebbe, inserisci "[${sourceNeededLabel(config.language)}: …]". Niente blocco note-esperto, niente sezione ${sourcesSectionTitle(config.language)}.)`}
⚠️ Usa SOLO le fonti esterne elencate qui sopra.${hasSources ? ' Ognuna DEVE comparire come link cliccabile reale: <a href="URL" target="_blank" rel="noopener">Titolo</a>, sia nel blocco note-esperto sia nella sezione Fonti.' : ''} NON inventare MAI altre fonti, URL, studi, esperti o numeri non presenti nell'elenco: una citazione fabbricata è l'errore più grave. Ogni link esterno non elencato verrà rimosso.

DOMANDE FAQ (da usare nella sezione FAQ):
${faqQuestionsText || '(genera tu ALMENO 5-7 domande pertinenti che gli utenti cercano davvero su questo tema)'}

COPERTURA COMPETITIVA — l'obiettivo è essere la risposta PIÙ COMPLETA e citabile della SERP, non l'ennesimo articolo generico:
- I top 5 articoli posizionati hanno in media ${avgCompetitorWords} parole: superali di almeno il 20% con profondità REALE (più sotto-temi e dettaglio concreto, mai riempitivo).
- SOTTO-TEMI / ENTITÀ DA COPRIRE (dalle ricerche correlate reali — Google e le AI premiano la copertura completa del tema): tratta esplicitamente questi sotto-argomenti nel corpo, con H2/H3 dedicati dove ha senso:
${relatedTopicsText || '(nessuna ricerca correlata disponibile — copri comunque il tema in modo esaustivo, anticipando le domande logiche del lettore)'}
${competitorHeadingsText ? `- SEZIONI CHE I TOP RISULTATI COPRONO GIÀ (dai loro H2/H3 reali): copri quelle PERTINENTI e vai più a fondo, e aggiungi ciò che NON trattano (angoli, esempi, passaggi pratici). NON limitarti a parafrasarle.\n${competitorHeadingsText}\n` : ''}- Le domande "People Also Ask" elencate sopra vanno affrontate NON solo nella FAQ ma anche nel corpo, dove pertinenti: sono esattamente ciò che utenti e AI cercano su questo tema.
${ctaSection}

STRUTTURA GUTENBERG RICHIESTA:

<!-- wp:paragraph -->
<p><strong>${authorLine}</strong></p>
<!-- /wp:paragraph -->

<!-- wp:html -->
<div class="quick-answer-box" style="background:#f0f7ff;border-left:4px solid #1a73e8;padding:20px 24px;margin:24px 0;border-radius:8px;color:#1f2937;">
<h2 style="margin-top:0;font-size:1.1em;color:#1a73e8;">⚡ ${quickAnswerTitle(config.language)}</h2>
<p style="color:#1f2937;">[150-200 parole che rispondono direttamente alla domanda principale, nella lingua dell'articolo]</p>
</div>
<!-- /wp:html -->

[Introduzione coinvolgente 200-300 parole]

[Corpo dell'articolo con H2/H3, tabella, ${hasSources ? 'note esperto, ' : ''}FAQ]

${sourcesTemplate}

Ricorda: restituisci SOLO l'HTML in blocchi Gutenberg (niente JSON, niente \`\`\`, niente preamboli). L'articolo deve essere completo, raggiungere la lunghezza richiesta ed essere scritto INTERAMENTE in ${langName(config.language)}.
`
}

/** Count words in Gutenberg HTML (tags/comments stripped). */
function countWords(html: string): number {
  return html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
}

/**
 * Expansion pass: Kimi-k2 routinely under-delivers on length. If the draft is meaningfully
 * short of target, ask the model to DEEPEN existing sections (more detail, examples, nuance) —
 * NOT to pad or repeat — while preserving every block, link and the structure. Raw-HTML in/out.
 * Guarded: only accept a result that is genuinely longer and keeps all the wp: blocks.
 */
async function expandContent(html: string, keyword: string, targetWordCount: number, language?: string): Promise<string> {
  const current = countWords(html)
  if (current >= targetWordCount * 0.9) return html
  const EXPAND_SYSTEM = `Sei un editor SEO. Ricevi un articolo HTML in blocchi Gutenberg troppo corto. Devi ESPANDERLO ad ALMENO ${targetWordCount} parole AGGIUNGENDO profondità reale alle sezioni esistenti: esempi esplicitamente illustrativi, dettagli pratici, spiegazioni, casi d'uso generici. REGOLE: scrivi nella STESSA lingua dell'articolo${language ? ` (${langName(language)})` : ''} — NON tradurlo, NON ripetere concetti, NON aggiungere riempitivi vuoti, NON inventare statistiche, case study, clienti, esperti, citazioni, studi, fonti o URL (dove servirebbero, inserisci "[${sourceNeededLabel(language ?? 'en')}: …]"), NON rimuovere o rinominare sezioni, MANTIENI tutti i blocchi <!-- wp:... -->, tutti i link <a href> e la tabella/FAQ/Fonti dove sono. Puoi aggiungere nuovi paragrafi <!-- wp:paragraph --> e nuovi H3 dentro le sezioni esistenti. Restituisci SOLO l'HTML completo aggiornato: niente JSON, niente \`\`\`, niente commenti tuoi.`
  try {
    const raw = await complete(
      [{ role: 'user', content: `Keyword: "${keyword}". Articolo attuale (${current} parole, target ${targetWordCount}+):\n\n${html}` }],
      { model: 'openai/gpt-4o', temperature: 0.6, maxTokens: 16384, systemPrompt: EXPAND_SYSTEM, timeoutMs: 180_000 }
    )
    const cleaned = raw.trim().replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim()
    if (!cleaned) return html
    const blocksBefore = (html.match(/<!--\s*wp:/g) || []).length
    const blocksAfter = (cleaned.match(/<!--\s*wp:/g) || []).length
    // Accept only if it actually grew and kept the structure.
    if (countWords(cleaned) > current * 1.05 && blocksAfter >= blocksBefore) return cleaned
    return html
  } catch (e) {
    console.warn('[Writing] expansion skipped:', e)
    return html
  }
}

/**
 * Light proofreading pass (cheap Haiku call). Fixes ONLY typos, duplicated words and
 * malformed/orphan HTML tags that the content model (Kimi) occasionally emits — it must NOT
 * rewrite, rephrase, shorten or change meaning. Raw-HTML in / raw-HTML out (no JSON wrapper,
 * to avoid truncating long articles). Guarded: if the result looks truncated or structurally
 * smaller than the input, we keep the original — proofreading must never lose content.
 */
async function proofreadContent(html: string): Promise<string> {
  const PROOF_SYSTEM = `Sei un correttore di bozze. Ricevi HTML in blocchi Gutenberg e restituisci lo STESSO HTML con SOLO queste correzioni: refusi, parole duplicate (es. "ATM ATM"), accenti/apostrofi errati, e tag HTML malformati o orfani (es. "3>", "<>", "P>", "-->" isolati, "<" spaiati). NON riscrivere, NON riformulare, NON accorciare, NON aggiungere o togliere contenuti o frasi, NON cambiare il significato. Mantieni TUTTI i blocchi <!-- wp:... --> e i link <a href> esattamente dove sono. Restituisci SOLO l'HTML corretto: niente JSON, niente \`\`\`, niente commenti tuoi.`
  try {
    const raw = await complete(
      [{ role: 'user', content: html }],
      // gpt-4o-mini: cheapest output ($0.60/1M) — this pass re-emits the whole article, and a
      // mechanical copyedit needs no premium model. ~8× cheaper than Haiku here, no quality loss.
      { model: 'openai/gpt-4o-mini', temperature: 0.1, maxTokens: 16384, systemPrompt: PROOF_SYSTEM, timeoutMs: 120_000 }
    )
    const cleaned = raw.trim().replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim()
    // Guards: never accept an empty, truncated, or structurally-smaller result.
    if (!cleaned) return html
    if (cleaned.length < html.length * 0.85) return html
    const blocksBefore = (html.match(/<!--\s*wp:/g) || []).length
    const blocksAfter = (cleaned.match(/<!--\s*wp:/g) || []).length
    if (blocksAfter < blocksBefore) return html
    return cleaned
  } catch (e) {
    console.warn('[Writing] proofreading skipped:', e)
    return html
  }
}

/**
 * Fact-safety pass (the skill's #1 rule: NEVER fabricate statistics OR case studies). The content
 * model can invent plausible-but-unsourced numbers ("a marketplace saw CAC +34%", "98.4% match rate")
 * AND whole fake success stories ("an Italian retailer with 2.3M installs migrated and got +43%").
 * This pass neutralises BOTH: it rewrites invented stats and fabricated case studies into honest,
 * explicitly-generic/qualitative language while LEAVING product pricing/specs, structural counts,
 * dates, and any figure tied to a cited source intact. It rewrites IN PLACE (keeps every block) so
 * the article stays structurally whole. Raw-HTML in/out, guarded (block-count preserved; keep
 * original if the result is empty or structurally smaller).
 */
async function sanitizeFabricatedStats(html: string, research: ResearchResult, language: string): Promise<string> {
  const allowedSources = research.externalSources.map((s) => `- ${s.url} — ${s.title}`).join('\n')
  const SYSTEM = `Sei un fact-checker editoriale severo che difende la credibilità del brand. Ricevi un articolo HTML in blocchi Gutenberg. Trova e CORREGGI tre tipi di contenuto inventato:

FONTI VERIFICATE (le UNICHE che contano come fonte):
${allowedSources || '(nessuna)'}

A) STATISTICHE NON VERIFICABILI: percentuali/numeri presentati come dati di fatto senza essere attribuiti a una delle FONTI VERIFICATE qui sopra (es. "+34% di CAC", "il 78% degli utenti", "match rate del 98,4%", "riduce del 40%"). Un numero attribuito a uno studio, ente o esperto NON presente nell'elenco è comunque NON verificato.

C) ATTRIBUZIONI NON VERIFICATE: "secondo gli esperti", "secondo uno studio di …", "come afferma il Dr. …", citazioni di riviste, enti, università o persone che non corrispondono alle FONTI VERIFICATE.

B) CASE STUDY / STORIE DI SUCCESSO / CLIENTI INVENTATI (l'errore più grave): aneddoti con un'azienda o un cliente specifico e risultati precisi spacciati per reali — es. "un retailer italiano con 2,3 milioni di installazioni ha migrato da X a Y e ha ottenuto +43% di vendite", "ha risparmiato 120 ore", "il tasso è salito dal 4,1% al 5,9%", test A/B inventati, migrazioni inventate, numeri prima/dopo. Se non c'è una fonte/citazione esplicita e verificabile, è FALSO e va eliminato.

COSA FARE:
- Per le statistiche inventate: sostituisci con linguaggio qualitativo onesto ("molti", "spesso", "tipicamente", "può aumentare/ridurre significativamente") oppure, se il dato è essenziale, con il placeholder "[${sourceNeededLabel(language)}: …]" che descrive il dato da verificare.
- Per le attribuzioni non verificate: togli l'attribuzione (niente "secondo gli esperti/uno studio") e lascia l'affermazione generale, oppure sostituiscila con "[${sourceNeededLabel(language)}: …]".
- Scrivi i placeholder nella lingua dell'articolo, così come indicati.
- Per i case study inventati: RISCRIVI il passaggio rendendolo ESPLICITAMENTE generico/ipotetico e togliendo l'azienda inventata e tutti i numeri inventati (es. "Immagina un e-commerce che passa ai deep link universali: gli utenti arrivano direttamente alla scheda prodotto invece che alla homepage, riducendo l'attrito e migliorando le conversioni"). Mantieni il valore informativo, elimina la finzione.
- IMPORTANTISSIMO: riscrivi SEMPRE IN LOCO. MANTIENI ogni blocco <!-- wp:... -->, ogni heading, ogni tabella e ogni link <a href>. NON eliminare blocchi, NON accorciare drasticamente: trasforma il contenuto falso in contenuto onesto di lunghezza simile.

NON TOCCARE: prezzi e specifiche di prodotto reali (es. "$200/mese", "180 KB"), numeri strutturali (es. "5 criteri", "3 passi"), date, versioni, i placeholder tra parentesi quadre, e i dati attribuiti a una delle FONTI VERIFICATE elencate.
NON cambiare il resto del testo né il tono. Restituisci SOLO l'HTML completo corretto: niente JSON, niente \`\`\`, niente commenti.`
  try {
    const raw = await complete(
      [{ role: 'user', content: html }],
      { model: 'openai/gpt-4o-mini', temperature: 0.1, maxTokens: 16384, systemPrompt: SYSTEM, timeoutMs: 120_000 }
    )
    const cleaned = raw.trim().replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim()
    if (!cleaned) return html
    // Allow shrink (rewriting invented case studies/stats to honest copy is often shorter), but the
    // block-count guard below still rejects any truncated/structurally-broken output.
    if (cleaned.length < html.length * 0.7) return html
    const blocksBefore = (html.match(/<!--\s*wp:/g) || []).length
    const blocksAfter = (cleaned.match(/<!--\s*wp:/g) || []).length
    if (blocksAfter < blocksBefore) return html
    return cleaned
  } catch (e) {
    console.warn('[Writing] fact-safety pass skipped:', e)
    return html
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`
  } catch {
    return url.trim().toLowerCase()
  }
}

/**
 * Deterministic guard for the no-fabrication rule: every external link that is NOT one of the
 * allowed URLs (verified research sources, internal links, money pages, links already in the
 * author's original article) is unwrapped and followed by a visible "[Source needed]" placeholder.
 * Links to the site's own host are kept. Returns the cleaned HTML and the removed URLs.
 */
export function stripUnlistedExternalLinks(
  html: string,
  opts: { allowedUrls: string[]; siteUrl: string; language: string },
): { html: string; removed: string[] } {
  const allowed = new Set(opts.allowedUrls.filter(Boolean).map(normalizeUrl))
  const siteHost = hostOf(opts.siteUrl)
  const removed: string[] = []
  const cleaned = html.replace(/<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (full, href: string, text: string) => {
    if (siteHost && hostOf(href) === siteHost) return full
    if (allowed.has(normalizeUrl(href))) return full
    removed.push(href)
    return `${text} ${sourceNeededPlaceholder(opts.language)}`
  })
  return { html: cleaned, removed }
}

/** URLs an article may link: verified sources, internal links, money pages (+ extra, e.g. the original article's). */
function allowedArticleUrls(research: ResearchResult, config: WritingConfig, extra: string[] = []): string[] {
  return [
    ...research.externalSources.map((s) => s.url),
    ...research.internalLinks.map((l) => l.url),
    ...(config.moneyPages ?? []).map((mp) => mp.url),
    ...extra,
  ]
}

function scoreArticle(content: string, keyword: string, research: ResearchResult): {
  seoScore: number
  geoScore: number
} {
  let seoScore = 40
  let geoScore = 30

  // SEO signals
  if (content.includes(keyword)) seoScore += 10
  if (content.includes('wp:heading')) seoScore += 5
  if (content.includes('wp:table') || content.includes('is-style-stripes')) seoScore += 10
  if (content.includes('rank_math') || content.includes('yoast')) seoScore += 5
  const internalLinkCount = (content.match(/href="\/[^"]+"/g) || []).length
  seoScore += Math.min(internalLinkCount * 2, 20)
  if (content.length > 6000) seoScore += 10

  // GEO signals
  if (content.includes('quick-answer-box')) geoScore += 15
  if (content.includes('Risposta rapida')) geoScore += 5
  if (content.includes('wp:faq') || content.includes('FAQ')) geoScore += 15
  if (content.includes('Fonti') || content.includes('pubmed') || content.includes('ncbi')) geoScore += 15
  if (content.includes('note-esperto') || content.includes('expert-note')) geoScore += 10
  if (research.externalSources.some((s) => content.includes(s.url))) geoScore += 10

  return {
    seoScore: Math.min(seoScore, 100),
    geoScore: Math.min(geoScore, 100),
  }
}

export async function runWritingAgent(
  keyword: string,
  research: ResearchResult,
  audit: SiteAuditResult,
  config: WritingConfig
): Promise<ArticleContent> {
  console.log(`[Writing] Generating article for: "${keyword}" (~${config.targetWordCount} words)`)

  const publishDate = formatPublishDate(config.language)

  const prompt = buildWritingPrompt(keyword, research, config, publishDate)

  // 1. CONTENT — raw Gutenberg HTML (NOT wrapped in JSON: embedding a long article in a
  //    JSON string field truncates/breaks reliably, producing near-empty output).
  const rawOutput = await complete(
    [{ role: 'user', content: prompt }],
    {
      // gpt-4o (not kimi-k2): a full-length article generation must finish inside the Edge proxy's
      // wall-clock window. kimi's throughput pushes a 16k-token write past it → "Failed to fetch".
      // gpt-4o writes the same length in ~40-60s, reliably, at comparable quality.
      model: 'openai/gpt-4o',
      temperature: 0.65,
      maxTokens: 16384,
      systemPrompt: WRITING_SYSTEM_PROMPT(config, research.externalSources.length > 0),
      timeoutMs: 180_000,
    }
  )

  let gutenbergContent = rawOutput
    .trim()
    .replace(/^```(?:html|json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  // Defensive recovery: if a model still returned JSON, lift the gutenbergContent field out.
  if (gutenbergContent.startsWith('{') && gutenbergContent.includes('gutenbergContent')) {
    try {
      const j = JSON.parse(gutenbergContent.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as Partial<ArticleContent>
      if (j.gutenbergContent) gutenbergContent = j.gutenbergContent
    } catch {
      /* keep raw */
    }
  }

  // 1b. EXPAND — if Kimi under-delivered on length, deepen existing sections (guarded).
  gutenbergContent = await expandContent(gutenbergContent, keyword, config.targetWordCount, config.language)

  // 1c. PROOFREAD — cheap Haiku pass fixes typos / malformed HTML without rewriting (guarded).
  gutenbergContent = await proofreadContent(gutenbergContent)

  // 1d. FACT-SAFETY — the skill's #1 rule: never publish fabricated statistics. Neutralises
  // unsourced percentages / invented case-study numbers / attributions to anything that is not a
  // verified research source into honest language or placeholders (guarded).
  gutenbergContent = await sanitizeFabricatedStats(gutenbergContent, research, config.language)

  // 1e. LINK GUARD — deterministic: any external URL not in the verified sources is unsourced.
  const linkGuard = stripUnlistedExternalLinks(gutenbergContent, {
    allowedUrls: allowedArticleUrls(research, config),
    siteUrl: config.siteUrl,
    language: config.language,
  })
  if (linkGuard.removed.length > 0) console.warn('[Writing] removed unverified external links:', linkGuard.removed)
  gutenbergContent = linkGuard.html

  // 2. METADATA — small, reliable JSON via a cheap model (small payload = no truncation).
  let meta: {
    title?: string
    metaTitle?: string
    metaDescription?: string
    slug?: string
    imageSearchTerms?: string[]
  } = {}
  try {
    const metaRaw = await complete(
      [
        {
          role: 'user',
          content:
            `Keyword: "${keyword}". Estratto articolo:\n${gutenbergContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1200)}\n\n` +
            `Scrivi title, metaTitle, metaDescription, slug e imageSearchTerms in ${langName(config.language)} (${config.language}), la lingua dell'articolo.\n` +
            `Restituisci SOLO questo JSON (niente altro): {"title":"titolo SEO accattivante con la keyword","metaTitle":"max 60 caratteri","metaDescription":"max 155 caratteri","slug":"slug-con-trattini","imageSearchTerms":["termine ricerca immagine 1","termine 2","termine 3"]}`,
        },
      ],
      { model: 'openai/gpt-4o-mini', temperature: 0.3, maxTokens: 400 }
    )
    meta = JSON.parse(metaRaw.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as typeof meta
  } catch (e) {
    console.warn('[Writing] meta generation failed, using fallbacks:', e)
  }

  const { seoScore, geoScore } = scoreArticle(gutenbergContent, keyword, research)

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .replace(/[àáâãäå]/g, 'a')
      .replace(/[èéêë]/g, 'e')
      .replace(/[ìíîï]/g, 'i')
      .replace(/[òóôõö]/g, 'o')
      .replace(/[ùúûü]/g, 'u')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

  const slug = meta.slug ? slugify(meta.slug) : slugify(keyword)
  const wordCount = gutenbergContent.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length

  const authorLine = config.authorLine ?? defaultAuthorLine(config.siteName, config.language, publishDate)

  console.log(`[Writing] Done: ${wordCount} words, SEO ${seoScore}/100, GEO ${geoScore}/100`)

  return {
    title: meta.title ?? `${keyword.charAt(0).toUpperCase() + keyword.slice(1)}`,
    slug,
    metaTitle: meta.metaTitle ?? `${meta.title ?? keyword} | ${config.siteName}`,
    metaDescription: meta.metaDescription ?? defaultMetaDescription(keyword, config.language),
    focusKeyword: keyword,
    gutenbergContent,
    wordCount,
    seoScore,
    geoScore,
    language: config.language,
    authorLine,
    imageSearchTerms:
      meta.imageSearchTerms && meta.imageSearchTerms.length > 0
        ? meta.imageSearchTerms
        : [keyword, `${audit.niche} ${keyword}`],
  }
}

// ─── AUGMENT (refresh existing content) ─────────────────────────────────────────

const AUGMENT_SYSTEM_PROMPT = (config: WritingConfig) => `
Sei un editor SEO/GEO esperto. Ricevi un ARTICOLO ESISTENTE in HTML. Il tuo compito è ARRICCHIRLO secondo gli standard SEO/GEO per farlo posizionare meglio su Google e farlo citare dalle AI — NON riscriverlo da zero.

SITO: ${config.siteUrl} · NICCHIA: ${config.niche} · LINGUA DELL'ARTICOLO: ${langName(config.language)} (${config.language})

REGOLE DI ARRICCHIMENTO:
- TUTTE le aggiunte (nuove sezioni, FAQ, tabelle, note) devono essere scritte in ${langName(config.language)}, la stessa lingua dell'articolo esistente. NON tradurre il contenuto esistente.
- MANTIENI intatto tutto il contenuto valido già presente (paragrafi, heading, tabelle, link, immagini). NON rimuovere né stravolgere ciò che è già buono.
- AGGIUNGI solo gli elementi MANCANTI (vedi checklist) e APPROFONDISCI le sezioni troppo brevi con dettagli concreti, esempi pratici, spiegazioni. NON duplicare elementi già presenti.
- Distribuisci i link interni forniti in modo naturale nel testo (come <a href="URL">anchor</a>), senza forzature.
- Le fonti esterne fornite (se ci sono) vanno linkate come veri tag <a href> sia in un blocco nota-esperto sia nella sezione Fonti. Senza fonti fornite: niente nota-esperto e niente nuova sezione Fonti.

DIVIETI ASSOLUTI (come per i nuovi articoli):
1. NIENTE statistiche, percentuali o numeri inventati. Senza un dato verificato descrivi in modo qualitativo senza attribuirlo a nessuno, oppure usa "[${sourceNeededLabel(config.language)}: …]".
2. NIENTE case study, storie di successo, clienti o aziende inventati con risultati precisi (es. "un retailer ha ottenuto +43%"). È una frode. Se illustri un beneficio, fallo in modo esplicitamente generico/ipotetico.
3. NIENTE autori/esperti inventati. NIENTE citazioni, studi, enti o URL a memoria: solo le fonti fornite.

${noFabricationRules(config.language)}

OUTPUT: SOLO l'HTML completo dell'articolo arricchito in blocchi Gutenberg. NIENTE JSON, NIENTE \`\`\`, NIENTE testo prima o dopo.
`

function buildAugmentPrompt(
  existingContent: string,
  keyword: string,
  research: ResearchResult,
  config: WritingConfig,
  publishDate: string
): string {
  const authorLine = config.authorLine ?? defaultAuthorLine(config.siteName, config.language, publishDate)
  const internalLinksText = research.internalLinks
    .slice(0, 10)
    .map((l) => `- ${l.url} (anchor suggerito: "${l.anchorText}")`)
    .join('\n')
  const externalSourcesText = research.externalSources.map((s) => `- ${s.url} — ${s.title}`).join('\n')
  const hasSources = research.externalSources.length > 0
  const faqQuestionsText = research.peopleAlsoAsk
    .slice(0, 7)
    .map((q, i) => `${i + 1}. ${q}`)
    .join('\n')
  const relatedTopicsText = research.relatedKeywords.slice(0, 10).map((k) => `- ${k}`).join('\n')
  const competitorHeadingsText = (research.competitorHeadings ?? []).slice(0, 16).map((h) => `- ${h}`).join('\n')
  const moneyPagesSection = moneyPagesPromptSection(keyword, config)

  return `
Argomento / keyword principale: "${keyword}"
Autore da usare (se manca una riga autore): ${authorLine}
Lunghezza target dopo l'arricchimento: ${config.targetWordCount}+ parole

ARTICOLO ESISTENTE DA ARRICCHIRE (mantienilo e potenzialo):
"""
${existingContent}
"""

CHECKLIST DI ELEMENTI SEO/GEO — assicurati che l'articolo finale li contenga TUTTI. Aggiungi SOLO quelli mancanti, non duplicare quelli già presenti:
1. Box "Risposta rapida": un paragrafo iniziale con class="quick-answer-box" che risponde in 150-200 parole alla domanda principale (subito dopo l'eventuale riga autore).
2. Riga autore: "${authorLine}" (se non c'è già).
3. Almeno 8 sezioni H2 con H3 descrittivi; approfondisci le sezioni troppo brevi.
4. Una tabella comparativa is-style-stripes con criteri REALI (funzioni, piani, supporto) — niente metriche di performance inventate.
5. ${hasSources ? 'Un blocco nota-esperto (class="expert-note") che cita e linka una fonte esterna autorevole REALE tra quelle fornite.' : 'Nessun blocco nota-esperto (non ci sono fonti verificate da citare).'}
6. Sezione FAQ con titolo H2 ESATTAMENTE "${faqSectionTitle(config.language)}" e ALMENO 5-7 domande (H3 = domanda, paragrafo = risposta 60-120 parole).
7. ${hasSources ? `Sezione "${sourcesSectionTitle(config.language)}" (H2) con citazioni numerate che linkano le fonti esterne reali fornite.` : `Nessuna nuova sezione "${sourcesSectionTitle(config.language)}" (non ci sono fonti verificate); non inventarne.`}

LINK INTERNI DA DISTRIBUIRE NEL TESTO (usa <a href="URL">anchor</a>):
${internalLinksText || '(nessun link interno disponibile — non inventarne)'}
${moneyPagesSection}
FONTI ESTERNE AUTOREVOLI REALI — linkale come <a href="URL" target="_blank" rel="noopener">Titolo</a> nel blocco nota-esperto e nella sezione Fonti:
${externalSourcesText || `(NESSUNA fonte verificata disponibile — NON inventare URL o citazioni a memoria e NON attribuire affermazioni a "esperti" o "studi". Dove servirebbe una fonte, usa "[${sourceNeededLabel(config.language)}: …]". Meglio nessuna citazione che una falsa.)`}

DOMANDE FAQ suggerite (usale se mancano FAQ):
${faqQuestionsText || '(genera tu 5-7 domande pertinenti che gli utenti cercano davvero)'}

COPERTURA DA COLMARE (rendi l'articolo più completo della concorrenza — aggiungi le sezioni mancanti, non duplicare):
- Sotto-temi/entità correlati da coprire se assenti:
${relatedTopicsText || '(nessuna ricerca correlata disponibile)'}
${competitorHeadingsText ? `- Sezioni che i top risultati coprono già (loro H2/H3 reali): aggiungi quelle pertinenti che mancano e vai più a fondo:\n${competitorHeadingsText}\n` : ''}- Rispondi alle domande "People Also Ask" anche nel corpo, dove pertinenti.

Restituisci SOLO l'HTML completo dell'articolo ARRICCHITO in blocchi Gutenberg.
`
}

/**
 * Refresh/augment an EXISTING article: keep the good body, add the missing GEO/SEO elements
 * (Risposta rapida, FAQ, nota-esperto + fonti reali, link interni) and deepen thin sections —
 * the seo-geo skill's "audit & optimize existing content" flow. Runs the same QA passes as a
 * fresh write (expand if still short → proofread → fact-safety) so it can never inject fabricated
 * stats/case studies. Returns a fully-formed ArticleContent (caller runs finalizeArticle next).
 */
export async function runAugmentAgent(
  existingContent: string,
  keyword: string,
  research: ResearchResult,
  audit: SiteAuditResult,
  config: WritingConfig
): Promise<ArticleContent> {
  console.log(`[Augment] Enriching existing article for: "${keyword}" (~${config.targetWordCount} words target)`)

  const publishDate = formatPublishDate(config.language)
  const prompt = buildAugmentPrompt(existingContent, keyword, research, config, publishDate)

  const rawOutput = await complete(
    [{ role: 'user', content: prompt }],
    { model: 'openai/gpt-4o', temperature: 0.55, maxTokens: 16384, systemPrompt: AUGMENT_SYSTEM_PROMPT(config), timeoutMs: 180_000 }
  )

  let gutenbergContent = rawOutput.trim().replace(/^```(?:html|json)?\s*/i, '').replace(/\s*```$/i, '').trim()

  // Guard: never let augmentation LOSE the original. If the model returned something shorter than
  // the input (truncation / accidental rewrite-down), fall back to the original content untouched.
  if (!gutenbergContent || gutenbergContent.length < existingContent.length * 0.9) {
    console.warn('[Augment] result smaller than input — keeping original content')
    gutenbergContent = existingContent
  }

  // Same QA chain as a fresh write: deepen if short, proofread, then enforce no fabricated facts.
  gutenbergContent = await expandContent(gutenbergContent, keyword, config.targetWordCount, config.language)
  gutenbergContent = await proofreadContent(gutenbergContent)
  gutenbergContent = await sanitizeFabricatedStats(gutenbergContent, research, config.language)
  // Link guard: links already in the author's original article are theirs, not generated — keep them.
  const originalUrls = [...existingContent.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map((m) => m[1] ?? '')
  const linkGuard = stripUnlistedExternalLinks(gutenbergContent, {
    allowedUrls: allowedArticleUrls(research, config, originalUrls),
    siteUrl: config.siteUrl,
    language: config.language,
  })
  if (linkGuard.removed.length > 0) console.warn('[Augment] removed unverified external links:', linkGuard.removed)
  gutenbergContent = linkGuard.html

  // Metadata for the refreshed article.
  let meta: { title?: string; metaTitle?: string; metaDescription?: string; slug?: string; imageSearchTerms?: string[] } = {}
  try {
    const metaRaw = await complete(
      [
        {
          role: 'user',
          content:
            `Keyword: "${keyword}". Estratto articolo:\n${gutenbergContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1200)}\n\n` +
            `Scrivi title, metaTitle, metaDescription, slug e imageSearchTerms in ${langName(config.language)} (${config.language}), la lingua dell'articolo.\n` +
            `Restituisci SOLO questo JSON: {"title":"titolo SEO con la keyword","metaTitle":"max 60 caratteri","metaDescription":"max 155 caratteri","slug":"slug-con-trattini","imageSearchTerms":["termine 1","termine 2","termine 3"]}`,
        },
      ],
      { model: 'openai/gpt-4o-mini', temperature: 0.3, maxTokens: 400 }
    )
    meta = JSON.parse(metaRaw.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as typeof meta
  } catch (e) {
    console.warn('[Augment] meta generation failed, using fallbacks:', e)
  }

  const { seoScore, geoScore } = scoreArticle(gutenbergContent, keyword, research)
  const slugify = (s: string) =>
    s.toLowerCase().replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i').replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const slug = meta.slug ? slugify(meta.slug) : slugify(keyword)
  const wordCount = gutenbergContent.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
  const authorLine = config.authorLine ?? defaultAuthorLine(config.siteName, config.language, publishDate)

  console.log(`[Augment] Done: ${wordCount} words, SEO ${seoScore}/100, GEO ${geoScore}/100`)

  return {
    title: meta.title ?? `${keyword.charAt(0).toUpperCase() + keyword.slice(1)}`,
    slug,
    metaTitle: meta.metaTitle ?? `${meta.title ?? keyword} | ${config.siteName}`,
    metaDescription: meta.metaDescription ?? defaultMetaDescription(keyword, config.language, true),
    focusKeyword: keyword,
    gutenbergContent,
    wordCount,
    seoScore,
    geoScore,
    language: config.language,
    authorLine,
    imageSearchTerms: meta.imageSearchTerms && meta.imageSearchTerms.length > 0 ? meta.imageSearchTerms : [keyword, `${audit.niche} ${keyword}`],
  }
}

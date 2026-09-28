/**
 * Shared content-language helpers for agent prompts, SERP markets, and UI fallbacks.
 * Supported article/content languages: it, en, de, fr, es, pt.
 */

import type { WorkspaceMarket } from '../types/database';

export type ContentLanguage = 'it' | 'en' | 'de' | 'fr' | 'es' | 'pt'

export const CONTENT_LANGUAGES: readonly ContentLanguage[] = ['it', 'en', 'de', 'fr', 'es', 'pt']

const LANG_NAMES: Record<ContentLanguage, string> = {
  it: 'italiano',
  en: 'inglese',
  de: 'tedesco',
  fr: 'francese',
  es: 'spagnolo',
  pt: 'portoghese',
}

const PROMPT_LANG_NAMES: Record<ContentLanguage, string> = {
  it: 'Italian',
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
}

const LOCALE: Record<ContentLanguage, string> = {
  it: 'it-IT',
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  pt: 'pt-PT',
}

/** Normalize arbitrary locale/code strings to a supported content language (defaults to English). */
export function normalizeContentLanguage(input?: string | null): ContentLanguage {
  const code = (input ?? '').toLowerCase().split('-')[0]
  if (code === 'it' || code === 'en' || code === 'de' || code === 'fr' || code === 'es' || code === 'pt') {
    return code
  }
  return 'en'
}

/** Italian name for prompts (e.g. "tedesco"). */
export function langName(code: string): string {
  return LANG_NAMES[normalizeContentLanguage(code)]
}

/** English name for LLM extraction prompts (e.g. "German"). */
export function promptLangName(code: string): string {
  return PROMPT_LANG_NAMES[normalizeContentLanguage(code)]
}

export function isEnglish(code?: string | null): boolean {
  return normalizeContentLanguage(code) === 'en'
}

/** Map react-i18next locale to the default content language for generated text. */
export function defaultUiContentLanguage(i18nLanguage?: string | null): ContentLanguage {
  return normalizeContentLanguage(i18nLanguage)
}

/** Default SERP/market slug for a content language. */
export function marketForContentLanguage(code: string): WorkspaceMarket {
  switch (normalizeContentLanguage(code)) {
    case 'it':
      return 'IT'
    case 'de':
      return 'DE'
    case 'fr':
      return 'FR'
    case 'es':
      return 'ES'
    case 'pt':
      return 'PT'
    default:
      return 'global'
  }
}

/** Audit/UI copy: Italian for `it`, English for all other supported content languages. */
export function prefersEnglishUi(code?: string | null): boolean {
  return normalizeContentLanguage(code) !== 'it'
}

export function faqSectionTitle(code: string): string {
  const titles: Record<ContentLanguage, string> = {
    it: 'Domande frequenti',
    en: 'Frequently Asked Questions',
    de: 'Häufig gestellte Fragen',
    fr: 'Questions fréquentes',
    es: 'Preguntas frecuentes',
    pt: 'Perguntas frequentes',
  }
  return titles[normalizeContentLanguage(code)]
}

export function sourcesSectionTitle(code: string): string {
  const titles: Record<ContentLanguage, string> = {
    it: 'Fonti',
    en: 'Sources',
    de: 'Quellen',
    fr: 'Sources',
    es: 'Fuentes',
    pt: 'Fontes',
  }
  return titles[normalizeContentLanguage(code)]
}

export function quickAnswerTitle(code: string): string {
  const titles: Record<ContentLanguage, string> = {
    it: 'Risposta rapida',
    en: 'Quick Answer',
    de: 'Kurzantwort',
    fr: 'Réponse rapide',
    es: 'Respuesta rápida',
    pt: 'Resposta rápida',
  }
  return titles[normalizeContentLanguage(code)]
}

export function defaultAuthorLine(siteName: string, code: string, publishDate?: string): string {
  const lang = normalizeContentLanguage(code)
  switch (lang) {
    case 'en':
      return `By the ${siteName} Team${publishDate ? ` | Published: ${publishDate}` : ''}`
    case 'de':
      return `Vom ${siteName}-Team${publishDate ? ` | Veröffentlicht: ${publishDate}` : ''}`
    case 'fr':
      return `Par l'équipe ${siteName}${publishDate ? ` | Publié le : ${publishDate}` : ''}`
    case 'es':
      return `Por el equipo de ${siteName}${publishDate ? ` | Publicado: ${publishDate}` : ''}`
    case 'pt':
      return `Pelo time ${siteName}${publishDate ? ` | Publicado: ${publishDate}` : ''}`
    default:
      return `A cura del team ${siteName}${publishDate ? ` | Pubblicato: ${publishDate}` : ''}`
  }
}

export function formatPublishDate(code: string): string {
  return new Date().toLocaleDateString(LOCALE[normalizeContentLanguage(code)], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function contentLocale(code: string): string {
  return LOCALE[normalizeContentLanguage(code)]
}

export function infographicQuickGuideTitle(keyword: string, code: string): string {
  const lang = normalizeContentLanguage(code)
  switch (lang) {
    case 'de':
      return `Kurzanleitung: ${keyword}`
    case 'fr':
      return `Guide rapide : ${keyword}`
    case 'es':
      return `Guía rápida: ${keyword}`
    case 'pt':
      return `Guia rápido: ${keyword}`
    case 'en':
      return `Quick guide: ${keyword}`
    default:
      return `Guida rapida: ${keyword}`
  }
}

export function infographicKeyPointsSubtitle(code: string): string {
  const subtitles: Record<ContentLanguage, string> = {
    it: 'Punti chiave da ricordare',
    en: 'Key points to remember',
    de: 'Wichtige Punkte',
    fr: 'Points clés à retenir',
    es: 'Puntos clave a recordar',
    pt: 'Pontos-chave a lembrar',
  }
  return subtitles[normalizeContentLanguage(code)]
}

export function verifiedSourcesSectionLabels(code: string): {
  header: string
  intro: string
  checkedOnLabel: string
} {
  const lang = normalizeContentLanguage(code)
  switch (lang) {
    case 'de':
      return {
        header: '## Quellen und Referenzen',
        intro: 'Die Informationen in diesem Artikel wurden anhand folgender Quellen überprüft:',
        checkedOnLabel: 'Letzte Quellenprüfung',
      }
    case 'fr':
      return {
        header: '## Sources et références',
        intro: 'Les informations de cet article ont été vérifiées à l’aide des sources suivantes :',
        checkedOnLabel: 'Dernière vérification des sources',
      }
    case 'es':
      return {
        header: '## Fuentes y referencias',
        intro: 'La información de este artículo se ha verificado utilizando las siguientes fuentes:',
        checkedOnLabel: 'Última revisión de fuentes',
      }
    case 'pt':
      return {
        header: '## Fontes e referências',
        intro: 'As informações deste artigo foram verificadas com as seguintes fontes:',
        checkedOnLabel: 'Última verificação de fontes',
      }
    case 'en':
      return {
        header: '## Sources and References',
        intro: 'The information in this article has been verified using the following sources:',
        checkedOnLabel: 'Last source check',
      }
    default:
      return {
        header: '## Fonti e Riferimenti',
        intro: 'Le informazioni contenute in questo articolo sono state verificate utilizzando le seguenti fonti:',
        checkedOnLabel: 'Ultimo controllo delle fonti',
      }
  }
}

export function defaultMetaDescription(keyword: string, code: string, updated = false): string {
  const year = new Date().getFullYear()
  const lang = normalizeContentLanguage(code)
  switch (lang) {
    case 'en':
      return updated
        ? `The complete guide to ${keyword}. Updated for ${year}.`
        : `The complete guide to ${keyword}. Everything you need to know in ${year}.`
    case 'de':
      return updated
        ? `Der vollständige Leitfaden zu ${keyword}. Aktualisiert für ${year}.`
        : `Der vollständige Leitfaden zu ${keyword}. Alles, was Sie ${year} wissen müssen.`
    case 'fr':
      return updated
        ? `Le guide complet sur ${keyword}. Mis à jour pour ${year}.`
        : `Le guide complet sur ${keyword}. Tout ce qu'il faut savoir en ${year}.`
    case 'es':
      return updated
        ? `La guía completa sobre ${keyword}. Actualizada para ${year}.`
        : `La guía completa sobre ${keyword}. Todo lo que necesitas saber en ${year}.`
    case 'pt':
      return updated
        ? `O guia completo sobre ${keyword}. Atualizado para ${year}.`
        : `O guia completo sobre ${keyword}. Tudo o que precisa saber em ${year}.`
    default:
      return updated
        ? `Guida completa su ${keyword}. Aggiornata al ${year}.`
        : `Guida completa su ${keyword}. Tutto quello che devi sapere nel ${year}.`
  }
}

export function pexelsCaptionLabels(code: string): { by: string; on: string } {
  const lang = normalizeContentLanguage(code)
  if (lang === 'it') return { by: 'Foto di', on: 'su' }
  if (lang === 'de') return { by: 'Foto von', on: 'auf' }
  if (lang === 'fr') return { by: 'Photo par', on: 'sur' }
  if (lang === 'es') return { by: 'Foto de', on: 'en' }
  if (lang === 'pt') return { by: 'Foto de', on: 'no' }
  return { by: 'Photo by', on: 'on' }
}

/**
 * Full language names (English, native and Italian spellings, accents stripped) → ISO 639-1.
 * LLMs asked for "the site language" answer "Italian", "italiano", "English (US)"… and
 * normalizeContentLanguage() alone would turn every one of those into 'en'.
 */
const LANGUAGE_NAME_TO_CODE: Record<string, string> = {
  english: 'en', inglese: 'en', englisch: 'en', anglais: 'en', ingles: 'en',
  italian: 'it', italiano: 'it', italienisch: 'it', italien: 'it',
  german: 'de', deutsch: 'de', tedesco: 'de', allemand: 'de', aleman: 'de',
  french: 'fr', francais: 'fr', francese: 'fr', franzosisch: 'fr', frances: 'fr',
  spanish: 'es', espanol: 'es', spagnolo: 'es', espagnol: 'es', spanisch: 'es', castellano: 'es',
  portuguese: 'pt', portugues: 'pt', portoghese: 'pt', portugais: 'pt', portugiesisch: 'pt',
  dutch: 'nl', nederlands: 'nl', olandese: 'nl',
}

/**
 * Parse an ISO code, a locale ("it-IT", "en_US") or a language name ("Italian", "italiano")
 * into a lowercase ISO 639-1 code. Returns null when the input is empty or unrecognisable, so
 * callers can fall through to the next source instead of silently defaulting.
 */
export function languageCodeFromInput(input?: string | null): string | null {
  const raw = (input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
  if (!raw) return null
  const locale = raw.match(/^([a-z]{2})(?:[-_][a-z0-9]{2,4})?$/)
  if (locale) return locale[1] ?? null
  const byName = LANGUAGE_NAME_TO_CODE[raw] ?? LANGUAGE_NAME_TO_CODE[raw.split(/[^a-z]+/)[0] ?? '']
  return byName ?? null
}

/**
 * First recognisable language among `candidates` (in priority order), normalized to a supported
 * content language; English when none is usable. A recognised but unsupported code (e.g. 'nl')
 * still wins its slot and becomes English — the site's own signal beats a stale default.
 */
export function resolveContentLanguage(candidates: ReadonlyArray<string | null | undefined>): ContentLanguage {
  for (const c of candidates) {
    const code = languageCodeFromInput(c)
    if (code) return normalizeContentLanguage(code)
  }
  return 'en'
}

/** Labels of the proprietary-framework block (IT, else English). */
export function frameworkBlockLabels(code: string): { kicker: string; howToUse: string } {
  return normalizeContentLanguage(code) === 'it'
    ? { kicker: 'Framework esclusivo', howToUse: 'Come usarlo:' }
    : { kicker: 'Exclusive framework', howToUse: 'How to use it:' }
}

/** WordPress category the autopilot files its articles under (IT, else English). */
export function defaultBlogCategoryName(code: string): string {
  return normalizeContentLanguage(code) === 'it' ? 'Guide e Articoli' : 'Guides and Articles'
}

/** Working title of a content-plan item (IT, else English). */
export function completeGuideTitle(keyword: string, code: string, year = new Date().getFullYear()): string {
  const kw = keyword.charAt(0).toUpperCase() + keyword.slice(1)
  return normalizeContentLanguage(code) === 'it' ? `${kw}: Guida Completa ${year}` : `${kw}: The Complete Guide ${year}`
}

/**
 * Turn an article byline into the schema.org author. Strips the byline prefixes produced by
 * defaultAuthorLine() in every language ("A cura del team X", "By the X Team", "Vom X-Team"…)
 * and the "| Published: …" suffix. A team byline is an Organization, never a Person; an empty
 * byline falls back to the site as Organization.
 */
export function authorFromByline(
  byline: string | null | undefined,
  siteName: string,
): { name: string; type: 'Person' | 'Organization' } {
  const line = (byline ?? '').replace(/\s*\|.*$/, '').trim()
  const teamPatterns: RegExp[] = [
    /^A cura del(?:la|lo)? (?:team|redazione)(?: di)?\s+(.+)$/i,
    /^By (?:the )?(.+?)\s+(?:team|editorial team|editors|staff)$/i,
    /^Vom\s+(.+?)-?Team$/i,
    /^Par l['’]équipe(?: de)?\s+(.+)$/i,
    /^Por el equipo(?: de)?\s+(.+)$/i,
    /^Pel[oa] (?:time|equipa|equipe)(?: d[aeo])?\s+(.+)$/i,
  ]
  for (const re of teamPatterns) {
    const m = line.match(re)
    if (m) return { name: (m[1] ?? '').trim() || siteName, type: 'Organization' }
  }
  const name = line
    .replace(/^A cura (?:di|del|della|dello|dei|degli)\s+/i, '')
    .replace(/^(?:Written )?By\s+/i, '')
    .trim()
  if (!name) return { name: siteName, type: 'Organization' }
  if (/(?:^|[\s-])(?:team|redazione|staff|editorial|équipe|equipo)(?=$|\s)/i.test(name) || name.toLowerCase() === siteName.toLowerCase()) {
    return { name, type: 'Organization' }
  }
  return { name, type: 'Person' }
}

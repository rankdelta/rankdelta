/**
 * Content-integrity rule shared by every article generator (founder decision):
 * generated content must NEVER fabricate facts. Where real data, experience or a source would
 * strengthen the article, the model (or the fact-check pass) leaves a visible placeholder in the
 * article's language for the author to fill. Same rule as the AI Content Enhancer
 * (ENHANCER_SYSTEM_PROMPT in src/components/content/AIContentEnhancer.tsx).
 */

import { normalizeContentLanguage, promptLangName, type ContentLanguage } from './contentLanguages'

const SOURCE_NEEDED: Record<ContentLanguage, string> = {
  en: 'Source needed',
  it: 'Fonte necessaria',
  de: 'Quelle erforderlich',
  fr: 'Source nécessaire',
  es: 'Fuente necesaria',
  pt: 'Fonte necessária',
}

const ADD_NOTE: Record<ContentLanguage, string> = {
  en: 'ADD',
  it: 'AGGIUNGI',
  de: 'ERGÄNZEN',
  fr: 'AJOUTER',
  es: 'AÑADIR',
  pt: 'ADICIONAR',
}

/** "Source needed" label in the article's language. */
export function sourceNeededLabel(code: string): string {
  return SOURCE_NEEDED[normalizeContentLanguage(code)]
}

/** "ADD" label (author's own data/experience/example) in the article's language. */
export function addNoteLabel(code: string): string {
  return ADD_NOTE[normalizeContentLanguage(code)]
}

/** Visible placeholder for an unsourced claim, e.g. "[Source needed: 73.2% of users]". */
export function sourceNeededPlaceholder(code: string, what?: string): string {
  const detail = what?.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim()
  return detail ? `[${sourceNeededLabel(code)}: ${detail}]` : `[${sourceNeededLabel(code)}]`
}

/**
 * Prompt block with the no-fabrication rule, in English (prompt language), telling the model to
 * write placeholders in the article's language.
 */
export function noFabricationRules(code: string): string {
  const lang = promptLangName(code)
  return `NO-FABRICATION RULE (non-negotiable):
- NEVER invent facts: no made-up statistics, percentages or figures, surveys, studies, test results, case studies, customer stories, expert quotes or named experts, "according to X" attributions, sources or URLs, author credentials, or first-person experience.
- Only attribute a statement to a source that is explicitly provided to you in this prompt, and only cite what that source says. Never cite anything from memory.
- General, well-established knowledge may be stated plainly, without numbers or attributions.
- Where real data, a source, first-hand experience or a real example would strengthen the article, insert a visible placeholder in square brackets, written in ${lang}, for the author to fill: "[${sourceNeededLabel(code)}: …]" for a missing source or figure, "[${addNoteLabel(code)}: …]" for the author's own data, experience or example.`
}

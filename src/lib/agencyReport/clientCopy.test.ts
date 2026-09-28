/**
 * Copy that reaches the client (share link, PDF, deck): the empty-state notes, the briefing and the
 * AI visibility hero. It states facts about the business; instructions for the report owner
 * ("connect Search Console", "run a new audit, then rebuild the report") belong to the builder.
 */
import { describe, it, expect } from 'vitest'
import en from '../../assets/locales/en/translations.json'
import itLocale from '../../assets/locales/it/translations.json'

type Tree = { [key: string]: string | Tree }

function strings(tree: Tree, prefix: string): Array<[string, string]> {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}.${k}`, v] as [string, string]] : strings(v, `${prefix}.${k}`)))
}

// "Rebuild internal links" is SEO advice; "rebuild the report" is an instruction to the owner.
const OWNER_TALK = /\b(connect|connected|reconnect|rebuild (the|this) report|run a new|scan ran|collegat[oaie]|rigenera (il|questo) report|esegui un nuovo|GA4 where)\b/i

describe.each([
  ['en', en],
  ['it', itLocale],
] as const)('client-facing report copy (%s)', (_lang, locale) => {
  const report = (locale as unknown as { agencyReport: Tree }).agencyReport
  const clientFacing = [
    ...strings(report['emptyState'] as Tree, 'emptyState'),
    ...strings(report['briefing'] as Tree, 'briefing'),
    ...strings(report['hero'] as Tree, 'hero'),
  ]

  it('never tells the client to connect, run or rebuild anything', () => {
    expect(clientFacing.length).toBeGreaterThan(20)
    expect(clientFacing.filter(([, text]) => OWNER_TALK.test(text))).toEqual([])
  })

  it('calls competitor mentions mentions, not citations', () => {
    const text = (report['briefing'] as { items: Record<string, string> }).items['promptsMissingCompetitor']
    expect(text).not.toMatch(/cited|citato/)
  })
})

import { describe, expect, it } from 'vitest'
import { sharedReportIdentity, sharedReportLocale, sharedReportTitle } from './SharedReportPage'
import type { ClientReportSnapshot } from '../lib/agencyReport/types'

function snapshot(partial: Record<string, unknown>): ClientReportSnapshot {
  return {
    id: 'r1',
    project_id: 'p1',
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    sections: [],
    data: {},
    branding: null,
    ...partial,
  } as unknown as ClientReportSnapshot
}

describe('shared report chrome helpers', () => {
  it('prefers the identity stored in the snapshot, then the row columns', () => {
    expect(
      sharedReportIdentity(
        snapshot({ data: { meta: { projectName: 'Bravalo', websiteUrl: 'https://bravalo.it' } }, project_name: 'Row' }),
      ),
    ).toEqual({ clientName: 'Bravalo', websiteUrl: 'https://bravalo.it' })
    expect(sharedReportIdentity(snapshot({ project_name: ' Row ', website_url: 'https://row.it' }))).toEqual({
      clientName: 'Row',
      websiteUrl: 'https://row.it',
    })
    expect(sharedReportIdentity(snapshot({}))).toEqual({ clientName: null, websiteUrl: null })
  })

  it('maps the report locale to it/en', () => {
    expect(sharedReportLocale(snapshot({ data: { meta: { locale: 'it' } } }))).toBe('it')
    expect(sharedReportLocale(snapshot({ data: { meta: { locale: 'en-GB' } } }))).toBe('en')
    expect(sharedReportLocale(snapshot({}))).toBeNull()
  })

  it('builds the tab title without app branding', () => {
    expect(sharedReportTitle('Bravalo', '1 ago – 31 ago 2026')).toBe('Bravalo · Report 1 ago – 31 ago 2026')
    expect(sharedReportTitle(null, '1 ago – 31 ago 2026')).toBe('Report 1 ago – 31 ago 2026')
  })
})

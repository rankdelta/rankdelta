import { describe, it, expect } from 'vitest'
import { buildActionPlan } from './guidedAudit'
import type { SiteAuditResult } from '../siteAudit'
import type { StaleCandidate } from './standaloneContent'

// Minimal fixtures — only the fields buildActionPlan actually reads. The `geo_no_schema` issue
// is short-circuited in step 4, so no other issue fields are touched.
const audit = {
  siteUrl: 'https://example.com',
  issues: [{ code: 'geo_no_schema', count: 5 }],
} as unknown as SiteAuditResult

const stale = [
  { url: 'https://example.com/partner', title: 'Partner', geoScore: 0, missing: ['FAQ'] },
] as unknown as StaleCandidate[]

describe('buildActionPlan — label locale follows uiLanguage, not content language', () => {
  it('renders English labels when the UI is English (even for Italian-content sites)', () => {
    const plan = buildActionPlan(audit, stale, 'en')
    const schema = plan.find((a) => a.id === 'add_schema_sitewide')
    expect(schema?.title).toContain('Add structured data')
    const refresh = plan.find((a) => a.id.startsWith('refresh:'))
    expect(refresh?.title).toContain('Update')
  })

  it('renders Italian labels when the UI is Italian', () => {
    const plan = buildActionPlan(audit, stale, 'it')
    const schema = plan.find((a) => a.id === 'add_schema_sitewide')
    expect(schema?.title).toContain('Aggiungi i dati strutturati')
    const refresh = plan.find((a) => a.id.startsWith('refresh:'))
    expect(refresh?.title).toContain('Aggiorna')
  })
})

import { describe, it, expect } from 'vitest'
import { withCleanNarrative, withSectionSummary } from './snapshot'
import { hasBaseline } from './reportUi'
import type { MetricWithDelta } from '../reportBuild/math'

// The shape of the reports built on 14–15/09/26: summary deltas stored as 0 on a first reading.
const oldSnapshot = {
  id: 'r1',
  data: {
    summary: {
      aiSov: { value: 14.3, delta: 0, deltaPct: 0 },
      avgPosition: { value: 18.5, delta: 0, deltaPct: 0 },
      healthScore: { value: 51, delta: 51, deltaPct: 100 },
    },
    geo: { sovOverall: { value: 14.3, delta: 14.3, deltaPct: 100 } },
    rankings: { avgPosition: { value: 18.5, delta: 18.5, deltaPct: 100 } },
  },
}

describe('withSectionSummary', () => {
  it('reads an old first-reading snapshot as a first reading (no "±0.0" in the scorecard)', () => {
    const summary = (withSectionSummary(oldSnapshot).data as { summary: Record<string, MetricWithDelta> }).summary
    expect(summary['aiSov']).toEqual({ value: 14.3, delta: 14.3, deltaPct: 100 })
    expect(summary['avgPosition']).toEqual({ value: 18.5, delta: 18.5, deltaPct: 100 })
    expect(hasBaseline(summary['aiSov'])).toBe(false)
    expect(hasBaseline(summary['avgPosition'])).toBe(false)
    expect(summary['healthScore']).toEqual({ value: 51, delta: 51, deltaPct: 100 })
  })

  it('keeps a real movement, and leaves reports without the sections untouched', () => {
    const moved = { data: { summary: { aiSov: { value: 30, delta: 5, deltaPct: 20 } }, geo: { sovOverall: { value: 30, delta: 5, deltaPct: 20 } } } }
    expect(withSectionSummary(moved)).toEqual(moved)
    const noSections = { data: { summary: { aiSov: { value: 30, delta: 0, deltaPct: 0 } } } }
    expect(withSectionSummary(noSections)).toBe(noSections)
    const disconnected = { data: { summary: { aiSov: { value: null, delta: null, deltaPct: null } }, geo: { data: null, status: 'not_connected' } } }
    expect(withSectionSummary(disconnected)).toBe(disconnected)
    expect(withSectionSummary({ data: null })).toEqual({ data: null })
  })
})

// Shapes of shared reports built before the build-side fixes (28/09 sweep); names are fictional.
describe('withCleanNarrative', () => {
  it('recovers a summary stored as the raw fenced JSON completion', () => {
    const raw = '```json { "executiveSummary": "Lo score di salute del sito è 72. Tutte le integrazioni dati risultano non connesse.", "sections": { "site_health": "L\'audit rileva 5 issue.", "backlinks": "Il dato sui link persi non è disponibile (null)." }, "nextActions": ["Correggere il title mancante", "Attivare l\'integrazione con Google Search Console per abilitare il monitoraggio"] } ```'
    const out = withCleanNarrative({ id: 'r', narrative: { executiveSummary: raw, sections: {}, nextActions: [] } })
    expect(out.narrative).toEqual({
      executiveSummary: 'Lo score di salute del sito è 72.',
      sections: { site_health: "L'audit rileva 5 issue." },
      nextActions: ['Correggere il title mancante'],
    })
  })

  it('drops sentences about the reporting tool from an old narrative, keeps the rest', () => {
    const out = withCleanNarrative({
      narrative: {
        executiveSummary: 'Share of voice reached 30.8%. ChatGPT mentions you most.',
        sections: { geo: 'ChatGPT leads.' },
        nextActions: [
          'Add JSON-LD schema to the 3 pages missing structured data.',
          "Request Google AI Overviews-specific tracking be added to next month's monitoring, as this engine shows null data.",
        ],
      },
    })
    expect((out.narrative as { nextActions: string[] }).nextActions).toEqual(['Add JSON-LD schema to the 3 pages missing structured data.'])
    expect((out.narrative as { executiveSummary: string }).executiveSummary).toBe('Share of voice reached 30.8%. ChatGPT mentions you most.')
  })

  it('leaves reports without a narrative alone', () => {
    const report = { id: 'r', narrative: null }
    expect(withCleanNarrative(report)).toBe(report)
  })
})

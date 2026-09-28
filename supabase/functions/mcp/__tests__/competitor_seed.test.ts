/**
 * Competitor seeding for setup_ai_visibility (deno). One scan of a travel site used to add 76
 * "competitors": every cited source domain (g2.com, it.trustpilot.com as "It", msn.com…).
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { pickCompetitorCandidates, type MentionRow } from '../competitor_seed.ts'

const m = (brand: string, run: string, extra: Partial<MentionRow> = {}): MentionRow => ({
  brand_name: brand,
  query_run_id: run,
  tracked_brand_id: null,
  competitor_brand_id: null,
  ...extra,
})

Deno.test('keeps brands named in two or more answers, most frequent first', () => {
  const picked = pickCompetitorCandidates(
    [m('Hotel A', 'r1'), m('Hotel A', 'r2'), m('Hotel A', 'r3'), m('Tour B', 'r1'), m('Tour B', 'r2'), m('Once', 'r4')],
    new Set(),
  )
  assertEquals(picked, ['Hotel A', 'Tour B'])
})

Deno.test('counts answers, not repeats inside one answer', () => {
  assertEquals(pickCompetitorCandidates([m('Echo', 'r1'), m('Echo', 'r1'), m('Echo', 'r1')], new Set()), [])
})

Deno.test('skips the own brand, known competitors and names already tracked', () => {
  const picked = pickCompetitorCandidates(
    [
      m('Own', 'r1', { tracked_brand_id: 't' }), m('Own', 'r2', { tracked_brand_id: 't' }),
      m('Known', 'r1', { competitor_brand_id: 'c' }), m('Known', 'r2', { competitor_brand_id: 'c' }),
      m('Existing', 'r1'), m('existing', 'r2'),
      m('New', 'r1'), m('New', 'r2'),
    ],
    new Set(['existing']),
  )
  assertEquals(picked, ['New'])
})

Deno.test('caps the list', () => {
  const rows = Array.from({ length: 12 }, (_, i) => [m(`Brand ${i}`, 'r1'), m(`Brand ${i}`, 'r2')]).flat()
  assertEquals(pickCompetitorCandidates(rows, new Set(), { max: 8 }).length, 8)
})

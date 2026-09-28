/**
 * The AI narrative is written for the client (deno). The Rankdelta.ai report of 23/09 told the
 * client to "Request Google AI Overviews-specific tracking be added to next month's monitoring,
 * as this engine shows null data" and quoted "16 tracked AI engine runs".
 *
 * Run: deno test supabase/functions/_shared/__tests__/reportNarrativeQuality.test.ts
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { buildNarrativePrompt, isToolTalk, removeToolTalk } from '../reportBuild.ts'
import { trimReportDataForNarrative } from '../reportNarrativePayload.ts'

Deno.test('advice about the reporting tool is removed from next actions (the real case)', () => {
  const { narrative, removed } = removeToolTalk({
    executiveSummary: 'You appear in 2 of 6 discovery questions. The priority is schema on comparison pages.',
    nextActions: [
      'Add JSON-LD schema to the 3 pages flagged as missing structured data.',
      "Request Google AI Overviews-specific tracking be added to next month's monitoring, as this engine shows null data despite being your largest potential traffic source.",
      'Publish a page that answers "alternatives to Rankability for AI SEO software" directly.',
    ],
  })
  assertEquals(removed, 1)
  assertEquals((narrative.nextActions as string[]).length, 2)
  assert(!(narrative.nextActions as string[]).some((a) => /tracking|monitoring/i.test(a)))
})

Deno.test('sentences about missing or disconnected data leave the summary and sections', () => {
  const { narrative } = removeToolTalk({
    executiveSummary:
      'Share of voice rose to 35.7%. Google AI Overviews has no data for this period. Clicks from Google grew by 120.',
    sections: {
      gsc: 'Search Console is not connected yet, so clicks are unavailable. Impressions grew on the itinerary pages.',
      geo: 'ChatGPT names you in 3 answers.',
    },
  })
  assertEquals(narrative.executiveSummary, 'Share of voice rose to 35.7%. Clicks from Google grew by 120.')
  assertEquals((narrative.sections as Record<string, string>).gsc, 'Impressions grew on the itinerary pages.')
  assertEquals((narrative.sections as Record<string, string>).geo, 'ChatGPT names you in 3 answers.')
})

Deno.test('Italian tool-talk is caught too', () => {
  assert(isToolTalk('Aggiungere il tracciamento di AI Overviews al monitoraggio del mese prossimo.'))
  assert(isToolTalk('Search Console non è ancora collegato.'))
  assert(isToolTalk('Collega Google Analytics per vedere le sessioni.'))
})

Deno.test('real SEO work is never mistaken for tool-talk', () => {
  for (const ok of [
    'Add FAQ structured data to the Val di Noto itinerary page.',
    'Publish a comparison page for "best boutique hotels in Noto".',
    'Earn a mention on tripadvisor.it, the source AI answers cite most.',
    'Fix the 5 pages with thin content that AI engines skip.',
    'Rafforza i link interni verso la pagina degli eventi a Noto.',
    'Your rankings improved on 12 keywords tracked this month.',
  ]) {
    assertEquals(isToolTalk(ok), false, ok)
  }
})

Deno.test('the summary is never blanked, even if every sentence matched', () => {
  const { narrative } = removeToolTalk({ executiveSummary: 'Search Console is not connected.' })
  assertEquals(narrative.executiveSummary, 'Search Console is not connected.')
})

Deno.test('the model never sees run counters or engines without a value, and sees brand prompts', () => {
  const trimmed = trimReportDataForNarrative({
    geo: {
      sovOverall: { value: 35.7, delta: null, deltaPct: null },
      sovByEngine: [
        { engine: 'chatgpt', sovPercent: 36.4 },
        { engine: 'google_aio', sovPercent: null },
      ],
      runCounts: { current: 16, previous: 0 },
      sovScope: 'discovery',
      brandedPrompts: [{ text: 'Acme vs Rival', mentioned: true }],
      topPromptsMentioned: [],
      topPromptsNotMentioned: [],
      topCitedSources: [],
    },
  })
  const geo = trimmed.geo as Record<string, unknown>
  assertEquals('runCounts' in geo, false)
  assertEquals(geo.sovByEngine, [{ engine: 'chatgpt', sovPercent: 36.4 }])
  assertEquals(geo.sovScope, 'discovery')
  assertEquals(geo.brandedPrompts, [{ text: 'Acme vs Rival', mentioned: true }])
})

Deno.test('the prompt tells the model who reads it and how AI visibility is measured', () => {
  const { system } = buildNarrativePrompt({}, 'en')
  assert(system.includes('this text goes to the client'))
  assert(system.includes('Never recommend adding, requesting or configuring tracking'))
  assert(system.includes('never present a mention there as a win'))
  assert(system.includes('never about the report or how it is measured'))
})

Deno.test('headline metrics without a value never reach the model', () => {
  const trimmed = trimReportDataForNarrative({
    summary: {
      healthScore: { value: 84, delta: null, deltaPct: null },
      aiSov: { value: 30.8, delta: null, deltaPct: null },
      gscClicks: { value: null, delta: null, deltaPct: null },
      ga4Sessions: { value: null, delta: null, deltaPct: null },
    },
  })
  assertEquals(Object.keys(trimmed.summary as Record<string, unknown>), ['healthScore', 'aiSov'])
  const empty = trimReportDataForNarrative({ summary: { gscClicks: { value: null, delta: null, deltaPct: null } } })
  assertEquals('summary' in empty, false)
})

Deno.test('the prompt forbids traffic claims without traffic data and causes stated as proven', () => {
  const { system } = buildNarrativePrompt({}, 'en')
  assert(system.includes('never call a page high-traffic, top-performing or ranking'))
  assert(system.includes('Present a cause as the likely reason, never as proven'))
  assert(system.includes('A count you state must match the items you name'))
})

Deno.test('the prompt dates a health score from an audit older than the period', () => {
  const { system } = buildNarrativePrompt({}, 'en')
  assert(system.includes('when that date is before meta.periodStart, refer to them as the last audit'))
})

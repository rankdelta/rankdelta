/**
 * Share of Voice on discovery prompts, branded prompts listed apart, one count per mention (deno).
 *
 * The case that shipped wrong: a report said "mentioned in 2 of 6 prompts" and 30.8% SoV, but
 * both wins were "Rankdelta.ai vs Rival" prompts, which name the brand, and the mart behind SoV
 * counted each Perplexity mention once per cited source (10x).
 *
 * Run: deno test supabase/functions/_shared/__tests__/reportBrandedPrompts.test.ts
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { assembleReportData } from '../reportAssemble.ts'
import {
  brandTermsFrom,
  brandedPromptResults,
  groupVisibilityRunsByQuery,
  isBrandedPrompt,
  mentionCounts,
  splitBrandedPrompts,
  type VisibilityRunRow,
} from '../reportVisibility.ts'

const ACME = [{ name: 'Acme', domain: 'https://www.acme-widgets.example', aliases: ['Acme Co'] }]

function run(id: string, queryId: string, text: string, provider: string, day: string, opts: {
  yours?: number
  rival?: number
  citations?: number
} = {}): VisibilityRunRow {
  const mentions = [
    ...Array.from({ length: opts.yours ?? 0 }, () => ({ tracked_brand_id: 'b1', competitor_brand_id: null })),
    ...Array.from({ length: opts.rival ?? 0 }, () => ({ tracked_brand_id: null, competitor_brand_id: 'c1' })),
  ]
  return {
    id,
    run_at: `${day}T10:00:00Z`,
    status: 'completed',
    provider,
    visibility_brand_mentions: mentions,
    visibility_citations: Array.from({ length: opts.citations ?? 0 }, (_, i) => ({ source_domain: `src${i}.example` })),
    visibility_queries: { id: queryId, text, is_active: true },
  }
}

Deno.test('brand terms: name, aliases, domain and its label; whole words only', () => {
  const terms = brandTermsFrom(ACME)
  assert(terms.includes('acme'))
  assert(terms.includes('acme co'))
  assert(terms.includes('acme widgets example'))
  assert(terms.includes('acme widgets'))
  assert(isBrandedPrompt('Acme vs Rival: which is better?', terms))
  assert(isBrandedPrompt('is acme-widgets.example legit', terms))
  assertEquals(isBrandedPrompt('best acmeology tools', terms), false)
  assertEquals(isBrandedPrompt('best widget shops', terms), false)
  // Accents and case are ignored.
  assert(isBrandedPrompt('ÀCME o Rival?', brandTermsFrom([{ name: 'Acme' }])))
})

Deno.test('a mention counts once, however many sources the answer cites', () => {
  const counts = mentionCounts([run('r1', 'q1', 'best widgets', 'perplexity', '2026-02-10', { yours: 1, rival: 1, citations: 17 })])
  assertEquals(counts, { yours: 1, competitors: 1 })
})

Deno.test('branded prompts are split out and report whether the brand came up', () => {
  const grouped = groupVisibilityRunsByQuery([
    run('r1', 'q1', 'Acme vs Rival', 'chatgpt', '2026-02-10', { yours: 1 }),
    run('r2', 'q2', 'best widgets', 'chatgpt', '2026-02-10', { rival: 1 }),
  ])
  const { discovery, branded } = splitBrandedPrompts(grouped, brandTermsFrom(ACME))
  assertEquals([...discovery.values()].map((p) => p.text), ['best widgets'])
  assertEquals(brandedPromptResults(branded), [{ text: 'Acme vs Rival', mentioned: true }])
})

function adminWith(runs: VisibilityRunRow[], geoMart: unknown[] = []) {
  const tables: Record<string, unknown> = {
    report_geo_daily_mart: geoMart,
    report_ranking_daily_mart: [],
    competitor_brands: [{ id: 'c1', name: 'Rival', domain: 'rival.example' }],
    tracked_brands: ACME,
    visibility_query_runs: runs,
    backlink_referring_domains: [],
  }
  const chainFor = (table: string) => {
    const entry = tables[table]
    const result = Promise.resolve({ data: entry === undefined ? null : entry, error: null })
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'range']) chain[m] = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
    chain.single = chain.maybeSingle
    chain.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => result.then(f, r)
    return chain
  }
  return { from: chainFor }
}

const INPUT = { projectId: 'p1', periodStart: '2026-02-01', periodEnd: '2026-02-28', websiteUrl: 'https://acme-widgets.example', locale: 'en' }

type Geo = {
  sovOverall: { value: number | null }
  sovByEngine: Array<{ engine: string; sovPercent: number | null }>
  topPromptsMentioned: string[]
  topPromptsNotMentioned: string[]
  brandedPrompts: Array<{ text: string; mentioned: boolean }>
  promptCounts: { discovery: number; branded: number }
  sovScope: string
  competitorLeaderboard: Array<{ name: string; mentions: number }>
}

Deno.test('report SoV, wins and competitors come from discovery prompts only', async () => {
  const admin = adminWith([
    // Branded: Acme is named by construction; it must not count as a win or in SoV.
    run('r1', 'q1', 'Acme vs Rival', 'perplexity', '2026-02-10', { yours: 1, rival: 1, citations: 17 }),
    run('r2', 'q2', 'best widgets', 'chatgpt', '2026-02-11', { rival: 1 }),
    run('r3', 'q3', 'top widget shops', 'perplexity', '2026-02-12', { yours: 1, rival: 1, citations: 12 }),
  ])
  const geo = (await assembleReportData(admin as never, INPUT)).data['geo'] as Geo
  assertEquals(geo.sovScope, 'discovery')
  assertEquals(Math.round(geo.sovOverall.value ?? -1), 33) // 1 of 3 mentions, not 2 of 5 (or 12x more on Perplexity)
  assertEquals(geo.topPromptsMentioned, ['top widget shops'])
  assertEquals(geo.topPromptsNotMentioned, ['best widgets'])
  assertEquals(geo.brandedPrompts, [{ text: 'Acme vs Rival', mentioned: true }])
  assertEquals(geo.promptCounts, { discovery: 2, branded: 1 })
  assertEquals(geo.competitorLeaderboard[0], { id: 'c1', name: 'Rival', mentions: 2 } as never)
  const perplexity = geo.sovByEngine.find((e) => e.engine === 'perplexity')
  assertEquals(perplexity?.sovPercent, 50)
})

Deno.test('with only branded prompts the report measures all of them and says so', async () => {
  const admin = adminWith([run('r1', 'q1', 'Acme vs Rival', 'chatgpt', '2026-02-10', { yours: 1, rival: 1 })])
  const geo = (await assembleReportData(admin as never, INPUT)).data['geo'] as Geo
  assertEquals(geo.sovScope, 'all')
  assertEquals(geo.sovOverall.value, 50)
  assertEquals(geo.topPromptsMentioned, ['Acme vs Rival'])
  assertEquals(geo.brandedPrompts, [])
})

Deno.test('no readable answers: falls back to the nightly mart', async () => {
  const admin = adminWith([], [
    { day: '2026-02-10', provider: 'chatgpt', your_mentions: 1, competitor_mentions: 3, citations: 0, run_count: 2 },
  ])
  const geo = (await assembleReportData(admin as never, INPUT)).data['geo'] as Geo
  assertEquals(geo.sovOverall.value, 25)
  assertEquals(geo.sovScope, 'all')
})

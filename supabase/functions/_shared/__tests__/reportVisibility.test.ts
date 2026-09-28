/**
 * reportVisibility pure helpers (deno).
 *
 * Run: deno test supabase/functions/_shared/__tests__/reportVisibility.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  classifyVisibilityPrompts,
  competitorMentionCounts,
  groupVisibilityRunsByQuery,
  ownCitationCounts,
  ownCitationRate,
  siteHost,
  runMentionsBrand,
  runsInPeriod,
  sentimentCounts,
  topCitedSourceDomains,
  type VisibilityRunRow,
} from '../reportVisibility.ts'

const q = (id: string, text: string) => ({ id, text, is_active: true })
const own = (sentiment = 'neutral') => ({ tracked_brand_id: 'tb1', competitor_brand_id: null, brand_name: 'Acme', sentiment })
const rival = (id: string, name = 'Rival') => ({ tracked_brand_id: null, competitor_brand_id: id, brand_name: name, sentiment: 'neutral' })

Deno.test('groupVisibilityRunsByQuery groups runs by query', () => {
  const grouped = groupVisibilityRunsByQuery([
    {
      id: 'r1',
      run_at: '2026-02-10T00:00:00Z',
      status: 'completed',
      visibility_queries: q('q1', 'best widgets'),
    },
    {
      id: 'r2',
      run_at: '2026-02-11T00:00:00Z',
      status: 'completed',
      visibility_queries: q('q1', 'best widgets'),
    },
  ])
  assertEquals(grouped.get('q1')?.runs.length, 2)
})

Deno.test('topCitedSourceDomains counts only in-period runs', () => {
  const domains = topCitedSourceDomains(
    [
      {
        id: 'r1',
        run_at: '2026-02-10T00:00:00Z',
        status: 'completed',
        visibility_citations: [{ source_domain: 'example.com' }],
        visibility_queries: q('q1', 'a'),
      },
      {
        id: 'r2',
        run_at: '2026-01-01T00:00:00Z',
        status: 'completed',
        visibility_citations: [{ source_domain: 'old.com' }],
        visibility_queries: q('q1', 'a'),
      },
    ],
    '2026-02-01',
    '2026-02-28',
  )
  assertEquals(domains, [{ domain: 'example.com', count: 1 }])
})

Deno.test('classifyVisibilityPrompts counts a prompt as won when any completed answer names the brand', () => {
  const grouped = groupVisibilityRunsByQuery([
    {
      id: 'r1',
      run_at: '2026-01-01T00:00:00Z',
      status: 'completed',
      mentioned_brands: [],
      visibility_queries: q('q1', 'best widgets'),
    },
    {
      id: 'r2',
      run_at: '2026-02-15T00:00:00Z',
      status: 'completed',
      mentioned_brands: ['Acme'],
      visibility_queries: q('q1', 'best widgets'),
    },
  ])
  const { mentioned, notMentioned } = classifyVisibilityPrompts(grouped)
  assertEquals(mentioned, ['best widgets'])
  assertEquals(notMentioned, [])
})

Deno.test('classifyVisibilityPrompts reads visibility_brand_mentions (mentioned_brands may be NULL)', () => {
  const grouped = groupVisibilityRunsByQuery([
    // own brand named by ChatGPT, not by Perplexity → won (share 0.5)
    { id: 'r1', run_at: '2026-02-10T00:00:00Z', status: 'completed', mentioned_brands: null, visibility_brand_mentions: [own()], visibility_queries: q('q1', 'best widgets') },
    { id: 'r2', run_at: '2026-02-10T01:00:00Z', status: 'completed', mentioned_brands: null, visibility_brand_mentions: [rival('c1')], visibility_queries: q('q1', 'best widgets') },
    // only a competitor named → missing
    { id: 'r3', run_at: '2026-02-10T00:00:00Z', status: 'completed', mentioned_brands: null, visibility_brand_mentions: [rival('c1')], visibility_queries: q('q2', 'widget pricing') },
    { id: 'r4', run_at: '2026-02-11T00:00:00Z', status: 'completed', mentioned_brands: null, visibility_brand_mentions: [], visibility_queries: q('q2', 'widget pricing') },
    // named in every answer → won, ranked first (share 1)
    { id: 'r5', run_at: '2026-02-10T00:00:00Z', status: 'completed', mentioned_brands: null, visibility_brand_mentions: [own('positive')], visibility_queries: q('q3', 'acme reviews') },
    // no completed run → left out entirely
    { id: 'r6', run_at: '2026-02-10T00:00:00Z', status: 'failed', mentioned_brands: null, visibility_brand_mentions: [], visibility_queries: q('q4', 'never answered') },
  ])
  const { mentioned, notMentioned } = classifyVisibilityPrompts(grouped)
  assertEquals(mentioned, ['acme reviews', 'best widgets'])
  assertEquals(notMentioned, ['widget pricing'])
})

Deno.test('runMentionsBrand ignores competitor-only answers and falls back to the legacy column', () => {
  const base = { id: 'r', run_at: '2026-02-10T00:00:00Z', status: 'completed', visibility_queries: q('q1', 'a') }
  assertEquals(runMentionsBrand({ ...base, visibility_brand_mentions: [rival('c1')] }), false)
  assertEquals(runMentionsBrand({ ...base, visibility_brand_mentions: [rival('c1'), own()] }), true)
  assertEquals(runMentionsBrand({ ...base, mentioned_brands: ['Acme'] }), true)
  assertEquals(runMentionsBrand({ ...base, mentioned_brands: null }), false)
})

Deno.test('competitorMentionCounts and sentimentCounts only use completed answers', () => {
  const rows = [
    { id: 'r1', run_at: '2026-02-10T00:00:00Z', status: 'completed', visibility_brand_mentions: [own('positive'), rival('c1')], visibility_queries: q('q1', 'a') },
    { id: 'r2', run_at: '2026-02-10T00:00:00Z', status: 'completed', visibility_brand_mentions: [own('negative'), rival('c1'), rival('c2', 'Other')], visibility_queries: q('q2', 'b') },
    { id: 'r3', run_at: '2026-02-10T00:00:00Z', status: 'completed', visibility_brand_mentions: [own()], visibility_queries: q('q3', 'c') },
    { id: 'r4', run_at: '2026-02-10T00:00:00Z', status: 'running', visibility_brand_mentions: [own('positive'), rival('c2')], visibility_queries: q('q3', 'c') },
  ]
  const counts = competitorMentionCounts(rows)
  assertEquals(counts.get('c1'), 2)
  assertEquals(counts.get('c2'), 1)
  assertEquals(sentimentCounts(rows), { positive: 1, neutral: 1, negative: 1 })
})

Deno.test('runsInPeriod keeps inclusive UTC day bounds', () => {
  const rows = [
    { id: 'a', run_at: '2026-02-01T00:00:00Z', status: 'completed', visibility_queries: q('q1', 'a') },
    { id: 'b', run_at: '2026-02-28T23:59:00Z', status: 'completed', visibility_queries: q('q1', 'a') },
    { id: 'c', run_at: '2026-03-01T00:00:00Z', status: 'completed', visibility_queries: q('q1', 'a') },
  ]
  assertEquals(runsInPeriod(rows, '2026-02-01', '2026-02-28').map((r) => r.id), ['a', 'b'])
})

Deno.test('groupVisibilityRunsByQuery groups multiple queries and preserves text', () => {
  const grouped = groupVisibilityRunsByQuery([
    {
      id: 'r1',
      run_at: '2026-02-01T10:00:00Z',
      status: 'completed',
      visibility_queries: q('q1', 'best widgets'),
    },
    {
      id: 'r2',
      run_at: '2026-02-02T10:00:00Z',
      status: 'completed',
      visibility_queries: q('q1', 'best widgets'),
    },
    {
      id: 'r3',
      run_at: '2026-02-01T10:00:00Z',
      status: 'completed',
      visibility_queries: q('q2', 'widget pricing'),
    },
  ])
  assertEquals(grouped.size, 2)
  assertEquals(grouped.get('q1')?.runs.length, 2)
  assertEquals(grouped.get('q1')?.text, 'best widgets')
  assertEquals(grouped.get('q2')?.runs.length, 1)
  assertEquals(grouped.get('q2')?.text, 'widget pricing')
})

Deno.test('groupVisibilityRunsByQuery skips rows without query id', () => {
  const grouped = groupVisibilityRunsByQuery([
    {
      id: 'r1',
      run_at: '2026-02-01T10:00:00Z',
      status: 'completed',
      visibility_queries: q('', 'orphan'),
    },
  ])
  assertEquals(grouped.size, 0)
})

Deno.test('topCitedSourceDomains sorts by frequency', () => {
  const top = topCitedSourceDomains(
    [
      {
        id: 'r1',
        run_at: '2026-02-10T12:00:00Z',
        status: 'completed',
        visibility_citations: [{ source_domain: 'alpha.com' }, { source_domain: 'beta.com' }],
        visibility_queries: q('q1', 'a'),
      },
      {
        id: 'r2',
        run_at: '2026-02-11T12:00:00Z',
        status: 'completed',
        visibility_citations: [{ source_domain: 'alpha.com' }],
        visibility_queries: q('q1', 'a'),
      },
    ],
    '2026-02-01',
    '2026-02-28',
    5,
  )
  assertEquals(top, [
    { domain: 'alpha.com', count: 2 },
    { domain: 'beta.com', count: 1 },
  ])
})

Deno.test('classifyVisibilityPrompts ignores non-completed runs', () => {
  const grouped = groupVisibilityRunsByQuery([
    {
      id: 'r3',
      run_at: '2026-02-06T10:00:00Z',
      status: 'completed',
      mentioned_brands: [],
      visibility_queries: q('q2', 'missing prompt'),
    },
    {
      id: 'r4',
      run_at: '2026-02-07T10:00:00Z',
      status: 'running',
      mentioned_brands: ['Should not count'],
      visibility_queries: q('q2', 'missing prompt'),
    },
  ])
  const { mentioned, notMentioned } = classifyVisibilityPrompts(grouped)
  assertEquals(mentioned, [])
  assertEquals(notMentioned, ['missing prompt'])
})

// ── citation rate ─────────────────────────────────────────────────────────────────────────────

const citedRun = (id: string, status: string, domains: string[]): VisibilityRunRow => ({
  id,
  run_at: '2026-09-20T10:00:00Z',
  status,
  visibility_citations: domains.map((source_domain) => ({ source_domain })),
  visibility_queries: { id: 'q1', text: 'best coffee grinder', is_active: true },
})

Deno.test('siteHost: bare, lower-case host without www or path', () => {
  assertEquals(siteHost('https://www.Coffee.example/shop?x=1'), 'coffee.example')
  assertEquals(siteHost('coffee.example'), 'coffee.example')
  assertEquals(siteHost(''), null)
  assertEquals(siteHost(null), null)
})

Deno.test('ownCitationRate: share of answers with sources that link the site, never above 100%', () => {
  // A Perplexity-style answer cites eight sources: counting all of them per run gave ~800%.
  const runs = [
    citedRun('a', 'completed', ['wiki.example', 'news.example', 'www.coffee.example', 'blog.example', 'a.example', 'b.example', 'c.example', 'd.example']),
    citedRun('b', 'completed', ['shop.coffee.example']),
    citedRun('c', 'completed', ['rival.example', 'news.example']),
    citedRun('d', 'completed', []),
    citedRun('e', 'failed', ['coffee.example']),
  ]
  // 'd' lists no sources, so it cannot cite the site: 2 of the 3 answers with sources.
  assertEquals(ownCitationRate(runs, 'https://www.coffee.example'), 66.7)
})

Deno.test('ownCitationRate: answers from engines that never cite sources do not dilute it', () => {
  const perplexity = [citedRun('p1', 'completed', ['coffee.example', 'wiki.example']), citedRun('p2', 'completed', ['wiki.example'])]
  const chatgptAndGemini = ['c1', 'c2', 'g1', 'g2'].map((id) => citedRun(id, 'completed', []))
  assertEquals(ownCitationRate([...perplexity, ...chatgptAndGemini], 'coffee.example'), 50)
  assertEquals(ownCitationRate(chatgptAndGemini, 'coffee.example'), null)
  assertEquals(ownCitationCounts([...perplexity, ...chatgptAndGemini], 'coffee.example'), { cited: 1, withSources: 2 })
})

Deno.test('ownCitationRate: a look-alike domain is not the site', () => {
  assertEquals(ownCitationRate([citedRun('a', 'completed', ['notcoffee.example'])], 'coffee.example'), 0)
})

Deno.test('ownCitationRate: null without a site or without completed answers', () => {
  assertEquals(ownCitationRate([citedRun('a', 'completed', ['coffee.example'])], null), null)
  assertEquals(ownCitationRate([citedRun('a', 'failed', ['coffee.example'])], 'coffee.example'), null)
})

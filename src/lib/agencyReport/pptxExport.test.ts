// @vitest-environment node
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import i18n from '../../common/i18n'
import type { WhiteLabelReportBranding } from '../whiteLabelReport'
import {
  buildReportDeck,
  buildReportDeckFilename,
  clip,
  clipSentences,
  deckVisibleText,
  planReportDeck,
  renderReportDeck,
  type DeckSlide,
  type DeckTranslate,
  type ReportDeckInput,
} from './pptxExport'
import type { ReportData } from './types'
import { ENGLISH_LEAK_RE, gscOnlyReport, harborstayReport } from './__fixtures__/reportFixtures'

const tEn = i18n.getFixedT('en') as unknown as DeckTranslate
const tIt = i18n.getFixedT('it') as unknown as DeckTranslate

const m = (value: number | null, previous: number | null) => {
  if (value == null && previous == null) return { value: null, delta: null, deltaPct: null }
  const cur = value ?? 0
  const prev = previous ?? 0
  const delta = cur - prev
  return { value, delta, deltaPct: prev !== 0 ? Math.round((1000 * delta) / prev) / 10 : cur !== 0 ? 100 : 0 }
}

const days = <T extends Record<string, number>>(n: number, f: (i: number) => T) =>
  Array.from({ length: n }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, ...f(i) }))

/** Every source connected and populated. */
const fullData: ReportData = {
  meta: { periodStart: '2026-08-01', periodEnd: '2026-08-28', builtAt: '2026-08-29T08:00:00Z', locale: 'en', annotations: [{ section: 'gsc', text: 'Migration on 12 Aug.' }] },
  summary: {
    healthScore: m(74, 70),
    aiSov: m(14.3, 11.1),
    avgPosition: m(9.1, 11.4),
    gscClicks: m(1530, 1240),
    ga4Sessions: m(5200, 4800),
    ga4AiAssistantSessions: m(80, 40),
    keyEvents: m(null, null),
  },
  geo: {
    sovOverall: m(14.3, 11.1),
    sovByEngine: [
      { engine: 'openai', sovPercent: 61 },
      { engine: 'perplexity', sovPercent: 12 },
      { engine: 'gemini', sovPercent: 40 },
    ],
    trend: days(5, (i) => ({ yours: 2 + i, competitors: 10, sovPercent: 10 + i })),
    topPromptsMentioned: ['best crm for agencies', 'crm with ai features'],
    topPromptsNotMentioned: ['cheapest crm for freelancers', 'crm vs spreadsheet', 'crm for real estate'],
    competitorLeaderboard: [
      { id: 'c1', name: 'HubSpot', mentions: 14 },
      { id: 'c2', name: 'Pipedrive', mentions: 3 },
    ],
    citationRate: m(34, 12),
    topCitedSources: [{ domain: 'g2.com', count: 9 }],
  },
  ai_attribution: { byEngine: [{ engine: 'openai', sovPercent: 61, ga4Sessions: 55 }], topAiReferredLandingPages: [] },
  rankings: {
    avgPosition: m(9.1, 11.4),
    distribution: { '1': 2, '2-3': 5, '4-10': 12, '11-20': 8, '21+': 3 },
    topMovers: [
      { phrase: 'crm software', currentRank: 2, previousRank: 6, delta: 4, url: null },
      { phrase: 'crm for agencies', currentRank: 8, previousRank: 14, delta: 6, url: null },
      { phrase: 'sales pipeline tool', currentRank: 15, previousRank: 7, delta: -8, url: null },
    ],
    table: [{ phrase: 'crm software', rank: 2, url: null }],
  },
  gsc: {
    clicks: m(1530, 1240),
    impressions: m(120000, 80000),
    ctr: m(1.3, 1.55),
    avgPosition: m(12.2, 12.9),
    trend: days(28, (i) => ({ clicks: 40 + i, impressions: 4000 + i * 10 })),
    topQueries: Array.from({ length: 12 }, (_, i) => ({ key: `query ${i}`, clicks: 100 - i, impressions: 2000 - i * 10, ctr: 0.05, position: 4 + i })),
    topPages: [{ key: 'https://acme.com/pricing', clicks: 300, impressions: 9000, ctr: 0.033, position: 3.4 }],
  },
  ga4: {
    sessions: m(5200, 4800),
    users: m(4100, 3900),
    engagedSessions: m(3000, 2800),
    keyEvents: m(120, 100),
    organicShare: m(41, 39),
    aiAssistantSessions: m(80, 40),
    trend: days(28, (i) => ({ sessions: 150 + i, users: 120 + i })),
    topLandingPages: [
      { key: 'https://acme.com/', sessions: 2200, users: 1900, pageviews: 3000 },
      { key: 'https://acme.com/blog/crm-guide', sessions: 800, users: 700, pageviews: 900 },
    ],
    topSources: [{ source: 'google', sessions: 3000 }],
  },
  site_health: { auditScore: 74, topIssues: [], auditedAt: '2026-08-20T10:00:00Z' },
  backlinks: { referringDomains: 212, new: 9, lost: 2 },
}

const disconnected = { data: null, reason: 'not_connected' } as const

/** Summary only; every other source disconnected, GSC connected but empty. */
const sparseData: ReportData = {
  summary: fullData.summary,
  geo: disconnected,
  ai_attribution: disconnected,
  rankings: disconnected,
  gsc: { clicks: m(0, 0), impressions: m(0, 0), ctr: m(0, 0), avgPosition: m(null, null), trend: [], topQueries: [], topPages: [] },
  ga4: disconnected,
  site_health: disconnected,
  backlinks: disconnected,
}

const agencyBranding: WhiteLabelReportBranding = {
  agencyName: 'Studio Nord',
  logoUrl: null,
  primaryColor: '#0f766e',
  hideAstroSeoFooter: true,
  enabled: true,
}

function input(overrides: Partial<ReportDeckInput> = {}): ReportDeckInput {
  return {
    data: fullData,
    narrative: {
      executiveSummary: 'Organic clicks grew while AI share of voice improved on every engine.',
      sections: { gsc: 'Search demand grew after the migration.', geo: 'ChatGPT leads the engines.' },
      nextActions: ['Rewrite the pricing page title', 'Publish the CRM comparison guide', 'Fix the 12 broken internal links'],
    },
    branding: null,
    goals: { gscClicks: 2000, aiSov: 20 },
    period: { start: '2026-08-01', end: '2026-08-28' },
    projectName: 'Acme CRM',
    websiteUrl: 'https://acme.com',
    locale: 'en-US',
    logoData: null,
    ...overrides,
  }
}

const kinds = (slides: DeckSlide[]) => slides.map((s) => s.kind)
const titles = (slides: DeckSlide[]) => slides.map((s) => ('title' in s ? s.title : ''))

/** Minimal zip reader (local file headers, deflate) — enough for a JSZip-generated .pptx. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Map<string, string>()
  let off = 0
  while (off + 30 <= bytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true)
    const csize = dv.getUint32(off + 18, true)
    const nlen = dv.getUint16(off + 26, true)
    const xlen = dv.getUint16(off + 28, true)
    const name = new TextDecoder().decode(bytes.subarray(off + 30, off + 30 + nlen))
    const start = off + 30 + nlen + xlen
    const raw = bytes.subarray(start, start + csize)
    out.set(name, new TextDecoder().decode(method === 8 ? inflateRawSync(raw) : raw))
    off = start + csize
  }
  return out
}

describe('planReportDeck', () => {
  it('produces one slide per populated section when everything is connected', () => {
    const plan = planReportDeck(input(), tEn)
    expect(kinds(plan.slides)).toEqual([
      'cover',
      'briefing',
      'ai',
      'prompts',
      'scorecard',
      'metrics', // Search Console KPIs + charts
      'table', // top queries
      'table', // top pages
      'metrics', // GA4
      'rankings',
      'scorecard', // site health + backlinks
      'list', // next steps
      'closing',
    ])
    expect(titles(plan.slides)).toContain('Google Search Console')
    expect(titles(plan.slides)).toContain('Site health · Backlinks')
    expect(titles(plan.slides)).toContain('Next steps')
  })

  it('skips every section without data (disconnected or connected-but-empty)', () => {
    const plan = planReportDeck(input({ data: sparseData, narrative: null }), tEn)
    expect(kinds(plan.slides)).toEqual(['cover', 'briefing', 'scorecard', 'closing'])
    const text = deckVisibleText(plan)
    expect(text).not.toContain('Google Search Console')
    expect(text).not.toContain('Google Analytics')
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('NaN')
  })

  it('drops the briefing and next-steps slides when there is nothing to say', () => {
    const noBaseline: ReportData = {
      summary: { ...fullData.summary!, healthScore: m(74, null), aiSov: m(null, null), avgPosition: m(null, null), gscClicks: m(null, null), ga4Sessions: m(null, null), ga4AiAssistantSessions: m(null, null) },
    }
    const plan = planReportDeck(input({ data: noBaseline, narrative: null }), tEn)
    expect(kinds(plan.slides)).toEqual(['cover', 'scorecard', 'closing'])
  })

  it('formats every number for the Italian locale and speaks Italian', () => {
    const plan = planReportDeck(input({ locale: 'it-IT' }), tIt)
    const text = deckVisibleText(plan)
    expect(text).toContain('14,3%')
    expect(text).not.toContain('14.3%')
    expect(text).toContain('120.000') // impressions with Italian thousands separator
    expect(text).toContain('Prossimi passi')
    expect(text).toContain('Briefing esecutivo')
    expect(text).toContain('vs periodo precedente')
    expect(text).toContain('Powered by Rankdelta')
    expect(text).not.toMatch(/undefined|NaN/)
  })

  it('never names Rankdelta on a white-label deck and files it under the agency', () => {
    const plan = planReportDeck(input({ branding: agencyBranding, locale: 'it-IT' }), tIt)
    const text = deckVisibleText(plan)
    expect(text).not.toMatch(/rankdelta/i)
    expect(plan.footer).toBe('Preparato da Studio Nord · Acme CRM · 1 ago – 28 ago 2026')
    expect(plan.accent).toBe('0F766E')
    const closing = plan.slides[plan.slides.length - 1]!
    expect(closing.kind === 'closing' && closing.lines).toEqual(['Preparato da Studio Nord'])
    expect(buildReportDeckFilename('Acme CRM', '2026-08-01', '2026-08-28', agencyBranding)).toBe('Acme-CRM-2026-08-01_2026-08-28-studio-nord.pptx')
    expect(buildReportDeckFilename('Acme CRM', '2026-08-01', '2026-08-28', null)).toBe('Acme-CRM-2026-08-01_2026-08-28-rankdelta.pptx')
    // White-label without an agency name: no brand in the file name at all.
    expect(buildReportDeckFilename('Acme CRM', '2026-08-01', '2026-08-28', { ...agencyBranding, agencyName: null })).toBe('Acme-CRM-2026-08-01_2026-08-28.pptx')
  })

  it('splits impressions onto a second chart only when they dwarf clicks', () => {
    const wide = planReportDeck(input(), tEn)
    const gsc = wide.slides.find((s) => s.kind === 'metrics' && s.title === 'Google Search Console')
    expect(gsc && gsc.kind === 'metrics' && gsc.charts.map((c) => c.series.length)).toEqual([1, 1])

    const close: ReportData = { ...fullData, gsc: { ...fullData.gsc!, trend: days(10, (i) => ({ clicks: 40 + i, impressions: 90 + i })) } as ReportData['gsc'] }
    const narrow = planReportDeck(input({ data: close }), tEn)
    const gsc2 = narrow.slides.find((s) => s.kind === 'metrics' && s.title === 'Google Search Console')
    expect(gsc2 && gsc2.kind === 'metrics' && gsc2.charts.map((c) => c.series.length)).toEqual([2])
  })

  it('caps tables at eight rows, keeps the narrative in the notes and the engines as a bar chart', () => {
    const plan = planReportDeck(input(), tEn)
    const queries = plan.slides.find((s) => s.kind === 'table' && s.title === 'Which queries bring clicks')
    expect(queries && queries.kind === 'table' && queries.table.rows).toHaveLength(8)
    const gsc = plan.slides.find((s) => s.kind === 'metrics' && s.title === 'Google Search Console')
    expect(gsc && gsc.kind === 'metrics' && gsc.notes).toBe('Search demand grew after the migration.\n\nMigration on 12 Aug.')
    const ai = plan.slides.find((s) => s.kind === 'ai')
    expect(ai && ai.kind === 'ai' && ai.chart?.kind).toBe('hbar')
    expect(ai && ai.kind === 'ai' && ai.chart?.labels).toEqual(['Perplexity', 'Gemini', 'ChatGPT'])
    expect(ai && ai.kind === 'ai' && ai.headline.value).toBe('14.3%')
    expect(ai && ai.kind === 'ai' && ai.headline.movement?.text).toBe('▲ +3.2\u00a0pt vs previous period')
  })
})

describe('planReportDeck — what real agencies have (GEO only, GSC only)', () => {
  const geoOnly = () => {
    const r = harborstayReport()
    return input({ data: r.data, narrative: r.narrative, branding: r.branding, goals: null, sections: r.sections, projectName: 'Harborstay', websiteUrl: 'https://harborstay.example', period: { start: r.period_start, end: r.period_end } })
  }
  const gscOnly = () => {
    const r = gscOnlyReport()
    return input({ data: r.data, narrative: r.narrative, branding: r.branding, goals: r.goals, sections: r.sections, projectName: 'Cliente', websiteUrl: 'https://cliente.it', period: { start: r.period_start, end: r.period_end } })
  }

  it('GEO-only: AI slide, scorecard, health score beside the issues table; no Google, GA4, rankings or backlinks slide', () => {
    const plan = planReportDeck(geoOnly(), tEn)
    expect(kinds(plan.slides)).toEqual(['cover', 'briefing', 'ai', 'prompts', 'scorecard', 'health', 'list', 'closing'])
    const text = deckVisibleText(plan)
    expect(text).not.toMatch(/Google Search Console|Google Analytics|Rankings|Referring domains/)
    // Competitors: a real count or "not mentioned yet" — never a bare name, never a 0.
    expect(text).toContain('Staynest (9 mentions)')
    expect(text).toContain('Casalibera (not mentioned yet)')
    // Engines by product name, first reading marked as such, citation rate 0% is still a number.
    const ai = plan.slides.find((s) => s.kind === 'ai')
    expect(ai && ai.kind === 'ai' && ai.chart?.labels).toEqual(['ChatGPT', 'Perplexity'])
    expect(ai && ai.kind === 'ai' && ai.headline.movement?.text).toMatch(/first reading/)
    expect(text).not.toMatch(/google_aio|chatgpt\b|\+100|undefined|NaN/)
  })

  it('GEO-only: the health slide carries the score and the audit table with priority labels and page counts', () => {
    const plan = planReportDeck(geoOnly(), tEn)
    const health = plan.slides.find((s) => s.kind === 'health') as Extract<DeckSlide, { kind: 'health' }>
    expect(health.title).toBe('Site health')
    expect(health.tile.value).toMatch(/^\d+\/100$/)
    expect(health.table.title).toBe('What is holding the site back')
    expect(health.table.columns.map((c) => c.label)).toEqual(['Issue', 'Pages', 'Priority'])
    expect(health.table.rows.map((r) => [r[1], r[2]])).toEqual([['4', 'Medium'], ['5', 'Opportunity']])
    expect(health.table.rows[0]?.[0]).toContain('Poco testo rispetto al codice')
  })

  it('GEO-only first reading: "At a glance" does not promise a comparison it cannot show', () => {
    const plan = planReportDeck(geoOnly(), tEn)
    const scorecard = plan.slides.find((s) => s.kind === 'scorecard') as Extract<DeckSlide, { kind: 'scorecard' }>
    const compared = scorecard.tiles.some((x) => x.movement && x.movement.tone !== 'muted')
    expect(scorecard.subtitle).toBe(compared ? 'The key numbers, compared with the previous period.' : 'The key numbers for this period. Comparisons start with the next report.')
  })

  it('GSC-only: Search Console slides only, locale numbers, count movements without a unit', () => {
    const plan = planReportDeck(gscOnly(), tEn)
    expect(kinds(plan.slides)).toEqual(['cover', 'briefing', 'scorecard', 'metrics', 'table', 'table', 'list', 'closing'])
    const text = deckVisibleText(plan)
    expect(text).not.toMatch(/AI share of voice|Tracked prompts|Rankings|Site health|Referring domains/)
    expect(text).toContain('52,340')
    expect(text).toMatch(/▲ \+234 \(\+23%\) vs previous period/)
    expect(text).not.toMatch(/\bpp\b|undefined|NaN/)
  })

  it('speaks Italian on both decks — no English label, header or chip', () => {
    for (const make of [geoOnly, gscOnly]) {
      const plan = planReportDeck({ ...make(), locale: 'it-IT' }, tIt)
      const text = deckVisibleText(plan)
      const leak = text.match(ENGLISH_LEAK_RE)
      expect(leak, leak ? `English leak: "${leak[0]}"` : '').toBeNull()
      expect(text).not.toMatch(/\d\.\d%/)
    }
    const geo = deckVisibleText(planReportDeck({ ...geoOnly(), locale: 'it-IT' }, tIt))
    expect(geo).toContain('Casalibera (mai menzionato)')
    expect(geo).toContain('27,4%')
    const gsc = deckVisibleText(planReportDeck({ ...gscOnly(), locale: 'it-IT' }, tIt))
    expect(gsc).toContain('52.340')
  })
})

describe('buildReportDeck', () => {
  it('writes a real .pptx with one slide per planned slide and the localized text inside', async () => {
    const plan = planReportDeck(input({ locale: 'it-IT', branding: agencyBranding }), tIt)
    const blob = await buildReportDeck(input({ locale: 'it-IT', branding: agencyBranding }), tIt)
    expect(blob.size).toBeGreaterThan(10_000)
    const files = unzip(new Uint8Array(await blob.arrayBuffer()))
    const slideFiles = [...files.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    expect(slideFiles).toHaveLength(plan.slides.length)
    const xml = slideFiles.map((n) => files.get(n)!).join('\n')
    expect(xml).toContain('Acme CRM')
    expect(xml).toContain('14,3%')
    expect(xml).toContain('Prossimi passi')
    expect(xml).not.toMatch(/rankdelta/i)
    expect(xml).not.toMatch(/undefined|NaN/)
    // Native charts and speaker notes made it into the package.
    expect([...files.keys()].some((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))).toBe(true)
    const notes = [...files.keys()].filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).map((n) => files.get(n)!).join('\n')
    expect(notes).toContain('ChatGPT leads the engines.')
  })

  it('renders a plan with a custom pptxgenjs constructor (no zip needed)', () => {
    const calls: string[] = []
    class FakePptx {
      layout = ''
      title = ''
      author = ''
      company = ''
      addSlide() {
        calls.push('slide')
        const noop = () => slide
        const slide = { background: {}, addText: noop, addShape: noop, addChart: noop, addTable: noop, addImage: noop, addNotes: noop }
        return slide
      }
    }
    const plan = planReportDeck(input(), tEn)
    const pptx = renderReportDeck(plan, FakePptx as unknown as typeof import('pptxgenjs').default)
    expect(pptx.layout).toBe('LAYOUT_WIDE')
    expect(calls).toHaveLength(plan.slides.length)
  })
})

describe('slide text never stops mid-word', () => {
  // The AI summary of the Rankdelta.ai report (28/09) ended on the briefing slide as "…limiting AI citation ra…".
  const summary =
    'This period marks the first measurable AI-search presence for your brand, with a 30.8% share of voice across 16 tracked AI engine runs. ' +
    'ChatGPT cites you most frequently at 33.3% SOV, followed by Perplexity at 28.6%. ' +
    'The gap is stark: you appear in comparison prompts like "Rankdelta.ai vs Onelittleweb" but not in "best AI SEO software." ' +
    'Your site health score of 84 is solid, but four GEO-specific issues are directly limiting AI citation rates, which currently sit at 0%.'

  it('clip cuts at a word boundary, and hard-cuts only a long unbroken token', () => {
    expect(clip('Structured data missing on the product pages', 30)).toBe('Structured data missing on…')
    expect(clip('short', 30)).toBe('short')
    expect(clip('/blog/2026/09/a-very-long-slug-without-any-space-at-all', 20)).toBe('/blog/2026/09/a-ver…')
  })

  it('clipSentences keeps whole sentences; decimals and domains are not sentence ends', () => {
    const out = clipSentences(summary, 300)
    expect(out).toBe(
      'This period marks the first measurable AI-search presence for your brand, with a 30.8% share of voice across 16 tracked AI engine runs. ' +
        'ChatGPT cites you most frequently at 33.3% SOV, followed by Perplexity at 28.6%.',
    )
    expect(clipSentences(summary, 2000)).toBe(summary)
    // Not even one sentence fits: word-boundary clip.
    expect(clipSentences(summary, 60)).toBe('This period marks the first measurable AI-search presence…')
  })

  it('the briefing slide shows whole sentences and keeps the full summary in the speaker notes', () => {
    const long = `${summary} ${summary}`
    const plan = planReportDeck(input({ narrative: { executiveSummary: long, sections: {}, nextActions: [] } }), tEn)
    const briefing = plan.slides.find((s) => s.kind === 'briefing') as Extract<DeckSlide, { kind: 'briefing' }>
    expect(briefing.lead!.length).toBeLessThanOrEqual(720)
    expect(briefing.lead).toMatch(/[.!?]["”]?$/)
    expect(briefing.notes).toContain(long)
  })
})

describe('deck slides that would read as empty', () => {
  it('"At a glance" says comparisons start next time when no tile has a previous period', () => {
    const first = (value: number) => ({ value, delta: null, deltaPct: null })
    const noBaseline: ReportData = {
      ...fullData,
      summary: { ...fullData.summary!, healthScore: first(84), aiSov: first(30.8), avgPosition: m(null, null), gscClicks: m(null, null), ga4Sessions: m(null, null), ga4AiAssistantSessions: m(null, null) },
    }
    const plan = planReportDeck(input({ data: noBaseline, sections: ['summary'] }), tEn)
    const scorecard = plan.slides.find((s) => s.kind === 'scorecard') as Extract<DeckSlide, { kind: 'scorecard' }>
    expect(scorecard.subtitle).toBe('The key numbers for this period. Comparisons start with the next report.')
    const it = planReportDeck(input({ data: noBaseline, sections: ['summary'], locale: 'it-IT' }), tIt)
    const itScorecard = it.slides.find((s) => s.kind === 'scorecard') as Extract<DeckSlide, { kind: 'scorecard' }>
    expect(itScorecard.subtitle).toBe('I numeri chiave del periodo. I confronti partono dal prossimo report.')
    // With a previous period the usual subtitle stays.
    const full = planReportDeck(input(), tEn).slides.find((s) => s.kind === 'scorecard') as Extract<DeckSlide, { kind: 'scorecard' }>
    expect(full.subtitle).toBe('The key numbers, compared with the previous period.')
  })

  it('keeps health + backlinks tiles on their own slide and the issues on the next one', () => {
    const plan = planReportDeck(input(), tEn)
    expect(kinds(plan.slides)).not.toContain('health')
  })

  it('renders the health slide (tile beside the table) without throwing', async () => {
    const r = harborstayReport()
    const plan = planReportDeck(input({ data: r.data, narrative: r.narrative, branding: r.branding, goals: null, sections: r.sections }), tEn)
    const blob = await buildReportDeck(input({ data: r.data, narrative: r.narrative, branding: r.branding, goals: null, sections: r.sections, logoData: null }), tEn)
    expect(plan.slides.some((s) => s.kind === 'health')).toBe(true)
    expect(blob.size).toBeGreaterThan(10_000)
  })
})

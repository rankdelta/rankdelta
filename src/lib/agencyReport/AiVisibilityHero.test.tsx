import { describe, it, expect, beforeAll } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../common/i18n'
import { AiVisibilityHero, buildHeroModel } from '../../components/agencyReport/AiVisibilityHero'
import type { ReportData } from './types'

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const data: ReportData = {
  geo: {
    sovOverall: { value: 84.6, delta: 3.2, deltaPct: 3.9 },
    sovByEngine: [
      { engine: 'perplexity', sovPercent: 90 },
      { engine: 'openai', sovPercent: 80 },
      { engine: 'gemini', sovPercent: null },
    ],
    trend: [
      { date: '2026-08-01', yours: 4, competitors: 1, sovPercent: 80 },
      { date: '2026-08-02', yours: 5, competitors: 1, sovPercent: 83 },
    ],
    topPromptsMentioned: ['migliori integratori per cani anziani', 'integratore articolazioni cane'],
    topPromptsNotMentioned: ['probiotici per cani prezzo'],
    competitorLeaderboard: [{ id: 'c1', name: 'Competitor Uno', mentions: 0 }],
    citationRate: { value: 12, delta: null, deltaPct: null },
    topCitedSources: [{ domain: 'amazon.it', count: 7 }, { domain: 'zooplus.it', count: 2 }],
  },
  ai_attribution: {
    byEngine: [{ engine: 'openai', sovPercent: 80, ga4Sessions: 12 }],
    topAiReferredLandingPages: [],
  },
}

describe('buildHeroModel', () => {
  it('builds a sorted, labelled engine leaderboard and joins GA4 sessions by engine', () => {
    const model = buildHeroModel(data)!
    expect(model.engines.map((e) => e.engine)).toEqual(['Perplexity', 'ChatGPT'])
    expect(model.engines[1]?.sessions).toBe(12)
    expect(model.promptsTotal).toBe(3)
    expect(model.leader).toBeNull() // zero mentions → nobody is named
  })

  it('reads the sessions field the assembler actually writes (aiAssistantSessions), not only the legacy one', () => {
    const current: ReportData = {
      ...data,
      ai_attribution: {
        byEngine: [
          { engine: 'openai', sovPercent: 80, aiAssistantSessions: 31, keyEvents: 0, conversionRate: null },
          { engine: 'perplexity', sovPercent: 90, aiAssistantSessions: null, keyEvents: 0, conversionRate: null },
        ],
        topAiReferredLandingPages: [],
      },
    }
    const model = buildHeroModel(current)!
    expect(model.engines.find((e) => e.engine === 'ChatGPT')?.sessions).toBe(31)
    expect(model.engines.find((e) => e.engine === 'Perplexity')?.sessions).toBeNull()
  })

  it('returns null for disconnected or empty GEO data', () => {
    expect(buildHeroModel({ geo: { data: null, reason: 'not_connected' } })).toBeNull()
    expect(buildHeroModel({})).toBeNull()
    expect(
      buildHeroModel({
        geo: {
          sovOverall: { value: null, delta: null, deltaPct: null },
          sovByEngine: [],
          trend: [],
          topPromptsMentioned: [],
          topPromptsNotMentioned: [],
          competitorLeaderboard: [],
          citationRate: { value: null, delta: null, deltaPct: null },
          topCitedSources: [],
        },
      }),
    ).toBeNull()
  })
})

describe('AiVisibilityHero honesty guards', () => {
  it('lists prompts neutrally when the mentioned / missing split contradicts share of voice', () => {
    const geo = data.geo as Exclude<ReportData['geo'], undefined | { data: null; reason: string }>
    const contradictory: ReportData = {
      geo: { ...geo, topPromptsMentioned: [], topPromptsNotMentioned: ['prompt uno', 'prompt due'], citationRate: { value: 0, delta: 0, deltaPct: 0 } },
    }
    render(
      <I18nextProvider i18n={i18n}>
        <AiVisibilityHero data={contradictory} />
      </I18nextProvider>,
    )
    const hero = screen.getByTestId('ai-visibility-hero')
    expect(screen.queryByTestId('hero-prompts-missing')).not.toBeInTheDocument()
    expect(within(hero).getByTestId('hero-prompts-tracked')).toHaveTextContent('prompt uno')
    expect(hero).not.toHaveTextContent(/0 (of|su) 2/)
    // A 0 → 0 citation rate is not a comparison: no flat chip.
    expect(within(hero).queryByLabelText('0.0 pt')).not.toBeInTheDocument()
  })
})

describe('AiVisibilityHero', () => {
  it('renders the headline share of voice, engines, actual prompt texts and cited sources', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <AiVisibilityHero data={data} accentColor="#2563eb" />
      </I18nextProvider>,
    )
    const hero = screen.getByTestId('ai-visibility-hero')
    expect(within(hero).getByTestId('hero-sov')).toHaveTextContent('84.6%') // same precision as the scorecard
    expect(within(hero).getByLabelText('+3.2 pt')).toBeInTheDocument()
    expect(within(hero).getByTestId('hero-engines')).toHaveTextContent(/Perplexity.*ChatGPT/s)
    expect(within(hero).getByTestId('hero-prompts-won')).toHaveTextContent('integratore articolazioni cane')
    expect(within(hero).getByTestId('hero-prompts-missing')).toHaveTextContent('probiotici per cani prezzo')
    expect(within(hero).getByTestId('hero-prompts-missing')).not.toHaveTextContent('Competitor Uno')
    expect(within(hero).getByTestId('hero-sources')).toHaveTextContent('amazon.it')
  })

  it('caps a long prompt list at 6 with a toggle, keeping every prompt in the DOM for print', () => {
    const geo = data.geo as Exclude<ReportData['geo'], undefined | { data: null; reason: string }>
    const many: ReportData = {
      ...data,
      geo: { ...geo, topPromptsMentioned: Array.from({ length: 9 }, (_, i) => `won prompt ${i + 1}`), topPromptsNotMentioned: ['a missing one'] },
    }
    render(
      <I18nextProvider i18n={i18n}>
        <AiVisibilityHero data={many} />
      </I18nextProvider>,
    )
    const won = screen.getByTestId('hero-prompts-won')
    // Even collapsed, all 9 are rendered (hidden beyond 6) so the PDF is never truncated.
    expect(within(won).getByText('“won prompt 9”')).toBeInTheDocument()
    // Toggle reveals the remaining 3 and back.
    const toggle = within(won).getByRole('button', { name: '+3 more' })
    fireEvent.click(toggle)
    expect(within(won).getByRole('button', { name: 'Show less' })).toBeInTheDocument()
    fireEvent.click(within(won).getByRole('button', { name: 'Show less' }))
    expect(within(won).getByRole('button', { name: '+3 more' })).toBeInTheDocument()
  })
})

describe('AiVisibilityHero brand prompts', () => {
  const geo = data.geo as NonNullable<ReportData['geo']> & Record<string, unknown>
  const withBranded: ReportData = {
    ...data,
    geo: {
      ...geo,
      sovScope: 'discovery',
      promptCounts: { discovery: 3, branded: 2 },
      brandedPrompts: [
        { text: 'Acme vs Rival', mentioned: true },
        { text: 'is Acme legit', mentioned: false },
      ],
    } as ReportData['geo'],
  }

  it('lists prompts that name the brand apart from won / missing, with a note on the headline', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <AiVisibilityHero data={withBranded} accentColor="#2563eb" />
      </I18nextProvider>,
    )
    const hero = screen.getByTestId('ai-visibility-hero')
    const branded = within(hero).getByTestId('hero-branded-prompts')
    expect(branded).toHaveTextContent('Acme vs Rival')
    expect(branded).toHaveTextContent('1 of 2')
    expect(within(branded).getByLabelText('Mentioned')).toBeInTheDocument()
    expect(within(branded).getByLabelText('Not mentioned')).toBeInTheDocument()
    expect(within(hero).getByTestId('hero-sov-discovery-note')).toHaveTextContent("don't name the brand")
    expect(within(hero).getByTestId('hero-prompts-won')).not.toHaveTextContent('Acme vs Rival')
  })

  it('shows nothing extra for reports built before the split, or when every prompt was counted', () => {
    expect(buildHeroModel(data)!.brandedPrompts).toEqual([])
    const allScope = { ...withBranded, geo: { ...(withBranded.geo as object), sovScope: 'all' } as ReportData['geo'] }
    expect(buildHeroModel(allScope)!.brandedPrompts).toEqual([])
  })
})


describe('AiVisibilityHero client-facing captions', () => {
  const renderHero = (d: ReportData) =>
    render(
      <I18nextProvider i18n={i18n}>
        <AiVisibilityHero data={d} />
      </I18nextProvider>,
    )

  it('names only the engines this report tracks, and explains visits only when there are some', () => {
    renderHero(data)
    const hero = screen.getByTestId('ai-visibility-hero')
    expect(hero).toHaveTextContent('This one also shows what Perplexity and ChatGPT answer')
    expect(hero).not.toHaveTextContent(/Gemini|other AI assistants|GA4|where connected/)
    expect(within(hero).getByTestId('hero-engines')).toHaveTextContent('visits are the sessions it sent to the site')
  })

  it('keeps the engine caption to share of voice when no assistant sent visits', () => {
    renderHero({ geo: data.geo })
    expect(within(screen.getByTestId('hero-engines')).queryByText(/visits/)).toBeNull()
  })
})

describe('AiVisibilityHero citation sample', () => {
  it('shows how many answers with sources the rate is based on', () => {
    const withCounts: ReportData = { geo: { ...data.geo!, citationRate: { value: 50, delta: null, deltaPct: null }, citationCounts: { cited: 3, withSources: 6 } } }
    render(
      <I18nextProvider i18n={i18n}>
        <AiVisibilityHero data={withCounts} />
      </I18nextProvider>,
    )
    expect(screen.getByTestId('hero-citation-sample')).toHaveTextContent('3 of 6 answers with sources')
  })

  it('never labels competitors "not mentioned" when share of voice says they were', () => {
    // A report built 15/09: 14.3% share of voice, yet every tracked competitor stored with 0 mentions.
    const stale: ReportData = {
      geo: {
        ...data.geo!,
        sovOverall: { value: 14.3, delta: null, deltaPct: null },
        trend: [],
        topCitedSources: [],
        competitorLeaderboard: [
          { id: 'c1', name: 'Rival One', mentions: 0 },
          { id: 'c2', name: 'Rival Two', mentions: 0 },
        ],
      },
    }
    render(
      <I18nextProvider i18n={i18n}>
        <AiVisibilityHero data={stale} />
      </I18nextProvider>,
    )
    const block = screen.getByTestId('hero-competitors')
    expect(block).toHaveTextContent('Rival One · Rival Two')
    expect(block).not.toHaveTextContent(/not mentioned|mai menzionato/)
  })

  it('shows no sample for reports built before the counts existed', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <AiVisibilityHero data={data} />
      </I18nextProvider>,
    )
    expect(screen.queryByTestId('hero-citation-sample')).toBeNull()
  })
})

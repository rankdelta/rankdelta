/**
 * What an agency owner's client sees on the two most common real-world snapshots — GEO only and
 * GSC only — through both render paths (saved layout → widgets; no layout → legacy sections),
 * in English and in Italian. Every assertion is a thing a client complained about or would.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../common/i18n'
import { ClientReportView } from '../../components/agencyReport/ClientReportView'
import { ReportKpiCard } from '../../components/agencyReport/ReportKpiCard'
import { ENGLISH_LEAK_RE, gscOnlyReport, harborstayReport, metric } from './__fixtures__/reportFixtures'
import type { ClientReportSnapshot } from './types'

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

function renderClient(report: ClientReportSnapshot, name = 'Cliente', url = 'https://cliente.it') {
  return render(
    <I18nextProvider i18n={i18n}>
      <ClientReportView report={report} projectName={name} websiteUrl={url} isAgency readOnly />
    </I18nextProvider>,
  )
}

const bodyText = () => document.body.textContent ?? ''

describe('GEO-only report (Harborstay) — layout path', () => {
  it('lists every competitor with a real count or "not mentioned yet", never a bare 0', () => {
    renderClient(harborstayReport())
    // Hero (trend ≤ 1 point, no sources) + the competitor table both name the competitors.
    expect(screen.getAllByText(/Staynest/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/not mentioned yet/).length).toBeGreaterThan(0)
  })

  it('shows human engine names, no raw ids', () => {
    renderClient(harborstayReport())
    expect(screen.getAllByText(/Perplexity/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/ChatGPT/).length).toBeGreaterThan(0)
    expect(bodyText()).not.toMatch(/google_aio|chatgpt\b|perplexity\b/)
  })

  it('does not print a "+100%" first-reading chip or a "pp" unit anywhere', () => {
    renderClient(harborstayReport())
    expect(bodyText()).not.toMatch(/\+100/)
    expect(bodyText()).not.toMatch(/\bpp\b/)
  })
})

describe('GEO-only report (Harborstay) — legacy path (report saved without a layout)', () => {
  const legacy = () => harborstayReport({ layout: null })

  it('hides the attribution chart without GA4 and never shows raw engine ids', () => {
    renderClient(legacy())
    expect(screen.queryByLabelText(/AI visibility and sessions by engine/)).not.toBeInTheDocument()
    expect(bodyText()).not.toMatch(/google_aio/)
  })

  it('shows the audit issues under the health score', () => {
    renderClient(legacy())
    expect(screen.getByText('What is holding the site back')).toBeInTheDocument()
    expect(screen.getByText('Poco testo rispetto al codice')).toBeInTheDocument()
    expect(screen.getByText('Opportunity')).toBeInTheDocument()
  })

  it('says nothing about backlinks for a domain never analysed', () => {
    renderClient(legacy())
    expect(screen.queryByText(/referring domains/i)).not.toBeInTheDocument()
  })
})

describe('GSC-only report — second period, layout path', () => {
  it('shows the Search Console numbers with thousands separators and a count chip without "pp"', () => {
    renderClient(gscOnlyReport())
    expect(screen.getAllByText('1,234').length).toBeGreaterThan(0)
    expect(screen.getAllByText('52,340').length).toBeGreaterThan(0)
    // Clicks moved +234 (a count): no decimals, no percentage-point unit.
    expect(screen.getAllByText(/\+234$/).length).toBeGreaterThan(0)
    expect(bodyText()).not.toMatch(/234\.0|\bpp\b/)
  })

  it('shows no AI hero, no attribution and no rankings for a Google-only client', () => {
    renderClient(gscOnlyReport())
    expect(screen.queryByTestId('ai-visibility-hero')).not.toBeInTheDocument()
    expect(screen.queryByText(/^AI attribution$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Rankings$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Backlinks$/)).not.toBeInTheDocument()
    // Not a single "connect …" nag reaches the client.
    expect(bodyText()).not.toMatch(/Connect |isn't connected|No data for this period/)
  })

  it('renders the queries and pages tables with locale-formatted cells', () => {
    renderClient(gscOnlyReport())
    const queries = screen.getByTestId('gsc-top-queries')
    expect(within(queries).getByText('gestione case vacanza')).toBeInTheDocument()
    expect(within(queries).getByText('9,800')).toBeInTheDocument()
    expect(within(queries).getByText('3.3%')).toBeInTheDocument()
    const pages = screen.getByTestId('gsc-top-pages')
    expect(within(pages).getByText('/blog/affitti-brevi-guida')).toBeInTheDocument()
  })
})

describe('Italian report — no English leaks in either render path', () => {
  const cases: Array<[string, () => ClientReportSnapshot]> = [
    ['GEO-only, layout', () => harborstayReport()],
    ['GEO-only, legacy', () => harborstayReport({ layout: null })],
    ['GSC-only, layout', () => gscOnlyReport()],
    ['GSC-only, legacy', () => gscOnlyReport({ layout: null })],
  ]

  for (const [name, make] of cases) {
    it(`${name}: every label, header, chip, empty state and footer is Italian`, async () => {
      await i18n.changeLanguage('it')
      renderClient(make())
      const text = bodyText()
      const leak = text.match(ENGLISH_LEAK_RE)
      expect(leak, leak ? `English leak: "${leak[0]}" in …${text.slice(Math.max(0, (leak.index ?? 0) - 60), (leak.index ?? 0) + 60)}…` : '').toBeNull()
      // Italian decimal comma on percentages and thousands dot on counts.
      expect(text).not.toMatch(/\d\.\d%/)
      expect(text).not.toMatch(/\d,\d{3}\b/)
    })
  }

  it('GEO-only: competitors never mentioned read "mai menzionato", engines keep their product names', async () => {
    await i18n.changeLanguage('it')
    renderClient(harborstayReport())
    expect(screen.getAllByText(/Casalibera/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/mai menzionato/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Perplexity/).length).toBeGreaterThan(0)
    expect(bodyText()).toMatch(/27,4%/)
    // Cover headline (the first sentence the client reads) is Italian too.
    expect(screen.getByText(/Punteggio di salute del sito 86/)).toBeInTheDocument()
  })

  it('health score movement: the cover headline and the briefing say "Punteggio di salute del sito", never "Health score"', async () => {
    await i18n.changeLanguage('it')
    // Health 61 → 72 (+11) puts a healthUp item in the briefing; clicks up 23,4% fills the headline's change slot.
    const moved = (path: 'layout' | 'legacy'): ClientReportSnapshot =>
      gscOnlyReport({
        ...(path === 'legacy' ? { layout: null } : {}),
        data: { ...gscOnlyReport().data, summary: { ...gscOnlyReport().data.summary!, healthScore: metric(72, 11, 18) } },
      })
    for (const path of ['layout', 'legacy'] as const) {
      renderClient(moved(path))
      const text = bodyText()
      expect(text).toMatch(/Punteggio di salute del sito 72/)
      expect(text).toMatch(/Punteggio di salute del sito 61 → 72 \(\+11\)/)
      expect(text).not.toMatch(/[Hh]ealth score/)
      const leak = text.match(ENGLISH_LEAK_RE)
      expect(leak, leak ? `English leak: "${leak[0]}" (${path}) in …${text.slice(Math.max(0, (leak.index ?? 0) - 60), (leak.index ?? 0) + 60)}…` : '').toBeNull()
      cleanup()
    }
  })

  it('GSC-only: numbers use the Italian separators and the briefing is Italian', async () => {
    await i18n.changeLanguage('it')
    renderClient(gscOnlyReport())
    // CLDR: Italian groups from five digits on ("52.340"), four-digit numbers stay "1234".
    expect(screen.getAllByText('52.340').length).toBeGreaterThan(0)
    expect(bodyText()).not.toMatch(/52,340/)
    expect(screen.getByTestId('executive-briefing')).toBeInTheDocument()
  })
})

describe('Section commentary from the written narrative', () => {
  it('renders the LLM commentary under the section header, and nothing when the narrative has none', () => {
    const withText = gscOnlyReport({
      narrative: {
        executiveSummary: 'Organic clicks grew 23%.',
        sections: { gsc: 'Search demand grew after the August migration; the pricing page drove most of the gain.' },
        nextActions: [],
      },
    })
    renderClient(withText)
    expect(screen.getByText('Search demand grew after the August migration; the pricing page drove most of the gain.')).toBeInTheDocument()
    expect(screen.getByText('Section commentary')).toBeInTheDocument()
    cleanup()
    renderClient(gscOnlyReport())
    expect(screen.queryByText('Section commentary')).not.toBeInTheDocument()
  })

  it('titles the block in Italian on an Italian report', async () => {
    await i18n.changeLanguage('it')
    renderClient(gscOnlyReport({ narrative: { executiveSummary: '', sections: { gsc: 'La domanda è cresciuta dopo la migrazione.' }, nextActions: [] } }))
    expect(screen.getByText('Commento di sezione')).toBeInTheDocument()
    expect(bodyText().match(ENGLISH_LEAK_RE)).toBeNull()
  })
})

describe('ReportKpiCard movement chip', () => {
  const wrap = (node: React.ReactElement) => render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)

  it('formats a count movement without decimals or a percentage-point unit', () => {
    wrap(<ReportKpiCard label="Clicks" metric={metric(1234, 234, 23.4)} format={(v) => String(v)} deltaDigits={0} />)
    expect(screen.getByText('+234')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/pp|234\.0/)
  })

  it('formats a share-of-voice movement in points with one decimal', () => {
    wrap(<ReportKpiCard label="SoV" metric={metric(27.4, 4.25, 15)} format={(v) => `${v}%`} deltaUnit="pt" deltaDigits={1} />)
    expect(screen.getByText(/\+4\.3\s?pt/)).toBeInTheDocument()
  })

  it('hides the chip on a first reading (delta === value, deltaPct === 100)', () => {
    wrap(<ReportKpiCard label="Clicks" metric={metric(1234, 1234, 100)} format={(v) => String(v)} />)
    expect(document.body.textContent).not.toMatch(/\+1234|\+1,234|▲/)
  })
})

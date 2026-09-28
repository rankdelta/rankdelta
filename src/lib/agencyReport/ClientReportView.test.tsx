import { describe, it, expect, beforeAll } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../common/i18n'
import { ClientReportView } from '../../components/agencyReport/ClientReportView'
import type { ClientReportSnapshot } from './types'

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const mockReport: ClientReportSnapshot = {
  id: 'r1',
  project_id: 'p1',
  period_start: '2026-01-01',
  period_end: '2026-01-31',
  sections: ['summary', 'geo', 'gsc', 'rankings'],
  data: {
    summary: {
      healthScore: { value: 72, delta: 2, deltaPct: 2.8 },
      aiSov: { value: 18, delta: 1.2, deltaPct: 7.1 },
      avgPosition: { value: 8.4, delta: -0.3, deltaPct: null },
      gscClicks: { value: 1200, delta: 100, deltaPct: 9.1 },
      ga4Sessions: { value: 5000, delta: null, deltaPct: null },
      ga4AiAssistantSessions: { value: 42, delta: null, deltaPct: null },
      keyEvents: { value: null, delta: null, deltaPct: null },
    },
    geo: { data: null, reason: 'not_connected' },
    gsc: { data: null, reason: 'not_connected' },
    rankings: {
      avgPosition: { value: 12.1, delta: -1.2, deltaPct: null },
      distribution: { '1': 2, '2-3': 5, '4-10': 12, '11-20': 8, '21+': 3 },
      topMovers: [
        { phrase: 'seo tools', currentRank: 4, previousRank: 9, delta: 5, url: null },
        { phrase: 'rank tracker', currentRank: 18, previousRank: 12, delta: -6, url: null },
      ],
      table: [],
    },
  },
  narrative: {
    executiveSummary: 'Solid month with improving visibility.',
    sections: {},
    nextActions: ['Connect GSC', 'Expand GEO prompts'],
  },
  branding: {
    agencyName: 'Peak Agency',
    logoUrl: null,
    primaryColor: '#2563eb',
    hideAstroSeoFooter: true,
    enabled: true,
  },
  goals: { healthScore: 70, aiSov: 20 },
  created_at: '2026-02-01T00:00:00Z',
}

function renderReport(report = mockReport) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ClientReportView report={report} projectName="Acme" websiteUrl="https://acme.test" isAgency />
    </I18nextProvider>,
  )
}

describe('ClientReportView', () => {
  it('renders branded cover, scorecard, and executive summary', () => {
    renderReport()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Peak Agency')).toBeInTheDocument()
    expect(screen.getByText('acme.test')).toBeInTheDocument()
    expect(screen.getByText(/Solid month/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/at a glance|panoramica/i)).toBeInTheDocument()
    expect(screen.getByText(/Health score 72/i)).toBeInTheDocument()
  })

  it('opens with an executive briefing that names keywords and numbers from the data', () => {
    renderReport()
    const briefing = screen.getByTestId('executive-briefing')
    expect(within(briefing).getByTestId('briefing-wins')).toHaveTextContent(/seo tools/)
    // "rank tracker" #12 → #18 is a drop but never left page 1, so it is a watch item, not a reclaim action.
    expect(within(briefing).getByTestId('briefing-watch')).toHaveTextContent(/rank tracker.*6 (positions|posizioni)/)
    // Average position 13.3 → 12.1 comes with a baseline, so it reads as a real improvement.
    expect(within(briefing).getByTestId('briefing-wins')).toHaveTextContent(/#13\.3 → #12\.1/)
  })

  it('shows source-specific connect prompts for disconnected sections', () => {
    renderReport()
    expect(screen.getByText(/Connect Google Search Console/i)).toBeInTheDocument()
    expect(screen.getByText(/Connect AI visibility/i)).toBeInTheDocument()
    expect(screen.queryByText(/This data source is not connected/i)).not.toBeInTheDocument()
  })

  it('tells rank movers as biggest wins and biggest drops with names and positions', () => {
    renderReport()
    const wins = screen.getByTestId('movers-wins')
    expect(wins).toHaveTextContent('seo tools')
    expect(wins).toHaveTextContent('#9 → #4')
    const drops = screen.getByTestId('movers-drops')
    expect(drops).toHaveTextContent('rank tracker')
    expect(drops).toHaveTextContent('#12 → #18')
    expect(within(drops).getByLabelText(/6 (positions|posizioni)/)).toBeInTheDocument()
  })

  it('draws the rank distribution as a labelled bar with the page-1 share', () => {
    renderReport()
    const bar = screen.getByTestId('rank-distribution')
    // 2 + 5 + 12 = 19 of 30 keywords on page 1
    expect(bar).toHaveTextContent(/19 (of|keyword su) 30/)
    expect(bar).toHaveTextContent('63%')
  })

  it('shows goal RAG badges on scorecard when goals are set', () => {
    renderReport()
    const goals = screen.getAllByText(/goal|obiettivo/i)
    expect(goals.length).toBeGreaterThan(0)
  })

  it('draws a goal progress bar under KPIs that have a target', () => {
    renderReport()
    const bars = screen.getAllByRole('progressbar')
    // healthScore 72 vs 70 (met) and aiSov 18 vs 20 (90%) both carry a target.
    expect(bars.length).toBe(2)
    expect(screen.getByLabelText(/100% (of|di) 72|100% (of|di) 70/)).toBeInTheDocument()
    expect(screen.getByLabelText(/90% (of|di) 20/)).toBeInTheDocument()
  })
})

describe('ClientReportView empty-but-connected guidance', () => {
  const emptyReport: ClientReportSnapshot = {
    ...mockReport,
    sections: ['summary', 'site_health', 'backlinks'],
    data: {
      ...mockReport.data,
      meta: { builtAt: '2026-02-01T09:30:00Z' },
      site_health: { auditScore: 72, topIssues: [], auditedAt: '2026-01-10T15:31:55Z' },
      backlinks: { referringDomains: 0, new: 0, lost: null },
    },
  }

  it('hides never-analysed backlinks from the client and dates the audit score', () => {
    renderReport(emptyReport)
    // 0/0/null backlinks = Site Explorer never ran on the domain: no "no referring domains" note for the client
    expect(screen.queryByTestId('empty-state-note')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Referring domains$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/No referring domains|Nessun dominio referente/)).not.toBeInTheDocument()
    expect(screen.getByText(/Last audit: .*2026|Ultimo audit: .*2026/)).toBeInTheDocument()
  })
})

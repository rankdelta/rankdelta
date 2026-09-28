import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../common/i18n'
import { ReportHistoryBlock, ReportPeriodNavigator } from '../../components/agencyReport/ReportHistory'
import { ReportHistoryProvider } from '../../components/agencyReport/ReportHistoryContext'
import { ClientReportView } from '../../components/agencyReport/ClientReportView'
import { visibleWidgets, widgetDataState } from './widgetData'
import { layoutFromSections } from './layout'
import type { ReportHistoryPoint } from './history'
import type { ClientReportSnapshot } from './types'

beforeAll(async () => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  await i18n.changeLanguage('it')
})

afterAll(async () => {
  await i18n.changeLanguage('en')
})

function point(reportId: string, periodStart: string, periodEnd: string, v: Partial<ReportHistoryPoint>): ReportHistoryPoint {
  return {
    reportId,
    periodStart,
    periodEnd,
    aiSov: null,
    citationRate: null,
    gscClicks: null,
    gscImpressions: null,
    avgPosition: null,
    ga4Sessions: null,
    aiSessions: null,
    healthScore: null,
    referringDomains: null,
    ...v,
  }
}

const history: ReportHistoryPoint[] = [
  point('r-jul', '2026-06-16', '2026-07-15', { aiSov: 12.5, gscClicks: 800, ga4Sessions: 13000, avgPosition: 14.2, healthScore: 61 }),
  point('r-aug', '2026-07-16', '2026-08-15', { aiSov: 18, gscClicks: 950, ga4Sessions: 13400, avgPosition: 12.9, healthScore: 66 }),
  point('r-sep', '2026-08-16', '2026-09-15', { aiSov: 21.4, gscClicks: 1100, ga4Sessions: 13900, avgPosition: 11.1, healthScore: 72 }),
]

const withI18n = (ui: React.ReactElement) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)

// English that must never reach an Italian client report. Case-sensitive on purpose: the report
// keeps "Share of voice AI" / "share of voice" as Italian terms of art, but the app-UI labels
// "Share of Voice" / "Citation Rate" (resultsPage.*) and "Health score" (the Italian report says
// "Punteggio di salute del sito") are a leak.
const ENGLISH_LEAK_RE =
  /\b(Share of Voice|Citation Rate|[Hh]ealth score|Average position|SEO \+ GEO health|Generated (on|by)|Prior period|At a glance|Report by report|Trend across reports|this report|first reading|Executive (summary|briefing)|Next steps)\b/
const bodyText = (): string => document.body.textContent ?? ''

describe('ReportHistoryBlock (IT)', () => {
  it('renders the trend block with one row per report, comma decimals and the current report tagged', () => {
    withI18n(<ReportHistoryBlock history={history} currentReportId="r-sep" />)
    expect(screen.getByRole('heading', { name: 'Andamento nel tempo' })).toBeInTheDocument()
    // Report-specific label (agencyReport.shareOfVoice), not the app-UI "Share of Voice".
    expect(screen.getByText(/Share of voice AI: da 12,5% a 21,4% dal primo report \(16 giu – 15 lug 2026\); periodo migliore 16 ago – 15 set 2026\./)).toBeInTheDocument()
    const table = screen.getByTestId('history-table')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(4) // header + 3 reports
    expect(within(table).getByText('12,5%')).toBeInTheDocument()
    expect(within(table).getByText('#14,2')).toBeInTheDocument()
    // Italian groups thousands only from five digits (CLDR): 1100 stays as is, 13900 becomes 13.900.
    expect(within(table).getByText('1100')).toBeInTheDocument()
    expect(within(table).getByText('13.900')).toBeInTheDocument()
    expect(within(table).getByText('questo report')).toBeInTheDocument()
    expect(rows[3]).toHaveAttribute('data-current', 'true')
    // Movement chips vs the previous row: +3,4 pp share of voice on the last report.
    expect(within(rows[3]!).getByLabelText('+3,4')).toBeInTheDocument()
    // Chart families with data
    expect(screen.getByTestId('history-chart-sov')).toBeInTheDocument()
    expect(screen.getByTestId('history-chart-health')).toBeInTheDocument()
    expect(screen.getByText('Report per report')).toBeInTheDocument()
  })

  it('with one report renders nothing — no "trend" card that only says the history starts later', () => {
    const { container } = withI18n(<ReportHistoryBlock history={history.slice(0, 1)} currentReportId="r-jul" />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('report-history')).not.toBeInTheDocument()
    expect(screen.queryByText('Lo storico compare dal secondo report.')).not.toBeInTheDocument()
  })
})

describe('ReportHistoryBlock range selector (IT)', () => {
  const many: ReportHistoryPoint[] = Array.from({ length: 7 }, (_, i) =>
    point(`r-${i}`, `2026-0${i + 1}-01`, `2026-0${i + 1}-28`, { aiSov: 10 + i, gscClicks: 500 + i * 50 }),
  )

  it('offers 3/6/all when there are enough reports and trims the table client-side', () => {
    withI18n(<ReportHistoryBlock history={many} currentReportId="r-6" />)
    // Default = all: header + 7 rows.
    expect(within(screen.getByTestId('history-table')).getAllByRole('row')).toHaveLength(8)
    // Only trimming thresholds are offered (7 reports → 3 and 6, not 12), plus "all".
    expect(screen.getByRole('button', { name: 'Ultimi 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ultimi 6' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ultimi 12' })).not.toBeInTheDocument()
    // Focus the last 3: header + 3 rows.
    fireEvent.click(screen.getByRole('button', { name: 'Ultimi 3' }))
    expect(within(screen.getByTestId('history-table')).getAllByRole('row')).toHaveLength(4)
    // Back to all.
    fireEvent.click(screen.getByRole('button', { name: 'Tutto' }))
    expect(within(screen.getByTestId('history-table')).getAllByRole('row')).toHaveLength(8)
  })

  it('hides the selector when there are too few reports to trim', () => {
    withI18n(<ReportHistoryBlock history={history} currentReportId="r-sep" />)
    expect(screen.queryByRole('button', { name: 'Ultimi 3' })).not.toBeInTheDocument()
  })
})

describe('ReportPeriodNavigator (IT)', () => {
  it('links the previous and next report and exposes the compare switch', () => {
    const onNavigate = vi.fn()
    const onCompareChange = vi.fn()
    withI18n(
      <ReportPeriodNavigator history={history} currentReportId="r-aug" compareWithPrevious={false} onCompareChange={onCompareChange} onNavigate={onNavigate} />,
    )
    expect(screen.getByText('16 lug – 15 ago 2026')).toBeInTheDocument()
    expect(screen.getByText('· Report 2 di 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Report precedente' }))
    expect(onNavigate).toHaveBeenCalledWith('r-jul')
    fireEvent.click(screen.getByRole('button', { name: 'Report successivo' }))
    expect(onNavigate).toHaveBeenCalledWith('r-sep')
    fireEvent.click(screen.getByRole('switch', { name: 'Confronta con il report precedente' }))
    expect(onCompareChange).toHaveBeenCalledWith(true)
  })

  it('on the first report disables the previous button and the comparison', () => {
    withI18n(
      <ReportPeriodNavigator history={history} currentReportId="r-jul" compareWithPrevious onCompareChange={() => {}} onNavigate={() => {}} />,
    )
    expect(screen.getByRole('button', { name: 'Report precedente' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Report successivo' })).toBeEnabled()
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.getByText('· primo report: nessun confronto')).toBeInTheDocument()
  })

  it('with a single report shows the one-line note and nothing when history is unknown', () => {
    const { unmount } = withI18n(
      <ReportPeriodNavigator history={history.slice(2)} currentReportId="r-sep" compareWithPrevious={false} onCompareChange={() => {}} onNavigate={() => {}} />,
    )
    expect(screen.getByText('Lo storico compare dal secondo report.')).toBeInTheDocument()
    unmount()
    withI18n(<ReportPeriodNavigator history={null} currentReportId="r-sep" compareWithPrevious={false} onCompareChange={() => {}} onNavigate={() => {}} />)
    expect(screen.queryByTestId('report-period-navigator')).not.toBeInTheDocument()
  })
})

const snapshot: ClientReportSnapshot = {
  id: 'r-sep',
  project_id: 'p1',
  period_start: '2026-08-16',
  period_end: '2026-09-15',
  sections: ['summary'],
  data: {
    summary: {
      healthScore: { value: 72, delta: 6, deltaPct: 9.1 },
      // Snapshot compares against the prior period (20.0); the previous report read 18.0.
      aiSov: { value: 21.4, delta: 1.4, deltaPct: 7 },
      avgPosition: { value: 11.1, delta: -1.8, deltaPct: null },
      gscClicks: { value: 1100, delta: 150, deltaPct: 15.8 },
      ga4Sessions: { value: 13900, delta: null, deltaPct: null },
      ga4AiAssistantSessions: { value: null, delta: null, deltaPct: null },
      keyEvents: { value: null, delta: null, deltaPct: null },
    },
  },
  narrative: null,
  branding: null,
  goals: null,
  created_at: '2026-09-16T00:00:00Z',
}

describe('ClientReportView with report history', () => {
  it('renders the trend block after the briefing and re-bases the scorecard when comparing with the previous report', () => {
    withI18n(
      <ReportHistoryProvider value={{ history, compareWithPrevious: true }}>
        <ClientReportView report={snapshot} projectName="Bravalo" />
      </ReportHistoryProvider>,
    )
    const briefing = screen.getByTestId('executive-briefing')
    const block = screen.getByTestId('report-history')
    expect(briefing.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Share of voice: the previous report (18,0) differs from the snapshot prior (20,0) → chip shown.
    const chips = screen.getAllByTestId('scorecard-vs-report')
    expect(chips.length).toBeGreaterThanOrEqual(1)
    expect(chips.some((c) => within(c).queryByLabelText('+3,4') && within(c).queryByText('rispetto al report precedente'))).toBe(true)
    // Health: previous report 66, snapshot prior 66 → identical comparison, no second chip.
    expect(chips.some((c) => within(c).queryByLabelText('+6'))).toBe(false)
  })

  it('hides the block on a page that knows nothing about sibling reports', () => {
    withI18n(<ClientReportView report={snapshot} projectName="Bravalo" readOnly />)
    expect(screen.queryByTestId('report-history')).not.toBeInTheDocument()
    expect(screen.queryByTestId('scorecard-vs-report')).not.toBeInTheDocument()
  })

  it('uses the compact history stored in the snapshot when no rows were fetched', () => {
    const stored: ClientReportSnapshot = { ...snapshot, data: { ...snapshot.data, meta: { history: history.slice(0, 2) } } }
    withI18n(<ClientReportView report={stored} projectName="Bravalo" readOnly />)
    const table = screen.getByTestId('history-table')
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getByText('questo report')).toBeInTheDocument()
  })

  it('renders the whole report (KPI cards, history table, footer) without English labels', () => {
    const withCitations: Array<ReportHistoryPoint> = history.map((h, index) => ({ ...h, citationRate: 30 + index * 5 }))
    const stored: ClientReportSnapshot = {
      ...snapshot,
      sections: ['summary', 'geo'],
      data: {
        ...snapshot.data,
        geo: {
          sovOverall: { value: 21.4, delta: 1.4, deltaPct: 7 },
          sovByEngine: [{ engine: 'chatgpt', sovPercent: 21.4 }],
          trend: [],
          topPromptsMentioned: ['miglior software SEO'],
          topPromptsNotMentioned: [],
          competitorLeaderboard: [{ id: 'c1', name: 'Competitor Uno', mentions: 4 }],
          citationRate: { value: 40, delta: 5, deltaPct: 14.3 },
          topCitedSources: [],
        },
        meta: { history: withCitations },
      },
    }
    withI18n(<ClientReportView readOnly projectName="Bravalo" report={stored} />)
    const text = bodyText()
    const leak = text.match(ENGLISH_LEAK_RE)
    expect(leak, leak ? `English leak: "${leak[0]}" in …${text.slice(Math.max(0, (leak.index ?? 0) - 60), (leak.index ?? 0) + 60)}…` : '').toBeNull()
    // History table column + GEO KPI cards: the two AI KPIs must read Italian everywhere.
    const table = screen.getByTestId('history-table')
    expect(within(table).getByText('Share of voice AI')).toBeInTheDocument()
    expect(screen.getAllByText('Tasso di citazione').length).toBeGreaterThan(0)
  })
})

describe('report_history layout widget', () => {
  const layout = layoutFromSections(['summary', 'gsc'])
  const widget = layout.widgets.find((w) => w.type === 'report_history')!

  it('is part of the default layout right after the briefing', () => {
    expect(layout.widgets[0]?.type).toBe('executive_briefing')
    expect(widget).toBeDefined()
    expect(layout.widgets[1]?.id).toBe(widget.id)
  })

  it('is visible only from the second report on', () => {
    expect(widgetDataState(widget, snapshot)).toBe('empty')
    expect(widgetDataState(widget, snapshot, { history })).toBe('narrative')
    // The fetched history holds only the report on screen: one point, nothing to trend.
    expect(widgetDataState(widget, snapshot, { history: history.slice(2) })).toBe('empty')
    expect(visibleWidgets(layout.widgets, snapshot).some((w) => w.type === 'report_history')).toBe(false)
    expect(visibleWidgets(layout.widgets, snapshot, { history: history.slice(2) }).some((w) => w.type === 'report_history')).toBe(false)
    expect(visibleWidgets(layout.widgets, snapshot, { history }).some((w) => w.type === 'report_history')).toBe(true)
  })

  it('does not reach the client on a one-report project through either render path', () => {
    const one = history.slice(2)
    withI18n(
      <ReportHistoryProvider value={{ history: one, compareWithPrevious: false }}>
        <ClientReportView projectName="Bravalo" report={{ ...snapshot, layout }} />
      </ReportHistoryProvider>,
    )
    expect(screen.queryByTestId('report-history')).not.toBeInTheDocument()
    expect(screen.queryByText('Lo storico compare dal secondo report.')).not.toBeInTheDocument()
    cleanup()
    withI18n(
      <ReportHistoryProvider value={{ history: one, compareWithPrevious: false }}>
        <ClientReportView projectName="Bravalo" report={{ ...snapshot, layout: null }} />
      </ReportHistoryProvider>,
    )
    expect(screen.queryByTestId('report-history')).not.toBeInTheDocument()
    cleanup()
    // First scheduled/built report: the snapshot stores an empty previous-reports history.
    withI18n(<ClientReportView readOnly projectName="Bravalo" report={{ ...snapshot, data: { ...snapshot.data, meta: { history: [] } } }} />)
    expect(screen.queryByTestId('report-history')).not.toBeInTheDocument()
  })
})

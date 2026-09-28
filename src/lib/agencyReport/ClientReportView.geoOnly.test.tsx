/**
 * Regression for a GEO-only report (fictional "Harborstay"):
 * an "AI attribution" bar chart with raw engine ids and no visits, a "No referring domains found"
 * note for a domain never analysed, a bare "86" for site health with the audit's issues hidden.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../common/i18n'
import { ClientReportView } from '../../components/agencyReport/ClientReportView'
import { layoutFromSections } from './layout'
import { disconnectedSections } from './widgetData'
import type { ClientReportSnapshot } from './types'

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const metric = (value: number | null) => ({ value, delta: null, deltaPct: null })

// Layout saved by the builder before the issues table existed (all 8 sections requested).
const legacyLayout = layoutFromSections(['summary', 'geo', 'ai_attribution', 'rankings', 'gsc', 'ga4', 'site_health', 'backlinks'])
legacyLayout.widgets = legacyLayout.widgets.filter((w) => !(w.binding.section === 'site_health' && w.binding.metric === 'topIssues'))

const harborstay: ClientReportSnapshot = {
  id: 'rpt-geo-1',
  project_id: 'p1',
  period_start: '2026-08-23',
  period_end: '2026-09-21',
  // The build strips disconnected sections from `sections` — only these five survived.
  sections: ['summary', 'geo', 'ai_attribution', 'site_health', 'backlinks'],
  layout: legacyLayout,
  data: {
    summary: {
      healthScore: metric(86),
      aiSov: metric(27.4),
      avgPosition: metric(null),
      gscClicks: metric(null),
      ga4Sessions: metric(null),
      ga4AiAssistantSessions: metric(null),
      keyEvents: metric(null),
    },
    geo: {
      sovOverall: metric(27.4),
      citationRate: metric(0),
      sovByEngine: [
        { engine: 'perplexity', sovPercent: 29.5 },
        { engine: 'chatgpt', sovPercent: 24.8 },
      ],
      trend: [],
      competitorLeaderboard: [
        { name: 'Staynest', mentions: 9 },
        { name: 'Casalibera', mentions: 0 },
      ],
      topPromptsMentioned: ['Harborstay vs Staynest'],
      topPromptsNotMentioned: ['migliori software per gestire case vacanza'],
      promptsTracked: 19,
      promptsMentioned: 9,
      topCitedSources: [],
    } as unknown as ClientReportSnapshot['data']['geo'],
    ai_attribution: {
      byEngine: [
        { engine: 'chatgpt', sovPercent: 24.8, aiAssistantSessions: 0, keyEvents: 0, conversionRate: null },
        { engine: 'google_aio', sovPercent: null, aiAssistantSessions: 0, keyEvents: 0, conversionRate: null },
        { engine: 'perplexity', sovPercent: 29.5, aiAssistantSessions: 0, keyEvents: 0, conversionRate: null },
      ],
      topAiReferredLandingPages: [],
    },
    site_health: {
      auditScore: 86,
      auditedAt: '2026-09-15T09:00:00.000+00:00',
      topIssues: [
        { code: 'low_content_rate', label: 'Poco testo rispetto al codice', why: 'Contenuto sottile: poco materiale citabile dall’AI.', count: 4, severity: 'warning', dimension: 'geo' },
        { code: 'canonical', label: 'Canonical assente su alcune pagine', why: 'Aiuta a consolidare i segnali.', count: 5, severity: 'opportunity', dimension: 'seo' },
      ],
    },
    backlinks: { referringDomains: 0, new: 0, lost: null },
  },
  narrative: { executiveSummary: 'Harborstay holds a 27.4% share of voice.', sections: {}, nextActions: ['Expand the thin pages.'] },
  branding: { agencyName: 'Northwind Agency', logoUrl: null, primaryColor: '#7c3aed', hideAstroSeoFooter: true, enabled: true },
  goals: null,
  created_at: '2026-09-21T13:00:00Z',
}

function renderAs(role: 'client') {
  return render(
    <I18nextProvider i18n={i18n}>
      <ClientReportView report={harborstay} projectName="Harborstay" websiteUrl="https://harborstay.example" isAgency readOnly={role === 'client'} />
    </I18nextProvider>,
  )
}

describe('GEO-only report as the client sees it', () => {
  it('does not show an attribution chart that would only repeat share of voice (no GA4)', () => {
    renderAs('client')
    expect(screen.queryByText(/^AI attribution$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/google_aio/)).not.toBeInTheDocument()
  })

  it('says nothing about backlinks when the domain was never analysed', () => {
    renderAs('client')
    expect(screen.queryByText(/referring domains/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Backlinks$/)).not.toBeInTheDocument()
  })

  it('shows the audit issues under the health score, even on a layout saved before the table existed', () => {
    renderAs('client')
    expect(screen.getByText('Poco testo rispetto al codice')).toBeInTheDocument()
    expect(screen.getByText('Canonical assente su alcune pagine')).toBeInTheDocument()
    expect(screen.getByText(/Opportunity|Opportunità/)).toBeInTheDocument()
  })

  it('labels competitors never mentioned instead of listing a bare name', () => {
    renderAs('client')
    expect(screen.getByText(/Casalibera \((not mentioned yet|mai menzionato)\)/)).toBeInTheDocument()
  })

  it('dates the health score with its audit; the cover keeps "this period" when the audit is in it', () => {
    renderAs('client')
    expect(screen.getByText(/Last audit: Sep 15, 2026|Ultimo audit/)).toBeInTheDocument()
    expect(screen.getByText(/Health score 86 this period\.|nel periodo/)).toBeInTheDocument()
  })

  it('never calls an audit from before the period "this period"', () => {
    const staleHealth = { ...(harborstay.data.site_health as object), auditedAt: '2026-06-30T09:00:00.000+00:00' }
    const stale = { ...harborstay, data: { ...harborstay.data, site_health: staleHealth } } as ClientReportSnapshot
    render(
      <I18nextProvider i18n={i18n}>
        <ClientReportView report={stale} projectName="Harborstay" websiteUrl="https://harborstay.example" isAgency readOnly />
      </I18nextProvider>,
    )
    expect(screen.getByText(/Health score 86 \(site audit of Jun 30, 2026\)\.|audit del/)).toBeInTheDocument()
    expect(screen.queryByText(/Health score 86 this period/)).not.toBeInTheDocument()
  })

  it('puts the written summary right after the briefing, before the charts', () => {
    renderAs('client')
    const summary = screen.getByText('Harborstay holds a 27.4% share of voice.')
    const hero = screen.getByTestId('ai-visibility-hero')
    expect(summary.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('tells the owner which requested sources are missing (rankings, GSC, GA4, backlinks)', () => {
    // `sections` was stripped to the five that built; the saved layout still says what was wanted.
    expect(disconnectedSections(harborstay)).toEqual(['rankings', 'gsc', 'ga4', 'backlinks'])
  })
})

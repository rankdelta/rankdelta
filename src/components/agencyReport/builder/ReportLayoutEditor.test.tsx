import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../common/i18n'
import { ReportLayoutEditor } from './ReportLayoutEditor'
import { layoutFromSections } from '../../../lib/agencyReport/layout'
import type { ClientReportSnapshot } from '../../../lib/agencyReport/types'

const mockReport: ClientReportSnapshot = {
  id: 'r1',
  project_id: 'p1',
  period_start: '2026-01-01',
  period_end: '2026-01-31',
  sections: ['summary', 'gsc', 'geo'],
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
  },
  narrative: { executiveSummary: 'Test summary', sections: {}, nextActions: ['Action 1'] },
  branding: null,
  goals: null,
  created_at: '2026-02-01T00:00:00Z',
}

describe('ReportLayoutEditor', () => {
  it('renders canvas, templates, and widget palette', () => {
    const layout = layoutFromSections(['summary', 'gsc'])
    const onChange = vi.fn()

    render(
      <I18nextProvider i18n={i18n}>
        <ReportLayoutEditor
          layout={layout}
          onChange={onChange}
          enabledSections={['summary', 'gsc']}
          previewReport={mockReport}
          savedTemplates={[]}
        />
      </I18nextProvider>,
    )

    expect(screen.getByText(/Report canvas|Canvas report/i)).toBeInTheDocument()
    expect(screen.getByText(/Full report|Report completo/i)).toBeInTheDocument()
    expect(screen.getByText(/Executive dashboard|Dashboard executive/i)).toBeInTheDocument()
    expect(screen.getByText(/Add widgets|Aggiungi widget/i)).toBeInTheDocument()
    expect(layout.widgets.length).toBeGreaterThan(0)
  })

  it('applies executive template when clicked', () => {
    const layout = layoutFromSections(['summary'])
    const onChange = vi.fn()

    render(
      <I18nextProvider i18n={i18n}>
        <ReportLayoutEditor layout={layout} onChange={onChange} enabledSections={['summary', 'geo']} previewReport={mockReport} />
      </I18nextProvider>,
    )

    fireEvent.click(screen.getByText(/Executive dashboard|Dashboard executive/i))
    fireEvent.click(screen.getByText(/Replace layout|Sostituisci layout/i))
    expect(onChange).toHaveBeenCalled()
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]
    const nextLayout = lastCall?.[0]
    expect(nextLayout?.widgets.length).toBeGreaterThan(0)
  })

  it('shows edit and preview mode toggles', () => {
    const layout = layoutFromSections(['summary'])
    render(
      <I18nextProvider i18n={i18n}>
        <ReportLayoutEditor layout={layout} onChange={vi.fn()} enabledSections={['summary']} previewReport={mockReport} />
      </I18nextProvider>,
    )
    expect(screen.getByText(/^Preview$|^Anteprima$/i)).toBeInTheDocument()
    expect(screen.getByText(/^Edit$|^Modifica$/i)).toBeInTheDocument()
  })
})

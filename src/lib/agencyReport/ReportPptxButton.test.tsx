import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../common/i18n'
import { ReportPptxButton, reportHasDeckData } from '../../components/agencyReport/ReportPptxButton'
import type { ClientReportSnapshot } from './types'

const buildReportDeck = vi.fn(async () => new Blob(['pptx'], { type: 'application/octet-stream' }))
vi.mock('../../lib/agencyReport/pptxExport', () => ({
  buildReportDeck: (...args: unknown[]) => buildReportDeck(...(args as [])),
  buildReportDeckFilename: (client: string, start: string, end: string) => `${client}-${start}_${end}-rankdelta.pptx`,
}))
const showGlobalToast = vi.fn()
vi.mock('../../components/ui/GlobalToast', () => ({ showGlobalToast: (...args: unknown[]) => showGlobalToast(...args) }))

const report: ClientReportSnapshot = {
  id: 'r1',
  project_id: 'p1',
  period_start: '2026-08-01',
  period_end: '2026-08-28',
  sections: ['summary', 'gsc'],
  data: { summary: { healthScore: { value: 74, delta: null, deltaPct: null } } as never },
  narrative: null,
  branding: null,
  goals: null,
  created_at: '2026-08-29T08:00:00Z',
  project_name: 'Acme CRM',
}

function renderButton(lang: 'en' | 'it') {
  i18n.changeLanguage(lang)
  return render(
    <I18nextProvider i18n={i18n}>
      <ReportPptxButton report={report} clientName="Acme CRM" />
    </I18nextProvider>,
  )
}

describe('reportHasDeckData', () => {
  it('is true with a summary value or any connected section, false otherwise', () => {
    expect(reportHasDeckData(report)).toBe(true)
    expect(reportHasDeckData({ data: { gsc: { data: null, reason: 'not_connected' } } as never })).toBe(false)
    expect(reportHasDeckData({ data: { gsc: { clicks: { value: 3, delta: null, deltaPct: null } } } as never })).toBe(true)
    expect(reportHasDeckData({ data: {} as never })).toBe(false)
  })
})

describe('ReportPptxButton', () => {
  beforeEach(() => {
    buildReportDeck.mockClear()
    showGlobalToast.mockClear()
    URL.createObjectURL = vi.fn(() => 'blob:deck')
    URL.revokeObjectURL = vi.fn()
    HTMLAnchorElement.prototype.click = vi.fn()
  })

  it('speaks the UI language', () => {
    renderButton('it')
    expect(screen.getByRole('button', { name: /Esporta presentazione/ })).toBeInTheDocument()
  })

  it('lazy-builds the deck for the report locale and downloads it under the report file name', async () => {
    renderButton('en')
    screen.getByRole('button', { name: /Export deck/ }).click()
    await waitFor(() => expect(buildReportDeck).toHaveBeenCalledTimes(1))
    const [input] = buildReportDeck.mock.calls[0] as unknown as [{ locale: string; projectName: string; period: { start: string } }]
    expect(input.locale).toBe('en-US')
    expect(input.projectName).toBe('Acme CRM')
    expect(input.period.start).toBe('2026-08-01')
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled())
    expect(showGlobalToast).not.toHaveBeenCalled()
  })

  it('shows an error toast when the build fails', async () => {
    buildReportDeck.mockRejectedValueOnce(new Error('boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderButton('en')
    screen.getByRole('button', { name: /Export deck/ }).click()
    await waitFor(() => expect(showGlobalToast).toHaveBeenCalledWith(expect.stringMatching(/couldn't be prepared/), 'error'))
    spy.mockRestore()
  })
})

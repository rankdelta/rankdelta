import { describe, it, expect, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../common/i18n'
import type { ClientReportRow } from '../../../services/reportBuild'
import { ReportBuildSuccessBanner } from './ReportBuildSuccessBanner'

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

const report: ClientReportRow = {
  id: 'r1',
  project_id: 'p1',
  period_start: '2026-08-23',
  period_end: '2026-09-21',
  sections: ['summary', 'geo'],
  share_token: null,
  created_at: '2026-09-21T13:00:00Z',
}

const renderBanner = (onSetUpWeeklyDelivery: (() => void) | null | undefined): ReturnType<typeof render> =>
  render(
    <I18nextProvider i18n={i18n}>
      <ReportBuildSuccessBanner report={report} onDismiss={() => {}} onSetUpWeeklyDelivery={onSetUpWeeklyDelivery} onView={() => {}} />
    </I18nextProvider>,
  )

describe('ReportBuildSuccessBanner — weekly delivery nudge', () => {
  it('offers automatic weekly delivery and hands the click to the page', () => {
    const onSetUp = vi.fn()
    renderBanner(onSetUp)
    const nudge = screen.getByTestId('schedule-nudge')
    expect(nudge).toHaveTextContent('Send this client a fresh report every week — set up automatic delivery.')
    fireEvent.click(screen.getByRole('button', { name: 'Set up weekly delivery' }))
    expect(onSetUp).toHaveBeenCalledTimes(1)
  })

  it('shows nothing when the page passes no handler (not entitled, or a schedule already exists)', () => {
    renderBanner(null)
    expect(screen.queryByTestId('schedule-nudge')).not.toBeInTheDocument()
    expect(screen.queryByText(/automatic delivery/)).not.toBeInTheDocument()
    cleanup()
    renderBanner(undefined)
    expect(screen.queryByTestId('schedule-nudge')).not.toBeInTheDocument()
    // The rest of the banner is untouched.
    expect(screen.getByTestId('report-build-success')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open report' })).toBeInTheDocument()
  })

  it('reads Italian on an Italian workspace', async () => {
    await i18n.changeLanguage('it')
    renderBanner(vi.fn())
    expect(screen.getByTestId('schedule-nudge')).toHaveTextContent("Manda a questo cliente un report aggiornato ogni settimana — programma l'invio automatico.")
    expect(screen.getByRole('button', { name: "Programma l'invio settimanale" })).toBeInTheDocument()
  })
})

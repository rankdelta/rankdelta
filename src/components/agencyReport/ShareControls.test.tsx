import { describe, expect, it, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../common/i18n'

const reshareReport = vi.fn<(reportId: string) => Promise<string>>()
const revokeReportShare = vi.fn<(reportId: string) => Promise<void>>()
vi.mock('../../services/reportBuild', () => ({
  reshareReport: (reportId: string) => reshareReport(reportId),
  revokeReportShare: (reportId: string) => revokeReportShare(reportId),
}))

import { ShareControls } from './ShareControls'

const renderControls = (shareToken: string | null, onRevoked = vi.fn()) => {
  render(
    <I18nextProvider i18n={i18n}>
      <ShareControls reportId="r1" shareToken={shareToken} isAgency onRevoked={onRevoked} />
    </I18nextProvider>,
  )
  return onRevoked
}

describe('ShareControls', () => {
  beforeEach(() => {
    reshareReport.mockReset()
    revokeReportShare.mockReset()
  })

  it('after a revoke, says the link is disabled and creates a new one', async () => {
    reshareReport.mockResolvedValue('b'.repeat(48))
    const onRevoked = renderControls(null)
    expect(screen.getByText(/client link of this report is disabled/i)).toBeInTheDocument()
    expect(screen.queryByText(/On the Agency plan/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Create a new link/i }))
    await waitFor(() => expect(onRevoked).toHaveBeenCalled())
    expect(reshareReport).toHaveBeenCalledWith('r1')
  })

  it('shows an error when the new link cannot be created', async () => {
    reshareReport.mockRejectedValue(new Error('plan_required'))
    const onRevoked = renderControls(null)
    fireEvent.click(screen.getByRole('button', { name: /Create a new link/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be created/i)
    expect(onRevoked).not.toHaveBeenCalled()
  })

  it('with a link: copy and disable, no create button', () => {
    renderControls('a'.repeat(48))
    expect(screen.getByRole('button', { name: /Disable link/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create a new link/i })).not.toBeInTheDocument()
  })
})

import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../common/i18n'
import { ReportBuildProgress } from './ReportBuildProgress'

vi.mock('../../../hooks/useRotatingBuildStatus', () => ({
  useRotatingBuildStatus: () => 'Assembling GEO, GSC, GA4 & rankings…',
}))

describe('ReportBuildProgress', () => {
  it('renders nothing when inactive', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <ReportBuildProgress active={false} />
      </I18nextProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows rotating status and timing note when active', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ReportBuildProgress active />
      </I18nextProvider>,
    )
    expect(screen.getByTestId('report-build-progress')).toBeInTheDocument()
    expect(screen.getByText(/Assembling GEO, GSC, GA4 & rankings/i)).toBeInTheDocument()
    expect(screen.getByText(/under a minute|meno di un minuto/i)).toBeInTheDocument()
  })
})

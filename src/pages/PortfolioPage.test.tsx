import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../common/i18n'
import { PortfolioPage } from './PortfolioPage'
import { useSubscription } from '../hooks/useSubscription'

vi.mock('../hooks/useSubscription', () => ({
  useSubscription: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false, error: null }),
}))

vi.mock('../components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}))

vi.mock('../components/subscription/UpgradeModal', () => ({
  useUpgradeModal: () => ({
    openForLockedFeature: vi.fn(),
    UpgradeModal: () => null,
  }),
}))

describe('PortfolioPage plan gating', () => {
  beforeEach(() => {
    vi.mocked(useSubscription).mockReturnValue({
      subscription: { plan: 'pro' } as never,
      currentPlan: null,
      isLoading: false,
    } as never)
  })

  it('shows an in-app Agency upsell card for non-Agency users', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <PortfolioPage />
      </I18nextProvider>,
    )

    expect(screen.getByText(/Portfolio (rollup|overview) is available on the Agency plan/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Upgrade to Agency/i })).toBeInTheDocument()
  })

  it('renders the portfolio table shell for Agency users', () => {
    vi.mocked(useSubscription).mockReturnValue({
      subscription: { plan: 'agency' } as never,
      currentPlan: null,
      isLoading: false,
    } as never)

    render(
      <I18nextProvider i18n={i18n}>
        <PortfolioPage />
      </I18nextProvider>,
    )

    expect(screen.queryByRole('button', { name: /Upgrade to Agency/i })).not.toBeInTheDocument()
    expect(screen.getByText(/No (projects|clients) yet/i)).toBeInTheDocument()
  })
})

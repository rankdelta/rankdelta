import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../common/i18n'
import { savePendingCheck } from '../../lib/pendingCheck'
import { installMemoryLocalStorage } from '../../test-utils/memoryStorage'

vi.mock('../../hooks/useAuth', (): { useAuth: () => { signUp: () => void; signIn: () => void; isSigningUp: boolean } } => ({
  useAuth: () => ({ signUp: vi.fn(), signIn: vi.fn(), isSigningUp: false }),
}))
vi.mock('@tanstack/react-router', (): { useNavigate: () => () => void } => ({
  useNavigate: () => vi.fn(),
}))
vi.mock('../ui/LanguageSwitcher', (): { LanguageSwitcher: () => null } => ({ LanguageSwitcher: () => null }))

import { SignupForm } from './SignupForm'

function renderForm(): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={i18n}>
      <SignupForm />
    </I18nextProvider>,
  )
}

describe('SignupForm — free-check email prefill', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('prefills the email from a pending free check', async () => {
    savePendingCheck({ domain: 'acme.com', email: 'jane@acme.com', lang: 'en', level: 'absent' })
    renderForm()
    const email = await screen.findByLabelText(/e-?mail/i)
    expect(email).toHaveValue('jane@acme.com')
  })

  it('leaves the email empty when there is no pending check', async () => {
    renderForm()
    const email = await screen.findByLabelText(/e-?mail/i)
    expect(email).toHaveValue('')
  })
})

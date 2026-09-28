import { describe, it, expect, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../common/i18n'
import { ScheduleTestSendError } from '../../../services/reportSchedules'
import { ScheduleTestSendButton } from './ScheduleTestSendButton'

vi.mock('../../../lib/supabaseClient', () => ({ supabase: {} }))

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

const renderButton = (send: (id: string) => Promise<{ subject: string; sentTo: string }>): ReturnType<typeof render> =>
  render(
    <I18nextProvider i18n={i18n}>
      <ScheduleTestSendButton scheduleId="sch-1" send={send} />
    </I18nextProvider>,
  )

describe('ScheduleTestSendButton', () => {
  it('calls the dry run for its schedule and shows the subject plus "sent to you@…"', async () => {
    const send = vi.fn().mockResolvedValue({ subject: 'Acme · SEO & AI visibility report · Aug 1 – Aug 28, 2026', sentTo: 'owner@agency.com' })
    renderButton(send)
    fireEvent.click(screen.getByRole('button', { name: /Send me a test/ }))
    expect(send).toHaveBeenCalledWith('sch-1')
    expect(screen.getByRole('button')).toBeDisabled()
    const result = await screen.findByTestId('schedule-test-send-result')
    expect(result).toHaveTextContent('Test sent to owner@agency.com')
    expect(result).toHaveTextContent('Subject: Acme · SEO & AI visibility report · Aug 1 – Aug 28, 2026')
    expect(result).toHaveTextContent('The recipients above did not receive it.')
    expect(screen.getByRole('button', { name: /Send me a test/ })).toBeEnabled()
  })

  it('tells the owner to build a report first when the project has none', async () => {
    renderButton(vi.fn().mockRejectedValue(new ScheduleTestSendError('no_report')))
    fireEvent.click(screen.getByRole('button'))
    const error = await screen.findByTestId('schedule-test-send-error')
    expect(error).toHaveTextContent('Build a report for this client first')
    expect(screen.queryByTestId('schedule-test-send-result')).not.toBeInTheDocument()
  })

  it('maps unknown failures to a generic retry message and recovers on the next click', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ subject: 'S', sentTo: 'owner@agency.com' })
    renderButton(send)
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByTestId('schedule-test-send-error')).toHaveTextContent('could not be sent')
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByTestId('schedule-test-send-result')).toBeInTheDocument())
    expect(screen.queryByTestId('schedule-test-send-error')).not.toBeInTheDocument()
  })

  it('reads Italian on an Italian workspace', async () => {
    await i18n.changeLanguage('it')
    renderButton(vi.fn().mockResolvedValue({ subject: 'Acme · Report SEO e visibilità AI · 1 – 28 ago 2026', sentTo: 'owner@agency.com' }))
    fireEvent.click(screen.getByRole('button', { name: /Inviami una prova/ }))
    const result = await screen.findByTestId('schedule-test-send-result')
    expect(result).toHaveTextContent('Prova inviata a owner@agency.com')
    expect(result).toHaveTextContent('Oggetto: Acme · Report SEO e visibilità AI · 1 – 28 ago 2026')
  })
})

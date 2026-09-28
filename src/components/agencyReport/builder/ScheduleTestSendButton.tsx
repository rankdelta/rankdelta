import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PaperAirplaneIcon } from '@heroicons/react/24/outline'
import { ScheduleTestSendError, sendReportScheduleTest, type ScheduleTestSendResult } from '../../../services/reportSchedules'

interface ScheduleTestSendButtonProps {
  scheduleId: string
  /** Test seam: the service call (defaults to the runner's dry run). */
  send?: (scheduleId: string) => Promise<ScheduleTestSendResult>
}

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; result: ScheduleTestSendResult }
  | { kind: 'error'; code: ScheduleTestSendError['code'] }

/** Only two failures have something useful to tell the owner; the rest read as "try again". */
function errorKey(code: ScheduleTestSendError['code']): string {
  if (code === 'no_report') return 'agencyReport.schedule.testNoReport'
  if (code === 'email_not_configured') return 'agencyReport.schedule.testEmailNotConfigured'
  return 'agencyReport.schedule.testFailed'
}

/**
 * "Send me a test" on a schedule row: asks the runner for a dry run of that schedule and shows the
 * subject the client would see plus "sent to you@…". The schedule's recipients never receive it.
 */
export function ScheduleTestSendButton({ scheduleId, send = sendReportScheduleTest }: ScheduleTestSendButtonProps): React.JSX.Element {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ kind: 'idle' })

  const run = async (): Promise<void> => {
    setState({ kind: 'sending' })
    try {
      const result = await send(scheduleId)
      setState({ kind: 'sent', result })
    } catch (error) {
      setState({ kind: 'error', code: error instanceof ScheduleTestSendError ? error.code : 'send_failed' })
    }
  }

  return (
    <div className="flex flex-col items-end gap-1" data-testid="schedule-test-send">
      <button
        className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={state.kind === 'sending'}
        type="button"
        onClick={() => void run()}
      >
        <PaperAirplaneIcon aria-hidden className="h-3.5 w-3.5" />
        {state.kind === 'sending' ? t('agencyReport.schedule.testSending') : t('agencyReport.schedule.testSend')}
      </button>
      {state.kind === 'sent' && (
        <p className="max-w-xs text-right text-xs text-emerald-300/90" data-testid="schedule-test-send-result" role="status">
          <span className="font-medium">{t('agencyReport.schedule.testSent', { email: state.result.sentTo })}</span>
          <span className="block text-white/60">{t('agencyReport.schedule.testSentSubject', { subject: state.result.subject })}</span>
          <span className="block text-white/45">{t('agencyReport.schedule.testSentHint')}</span>
        </p>
      )}
      {state.kind === 'error' && (
        <p className="max-w-xs text-right text-xs text-amber-300/90" data-testid="schedule-test-send-error" role="alert">
          {t(errorKey(state.code))}
        </p>
      )}
    </div>
  )
}

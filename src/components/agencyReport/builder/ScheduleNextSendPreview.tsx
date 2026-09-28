import { useTranslation } from 'react-i18next'
import { formatSendDate, nextSendDate, type ReportCadence } from '../../../lib/agencyReport/schedule'

interface ScheduleNextSendPreviewProps {
  cadence: ReportCadence
  dayOfWeek: number
  dayOfMonth: number
  /** Test seam: "today" as UTC ymd. */
  asOf?: string
}

/**
 * "First send: Monday 28 September · then every week…" under the schedule form, so the owner sees
 * the date the client will actually receive the first report before saving the schedule.
 */
export function ScheduleNextSendPreview({ cadence, dayOfWeek, dayOfMonth, asOf }: ScheduleNextSendPreviewProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith('it') ? 'it-IT' : 'en-US'
  const next = nextSendDate(
    { cadence, dayOfWeek: cadence === 'weekly' ? dayOfWeek : null, dayOfMonth: cadence === 'monthly' ? dayOfMonth : null, lastRunAt: null },
    asOf,
  )
  if (!next) return null
  return (
    <p className="text-xs text-white/60" data-testid="schedule-next-send-preview">
      <span className="text-white/45">{t('agencyReport.schedule.firstSend')}: </span>
      <span className="font-medium text-white/85">
        {formatSendDate(next, locale, { today: t('agencyReport.schedule.today'), tomorrow: t('agencyReport.schedule.tomorrow') }, asOf)}
      </span>
      <span className="text-white/45"> · {t('agencyReport.schedule.firstSendHint')}</span>
    </p>
  )
}

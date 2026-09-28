import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { CalendarDaysIcon, CheckCircleIcon, LinkIcon } from '@heroicons/react/24/outline'
import type { ClientReportRow } from '../../../services/reportBuild'
import { fmtPeriodRange } from '../../../lib/agencyReport/reportUi'

interface ReportBuildSuccessBannerProps {
  report: ClientReportRow
  onView: () => void
  onDismiss: () => void
  /**
   * "Send this client a fresh report every week" — offered right after the build, the moment the
   * owner sees the value. The page passes it only when the account can schedule and the project
   * has no active schedule yet; null/undefined shows nothing (no upsell here).
   */
  onSetUpWeeklyDelivery?: (() => void) | null
}

export function ReportBuildSuccessBanner({ report, onView, onDismiss, onSetUpWeeklyDelivery }: ReportBuildSuccessBannerProps) {
  const { t, i18n } = useTranslation()
  const [copied, setCopied] = useState(false)

  const shareUrl = report.share_token ? `${window.location.origin}/r/${report.share_token}` : null

  const copyShare = async () => {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-violet-500/5 p-5 sm:p-6"
      data-testid="report-build-success"
    >
      <div className="flex flex-wrap items-start gap-4">
        <CheckCircleIcon className="h-8 w-8 shrink-0 text-emerald-400" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-lg font-semibold text-white">{t('agencyReport.builder.buildSuccess.title')}</h2>
          <p className="text-sm text-white/70">
            {fmtPeriodRange(report.period_start, report.period_end, i18n.language.startsWith('it') ? 'it-IT' : 'en-US')}
          </p>
          <p className="text-sm text-emerald-200/90">{t('agencyReport.builder.buildSuccess.savedToRecent')}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onView}
          className="inline-flex items-center justify-center rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          {t('agencyReport.builder.buildSuccess.viewReport')}
        </button>
        {shareUrl && (
          <button
            type="button"
            onClick={() => void copyShare()}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-white/90 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <LinkIcon className="h-4 w-4" aria-hidden />
            {copied ? t('agencyReport.linkCopied') : t('agencyReport.copyShareLink')}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm text-white/60 hover:text-white/90"
        >
          {t('agencyReport.builder.buildSuccess.buildAnother')}
        </button>
      </div>

      {onSetUpWeeklyDelivery && (
        <div
          className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-500/25 bg-violet-500/[0.08] px-4 py-3"
          data-testid="schedule-nudge"
        >
          <p className="flex min-w-0 items-center gap-2 text-sm text-white/85">
            <CalendarDaysIcon aria-hidden className="h-5 w-5 shrink-0 text-violet-300" />
            <span>{t('agencyReport.builder.buildSuccess.scheduleNudge')}</span>
          </p>
          <button
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-violet-400/40 bg-violet-500/20 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            type="button"
            onClick={onSetUpWeeklyDelivery}
          >
            {t('agencyReport.builder.buildSuccess.scheduleNudgeCta')}
          </button>
        </div>
      )}
    </motion.div>
  )
}

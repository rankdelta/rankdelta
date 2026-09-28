import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowTopRightOnSquareIcon, LinkIcon } from '@heroicons/react/24/outline'
import type { ClientReportRow } from '../../../services/reportBuild'
import { fmtPeriodRange, fmtRelativeTime } from '../../../lib/agencyReport/reportUi'
import { missingSectionsFromRow } from '../../../lib/agencyReport/widgetData'

interface RecentReportsListProps {
  reports: ClientReportRow[]
  highlightId?: string | null
  onOpen: (report: ClientReportRow) => void
}

/**
 * Report history rows: human period, when it was built, what it contains — and, for the owner,
 * which requested sources did not make it into that build — share status, quick actions.
 */
export function RecentReportsList({ reports, highlightId, onOpen }: RecentReportsListProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith('it') ? 'it-IT' : 'en-US'
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyLink = async (report: ClientReportRow) => {
    if (!report.share_token) return
    await navigator.clipboard.writeText(`${window.location.origin}/r/${report.share_token}`)
    setCopiedId(report.id)
    window.setTimeout(() => setCopiedId((cur) => (cur === report.id ? null : cur)), 2000)
  }

  return (
    <ul className="space-y-2" data-testid="recent-reports-list">
      {reports.map((r) => {
        const highlighted = highlightId === r.id
        const sectionCount = r.sections?.length ?? 0
        const missing = missingSectionsFromRow(r)
        return (
          <li
            key={r.id}
            className={`group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 transition-colors ${
              highlighted
                ? 'border-emerald-500/40 bg-emerald-500/10 ring-1 ring-emerald-500/30'
                : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
            }`}
          >
            <button
              type="button"
              onClick={() => onOpen(r)}
              className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
            >
              <span className="block text-sm font-medium text-white">{fmtPeriodRange(r.period_start, r.period_end, locale)}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-white/50">
                <span>{t('agencyReport.builder.builtAgo', { when: fmtRelativeTime(r.created_at, locale) })}</span>
                <span aria-hidden>·</span>
                <span>{t('agencyReport.builder.sectionsCount', { count: sectionCount })}</span>
              </span>
              {missing.length > 0 && (
                <span className="mt-0.5 block text-[11px] text-white/35" data-testid="recent-report-missing">
                  {t('agencyReport.builder.missingSources', { list: missing.map((key) => t(`agencyReport.sections.${key}`)).join(', ') })}
                </span>
              )}
            </button>

            <div className="flex shrink-0 items-center gap-2">
              {r.share_token ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                  {t('agencyReport.shared')}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-white/45">
                  {t('agencyReport.builder.privateReport')}
                </span>
              )}
              {r.share_token && (
                <button
                  type="button"
                  onClick={() => void copyLink(r)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-xs text-white/75 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                  aria-label={t('agencyReport.copyShareLink')}
                >
                  <LinkIcon className="h-3.5 w-3.5" aria-hidden />
                  {copiedId === r.id ? t('agencyReport.linkCopied') : t('agencyReport.copyShareLink')}
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpen(r)}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                {t('agencyReport.builder.buildSuccess.viewReport')}
                <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

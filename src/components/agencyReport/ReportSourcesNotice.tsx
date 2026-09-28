import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRightIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import type { ClientReportSnapshot } from '../../lib/agencyReport/types'
import type { SectionKey } from '../../lib/agencyReport/sections'
import { SECTION_CONNECT_KEYS } from '../../lib/agencyReport/reportUi'
import { disconnectedSections } from '../../lib/agencyReport/widgetData'
import { SECTION_ICONS } from './reportPrimitives'

/** Where in the app each data source gets connected. */
export function connectRouteForSection(section: SectionKey, projectId: string): string {
  switch (section) {
    case 'geo':
    case 'ai_attribution':
      return `/visibility/${projectId}/`
    case 'rankings':
    case 'gsc':
    case 'ga4':
      return `/rankings/${projectId}`
    case 'site_health':
      return '/audit'
    case 'backlinks':
      return '/site-explorer'
    default:
      return '/home'
  }
}

interface ReportSourcesNoticeProps {
  report: ClientReportSnapshot
}

/**
 * Owner-only callout listing the data sources this report could not include, each with a
 * one-click path to connect it. Never rendered on the shared/client view or in the PDF.
 */
export function ReportSourcesNotice({ report }: ReportSourcesNoticeProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const missing = disconnectedSections(report)
  if (missing.length === 0) return null

  return (
    <section
      className="print:hidden rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4"
      aria-labelledby="report-sources-heading"
      data-testid="report-sources-notice"
    >
      <div className="flex items-start gap-3">
        <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="report-sources-heading" className="text-sm font-semibold text-amber-100">
            {t('agencyReport.sources.title', { count: missing.length })}
          </h2>
          <p className="mt-0.5 text-xs text-amber-100/70">{t('agencyReport.sources.hint')}</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {missing.map((section) => {
              const Icon = SECTION_ICONS[section]
              return (
                <li
                  key={section}
                  className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/10 text-white/70" aria-hidden>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{t(`agencyReport.sections.${section}` as const)}</p>
                    <p className="text-[11px] leading-snug text-white/50">{t(SECTION_CONNECT_KEYS[section])}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate({ to: connectRouteForSection(section, report.project_id) as any })}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-white/80 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                  >
                    {t('agencyReport.sources.connect')}
                    <ArrowRightIcon className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </section>
  )
}

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowTrendingUpIcon, BoltIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { briefingIsEmpty, deriveBriefing, type Insight } from '../../lib/agencyReport/insights'
import type { ReportData } from '../../lib/agencyReport/types'

interface ExecutiveBriefingProps {
  data: ReportData | null | undefined
  accentColor?: string
  /** Override the default title (widget rename). */
  title?: string
}

type Column = {
  id: 'wins' | 'watch' | 'actions'
  items: Insight[]
  labelKey: string
  emptyKey: string
  Icon: typeof BoltIcon
  iconClass: string
  dotClass: string
}

/**
 * Executive briefing — the first block of the report. Three ranked lists (wins, watch, next
 * actions) computed deterministically from `report.data` by the insight engine; every sentence
 * comes from the i18n catalogue with real numbers and keyword/prompt names interpolated.
 */
export function ExecutiveBriefing({ data, accentColor, title }: ExecutiveBriefingProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith('it') ? 'it-IT' : 'en-US'
  const briefing = useMemo(() => deriveBriefing(data, { locale }), [data, locale])

  const columns: Column[] = [
    {
      id: 'wins',
      items: briefing.wins,
      labelKey: 'agencyReport.briefing.wins',
      emptyKey: 'agencyReport.briefing.noWins',
      Icon: ArrowTrendingUpIcon,
      iconClass: 'bg-emerald-50 text-emerald-600',
      dotClass: 'bg-emerald-500',
    },
    {
      id: 'watch',
      items: briefing.watch,
      labelKey: 'agencyReport.briefing.watch',
      emptyKey: 'agencyReport.briefing.noWatch',
      Icon: ExclamationTriangleIcon,
      iconClass: 'bg-amber-50 text-amber-600',
      dotClass: 'bg-amber-500',
    },
    {
      id: 'actions',
      items: briefing.actions,
      labelKey: 'agencyReport.briefing.actions',
      emptyKey: 'agencyReport.briefing.noActions',
      Icon: BoltIcon,
      iconClass: 'bg-violet-50 text-violet-600',
      dotClass: '',
    },
  ]

  const heading = title ?? t('agencyReport.briefing.title')

  return (
    <section
      aria-label={heading}
      data-testid="executive-briefing"
      className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 print:border-gray-300 break-inside-avoid-page"
      style={{ borderTopWidth: 4, borderTopColor: accentColor ?? 'var(--report-accent, #7c3aed)' }}
    >
      <div className="mb-4">
        <h2 className="text-base font-bold text-gray-900">{heading}</h2>
        <p className="mt-0.5 text-xs text-gray-500">{t('agencyReport.briefing.subtitle')}</p>
      </div>

      {briefingIsEmpty(briefing) ? (
        <p className="text-sm leading-relaxed text-gray-600">{t('agencyReport.briefing.sparse')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-4">
          {columns.map((col) => (
            <div key={col.id} className="min-w-0" data-testid={`briefing-${col.id}`}>
              <div className="mb-2.5 flex items-center gap-2">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${col.iconClass}`} aria-hidden>
                  <col.Icon className="h-3.5 w-3.5" />
                </span>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">{t(col.labelKey)}</h3>
              </div>
              {col.items.length === 0 ? (
                <p className="text-xs text-gray-400">{t(col.emptyKey)}</p>
              ) : col.id === 'actions' ? (
                <ol className="space-y-2">
                  {col.items.map((item, i) => (
                    <li key={item.key + i} className="flex gap-2 text-sm leading-snug text-gray-700">
                      <span
                        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{ backgroundColor: accentColor ?? 'var(--report-accent, #7c3aed)' }}
                        aria-hidden
                      >
                        {i + 1}
                      </span>
                      <span>{t(`agencyReport.briefing.items.${item.key}`, item.params)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <ul className="space-y-2">
                  {col.items.map((item, i) => (
                    <li key={item.key + i} className="flex gap-2 text-sm leading-snug text-gray-700">
                      <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${col.dotClass}`} aria-hidden />
                      <span>{t(`agencyReport.briefing.items.${item.key}`, item.params)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

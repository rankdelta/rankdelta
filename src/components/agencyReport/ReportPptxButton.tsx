import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PresentationChartBarIcon } from '@heroicons/react/24/outline'
import { isConnectedSection, type SectionKey } from '../../lib/agencyReport/sections'
import type { ClientReportSnapshot, ReportData } from '../../lib/agencyReport/types'
import { getWhiteLabelBranding } from '../../lib/whiteLabelReport'
import { showGlobalToast } from '../ui/GlobalToast'

interface ReportPptxButtonProps {
  report: ClientReportSnapshot
  clientName?: string | null
  websiteUrl?: string | null
  /** Agency plan / white-label: the closing slide and file name carry the agency, not Rankdelta. */
  isAgency?: boolean
  className?: string
  variant?: 'primary' | 'secondary'
}

const DATA_SECTIONS: SectionKey[] = ['geo', 'ai_attribution', 'rankings', 'gsc', 'ga4', 'site_health', 'backlinks']

/** True when at least one source came back with data — a deck of only a cover is not worth offering. */
export function reportHasDeckData(report: Pick<ClientReportSnapshot, 'data'>): boolean {
  const data = (report.data ?? {}) as ReportData
  if (data.summary && Object.values(data.summary).some((m) => m && typeof m === 'object' && m.value != null)) return true
  return DATA_SECTIONS.some((key) => isConnectedSection((data as Record<string, unknown>)[key]))
}

/** Hand the built file to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob)
  const a = doc.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  doc.body.appendChild(a)
  a.click()
  doc.body.removeChild(a)
  // Give the download a moment to start before the object URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * "Export deck" — builds a 16:9 .pptx of the report in the browser (pptxgenjs, lazy-loaded so the
 * main bundle stays put) and downloads it as <client>-<period>-<agency|rankdelta>.pptx.
 */
export function ReportPptxButton({
  report,
  clientName,
  websiteUrl,
  isAgency = false,
  className = '',
  variant = 'primary',
}: ReportPptxButtonProps) {
  const { t, i18n } = useTranslation()
  const [exporting, setExporting] = useState(false)

  const name = clientName?.trim() || report.project_name?.trim() || t('resultsPage.yourSiteFallback')
  const branding = useMemo(() => {
    const raw = report.branding
    return getWhiteLabelBranding(raw && typeof raw === 'object' ? { metadata: { white_label_report: raw } } : null, isAgency)
  }, [isAgency, report.branding])

  const handleExport = useCallback(async () => {
    setExporting(true)
    try {
      const { buildReportDeck, buildReportDeckFilename } = await import('../../lib/agencyReport/pptxExport')
      const locale = i18n.language.startsWith('it') ? 'it-IT' : 'en-US'
      const blob = await buildReportDeck(
        {
          data: (report.data ?? {}) as ReportData,
          narrative: report.narrative,
          branding,
          goals: report.goals,
          period: { start: report.period_start, end: report.period_end },
          projectName: name,
          websiteUrl: websiteUrl ?? report.website_url ?? null,
          locale,
          sections: report.sections,
        },
        (key, options) => t(key, options ?? {}),
      )
      downloadBlob(blob, buildReportDeckFilename(name, report.period_start, report.period_end, branding))
    } catch (err) {
      console.error('Report deck export failed', err)
      showGlobalToast(t('agencyReport.deck.exportError'), 'error')
    } finally {
      setExporting(false)
    }
  }, [branding, i18n.language, name, report, t, websiteUrl])

  const base =
    variant === 'primary'
      ? 'inline-flex items-center gap-2 rounded-full bg-white text-black px-4 py-2 text-sm font-semibold hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60'
      : 'inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60'

  return (
    <button
      type="button"
      onClick={() => void handleExport()}
      disabled={exporting}
      className={`${base} ${className}`.trim()}
      aria-busy={exporting}
      title={t('agencyReport.deck.hint')}
      data-testid="report-export-deck"
    >
      <PresentationChartBarIcon className="w-4 h-4" aria-hidden />
      {exporting ? t('agencyReport.deck.exporting') : t('agencyReport.deck.exportButton')}
    </button>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import type { ClientReportSnapshot } from '../../lib/agencyReport/types'
import {
  buildReportPdfBasename,
  buildReportPdfFilename,
  canPrintReport,
  enterReportPrintMode,
  exportReportDomToPdf,
  isPrintPreviewRequested,
  loadPdfExportDeps,
  PDF_EXPORT_ROOT_SELECTOR,
  printReportAsPdf,
  reportFileSuffix,
  type ReportPrintOptions,
} from '../../lib/agencyReport/pdfExport'
import { fmtPeriodRange } from '../../lib/agencyReport/reportUi'
import { getWhiteLabelBranding } from '../../lib/whiteLabelReport'

interface ReportPdfDownloadButtonProps {
  report: ClientReportSnapshot
  clientName?: string | null
  /** Agency plan / white-label: the running footer and file name carry the agency, not Rankdelta. */
  isAgency?: boolean
  className?: string
  variant?: 'primary' | 'secondary'
}

export function ReportPdfDownloadButton({
  report,
  clientName,
  isAgency = false,
  className = '',
  variant = 'primary',
}: ReportPdfDownloadButtonProps) {
  const { t, i18n } = useTranslation()
  const [exporting, setExporting] = useState(false)

  const name = clientName?.trim() || report.project_name?.trim() || t('resultsPage.yourSiteFallback')

  const branding = useMemo(() => {
    const raw = report.branding
    return getWhiteLabelBranding(raw && typeof raw === 'object' ? { metadata: { white_label_report: raw } } : null, isAgency)
  }, [isAgency, report.branding])

  const printOptions = useMemo<ReportPrintOptions>(() => {
    const locale = i18n.language.startsWith('it') ? 'it-IT' : 'en-US'
    const period = fmtPeriodRange(report.period_start, report.period_end, locale)
    const preparedBy = branding.agencyName
      ? t('agencyReport.print.preparedBy', { agency: branding.agencyName })
      : branding.hideAstroSeoFooter
        ? ''
        : t('agencyReport.poweredBy')
    return {
      documentTitle: buildReportPdfBasename(name, report.period_start, report.period_end, reportFileSuffix(branding)),
      footerText: [preparedBy, name, period].filter(Boolean).join(' · '),
      pageLabel: t('agencyReport.print.pageLabel'),
    }
  }, [branding, i18n.language, name, report.period_end, report.period_start, t])

  // `?print=1` keeps the print layout on screen (QA); Ctrl/Cmd+P gets the same layout as the button.
  useEffect(() => {
    let restore: (() => void) | null = null
    if (isPrintPreviewRequested()) restore = enterReportPrintMode({ ...printOptions, preview: true })

    const onBeforePrint = () => {
      if (!restore) restore = enterReportPrintMode(printOptions)
    }
    const onAfterPrint = () => {
      if (isPrintPreviewRequested()) return
      restore?.()
      restore = null
    }
    window.addEventListener('beforeprint', onBeforePrint)
    window.addEventListener('afterprint', onAfterPrint)
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint)
      window.removeEventListener('afterprint', onAfterPrint)
      restore?.()
    }
  }, [printOptions])

  const exportViaCanvas = useCallback(async () => {
    const root = document.querySelector(PDF_EXPORT_ROOT_SELECTOR)
    if (!(root instanceof HTMLElement)) return
    const deps = await loadPdfExportDeps()
    const filename = buildReportPdfFilename(name, report.period_start, report.period_end, reportFileSuffix(branding))
    await exportReportDomToPdf(root, filename, deps)
  }, [branding, name, report.period_end, report.period_start])

  const handleDownload = useCallback(async () => {
    setExporting(true)
    try {
      if (canPrintReport()) {
        await printReportAsPdf(printOptions)
      } else {
        await exportViaCanvas()
      }
    } catch (err) {
      console.error('Report PDF export failed', err)
      window.alert(t('agencyReport.downloadPdfError'))
    } finally {
      setExporting(false)
    }
  }, [exportViaCanvas, printOptions, t])

  const base =
    variant === 'primary'
      ? 'inline-flex items-center gap-2 rounded-full bg-white text-black px-4 py-2 text-sm font-semibold hover:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60'
      : 'inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60'

  return (
    <button
      type="button"
      onClick={() => void handleDownload()}
      disabled={exporting}
      className={`${base} ${className}`.trim()}
      aria-busy={exporting}
      title={t('agencyReport.print.hint')}
    >
      <ArrowDownTrayIcon className="w-4 h-4" aria-hidden />
      {exporting ? t('agencyReport.downloadingPdf') : t('agencyReport.downloadPdf')}
    </button>
  )
}

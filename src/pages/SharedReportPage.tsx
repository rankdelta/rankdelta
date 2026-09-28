import { useEffect, useMemo } from 'react'
import { useParams } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ClientReportView } from '../components/agencyReport/ClientReportView'
import { ReportPdfDownloadButton } from '../components/agencyReport/ReportPdfDownloadButton'
import { ReportPptxButton, reportHasDeckData } from '../components/agencyReport/ReportPptxButton'
import { fetchSharedReport } from '../services/reportBuild'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { fmtPeriodRange } from '../lib/agencyReport/reportUi'
import { getWhiteLabelBranding } from '../lib/whiteLabelReport'
import type { ClientReportSnapshot } from '../lib/agencyReport/types'

type SharedReportMeta = { projectName?: string | null; websiteUrl?: string | null; locale?: string | null }

/** The client identity travels inside the snapshot (report-build writes it) with row-level fallbacks. */
export function sharedReportIdentity(report: ClientReportSnapshot): { clientName: string | null; websiteUrl: string | null } {
  const data = report.data as { meta?: SharedReportMeta; websiteUrl?: string | null } | undefined
  const meta = data?.meta
  return {
    clientName: meta?.projectName?.trim() || report.project_name?.trim() || null,
    websiteUrl: meta?.websiteUrl || data?.websiteUrl || report.website_url || null,
  }
}

/** Language the report was written in ('it' / 'en'); the client should see the page in that language. */
export function sharedReportLocale(report: ClientReportSnapshot): 'it' | 'en' | null {
  const locale = (report.data as { meta?: SharedReportMeta } | undefined)?.meta?.locale
  if (!locale) return null
  return locale.toLowerCase().startsWith('it') ? 'it' : 'en'
}

/** Tab title as the client sees it: "Client · Report 1 Aug – 31 Aug 2026" (no app branding). */
export function sharedReportTitle(clientName: string | null, periodLabel: string): string {
  return clientName ? `${clientName} · Report ${periodLabel}` : `Report ${periodLabel}`
}

export function SharedReportPage() {
  const { t, i18n } = useTranslation()
  const { token } = useParams({ strict: false }) as { token?: string }

  useEffect(() => {
    const meta = document.querySelector('meta[name="robots"]')
    if (meta) meta.setAttribute('content', 'noindex, nofollow')
  }, [])

  const { data: report, isLoading, error } = useQuery({
    queryKey: ['shared-report', token],
    queryFn: () => fetchSharedReport(token!),
    enabled: !!token && token.length >= 16,
    retry: false,
  })

  const branding = useMemo(() => {
    const raw = report?.branding
    return getWhiteLabelBranding(raw && typeof raw === 'object' ? { metadata: { white_label_report: raw } } : null)
  }, [report?.branding])
  const brandingAgency = branding.hideAstroSeoFooter

  const identity = report ? sharedReportIdentity(report) : null
  const reportLocale = report ? sharedReportLocale(report) : null

  // Client-facing page: speak the report's language, not the viewer's app preference.
  useEffect(() => {
    if (!reportLocale) return
    const previous = i18n.language
    const previousLang = document.documentElement.lang
    const switched = !previous.toLowerCase().startsWith(reportLocale)
    if (switched) void i18n.changeLanguage(reportLocale)
    document.documentElement.lang = reportLocale
    return () => {
      document.documentElement.lang = previousLang
      if (switched) void i18n.changeLanguage(previous)
    }
  }, [i18n, reportLocale])

  // Tab title "<Client> · Report <period>" and, on white-label reports with a logo, the agency favicon.
  useEffect(() => {
    if (!report) return
    const previousTitle = document.title
    const locale = i18n.language.startsWith('it') ? 'it-IT' : 'en-US'
    document.title = sharedReportTitle(
      identity?.clientName ?? null,
      fmtPeriodRange(report.period_start, report.period_end, locale),
    )

    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    const previousIcon = icon ? { href: icon.href, type: icon.type } : null
    if (icon && branding.hideAstroSeoFooter && branding.logoUrl) {
      icon.href = branding.logoUrl
      icon.removeAttribute('type')
    }
    return () => {
      document.title = previousTitle
      if (icon && previousIcon) {
        icon.href = previousIcon.href
        if (previousIcon.type) icon.type = previousIcon.type
      }
    }
  }, [branding.hideAstroSeoFooter, branding.logoUrl, i18n.language, identity?.clientName, report])

  if (!token || token.length < 16) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] text-white flex items-center justify-center p-6">
        <p>{t('agencyReport.invalidShareLink')}</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] flex items-center justify-center">
        <LoadingSpinner text={t('agencyReport.loadingReport')} />
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] text-white flex items-center justify-center p-6">
        <p>{t('agencyReport.reportNotFound')}</p>
      </div>
    )
  }

  // Below the sheet: who prepared it, and Rankdelta only when the agency has not white-labelled.
  const preparedBy = branding.agencyName ? t('agencyReport.print.preparedBy', { agency: branding.agencyName }) : null
  const poweredBy = branding.hideAstroSeoFooter ? null : t('agencyReport.poweredBy')
  const chromeFooter = [preparedBy, poweredBy].filter(Boolean).join(' · ')

  return (
    <div className="min-h-screen bg-[#0b0b0f] print:bg-white py-6 px-4 print:p-0">
      <div className="print:hidden sm:sticky top-0 z-10 mx-auto mb-4 flex max-w-[900px] justify-end gap-2 px-4 py-2 sm:bg-[#0b0b0f]/90 sm:backdrop-blur">
        {reportHasDeckData(report) && (
          <ReportPptxButton
            report={report}
            clientName={identity?.clientName}
            websiteUrl={identity?.websiteUrl}
            isAgency={brandingAgency}
            variant="secondary"
          />
        )}
        <ReportPdfDownloadButton
          report={report}
          clientName={identity?.clientName}
          isAgency={brandingAgency}
          variant="secondary"
        />
      </div>
      <ClientReportView
        report={report}
        projectName={identity?.clientName ?? undefined}
        websiteUrl={identity?.websiteUrl ?? undefined}
        isAgency={brandingAgency}
        readOnly
      />
      {chromeFooter && (
        <p className="print:hidden mx-auto mt-6 max-w-[900px] text-center text-xs text-white/60">{chromeFooter}</p>
      )}
    </div>
  )
}

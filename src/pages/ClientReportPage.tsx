import { useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import { motion, AnimatePresence } from 'framer-motion'
import { ClientReportView } from '../components/agencyReport/ClientReportView'
import { ReportLayoutEditor } from '../components/agencyReport/builder/ReportLayoutEditor'
import { GscAiOverviewImport } from '../components/agencyReport/GscAiOverviewImport'
import { ReportPeriodNavigator } from '../components/agencyReport/ReportHistory'
import { ReportHistoryProvider } from '../components/agencyReport/ReportHistoryContext'
import { ReportPdfDownloadButton } from '../components/agencyReport/ReportPdfDownloadButton'
import { ReportPptxButton } from '../components/agencyReport/ReportPptxButton'
import { ReportSourcesNotice } from '../components/agencyReport/ReportSourcesNotice'
import { ShareControls } from '../components/agencyReport/ShareControls'
import { useActiveProject } from '../hooks/useActiveProject'
import { useDocumentTitleOverride } from '../hooks/useDocumentTitle'
import { useProjects } from '../hooks/useProjects'
import { useReportHistory } from '../hooks/useReportHistory'
import { useSubscription } from '../hooks/useSubscription'
import { isAgencyPlan } from '../lib/agencyReport/gating'
import { resolveReportHistory } from '../lib/agencyReport/history'
import { isValidLayout, layoutFromSections, normalizeLayout, withInsightBlocks, type ReportLayout } from '../lib/agencyReport/layout'
import {
  attachGscAiOverviewCsv,
  fetchClientReportById,
  updateReportLayout,
} from '../services/reportBuild'
import { deleteReportTemplate, fetchReportTemplates, saveReportTemplate } from '../services/reportTemplates'
import type { ClientReportSnapshot } from '../lib/agencyReport/types'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { fmtPeriodRange } from '../lib/agencyReport/reportUi'
import { sharedReportTitle } from './SharedReportPage'

export function ClientReportPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { reportId } = useParams({ strict: false }) as { reportId?: string }
  const { activeProject } = useActiveProject()
  const { data: projects = [] } = useProjects()
  const { subscription, currentPlan } = useSubscription()
  const isAgency = isAgencyPlan(subscription, currentPlan)
  const [localReport, setLocalReport] = useState<ClientReportSnapshot | null>(null)
  const [editLayout, setEditLayout] = useState(false)
  const [draftLayout, setDraftLayout] = useState<ReportLayout | null>(null)
  const [savingLayout, setSavingLayout] = useState(false)
  const [compareWithPrevious, setCompareWithPrevious] = useState(false)

  const { data: report, isLoading, error, refetch } = useQuery({
    queryKey: ['client-report', reportId],
    queryFn: () => fetchClientReportById(reportId!),
    enabled: !!reportId,
  })

  const snapshot = localReport ?? report
  const reportProject = projects.find((p) => p.id === snapshot?.project_id)
  // Sibling reports of the same client: period navigator + "vs previous report" on the scorecard.
  const { data: fetchedHistory } = useReportHistory(snapshot?.project_id)
  const history = useMemo(
    () => (snapshot && fetchedHistory ? resolveReportHistory(snapshot, fetchedHistory) : null),
    [snapshot, fetchedHistory],
  )
  // Tab title follows the report's client, not the sidebar's active project.
  useDocumentTitleOverride(
    snapshot
      ? `${sharedReportTitle(
          reportProject?.name ?? snapshot.project_name ?? null,
          fmtPeriodRange(snapshot.period_start, snapshot.period_end, i18n.language.startsWith('it') ? 'it-IT' : 'en-US'),
        )} · Rankdelta`
      : null,
  )

  const { data: templates = [], refetch: refetchTemplates } = useQuery({
    queryKey: ['report-templates', snapshot?.project_id],
    queryFn: () => fetchReportTemplates(snapshot?.project_id),
    enabled: editLayout && !!snapshot?.project_id,
  })

  const currentLayout = useMemo(() => {
    if (!snapshot) return null
    if (snapshot.layout && isValidLayout(snapshot.layout)) return withInsightBlocks(snapshot.layout, snapshot.sections ?? [])
    return layoutFromSections(snapshot.sections ?? [])
  }, [snapshot])

  const handleStartEditLayout = () => {
    if (!currentLayout) return
    setDraftLayout(normalizeLayout(currentLayout))
    setEditLayout(true)
  }

  const handleSaveLayout = async () => {
    if (!snapshot || !draftLayout) return
    setSavingLayout(true)
    try {
      // Saved by hand: render exactly this from now on, even if the insight blocks were removed.
      const saved: ReportLayout = { ...normalizeLayout(draftLayout), insightBlocks: 'manual' }
      await updateReportLayout(snapshot.id, saved)
      const next = { ...snapshot, layout: saved }
      setLocalReport(next)
      setEditLayout(false)
      await queryClient.invalidateQueries({ queryKey: ['client-report', reportId] })
    } finally {
      setSavingLayout(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] flex items-center justify-center">
        <LoadingSpinner text={t('agencyReport.loadingReport')} />
      </div>
    )
  }

  if (error || !snapshot) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] text-white flex items-center justify-center">
        <p>{t('agencyReport.reportNotFound')}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0b0b0f] print:bg-white">
      <div className="print:hidden sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#0b0b0f]/90 backdrop-blur">
        <button
          type="button"
          onClick={() => navigate({ to: '/reports/portal' as any })}
          className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
        >
          <ArrowLeftIcon className="w-4 h-4" /> {t('agencyReport.backToBuilder')}
        </button>
        <div className="flex items-center gap-2">
          {!editLayout && (
            <button
              type="button"
              onClick={handleStartEditLayout}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <PencilSquareIcon className="w-4 h-4" /> {t('agencyReport.builder.editLayout')}
            </button>
          )}
          {editLayout && (
            <>
              <button
                type="button"
                onClick={() => setEditLayout(false)}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm text-white/70 hover:bg-white/10"
              >
                {t('agencyReport.builder.cancelEdit')}
              </button>
              <button
                type="button"
                disabled={savingLayout}
                onClick={() => void handleSaveLayout()}
                className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {savingLayout ? t('agencyReport.builder.savingLayout') : t('agencyReport.builder.saveLayout')}
              </button>
            </>
          )}
          <ReportPptxButton
            report={snapshot}
            clientName={reportProject?.name ?? snapshot.project_name ?? activeProject?.name}
            websiteUrl={reportProject?.website_url ?? snapshot.website_url ?? activeProject?.website_url}
            isAgency={isAgency}
            variant="secondary"
          />
          <ReportPdfDownloadButton
            report={snapshot}
            clientName={reportProject?.name ?? snapshot.project_name ?? activeProject?.name}
            isAgency={isAgency}
          />
        </div>
      </div>

      <div className="mx-auto my-6 max-w-[900px] px-4 space-y-4 print:my-0 print:px-0">
        {!isAgency && (
          <div className="print:hidden rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {t('agencyReport.agencyUpsell')}
          </div>
        )}

        <div className="print:hidden space-y-4">
          <ReportPeriodNavigator
            history={history}
            currentReportId={snapshot.id}
            compareWithPrevious={compareWithPrevious}
            onCompareChange={setCompareWithPrevious}
            onNavigate={(id) => {
              setLocalReport(null)
              navigate({ to: '/reports/portal/$reportId' as any, params: { reportId: id } as any })
            }}
          />
          <ReportSourcesNotice report={snapshot} />
          <ShareControls
            reportId={snapshot.id}
            shareToken={snapshot.share_token ?? null}
            isAgency={isAgency}
            onRevoked={() => void refetch()}
          />
          <GscAiOverviewImport
            onImport={async (rows) => {
              const next = await attachGscAiOverviewCsv(snapshot.id, snapshot.data, rows)
              setLocalReport({ ...snapshot, data: next })
              await queryClient.invalidateQueries({ queryKey: ['client-report', reportId] })
            }}
          />
        </div>

        <ReportHistoryProvider value={{ history: fetchedHistory ?? null, compareWithPrevious }}>
        <AnimatePresence mode="wait">
          {editLayout && draftLayout ? (
            <motion.div
              key="editor"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="print:hidden rounded-2xl border border-violet-500/30 bg-[#151b2e] p-6"
            >
              <ReportLayoutEditor
                layout={draftLayout}
                onChange={setDraftLayout}
                enabledSections={snapshot.sections ?? []}
                previewReport={snapshot}
                projectName={reportProject?.name ?? activeProject?.name}
                websiteUrl={reportProject?.website_url ?? activeProject?.website_url}
                savedTemplates={templates}
                onSaveTemplate={async (name) => {
                  await saveReportTemplate({ name, layout: draftLayout, projectId: snapshot.project_id })
                  await refetchTemplates()
                }}
                onDeleteTemplate={async (id) => {
                  await deleteReportTemplate(id)
                  await refetchTemplates()
                }}
              />
            </motion.div>
          ) : (
            <motion.div key="view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ClientReportView
                report={snapshot}
                projectName={reportProject?.name ?? activeProject?.name}
                websiteUrl={reportProject?.website_url ?? activeProject?.website_url}
                isAgency={isAgency}
              />
            </motion.div>
          )}
        </AnimatePresence>
        </ReportHistoryProvider>
      </div>
    </div>
  )
}

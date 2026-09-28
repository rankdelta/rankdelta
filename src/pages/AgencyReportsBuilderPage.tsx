import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useNavigate, useParams } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { AppShell } from '../components/layout/AppShell'
import { ReportLayoutEditor } from '../components/agencyReport/builder/ReportLayoutEditor'
import { ReportBuildSuccessBanner } from '../components/agencyReport/builder/ReportBuildSuccessBanner'
import { ReportBuilderStickyBar } from '../components/agencyReport/builder/ReportBuilderStickyBar'
import { RecentReportsList } from '../components/agencyReport/builder/RecentReportsList'
import { AgencyBrandingCard } from '../components/agencyReport/builder/AgencyBrandingCard'
import { useProjects } from '../hooks/useProjects'
import { useSubscription } from '../hooks/useSubscription'
import { useUpgradeModal } from '../components/subscription/UpgradeModal'
import { useActiveProject } from '../hooks/useActiveProject'
import { getWhiteLabelBranding } from '../lib/whiteLabelReport'
import {
  ALL_SECTION_KEYS,
  DEFAULT_ENABLED_SECTIONS,
  isAgencyPlan,
  isProPlusPlan,
  layoutFromSections,
  mergeLayoutWithSections,
  normalizeLayout,
  type ReportGoals,
  type ReportLayout,
  type SectionKey,
} from '../lib/agencyReport'
import {
  buildClientReport,
  fetchClientReportById,
  fetchClientReports,
  type ClientReportRow,
} from '../services/reportBuild'
import { deleteReportTemplate, fetchReportTemplates, saveReportTemplate } from '../services/reportTemplates'
import {
  createReportSchedule,
  deleteReportSchedule,
  fetchReportSchedules,
  type ReportScheduleRow,
} from '../services/reportSchedules'
import { LockClosedIcon } from '@heroicons/react/24/outline'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { TableSkeleton } from '../components/ui/Skeletons'
import { SECTION_DESC_KEYS, fmtPeriodRange } from '../lib/agencyReport/reportUi'
import { formatSendDate, nextSendDate } from '../lib/agencyReport/schedule'
import { ScheduleNextSendPreview } from '../components/agencyReport/builder/ScheduleNextSendPreview'
import { ScheduleTestSendButton } from '../components/agencyReport/builder/ScheduleTestSendButton'

type PeriodPreset = '30' | '90' | 'custom'
type BuilderTab = 'settings' | 'layout'

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function presetRange(preset: PeriodPreset): { start: string; end: string } {
  const end = new Date()
  const start = new Date()
  if (preset === '30') start.setDate(end.getDate() - 29)
  else if (preset === '90') start.setDate(end.getDate() - 89)
  return { start: ymd(start), end: ymd(end) }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const WEEKDAY_OPTIONS = [
  { value: 0, labelKey: 'agencyReport.schedule.weekdays.sun' },
  { value: 1, labelKey: 'agencyReport.schedule.weekdays.mon' },
  { value: 2, labelKey: 'agencyReport.schedule.weekdays.tue' },
  { value: 3, labelKey: 'agencyReport.schedule.weekdays.wed' },
  { value: 4, labelKey: 'agencyReport.schedule.weekdays.thu' },
  { value: 5, labelKey: 'agencyReport.schedule.weekdays.fri' },
  { value: 6, labelKey: 'agencyReport.schedule.weekdays.sat' },
] as const

export function AgencyReportsBuilderPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { reportId } = useParams({ strict: false }) as { reportId?: string }
  const queryClient = useQueryClient()
  const { data: projects = [] } = useProjects()
  const { activeProject } = useActiveProject()
  const { subscription, currentPlan, isLoading: subscriptionLoading } = useSubscription()
  const { openForLockedFeature, UpgradeModal } = useUpgradeModal()

  const canBuild = isProPlusPlan(subscription, currentPlan)
  const canAgency = isAgencyPlan(subscription, currentPlan)
  const canSchedule = canBuild
  const scheduleLocale = i18n.language.startsWith('it') ? 'it-IT' : 'en-US'

  const [projectId, setProjectId] = useState(activeProject?.id ?? '')
  const [preset, setPreset] = useState<PeriodPreset>('30')
  const [customStart, setCustomStart] = useState(presetRange('30').start)
  const [customEnd, setCustomEnd] = useState(presetRange('30').end)
  const [enabledSections, setEnabledSections] = useState<SectionKey[]>(DEFAULT_ENABLED_SECTIONS)
  const [goals, setGoals] = useState<ReportGoals>({})
  const [building, setBuilding] = useState(false)
  const [lastBuild, setLastBuild] = useState<ClientReportRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const projectSelectRef = useRef<HTMLSelectElement>(null)
  const recentReportsRef = useRef<HTMLElement>(null)
  const successBannerRef = useRef<HTMLDivElement>(null)
  const scheduleFormRef = useRef<HTMLElement>(null)
  const [activeTab, setActiveTab] = useState<BuilderTab>('settings')
  const [layout, setLayout] = useState<ReportLayout>(() => layoutFromSections(DEFAULT_ENABLED_SECTIONS))

  const [showScheduleForm, setShowScheduleForm] = useState(false)
  const [scheduleCadence, setScheduleCadence] = useState<'weekly' | 'monthly'>('weekly')
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(1)
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1)
  const [scheduleRecipients, setScheduleRecipients] = useState('')
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  const selectedProject = projects.find((p) => p.id === projectId) ?? activeProject
  const branding = getWhiteLabelBranding(selectedProject, canAgency)

  const range = preset === 'custom' ? { start: customStart, end: customEnd } : presetRange(preset)

  const { data: recent = [], isLoading } = useQuery({
    queryKey: ['client-reports', projectId],
    queryFn: () => fetchClientReports(projectId),
    enabled: !!projectId,
  })

  const { data: schedules = [], isLoading: schedulesLoading } = useQuery({
    queryKey: ['report-schedules', projectId],
    queryFn: () => fetchReportSchedules(projectId),
    enabled: !!projectId && canSchedule,
  })

  const { data: templates = [], refetch: refetchTemplates } = useQuery({
    queryKey: ['report-templates', projectId],
    queryFn: () => fetchReportTemplates(projectId),
    enabled: canBuild,
  })

  const { data: previewReport } = useQuery({
    queryKey: ['client-report-preview', projectId, recent[0]?.id],
    queryFn: () => fetchClientReportById(recent[0]!.id),
    enabled: !!projectId && !!recent[0]?.id,
  })

  useEffect(() => {
    setLayout((prev) => normalizeLayout(mergeLayoutWithSections(prev, enabledSections)))
  }, [enabledSections])

  // Projects load asynchronously: default to the sidebar's active client once it is known.
  useEffect(() => {
    if (!projectId && activeProject?.id) setProjectId(activeProject.id)
  }, [activeProject?.id, projectId])

  const buildSummary = useMemo(() => {
    if (!selectedProject) return null
    const locale = i18n.language.startsWith('it') ? 'it-IT' : 'en-US'
    const periodLabel =
      preset === 'custom' ? fmtPeriodRange(range.start, range.end, locale) : t(`agencyReport.period${preset}` as const)
    return `${selectedProject.name} · ${periodLabel} · ${t('agencyReport.builder.sectionsCount', { count: enabledSections.length })}`
  }, [selectedProject, preset, range.start, range.end, enabledSections.length, i18n.language, t])

  const GOAL_EXAMPLES: Record<keyof ReportGoals, string> = {
    healthScore: '80',
    aiSov: '25',
    avgPosition: '8',
    gscClicks: '1200',
    ga4Sessions: '5000',
    ga4AiAssistantSessions: '150',
  }

  const sectionLabels = useMemo(
    () =>
      ALL_SECTION_KEYS.map((key) => ({
        key,
        label: t(`agencyReport.sections.${key}` as const),
      })),
    [t],
  )

  const toggleSection = (key: SectionKey) => {
    setEnabledSections((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  const focusProjectSelector = () => {
    projectSelectRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    projectSelectRef.current?.focus()
  }

  const handleGenerate = async () => {
    if (!canBuild) {
      openForLockedFeature(t('agencyReport.buildReport'))
      return
    }
    if (!projectId || building || enabledSections.length === 0) return
    setBuilding(true)
    setError(null)
    setLastBuild(null)
    try {
      const result = await buildClientReport({
        projectId,
        periodStart: range.start,
        periodEnd: range.end,
        locale: i18n.language.startsWith('it') ? 'it' : 'en',
        goals,
        branding: canAgency
          ? {
              agencyName: branding.agencyName,
              logoUrl: branding.logoUrl,
              primaryColor: branding.primaryColor,
              hideAstroSeoFooter: true,
              enabled: true,
            }
          : undefined,
        share: canAgency,
        sections: enabledSections,
        layout: normalizeLayout(layout),
      })
      await queryClient.invalidateQueries({ queryKey: ['client-reports', projectId] })
      setLastBuild(result.report)
      // The build button sits at the bottom of the form; bring the "your report is ready" banner
      // (with Open / Copy link) into view instead of leaving the user staring at the history list.
      window.setTimeout(() => {
        ;(successBannerRef.current ?? recentReportsRef.current)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 150)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'build_failed')
    } finally {
      setBuilding(false)
    }
  }

  const handleCreateSchedule = async () => {
    if (!canSchedule) {
      openForLockedFeature(t('agencyReport.schedule.title'))
      return
    }
    if (!projectId) return

    const entered = scheduleRecipients
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
    const recipients = entered.filter((e) => EMAIL_RE.test(e))
    const invalid = entered.filter((e) => !EMAIL_RE.test(e))

    if (recipients.length === 0) {
      setScheduleError(t('agencyReport.schedule.invalidRecipients'))
      return
    }
    if (invalid.length > 0) {
      setScheduleError(t('agencyReport.schedule.invalidRecipientsList', { list: invalid.join(', ') }))
      return
    }

    setScheduleSaving(true)
    setScheduleError(null)
    try {
      await createReportSchedule({
        projectId,
        cadence: scheduleCadence,
        dayOfWeek: scheduleCadence === 'weekly' ? scheduleDayOfWeek : null,
        dayOfMonth: scheduleCadence === 'monthly' ? scheduleDayOfMonth : null,
        recipients,
        sections: enabledSections,
        branding: canAgency
          ? {
              agencyName: branding.agencyName,
              logoUrl: branding.logoUrl,
              primaryColor: branding.primaryColor,
              hideAstroSeoFooter: true,
              enabled: true,
            }
          : null,
        goals,
        layout: normalizeLayout(layout),
      })
      await queryClient.invalidateQueries({ queryKey: ['report-schedules', projectId] })
      setShowScheduleForm(false)
      setScheduleRecipients('')
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : 'schedule_failed')
    } finally {
      setScheduleSaving(false)
    }
  }

  const handleDeleteSchedule = async (schedule: ReportScheduleRow) => {
    await deleteReportSchedule(schedule.id)
    await queryClient.invalidateQueries({ queryKey: ['report-schedules', projectId] })
  }

  // Retention nudge after a build: only when the account can schedule (same gate as the form) and
  // this client has no active schedule yet. Not entitled → nothing (no upsell in the banner).
  const hasActiveSchedule = schedules.some((s) => s.active !== false)
  const offerWeeklySchedule = canSchedule && !!projectId && !schedulesLoading && !hasActiveSchedule

  const openWeeklyScheduleForm = (): void => {
    setScheduleCadence('weekly')
    setScheduleError(null)
    // Last-used recipients: a paused schedule of this client is the only place they survive.
    const paused = schedules.find((s) => (s.recipients ?? []).length > 0)
    if (!scheduleRecipients.trim() && paused) setScheduleRecipients(paused.recipients.join(', '))
    setActiveTab('settings')
    setShowScheduleForm(true)
    window.setTimeout(() => {
      scheduleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      document.getElementById('schedule-recipients')?.focus({ preventScroll: true })
    }, 150)
  }

  // Nested report detail route (/reports/portal/$reportId) renders through this layout's Outlet.
  if (reportId) {
    return (
      <AppShell>
        <Outlet />
      </AppShell>
    )
  }

  if (subscriptionLoading) {
    return (
      <AppShell>
        <div className="max-w-4xl mx-auto px-4 py-16 flex justify-center">
          <LoadingSpinner text={t('agencyReport.loadingReports')} />
        </div>
      </AppShell>
    )
  }

  if (!canBuild) {
    return (
      <AppShell>
        <div className="max-w-4xl mx-auto px-4 py-8">
          <header className="mb-8">
            <h1 className="text-2xl font-bold text-white">{t('agencyReport.builderTitle')}</h1>
            <p className="text-sm text-white/60 mt-1">{t('agencyReport.builderSubtitle')}</p>
          </header>
          <div className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/[0.12] to-fuchsia-500/[0.05] p-8 text-center">
            <LockClosedIcon className="mx-auto mb-4 h-10 w-10 text-violet-300" strokeWidth={1.5} aria-hidden />
            <p className="mx-auto mb-6 max-w-md text-base text-white/80">{t('agencyReport.builderUpsell')}</p>
            <button
              type="button"
              onClick={() => openForLockedFeature(t('agencyReport.buildReport'))}
              className="rounded-full bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              {t('agencyReport.builderUpgrade')}
            </button>
          </div>
        </div>
        <UpgradeModal />
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <header className="mb-6 sm:mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-400/90 mb-1">
              {t('agencyReport.title')}
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('agencyReport.builderTitle')}</h1>
            <p className="text-sm text-white/60 mt-1 max-w-2xl">{t('agencyReport.builderSubtitle')}</p>
          </div>
          {canAgency && (
            <button
              type="button"
              onClick={() => navigate({ to: '/reports/portfolio' as any })}
              className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              {t('agencyReport.portfolio.title')}
            </button>
          )}
        </header>

        <section
          className={`mb-6 rounded-2xl border p-4 sm:p-5 transition-colors ${
            projectId
              ? 'border-white/10 bg-white/[0.03]'
              : 'border-violet-500/40 bg-violet-500/[0.06] ring-2 ring-violet-500/25'
          }`}
          data-testid="project-selector-step"
        >
          <label className="block text-sm font-medium text-white/80 mb-1" htmlFor="report-project">
            <span className="text-xs font-semibold uppercase tracking-wide text-violet-400/90 mr-2">
              {t('agencyReport.builder.stepProject')}
            </span>
            {t('agencyReport.project')}
          </label>
          <select
            ref={projectSelectRef}
            id="report-project"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value)
              setLastBuild(null)
            }}
            className={`w-full rounded-lg border bg-[#151b2e] px-3 py-2.5 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
              projectId ? 'border-white/15' : 'border-violet-400/50'
            }`}
          >
            <option value="">{t('agencyReport.selectProject')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {!projectId && (
            <p className="mt-2 text-sm text-violet-300" data-testid="select-project-hint">
              {t('agencyReport.builder.selectProjectHint')}
            </p>
          )}
        </section>

        {lastBuild && !building && (
          <div ref={successBannerRef} className="mb-6 scroll-mt-24">
            <ReportBuildSuccessBanner
              report={lastBuild}
              onView={() =>
                navigate({ to: '/reports/portal/$reportId' as any, params: { reportId: lastBuild.id } as any })
              }
              onDismiss={() => setLastBuild(null)}
              onSetUpWeeklyDelivery={offerWeeklySchedule ? openWeeklyScheduleForm : null}
            />
          </div>
        )}

        <div className="mb-6 flex gap-2">
          {(['settings', 'layout'] as BuilderTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                activeTab === tab ? 'bg-violet-600 text-white' : 'bg-white/10 text-white/70 hover:bg-white/15'
              }`}
            >
              {t(`agencyReport.builder.tabs.${tab}` as const)}
            </button>
          ))}
        </div>

        {activeTab === 'layout' ? (
          <motion.div
            key="layout"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
          >
            <p className="text-sm text-white/60 mb-4">{t('agencyReport.builder.layoutHint')}</p>
            <ReportLayoutEditor
              layout={layout}
              onChange={setLayout}
              enabledSections={enabledSections}
              previewReport={previewReport}
              projectName={selectedProject?.name}
              websiteUrl={selectedProject?.website_url}
              savedTemplates={templates}
              canSaveTemplate={!!projectId}
              saveTemplateHint={t('agencyReport.builder.selectProjectHint')}
              onSaveTemplate={async (name) => {
                await saveReportTemplate({ name, layout, projectId })
                await refetchTemplates()
              }}
              onDeleteTemplate={async (id) => {
                await deleteReportTemplate(id)
                await refetchTemplates()
              }}
            />
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          </motion.div>
        ) : (
        <div className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-400/90 mb-3">
              {t('agencyReport.builder.stepSetup')}
            </p>
            <p className="text-sm font-medium text-white/80 mb-2">{t('agencyReport.period')}</p>
            <div className="flex flex-wrap gap-2">
              {(['30', '90', 'custom'] as PeriodPreset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                    preset === p ? 'bg-violet-600 text-white' : 'bg-white/10 text-white/70 hover:bg-white/15'
                  }`}
                >
                  {t(`agencyReport.period${p}` as const)}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="mt-3 flex flex-wrap gap-3">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="rounded-lg border border-white/15 bg-[#151b2e] px-3 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                  aria-label={t('agencyReport.periodStart')}
                />
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="rounded-lg border border-white/15 bg-[#151b2e] px-3 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                  aria-label={t('agencyReport.periodEnd')}
                />
              </div>
            )}
          </div>

          <div>
            <p className="text-sm font-medium text-white/80 mb-2">{t('agencyReport.sectionsTitle')}</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {sectionLabels.map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm text-white/80 cursor-pointer hover:bg-white/[0.04] focus-within:ring-2 focus-within:ring-violet-500"
                >
                  <input
                    type="checkbox"
                    checked={enabledSections.includes(key)}
                    onChange={() => toggleSection(key)}
                    className="mt-0.5 rounded border-white/20 text-violet-500 focus:ring-violet-500"
                  />
                  <span>
                    <span className="font-medium text-white/90">{label}</span>
                    <span className="block text-[11px] text-white/45 mt-0.5 leading-snug">
                      {t(SECTION_DESC_KEYS[key])}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-400/90 mb-3">
              {t('agencyReport.builder.stepTargets')}
            </p>
            <p className="text-sm font-medium text-white/80">{t('agencyReport.goalsTitle')}</p>
            <p className="text-xs text-white/45 mb-3">{t('agencyReport.goalsHint')}</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {(
                [
                  ['healthScore', t('resultsPage.healthLabel')],
                  ['aiSov', t('agencyReport.shareOfVoice')],
                  ['avgPosition', t('resultsPage.avgPosition')],
                  ['gscClicks', t('agencyReport.gscClicks')],
                  ['ga4Sessions', t('agencyReport.ga4Sessions')],
                  ['ga4AiAssistantSessions', t('agencyReport.aiSessions')],
                ] as Array<[keyof ReportGoals, string]>
              ).map(([key, label]) => (
                <label key={key} className="block text-xs text-white/60">
                  {label}
                  <input
                    type="number"
                    placeholder={t('agencyReport.builder.goalExample', { value: GOAL_EXAMPLES[key] })}
                    value={goals[key] ?? ''}
                    onChange={(e) =>
                      setGoals((g) => ({
                        ...g,
                        [key]: e.target.value === '' ? undefined : Number(e.target.value),
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/15 bg-[#151b2e] px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                  />
                </label>
              ))}
            </div>
          </div>

          {canAgency && <AgencyBrandingCard project={selectedProject} />}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!projectId}
              onClick={() => {
                if (!canSchedule) {
                  openForLockedFeature(t('agencyReport.schedule.title'))
                  return
                }
                setShowScheduleForm((v) => !v)
              }}
              className="inline-flex items-center justify-center rounded-full border border-white/20 px-6 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-50"
            >
              {t('agencyReport.schedule.addSchedule')}
            </button>
          </div>
        </div>
        )}

        <ReportBuilderStickyBar
          building={building}
          canBuild={canBuild}
          projectSelected={!!projectId}
          hasSections={enabledSections.length > 0}
          onBuild={() => void handleGenerate()}
          onFocusProject={focusProjectSelector}
          summary={buildSummary}
        />

        {showScheduleForm && activeTab === 'settings' && (
          <section className="mt-6 scroll-mt-24 rounded-2xl border border-violet-500/30 bg-violet-500/5 p-6" data-testid="schedule-form" ref={scheduleFormRef}>
            <h2 className="text-lg font-semibold text-white mb-4">{t('agencyReport.schedule.newTitle')}</h2>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-white/80 mb-2">{t('agencyReport.schedule.cadence')}</p>
                <div className="flex gap-2">
                  {(['weekly', 'monthly'] as const).map((c) => (
                    <button
                      aria-pressed={scheduleCadence === c}
                      key={c}
                      type="button"
                      onClick={() => setScheduleCadence(c)}
                      className={`rounded-full px-4 py-1.5 text-sm ${
                        scheduleCadence === c ? 'bg-violet-600 text-white' : 'bg-white/10 text-white/70'
                      }`}
                    >
                      {t(`agencyReport.schedule.${c}`)}
                    </button>
                  ))}
                </div>
              </div>
              {scheduleCadence === 'weekly' ? (
                <div>
                  <label className="block text-sm text-white/80 mb-1" htmlFor="schedule-dow">
                    {t('agencyReport.schedule.dayOfWeek')}
                  </label>
                  <select
                    id="schedule-dow"
                    value={scheduleDayOfWeek}
                    onChange={(e) => setScheduleDayOfWeek(Number(e.target.value))}
                    className="w-full rounded-lg border border-white/15 bg-[#151b2e] px-3 py-2 text-sm text-white"
                  >
                    {WEEKDAY_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>{t(d.labelKey)}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-sm text-white/80 mb-1" htmlFor="schedule-dom">
                    {t('agencyReport.schedule.dayOfMonth')}
                  </label>
                  <select
                    id="schedule-dom"
                    value={scheduleDayOfMonth}
                    onChange={(e) => setScheduleDayOfMonth(Number(e.target.value))}
                    className="w-full rounded-lg border border-white/15 bg-[#151b2e] px-3 py-2 text-sm text-white"
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm text-white/80 mb-1" htmlFor="schedule-recipients">
                  {t('agencyReport.schedule.recipients')}
                </label>
                <input
                  id="schedule-recipients"
                  type="text"
                  value={scheduleRecipients}
                  onChange={(e) => setScheduleRecipients(e.target.value)}
                  placeholder={t('agencyReport.schedule.recipientsPlaceholder')}
                  className="w-full rounded-lg border border-white/15 bg-[#151b2e] px-3 py-2 text-sm text-white"
                />
              </div>
              <ScheduleNextSendPreview cadence={scheduleCadence} dayOfMonth={scheduleDayOfMonth} dayOfWeek={scheduleDayOfWeek} />
              {scheduleError && <p className="text-sm text-red-400">{scheduleError}</p>}
              <button
                type="button"
                disabled={scheduleSaving}
                onClick={() => void handleCreateSchedule()}
                className="rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {scheduleSaving ? t('agencyReport.schedule.saving') : t('agencyReport.schedule.save')}
              </button>
            </div>
          </section>
        )}

        {projectId && canSchedule && (
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-white mb-3">{t('agencyReport.schedule.title')}</h2>
            {schedulesLoading ? (
              <LoadingSpinner text={t('agencyReport.schedule.loading')} />
            ) : schedules.length === 0 ? (
              <p className="text-sm text-white/50">{t('agencyReport.schedule.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {schedules.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
                  >
                    <div>
                      <p className="text-sm text-white">
                        {t(`agencyReport.schedule.${s.cadence}`)}
                        {s.cadence === 'weekly' && s.day_of_week != null
                          ? ` · ${t(WEEKDAY_OPTIONS.find((d) => d.value === s.day_of_week)?.labelKey ?? '')}`
                          : ''}
                        {s.cadence === 'monthly' && s.day_of_month != null
                          ? ` · ${t('agencyReport.schedule.dayOfMonthShort', { day: s.day_of_month })}`
                          : ''}
                      </p>
                      <p className="text-xs text-white/50">{(s.recipients ?? []).join(', ')}</p>
                      <p className="mt-1 text-xs text-white/60">
                        {s.active === false ? (
                          <span className="text-amber-300/90">{t('agencyReport.schedule.paused')}</span>
                        ) : (
                          <>
                            <span className="text-white/45">{t('agencyReport.schedule.nextSend')}: </span>
                            <span className="font-medium text-white/85">
                              {(() => {
                                const next = nextSendDate({
                                  cadence: s.cadence,
                                  dayOfWeek: s.day_of_week,
                                  dayOfMonth: s.day_of_month,
                                  lastRunAt: s.last_run_at,
                                })
                                return next
                                  ? formatSendDate(next, scheduleLocale, {
                                      today: t('agencyReport.schedule.today'),
                                      tomorrow: t('agencyReport.schedule.tomorrow'),
                                    })
                                  : '—'
                              })()}
                            </span>
                          </>
                        )}
                        {s.last_run_at && (
                          <span className="text-white/45">
                            {' · '}
                            {t('agencyReport.schedule.lastRun')}:{' '}
                            {new Date(s.last_run_at).toLocaleDateString(scheduleLocale, { day: 'numeric', month: 'short' })}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <ScheduleTestSendButton scheduleId={s.id} />
                      <button
                        type="button"
                        onClick={() => void handleDeleteSchedule(s)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        {t('agencyReport.schedule.delete')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section ref={recentReportsRef} className="mt-10 scroll-mt-24">
          <h2 className="text-lg font-semibold text-white mb-3">{t('agencyReport.recentReports')}</h2>
          {isLoading ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4" aria-busy="true">
              <TableSkeleton rows={4} cols={2} />
            </div>
          ) : recent.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-8 text-center">
              <p className="text-sm text-white/50">{t('agencyReport.noReports')}</p>
            </div>
          ) : (
            <RecentReportsList
              reports={recent}
              highlightId={lastBuild?.id ?? null}
              onOpen={(r) => navigate({ to: '/reports/portal/$reportId' as any, params: { reportId: r.id } as any })}
            />
          )}
        </section>
      </div>
      <UpgradeModal />
    </AppShell>
  )
}

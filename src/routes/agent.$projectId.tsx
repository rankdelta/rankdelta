import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SparklesIcon, CpuChipIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { AgentDashboard } from '../components/agent-dashboard/AgentDashboard'
import { ContentGeneratorPanel } from '../pages/ContentGenerator'
import { ContentRefreshPanel } from '../pages/ContentRefreshPage'
import { AppShell } from '../components/layout/AppShell'
import { useProjects } from '../hooks/useProjects'
import { useActiveProject } from '../hooks/useActiveProject'
import { getSessionSafe } from '../lib/requireAuth';

type Mode = 'generate' | 'refresh' | 'auto'

function AgentPage() {
  const { t } = useTranslation()
  const { projectId } = Route.useParams()
  const { mode: initialMode, url: refreshUrl } = Route.useSearch()
  const { data: projects } = useProjects()
  const project = projects?.find((p) => p.id === projectId)
  const { setActive } = useActiveProject()
  const [mode, setMode] = useState<Mode>(initialMode ?? 'generate')

  useEffect(() => {
    if (projectId) setActive(projectId)
  }, [projectId, setActive])

  const siteName = project?.name ?? t('contenuti.siteFallback')
  const siteUrl = project?.website_url ?? ''
  const niche = (project?.vertical as string) ?? project?.main_topic ?? 'general'
  const exampleKeyword = (project?.primary_keyword as string) ?? ''

  const tabs: Array<{ key: Mode; label: string; hint: string; Icon: typeof SparklesIcon }> = [
    { key: 'generate', label: t('contenuti.tabGenerate'), hint: t('contenuti.tabGenerateHint'), Icon: SparklesIcon },
    { key: 'refresh', label: t('contenuti.tabRefresh'), hint: t('contenuti.tabRefreshHint'), Icon: ArrowPathIcon },
    { key: 'auto', label: t('contenuti.tabAuto'), hint: t('contenuti.tabAutoHint'), Icon: CpuChipIcon },
  ]

  return (
    <AppShell>
      <div className="mb-6">
        <p className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('contenuti.eyebrow')}</p>
        {/* Site name already shown in the sidebar switcher — use a purpose title here instead. */}
        <h1 className="text-2xl font-bold text-white mt-1.5">{t('contenuti.title')}</h1>
      </div>

      {/* mode switch */}
      <div className="flex flex-wrap gap-2 mb-8">
        {tabs.map((t) => {
          const active = mode === t.key
          const Icon = t.Icon
          return (
            <button
              key={t.key}
              onClick={() => setMode(t.key)}
              title={t.hint}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                active
                  ? 'bg-white text-black border-white'
                  : 'border-white/15 text-white/60 hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={1.8} />
              {t.label}
            </button>
          )
        })}
      </div>

      {mode === 'generate' ? (
        <ContentGeneratorPanel projectId={projectId} siteName={siteName} siteUrl={siteUrl} niche={niche} exampleKeyword={exampleKeyword} hideHeader />
      ) : mode === 'refresh' ? (
        <ContentRefreshPanel projectId={projectId} siteName={siteName} siteUrl={siteUrl} niche={niche} autoUrl={refreshUrl} hideHeader />
      ) : (
        <AgentDashboard projectId={projectId} projectName={siteName} />
      )}
    </AppShell>
  )
}

export const Route = createFileRoute('/agent/$projectId')({
  validateSearch: (s: Record<string, unknown>): { mode?: Mode; url?: string; topic?: string } => ({
    mode: s['mode'] === 'refresh' || s['mode'] === 'auto' || s['mode'] === 'generate' ? s['mode'] : undefined,
    url: typeof s['url'] === 'string' ? s['url'] : undefined,
    topic: typeof s['topic'] === 'string' ? s['topic'] : undefined,
  }),
  beforeLoad: async () => {
    const {
      data: { session },
    } = await getSessionSafe()
    if (!session) throw redirect({ to: '/login' as any })
  },
  component: AgentPage,
})

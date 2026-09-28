/**
 * AgentDashboard — Owner-facing view for the autonomous SEO/GEO agent.
 *
 * Design principle: non-technical, "one number that goes up."
 * No jargon, no raw logs. Just:
 *   - Current status + big score
 *   - Recent activity feed
 *   - Content plan (what's coming)
 *   - One big "Start" button
 */

import { useState, type ComponentType, type SVGProps } from 'react'
import { useTranslation } from 'react-i18next'
import i18next, { type TFunction } from 'i18next'
import {
  DocumentTextIcon,
  SignalIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  MagnifyingGlassIcon,
  CalendarDaysIcon,
  HeartIcon,
  ExclamationTriangleIcon,
  RocketLaunchIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline'
import {
  useWPConnection,
  useContentPlan,
  useAgentRuns,
  useAgentActivity,
  useTriggerPipeline,
  useAgentRealtimeUpdates,
} from '../../hooks/useAgentPipeline'
import { WPConnectionSetup } from './WPConnectionSetup'
import type { AgentRun } from '../../services/agent/types'
import { hrefOf } from '../../lib/seoUrls'

interface Props {
  projectId: string
  projectName: string
}

type IconType = ComponentType<SVGProps<SVGSVGElement>>

// ─── ACTIVITY ICON MAP ────────────────────────────────────────────────────────

const ACTIVITY_ICON: Record<string, { Icon: IconType; tone: string }> = {
  article_published: { Icon: DocumentTextIcon,     tone: 'text-violet-300 bg-violet-500/10' },
  geo_mention:       { Icon: SignalIcon,            tone: 'text-violet-300 bg-violet-500/10' },
  ranking_improved:  { Icon: ArrowTrendingUpIcon,   tone: 'text-emerald-300 bg-emerald-500/10' },
  ranking_dropped:   { Icon: ArrowTrendingDownIcon, tone: 'text-rose-300 bg-rose-500/10' },
  audit_completed:   { Icon: MagnifyingGlassIcon,   tone: 'text-white/70 bg-white/[0.06]' },
  plan_created:      { Icon: CalendarDaysIcon,      tone: 'text-white/70 bg-white/[0.06]' },
  site_health:       { Icon: HeartIcon,             tone: 'text-emerald-300 bg-emerald-500/10' },
  error:             { Icon: ExclamationTriangleIcon, tone: 'text-amber-300 bg-amber-500/10' },
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function stageLabel(t: TFunction, stage: AgentRun['stage']): string {
  switch (stage) {
    case 'audit':   return t('agentDash.stageAudit')
    case 'plan':    return t('agentDash.stagePlan')
    case 'research': return t('agentDash.stageResearch')
    case 'write':   return t('agentDash.stageWrite')
    case 'publish': return t('agentDash.stagePublish')
    case 'monitor': return t('agentDash.stageMonitor')
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(i18next.language, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function timeAgo(t: TFunction, iso?: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return t('agentDash.timeNow')
  if (m < 60) return t('agentDash.timeMinutesAgo', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('agentDash.timeHoursAgo', { n: h })
  return t('agentDash.timeDaysAgo', { n: Math.floor(h / 24) })
}

// ─── STATUS PILL ─────────────────────────────────────────────────────────────

function StatusPill({ runs }: { runs: AgentRun[] }) {
  const { t } = useTranslation()
  const running = runs.find((r) => r.status === 'running')
  const lastFailed = runs.find((r) => r.status === 'failed')

  if (running) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-violet-500/15 border border-violet-500/30 text-violet-300 rounded-full text-sm font-medium">
        <span className="w-2 h-2 bg-violet-400 rounded-full animate-pulse" />
        {t('agentDash.stageInProgress', { stage: stageLabel(t, running.stage) })}
      </span>
    )
  }
  if (lastFailed && !runs.find((r) => r.status === 'completed' && r.createdAt > lastFailed.createdAt)) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-full text-sm font-medium">
        <ExclamationTriangleIcon className="w-4 h-4" strokeWidth={1.8} />
        {t('agentDash.statusLastRunError')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full text-sm font-medium">
      <span className="w-2 h-2 bg-emerald-400 rounded-full" />
      {t('agentDash.statusReady')}
    </span>
  )
}

// ─── SCORE RING ───────────────────────────────────────────────────────────────

function ScoreRing({ score, label }: { score: number; label: string; color: string }) {
  const r = 40
  const circumference = 2 * Math.PI * r
  const offset = circumference - (score / 100) * circumference
  const gradientId = `ring-grad-${label.replace(/\s/g, '')}`

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="100" height="100" viewBox="0 0 100 100" className="-rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="middle"
          className="rotate-90"
          style={{ transform: 'rotate(90deg) translate(0px, -100px)', fill: '#ffffff', fontSize: '20px', fontWeight: 700 }}
        >
          {score}
        </text>
      </svg>
      <span className="text-xs font-medium text-white/40">{label}</span>
    </div>
  )
}

// ─── CONTENT PLAN LIST ────────────────────────────────────────────────────────

function ContentPlanList({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const { data: plan, isLoading } = useContentPlan(projectId)

  if (isLoading) return <p className="text-sm text-white/30">{t('agentDash.loadingPlan')}</p>

  const items = plan ?? []
  const upcoming = items.filter((i) => i.status === 'planned').slice(0, 5)
  const done = items.filter((i) => i.status === 'completed').slice(0, 3)

  if (items.length === 0) {
    return (
      <p className="text-sm text-white/30 italic">
        {t('agentDash.planEmpty')}
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {done.map((item) => (
        <div key={item.id} className="flex items-center gap-3 py-2 border-b border-white/[0.04]">
          <CheckCircleIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" strokeWidth={1.8} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white/80 truncate">{item.title}</p>
            {item.wpPostUrl && (
              <a
                href={hrefOf(item.wpPostUrl) ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-violet-400 hover:underline"
              >
                {t('agentDash.readArticle')}
              </a>
            )}
          </div>
          <span className="text-xs text-white/25 flex-shrink-0">
            {formatDate(item.scheduledFor)}
          </span>
        </div>
      ))}
      {upcoming.map((item, i) => (
        <div key={item.id} className="flex items-center gap-3 py-2 border-b border-white/[0.04]">
          <span className="w-5 h-5 rounded-full border border-white/20 flex items-center justify-center text-[10px] font-bold text-white/30 flex-shrink-0">
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white/70 truncate">{item.title}</p>
            <p className="text-xs text-white/30">{t('agentDash.searchesPerMonth', { n: item.estimatedVolume.toLocaleString() })}</p>
          </div>
          <span className="text-xs text-white/25 flex-shrink-0">
            {formatDate(item.scheduledFor)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── ACTIVITY FEED ────────────────────────────────────────────────────────────

function ActivityFeed({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const { data: items, isLoading } = useAgentActivity(projectId, 10)

  if (isLoading) return <p className="text-sm text-white/30">{t('agentDash.loadingActivity')}</p>

  if (!items || items.length === 0) {
    return (
      <p className="text-sm text-white/30 italic">
        {t('agentDash.activityEmpty')}
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {items.map((item, i) => {
        const meta = ACTIVITY_ICON[item.type] ?? { Icon: DocumentTextIcon, tone: 'text-white/60 bg-white/[0.06]' }
        const Icon = meta.Icon
        return (
          <div key={i} className="flex items-start gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
            <span className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.tone}`}>
              <Icon className="w-4 h-4" strokeWidth={1.8} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white/80 leading-snug">{item.description}</p>
              {item.url && (
                <a
                  href={hrefOf(item.url) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-violet-400 hover:underline truncate block mt-0.5"
                >
                  {item.url.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>
            {item.timestamp && (
              <span className="text-[11px] text-white/25 flex-shrink-0 mt-0.5">
                {timeAgo(t, item.timestamp)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────

export function AgentDashboard({ projectId, projectName }: Props) {
  const { t } = useTranslation()
  const [showSetup, setShowSetup] = useState(false)
  const [lastResult, setLastResult] = useState<{ message: string; success: boolean } | null>(null)

  const { data: wpConn, isLoading: wpLoading } = useWPConnection(projectId)
  const { data: runs } = useAgentRuns(projectId)
  const trigger = useTriggerPipeline(projectId)

  useAgentRealtimeUpdates(projectId)

  const isRunning = runs?.some((r) => r.status === 'running') ?? false

  async function handleStartAgent() {
    setLastResult(null)
    try {
      const result = await trigger.mutateAsync({
        projectId,
        siteName: projectName,
      })
      setLastResult({ message: result.message, success: result.success })
    } catch (e) {
      setLastResult({
        message: t('agentDash.errorPrefix', { message: e instanceof Error ? e.message : String(e) }),
        success: false,
      })
    }
  }

  if (wpLoading) {
    return (
      <div className="flex items-center justify-center py-40">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!wpConn || showSetup) {
    return (
      <WPConnectionSetup
        projectId={projectId}
        onConnected={() => setShowSetup(false)}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('agentDash.eyebrow')}</p>
          <h1 className="text-3xl font-bold text-white mt-1.5">{projectName}</h1>
          <p className="text-white/40 mt-1">
            {wpConn.siteUrl} ·{' '}
            <button
              onClick={() => setShowSetup(true)}
              className="text-violet-400 hover:text-violet-300 transition-colors"
            >
              {t('agentDash.edit')}
            </button>
          </p>
        </div>
        <StatusPill runs={runs ?? []} />
      </div>

      {/* Score cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 flex flex-col items-center">
          <ScoreRing score={72} label={t('agentDash.seoScore')} color="#7c3aed" />
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 flex flex-col items-center">
          <ScoreRing score={58} label={t('agentDash.geoScore')} color="#34d399" />
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 flex flex-col justify-center">
          <p className="text-3xl font-bold text-white">
            {runs?.filter((r) => r.stage === 'publish' && r.status === 'completed').length ?? 0}
          </p>
          <p className="text-sm text-white/40 mt-1">{t('agentDash.publishedArticles')}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 flex flex-col justify-center">
          <p className="text-3xl font-bold text-emerald-400">
            {((runs ?? [])
              .reduce((s, r) => s + (r.costCents ?? 0), 0) / 100)
              .toFixed(2)}€
          </p>
          <p className="text-sm text-white/40 mt-1">{t('agentDash.spentThisMonth')}</p>
        </div>
      </div>

      {/* CTA button */}
      <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.08] to-transparent p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">
              {isRunning ? t('agentDash.ctaTitleRunning') : t('agentDash.ctaTitleIdle')}
            </h2>
            <p className="text-white/40 text-sm mt-0.5">
              {isRunning
                ? t('agentDash.ctaDescRunning')
                : t('agentDash.ctaDescIdle')}
            </p>
          </div>
          <button
            onClick={handleStartAgent}
            disabled={isRunning || trigger.isPending}
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isRunning ? (
              <>
                <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                {t('agentDash.btnInProgress')}
              </>
            ) : (
              <>
                <RocketLaunchIcon className="w-4 h-4" strokeWidth={2} />
                {t('agentDash.btnStartAgent')}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Last result message */}
      {lastResult && (
        <div
          className={`p-4 rounded-xl text-sm font-medium border ${
            lastResult.success
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
              : 'bg-rose-500/10 text-rose-300 border-rose-500/20'
          }`}
        >
          {lastResult.message}
        </div>
      )}

      {/* Two columns: activity + plan */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <p className="text-white/40 text-xs tracking-[0.18em] uppercase mb-4">{t('agentDash.recentActivity')}</p>
          <ActivityFeed projectId={projectId} />
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <p className="text-white/40 text-xs tracking-[0.18em] uppercase mb-4">{t('agentDash.contentPlan')}</p>
          <ContentPlanList projectId={projectId} />
        </div>
      </div>

      {/* Recent runs (technical) */}
      {runs && runs.length > 0 && (
        <details className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <summary className="text-white/50 text-sm font-medium cursor-pointer hover:text-white/70 transition-colors">
            {t('agentDash.technicalLog', { n: runs.length })}
          </summary>
          <div className="mt-4 space-y-1">
            {runs.slice(0, 10).map((run) => (
              <div
                key={run.id}
                className="flex items-center gap-3 text-sm py-1.5 border-b border-white/[0.04] last:border-0"
              >
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    run.status === 'completed'
                      ? 'bg-emerald-400'
                      : run.status === 'failed'
                      ? 'bg-rose-400'
                      : run.status === 'running'
                      ? 'bg-violet-400 animate-pulse'
                      : 'bg-white/20'
                  }`}
                />
                <span className="text-white/50 w-28 flex-shrink-0">{stageLabel(t, run.stage)}</span>
                <span className="text-white/25 text-xs">{formatDate(run.createdAt)}</span>
                {run.status === 'failed' && run.errorMessage && (
                  <span className="text-rose-400 text-xs truncate">{run.errorMessage}</span>
                )}
                {run.costCents > 0 && (
                  <span className="ml-auto text-white/25 text-xs flex-shrink-0">
                    {(run.costCents / 100).toFixed(2)}€
                  </span>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

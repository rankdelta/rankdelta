/**
 * Command Center — the home of the rebuilt product.
 *
 * One screen that tells the whole story: the GEO loop, with AI Share of Voice
 * (Quota di Voce AI) as the north-star metric, plus what the agent is doing and
 * what needs attention. Replaces the fragmented 3-system landing.
 */

import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { motion } from 'framer-motion'
import { useEffect, useRef, useState, type ComponentType, type SVGProps } from 'react'
import {
  MagnifyingGlassIcon,
  CalendarDaysIcon,
  PencilIcon,
  RocketLaunchIcon,
  SignalIcon,
  ArrowPathIcon,
  DocumentTextIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  HeartIcon,
  ExclamationTriangleIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  Squares2X2Icon,
  SparklesIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { AppShell } from '../components/layout/AppShell'
import { useActiveProject } from '../hooks/useActiveProject'
import type { Project } from '../types/database'
import { readOnboardingSnapshot, type OnboardingVisibility } from '../lib/onboardingSnapshot'
import {
  useWPConnection,
  useDashboardSummary,
  useAgentActivity,
  useAgentRuns,
  useTriggerPipeline,
  useAgentRealtimeUpdates,
  useAutonomy,
  useRefreshCandidates,
} from '../hooks/useAgentPipeline'
import { useVisibilityMentionInsights, useTrackedBrands, useVisibilityQueries, useVisibilityContentGaps, useCompetitorBrands } from '../hooks/useVisibilityTracker'
import { useLatestSiteAudit } from '../hooks/useSiteAudit'
import { useSubscription } from '../hooks/useSubscription'
import { useStartTrialModal } from '../components/subscription/StartTrialModal'
import { isAuditRunning } from '../services/auditStatus'
import { scoreTone } from '../lib/score'
import { isLowConfidenceSov } from '../lib/resultsMath'
import { hrefOf } from '../lib/seoUrls'
import { ShieldCheckIcon } from '@heroicons/react/24/outline'

// ─── helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null | undefined, t: TFunction): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return t('comando.timeNow')
  if (m < 60) return t('comando.timeMinutesAgo', { count: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('comando.timeHoursAgo', { count: h })
  return t('comando.timeDaysAgo', { count: Math.floor(h / 24) })
}

type IconType = ComponentType<SVGProps<SVGSVGElement>>

const ACTIVITY_ICON: Record<string, { Icon: IconType; tone: string }> = {
  article_published: { Icon: DocumentTextIcon, tone: 'text-violet-300 bg-violet-500/10' },
  geo_mention: { Icon: SignalIcon, tone: 'text-violet-300 bg-violet-500/10' },
  ranking_improved: { Icon: ArrowTrendingUpIcon, tone: 'text-emerald-300 bg-emerald-500/10' },
  ranking_dropped: { Icon: ArrowTrendingDownIcon, tone: 'text-rose-300 bg-rose-500/10' },
  audit_completed: { Icon: MagnifyingGlassIcon, tone: 'text-white/70 bg-white/[0.06]' },
  plan_created: { Icon: CalendarDaysIcon, tone: 'text-white/70 bg-white/[0.06]' },
  site_health: { Icon: HeartIcon, tone: 'text-emerald-300 bg-emerald-500/10' },
  error: { Icon: ExclamationTriangleIcon, tone: 'text-amber-300 bg-amber-500/10' },
}

type StepState = 'done' | 'active' | 'ready' | 'idle'

// ─── small UI atoms ─────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-white/40 text-xs tracking-[0.18em] uppercase">{children}</p>
}

/** Count an integer up to its target with an ease-out, only when the target changes. */
function useCountUp(target: number, duration = 700): number {
  const [n, setN] = useState(target)
  const fromRef = useRef(target)
  useEffect(() => {
    const from = fromRef.current
    if (from === target) return
    let raf = 0
    let start = 0
    const tick = (t: number) => {
      if (!start) start = t
      const p = Math.min(1, (t - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setN(Math.round(from + (target - from) * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return n
}

/** Animate the integer inside a pre-formatted value ("92", "85%", "0"); pass through "—", "€0.00", etc. */
function AnimatedValue({ value }: { value: string }) {
  const m = value.match(/^(\D*)(\d+)(\D*)$/)
  const target = m ? parseInt(m[2]!, 10) : 0
  const n = useCountUp(m ? target : 0)
  if (!m) return <>{value}</>
  return (
    <>
      {m[1]}
      {n}
      {m[3]}
    </>
  )
}

/**
 * Period-over-period change chip for the dark KPI cards (last 7 days vs the 7 before).
 * Green ▲ = improved, rose ▼ = declined. For metrics where lower is better (e.g. position),
 * pass positiveIsGood=false. Hidden when there's no prior-window comparison.
 */
function KpiDelta({ value, positiveIsGood = true, unit = 'pp', digits = 1 }: { value: number | null | undefined; positiveIsGood?: boolean; unit?: string; digits?: number }) {
  if (value == null) return null
  const flat = Math.abs(value) < (digits === 0 ? 0.5 : 0.05)
  const good = positiveIsGood ? value > 0 : value < 0
  const arrow = flat ? '■' : good ? '▲' : '▼'
  const cls = flat ? 'text-white/30' : good ? 'text-emerald-400' : 'text-rose-400'
  const mag = Math.abs(value).toFixed(digits)
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${cls}`}>
      {arrow} {mag}{unit ? ` ${unit}` : ''}
    </span>
  )
}

function StatCard({ label, value, sub, accent, Icon, calculating, delta }: { label: string; value: string; sub?: string; accent?: string; Icon?: IconType; calculating?: boolean; delta?: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 hover:bg-white/[0.03] transition-colors">
      <div className="flex items-center justify-between mb-3">
        <p className="text-white/40 text-xs">{label}</p>
        {Icon && (
          <span className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center">
            <Icon className={`w-4 h-4 ${calculating ? 'text-violet-300' : 'text-white/40'}`} strokeWidth={1.8} />
          </span>
        )}
      </div>
      {calculating ? (
        <>
          <div className="flex items-center gap-2.5">
            <ScoreSpinner />
            <span className="text-lg font-semibold text-white/80 animate-pulse">{t('comando.calculating')}</span>
          </div>
          <p className="text-violet-300/70 text-xs mt-1.5">{t('comando.calculatingHint')}</p>
        </>
      ) : (
        <>
          <p className="flex items-baseline gap-2">
            <span className={`text-3xl font-bold tracking-tight tabular-nums ${accent ?? 'text-white'}`}><AnimatedValue value={value} /></span>
            {delta}
          </p>
          {sub && <p className="text-white/45 text-xs mt-1.5">{sub}</p>}
        </>
      )}
    </div>
  )
}

/** A small, dynamic ring spinner for the "calculating score" state. */
function ScoreSpinner() {
  return (
    <span className="relative inline-flex h-7 w-7 shrink-0">
      <svg className="h-7 w-7 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="text-white/10" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-violet-400" />
      </svg>
    </span>
  )
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const w = 160
  const h = 40
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`)
    .join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke="url(#spark)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// ─── the GEO loop strip ─────────────────────────────────────────────────────

function GeoLoop({ steps }: { steps: Array<{ Icon: IconType; label: string; state: StepState; hint: string; onSelect?: () => void }> }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 h-full">
      <Eyebrow>{t('comando.geoLoopTitle')}</Eyebrow>
      {/* Horizontal scroll on narrow screens so the 6 steps stay legible instead of cramping. */}
      <div className="mt-6 -mx-1 overflow-x-auto">
      <div className="flex items-start justify-between gap-1 min-w-[460px] px-1">
        {steps.map((s, i) => {
          const Icon = s.Icon
          return (
            <div key={s.label} className="flex items-start flex-1 last:flex-none">
              <button
                type="button"
                onClick={s.onSelect}
                title={s.hint}
                className="flex flex-col items-center text-center gap-2.5 min-w-0 cursor-pointer group/node focus:outline-none"
              >
                <div
                  className={`relative w-11 h-11 rounded-xl flex items-center justify-center border transition-all group-hover/node:border-white/30 group-hover/node:bg-white/[0.05] ${
                    s.state === 'done'
                      ? 'bg-emerald-500/[0.08] border-emerald-500/30'
                      : s.state === 'active' || s.state === 'ready'
                        ? 'bg-violet-500/[0.12] border-violet-500/50'
                        : 'bg-white/[0.02] border-white/[0.08]'
                  }`}
                >
                  <Icon
                    className={`w-[18px] h-[18px] ${
                      s.state === 'done'
                        ? 'text-emerald-300'
                        : s.state === 'active' || s.state === 'ready'
                          ? 'text-violet-300'
                          : 'text-white/30'
                    }`}
                    strokeWidth={1.8}
                  />
                  {/* Pulsing dot ONLY for genuinely in-progress stages; 'ready' (next-up) gets a static dot. */}
                  {s.state === 'active' && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-400" />
                    </span>
                  )}
                  {s.state === 'ready' && (
                    <span className="absolute -top-0.5 -right-0.5 inline-flex rounded-full h-2.5 w-2.5 bg-violet-400/60 ring-2 ring-[#0e0e12]" />
                  )}
                </div>
                <span className={`text-[11px] font-medium transition-colors group-hover/node:text-white ${s.state === 'idle' ? 'text-white/45' : 'text-white/70'}`}>
                  {s.label}
                </span>
              </button>
              {i < steps.length - 1 && (
                <div className={`h-px flex-1 mx-1 mt-5 ${s.state === 'done' ? 'bg-emerald-500/30' : 'bg-white/[0.08]'}`} />
              )}
            </div>
          )
        })}
      </div>
      </div>
    </div>
  )
}

function snapshotAhaTitle(t: TFunction, vis: OnboardingVisibility): string {
  if (vis.level === 'recommended') return t('comando.snapshotRecommendedTitle', { brand: vis.brand })
  if (vis.level === 'known') return t('comando.snapshotKnownTitle', { brand: vis.brand })
  return t('comando.snapshotAbsentTitle', { brand: vis.brand })
}

// ─── inner (project guaranteed) ───────────────────────────────────────────────

function CommandCenterInner({ project }: { project: Project }) {
  const projectId = project.id
  const siteName = project.name
  const snap = readOnboardingSnapshot(project)
  const { t } = useTranslation()
  const navigate = useNavigate()
  useAgentRealtimeUpdates(projectId)

  const wp = useWPConnection(projectId)
  const summary = useDashboardSummary(projectId)
  const activity = useAgentActivity(projectId, 8)
  const runs = useAgentRuns(projectId)
  const insights = useVisibilityMentionInsights(projectId)
  const brands = useTrackedBrands(projectId)
  const queries = useVisibilityQueries(projectId)
  const trigger = useTriggerPipeline(projectId)
  const refresh = useRefreshCandidates(projectId)
  const audit = useLatestSiteAudit(projectId)
  const gaps = useVisibilityContentGaps(projectId)
  const competitorBrands = useCompetitorBrands(projectId)
  const [autonomy, setAutonomy] = useAutonomy(projectId)

  // Reverse-trial gate: the diagnosis below is free; the trial CTA is surfaced here, right after the
  // user sees their AI-visibility reveal (the highest-intent moment to ask for the card).
  const { canUseEngine, isTrialing, trialDaysRemaining, openPortal, refresh: refreshSubscription } = useSubscription()
  const trialModal = useStartTrialModal()

  // Returning from a successful trial checkout: the webhook updates the subscription async, so poll a
  // few times to flip the banner from "start trial" to "trialing" without a manual reload.
  useEffect(() => {
    let params: URLSearchParams
    try { params = new URLSearchParams(window.location.search) } catch { return }
    if (params.get('trial') !== 'started') return
    const timers = [800, 2500, 5000].map((ms) => window.setTimeout(() => refreshSubscription(), ms))
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [refreshSubscription])

  const health = audit.data
  const snapshotHealth = snap?.health
  // A freshly-onboarded project audits in the background; show a live "calculating" state until it lands.
  // If onboarding already saved a health snapshot, show that number instead of an empty dash.
  const auditing = !health && !snapshotHealth && isAuditRunning(projectId)
  const topIssue = health?.issues?.[0]
  // Canonical site-health number — MUST match the Diagnosi hero (SiteAuditPage) and the Results report,
  // which both show compositeHealth (incl. content freshness) and fall back to healthScore. Showing the
  // bare healthScore here made Comando read 92 while Diagnosi read 72 for the same site.
  const displayHealth =
    health != null ? (health.compositeHealth ?? health.healthScore) : (snapshotHealth?.compositeHealth ?? null)
  const healthAccent = displayHealth == null ? 'text-white/40' : scoreTone(displayHealth).text
  const healthFromSnapshot = health == null && snapshotHealth != null

  const AUTONOMY_OPTS: Array<{ key: 'manual' | 'review' | 'auto'; label: string; hint: string }> = [
    { key: 'manual', label: t('comando.autonomyManualLabel'), hint: t('comando.autonomyManualHint') },
    { key: 'review', label: t('comando.autonomyReviewLabel'), hint: t('comando.autonomyReviewHint') },
    { key: 'auto', label: t('comando.autonomyAutoLabel'), hint: t('comando.autonomyAutoHint') },
  ]

  const connected = !!wp.data
  const runList = runs.data ?? []
  const ins = insights.data

  const stageState = (stage: string): StepState => {
    const r = runList.filter((x) => x.stage === stage)
    if (r.some((x) => x.status === 'running')) return 'active'
    if (r.some((x) => x.status === 'completed')) return 'done'
    return 'idle'
  }

  const published = summary.data.articlesPublished
  const planned = summary.data.articlesPlanned
  const hasVisibility = !!ins?.hasData
  const snapshotVis = !hasVisibility ? snap?.visibility : undefined
  const hasHealth = !!health || !!snapshotHealth
  const hasQueries = (queries.data?.length ?? 0) > 0 || !!snapshotVis?.query

  const loopSteps: Array<{ Icon: IconType; label: string; state: StepState; hint: string; onSelect?: () => void }> = [
    { Icon: MagnifyingGlassIcon, label: t('comando.loopAuditLabel'), hint: t('comando.loopAuditHint'), state: hasHealth ? 'done' : auditing ? 'active' : connected ? (stageState('audit') === 'idle' ? 'done' : stageState('audit')) : 'idle', onSelect: () => navigate({ to: '/audit' as any }) },
    { Icon: CalendarDaysIcon, label: t('comando.loopPlanLabel'), hint: t('comando.loopPlanHint'), state: planned > 0 || published > 0 ? 'done' : stageState('plan'), onSelect: () => navigate({ to: '/piano' as any }) },
    { Icon: PencilIcon, label: t('comando.loopWriteLabel'), hint: t('comando.loopWriteHint'), state: stageState('write') !== 'idle' ? stageState('write') : published > 0 ? 'done' : 'idle', onSelect: () => navigate({ to: '/agent/$projectId', params: { projectId } }) },
    { Icon: RocketLaunchIcon, label: t('comando.loopPublishLabel'), hint: t('comando.loopPublishHint'), state: published > 0 ? 'done' : stageState('publish'), onSelect: () => navigate({ to: '/agent/$projectId', params: { projectId } }) },
    { Icon: SignalIcon, label: t('comando.loopMeasureLabel'), hint: t('comando.loopMeasureHint'), state: hasVisibility ? 'done' : hasQueries || snapshotVis ? 'ready' : 'idle', onSelect: () => navigate({ to: `/visibility/${projectId}/` as any }) },
    { Icon: ArrowPathIcon, label: t('comando.loopRefreshLabel'), hint: t('comando.loopRefreshHint'), state: (refresh.data?.length ?? 0) > 0 ? 'ready' : published > 0 ? 'done' : 'idle', onSelect: () => navigate({ to: '/piano' as any }) },
  ]

  const sov = ins?.sovLast7d ?? ins?.shareOfVoicePercent ?? null
  const delta = ins?.sovWeekOverWeekDelta ?? null
  const trend = (ins?.trend14d ?? []).map((d) => d.yours)
  // While the visibility query is still loading, show a loading state instead of the "no data yet"
  // empty state — otherwise a returning user briefly sees "Run your first check" and thinks their
  // tracking data vanished. An onboarding snapshot is already an answer: show it immediately.
  const insightsLoading = insights.isLoading && !snapshotVis
  const noCompetitors = sov != null && (competitorBrands.data?.length ?? 0) === 0
  const mentionCount = hasVisibility
    ? (ins?.yourBrandMentions ?? 0)
    : snapshotVis
      ? (snapshotVis.cited ? 1 : 0)
      : (ins?.yourBrandMentions ?? 0)

  // next actions
  const actions: Array<{ done: boolean; label: string; cta: string; to: string; optional?: boolean }> = [
    { done: hasHealth, label: t('comando.actionRunAudit'), cta: t('comando.ctaDiagnosi'), to: '/audit' },
    ...(topIssue && (topIssue.severity === 'critical' || topIssue.severity === 'warning')
      ? [{ done: false, label: t('comando.actionFixIssue', { issue: topIssue.label }), cta: t('comando.ctaOpen'), to: '/audit' }]
      : []),
    { done: (brands.data?.length ?? 0) > 0, label: t('comando.actionAddBrand'), cta: t('comando.ctaAdd'), to: `/visibility/${projectId}/competitors` },
    { done: hasQueries, label: t('comando.actionAddQueries'), cta: t('comando.ctaOpen'), to: `/visibility/${projectId}/queries` },
    { done: hasVisibility || !!snapshotVis, label: t('comando.actionFirstVisibilityCheck'), cta: t('comando.ctaMeasure'), to: `/visibility/${projectId}/queries` },
    ...(snapshotVis && !hasVisibility
      ? [{ done: false, label: t('comando.actionTrackOverTime'), cta: t('comando.ctaMeasure'), to: `/visibility/${projectId}/queries` }]
      : []),
    { done: connected, label: t('comando.actionConnectChannel'), cta: t('comando.ctaConnect'), to: `/agent/${projectId}`, optional: true },
    { done: published > 0 || !connected, label: t('comando.actionPublishFirst'), cta: t('comando.ctaStart'), to: `/agent/${projectId}`, optional: true },
  ]
  const pending = actions.filter((a) => !a.done)

  // ── Unified "Prossima mossa" feed: setup gaps first, then the audit's prioritized fixes,
  // then content opportunities from the visibility gaps. One guided list, in priority order. ──
  type Move = { id: string; label: string; why?: string; onSelect: () => void; tone: 'setup' | 'fix' | 'grow' }
  const moves: Move[] = []
  // 1. Setup steps still pending (can't run the loop without them).
  for (const a of pending) moves.push({ id: `setup:${a.label}`, label: a.label, onSelect: () => navigate({ to: a.to as any }), tone: 'setup' })
  // 2. Top fixes from the guided audit (refresh weak pages / add schema / generate) — one-click deep-links into the action.
  const planItems = (health?.plan ?? []).filter((p) => p.kind !== 'fix_technical').slice(0, 3)
  for (const p of planItems) {
    let onSelect: () => void
    if ((p.kind === 'refresh_page' || p.kind === 'improve_citability') && p.target) {
      const target = p.target
      onSelect = () => navigate({ to: '/agent/$projectId', params: { projectId }, search: { mode: 'refresh' as const, url: target } })
    } else if (p.kind === 'generate_content') {
      onSelect = () => navigate({ to: '/agent/$projectId', params: { projectId }, search: { mode: 'generate' as const } })
    } else {
      // add_schema (schema modal lives on the audit page) and any plan item without a target.
      onSelect = () => navigate({ to: '/audit' as any })
    }
    moves.push({ id: p.id, label: p.title, why: p.why, onSelect, tone: 'fix' })
  }
  // 3. Content opportunities: prompts where competitors are cited but you aren't.
  for (const g of (gaps.data ?? []).slice(0, 2)) {
    moves.push({
      id: `gap:${g.queryId}`,
      label: t('comando.moveCreateContent', { query: g.text }),
      why: g.competitorMentions > 0 ? t('comando.moveCompetitorsCited', { count: g.competitorMentions }) : t('comando.moveNotCitedYet'),
      onSelect: () => navigate({ to: `/visibility/${projectId}` as any }),
      tone: 'grow',
    })
  }

  const MOVE_TONE: Record<Move['tone'], string> = {
    setup: 'border-white/20 group-hover:border-violet-400/60',
    fix: 'border-amber-400/50 group-hover:border-amber-400',
    grow: 'border-emerald-400/50 group-hover:border-emerald-400',
  }

  return (
    <>
      {/* header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <Eyebrow>{t('comando.eyebrow')}</Eyebrow>
          {/* The site name already lives in the sidebar switcher — don't repeat it as a big title here. */}
          <h1 className="text-2xl font-bold text-white mt-1.5">{t('comando.subtitle')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Trust dial — visible on mobile too (it controls autonomy mode) */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-full border border-white/[0.1] bg-white/[0.02]" title={t('comando.autonomyDialTitle')}>
            {AUTONOMY_OPTS.map((o) => (
              <button
                key={o.key}
                onClick={() => setAutonomy(o.key)}
                title={o.hint}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  autonomy === o.key ? 'bg-white text-black' : 'text-white/45 hover:text-white/80'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {connected ? (
            <button
              onClick={() => trigger.mutate({ projectId, siteName, autonomy })}
              disabled={trigger.isPending}
              className="px-5 py-2.5 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 transition-all disabled:opacity-50"
            >
              {trigger.isPending ? (
                t('comando.starting')
              ) : (
                <span className="flex items-center gap-1.5"><RocketLaunchIcon className="w-4 h-4" strokeWidth={2} /> {t('comando.startAgent')}</span>
              )}
            </button>
          ) : (
            <button
              onClick={() => navigate({ to: `/visibility/${projectId}/queries` as any })}
              className="px-5 py-2.5 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 transition-all"
            >
              {t('comando.measureVisibility')}
            </button>
          )}
          <button
            onClick={() => navigate({ to: '/content/generate' as any })}
            className="px-4 py-2.5 rounded-full border border-white/15 text-white/70 text-sm font-medium hover:bg-white/[0.06] hover:text-white transition-all flex items-center gap-1.5"
            title={t('comando.generateArticleTitle')}
          >
            <SparklesIcon className="w-4 h-4" strokeWidth={1.8} /> {t('comando.generateArticle')}
          </button>
          <button
            onClick={() => navigate({ to: '/reports/portal' as any })}
            className="px-4 py-2.5 rounded-full border border-white/15 text-white/70 text-sm font-medium hover:bg-white/[0.06] hover:text-white transition-all flex items-center gap-1.5"
            title={t('agencyReport.builderTitle')}
          >
            <DocumentTextIcon className="w-4 h-4" strokeWidth={1.8} /> {t('agencyReport.buildReport')}
          </button>
          <button
            onClick={() => navigate({ to: '/report' as any })}
            className="px-4 py-2.5 rounded-full border border-white/15 text-white/70 text-sm font-medium hover:bg-white/[0.06] hover:text-white transition-all flex items-center gap-1.5"
            title={t('comando.reportTitle')}
          >
            <DocumentTextIcon className="w-4 h-4" strokeWidth={1.8} /> {t('comando.report')}
          </button>
        </div>
      </div>

      {/* Active autonomy mode — gives the Manuale/Revisione/Auto toggle visible meaning (it only
          affects a pipeline run, so without this the click looks like it does nothing). */}
      {(() => {
        const active = AUTONOMY_OPTS.find((o) => o.key === autonomy)
        return active ? (
          <div className="-mt-5 mb-6 flex items-start gap-2 text-xs text-white/50">
            <span className="shrink-0 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-medium text-violet-200">
              {t('comando.modeLabel', { mode: active.label })}
            </span>
            <span className="leading-relaxed pt-0.5">{active.hint}</span>
          </div>
        ) : null
      })()}

      {/* Trial gate banner — co-locates the reveal with the card-required CTA. The diagnosis stays
          free; this is where we ask for the card, at the moment intent is highest. */}
      {!canUseEngine && (
        <div className="mb-5 rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/[0.12] to-fuchsia-500/[0.05] p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white flex items-center gap-2">
              <SparklesIcon className="w-4 h-4 text-violet-300" strokeWidth={1.8} />
              {sov != null && sov < 50
                ? t('trial.bannerTitleLowSov', { sov: sov.toFixed(0) })
                : t('trial.bannerTitle')}
            </p>
            <p className="text-sm text-white/55 mt-1 leading-relaxed">
              {t('trial.bannerBody')}
            </p>
          </div>
          <button
            onClick={() => trialModal.openTrialModal()}
            className="shrink-0 px-5 py-2.5 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 transition-all"
          >
            {t('trial.bannerCta')}
          </button>
        </div>
      )}

      {isTrialing && (
        <div className={`mb-5 rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
          (trialDaysRemaining ?? 0) <= 2 ? 'border-amber-500/40 bg-amber-500/[0.08]' : 'border-white/[0.1] bg-white/[0.02]'
        }`}>
          <p className="flex-1 text-sm text-white/70">
            <span className="font-semibold text-white">
              {trialDaysRemaining != null
                ? t('trial.trialingDays', { count: trialDaysRemaining })
                : t('billing.statusTrialing', { days: 0 })}
            </span>
            <span className="text-white/45"> · {t('trial.trialingNote')}</span>
          </p>
          <button
            onClick={() => void openPortal()}
            className="shrink-0 px-4 py-2 rounded-full border border-white/15 text-white/80 text-sm font-medium hover:bg-white/[0.06] transition-all"
          >
            {t('trial.choosePlanCta')}
          </button>
        </div>
      )}

      {/* hero + loop */}
      <div className="grid lg:grid-cols-3 gap-5 mb-5">
        {/* north star */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-1 rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.08] to-transparent p-6 flex flex-col"
        >
          <Eyebrow>{t('comando.northStarEyebrow')}</Eyebrow>
          {insightsLoading ? (
            <div className="mt-3 space-y-3">
              <div className="h-12 w-28 rounded-lg bg-white/[0.06] animate-pulse" />
              <div className="h-3 w-40 rounded bg-white/[0.04] animate-pulse" />
            </div>
          ) : sov != null ? (
            <>
              <div className="flex items-end gap-3 mt-3">
                <span className="text-5xl font-bold text-white">{sov.toFixed(0)}%</span>
                {delta != null && (
                  <span className={`mb-1.5 text-sm font-semibold ${delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {delta >= 0 ? '▲' : '▼'} {t('comando.points', { points: Math.abs(delta).toFixed(1) })}
                  </span>
                )}
              </div>
              <p className="text-white/40 text-sm mt-1">{t('comando.northStarSub')}</p>
              {!noCompetitors && ins && isLowConfidenceSov(ins.yourBrandMentions, ins.totalCompetitorMentions) && (
                <p className="mt-2 text-[12px] text-amber-300/80">
                  {t('visibility.sovLowConfidenceShort', { mentions: ins.yourBrandMentions + ins.totalCompetitorMentions })}
                </p>
              )}
              {noCompetitors && (
                <p className="mt-2 text-[12px] text-amber-300/80">
                  {t('comando.sovNoCompetitors')}{' '}
                  <button
                    onClick={() => navigate({ to: `/visibility/${projectId}/competitors` as any })}
                    className="font-medium underline underline-offset-2 hover:text-amber-200"
                  >
                    {t('comando.sovAddCompetitors')}
                  </button>
                </p>
              )}
              <div className="mt-auto pt-4">{trend.length > 1 && <Sparkline data={trend} />}</div>
            </>
          ) : snapshotVis ? (
            <>
              <div className="flex items-start gap-2.5 mt-3">
                {snapshotVis.level === 'recommended' ? (
                  <CheckCircleIcon className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" strokeWidth={1.8} />
                ) : snapshotVis.level === 'known' ? (
                  <ExclamationTriangleIcon className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" strokeWidth={1.8} />
                ) : (
                  <XCircleIcon className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" strokeWidth={1.8} />
                )}
                <p className="text-lg font-semibold text-white leading-snug">{snapshotAhaTitle(t, snapshotVis)}</p>
              </div>
              <p className="text-white/40 text-sm mt-2">
                {snapshotVis.query
                  ? t('comando.snapshotQuerySub', { query: snapshotVis.query })
                  : t('comando.snapshotQuerySubNoQuery')}
              </p>
              {snapshotVis.level !== 'recommended' && snapshotVis.competitors.length > 0 && (
                <p className="text-white/50 text-sm mt-2">
                  {t('comando.snapshotCompetitors', { names: snapshotVis.competitors.slice(0, 3).join(', ') })}
                </p>
              )}
              <button
                onClick={() => navigate({ to: `/visibility/${projectId}/queries` as any })}
                className="mt-4 self-start px-4 py-2 rounded-full border border-violet-500/40 text-violet-300 text-sm font-medium hover:bg-violet-500/10 transition-colors"
              >
                {t('comando.trackOverTime')}
              </button>
            </>
          ) : (
            <>
              <p className="text-white/50 text-sm mt-3 flex-1">
                {t('comando.northStarEmpty')}
              </p>
              <button
                onClick={() => navigate({ to: `/visibility/${projectId}/queries` as any })}
                className="mt-4 self-start px-4 py-2 rounded-full border border-violet-500/40 text-violet-300 text-sm font-medium hover:bg-violet-500/10 transition-colors"
              >
                {t('comando.startFirstCheck')}
              </button>
            </>
          )}
        </motion.div>

        {/* loop */}
        <div className="lg:col-span-2">
          <GeoLoop steps={loopSteps} />
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-5">
        <StatCard label={t('comando.kpiSiteHealth')} value={displayHealth != null ? `${displayHealth}` : '—'} sub={health || healthFromSnapshot ? t(healthFromSnapshot ? 'comando.kpiSiteHealthSubOnboarding' : 'comando.kpiSiteHealthSubReady') : t('comando.kpiSiteHealthSubEmpty')} accent={healthAccent} Icon={ShieldCheckIcon} calculating={auditing} />
        <StatCard label={t('comando.kpiArticlesPublished')} value={String(published)} sub={t('comando.kpiArticlesPlanned', { count: planned })} Icon={DocumentTextIcon} />
        <StatCard label={t('comando.kpiAiCitations')} value={String(mentionCount)} sub={snapshotVis ? t('comando.kpiAiCitationsSubFirstRead') : t('comando.kpiAiCitationsSub')} accent="text-violet-300" Icon={SignalIcon} calculating={insightsLoading} delta={snapshotVis ? undefined : <KpiDelta value={ins?.mentionsWeekOverWeekDelta} positiveIsGood unit="" digits={0} />} />
        <StatCard label={t('comando.kpiShareOfVoice')} value={sov != null ? `${sov.toFixed(0)}%` : '—'} sub={snapshotVis ? t('comando.kpiShareOfVoiceSubFirstRead') : t('comando.kpiShareOfVoiceSub')} accent="text-emerald-300" Icon={ArrowTrendingUpIcon} calculating={insightsLoading} delta={snapshotVis ? undefined : <KpiDelta value={delta} positiveIsGood unit="pp" />} />
      </div>

      {/* closed loop — articles losing AI citations / rank */}
      {(refresh.data?.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-6 mb-5">
          <div className="flex items-center justify-between mb-4">
            <span className="flex items-center gap-2"><ArrowPathIcon className="w-4 h-4 text-amber-300" strokeWidth={1.8} /><Eyebrow>{t('comando.toRefreshTitle')}</Eyebrow></span>
            <span className="text-xs text-white/30">{t('comando.articlesCount', { count: refresh.data!.length })}</span>
          </div>
          <div className="space-y-2">
            {refresh.data!.slice(0, 4).map((c) => (
              <div key={c.planItemId} className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                  c.reason === 'rank_drop' ? 'bg-rose-500/15 text-rose-300'
                    : c.reason === 'no_geo' ? 'bg-violet-500/15 text-violet-300'
                    : 'bg-white/[0.06] text-white/50'
                }`}>
                  {c.reason === 'rank_drop' ? t('comando.reasonRank') : c.reason === 'no_geo' ? t('comando.reasonAi') : t('comando.reasonStale')}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white/80 truncate">{c.title}</p>
                  <p className="text-xs text-white/40 truncate">{c.detail}</p>
                </div>
                {c.wpPostUrl && (
                  <a href={hrefOf(c.wpPostUrl) ?? undefined} target="_blank" rel="noopener" className="text-xs text-violet-400 hover:underline flex-shrink-0">
                    {t('comando.openLink')}
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* two columns */}
      <div className="grid lg:grid-cols-3 gap-5">
        {/* activity — self-start so an empty log hugs its content instead of stretching to the tall
            "next move" column beside it (that left a big empty void on new projects). */}
        <div className="lg:col-span-2 self-start rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
          <Eyebrow>{t('comando.activityTitle')}</Eyebrow>
          <div className="mt-4 space-y-1">
            {(activity.data?.length ?? 0) === 0 ? (
              <p className="text-white/30 text-sm py-8 text-center">
                {t('comando.activityEmpty')}
              </p>
            ) : (
              activity.data!.map((a, i) => {
                const meta = ACTIVITY_ICON[a.type] ?? { Icon: DocumentTextIcon, tone: 'text-white/60 bg-white/[0.06]' }
                const Icon = meta.Icon
                return (
                  <div key={i} className="flex items-start gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
                    <span className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.tone}`}>
                      <Icon className="w-4 h-4" strokeWidth={1.8} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/80 leading-snug">{a.description}</p>
                      {a.url && (
                        <a href={hrefOf(a.url) ?? undefined} target="_blank" rel="noopener" className="text-xs text-violet-400 hover:underline truncate block mt-0.5">
                          {a.url.replace(/^https?:\/\//, '')}
                        </a>
                      )}
                    </div>
                    <span className="text-[11px] text-white/25 flex-shrink-0">{timeAgo(a.timestamp, t)}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* next moves — the guided "do this next", in priority order */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
          <Eyebrow>{t('comando.nextMoveTitle')}</Eyebrow>
          {moves.length === 0 ? (
            <div className="mt-4 text-center py-8">
              <CheckCircleIcon className="w-10 h-10 text-emerald-400/80 mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-white/60 text-sm">{t('comando.nextMoveAllDone')}</p>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {moves.slice(0, 6).map((a) => (
                <button
                  key={a.id}
                  onClick={a.onSelect}
                  className="w-full flex items-start gap-3 text-left p-3 rounded-xl border border-white/[0.06] hover:border-white/[0.15] hover:bg-white/[0.03] transition-all group"
                >
                  <span className={`mt-0.5 w-4.5 h-4.5 rounded-full border flex-shrink-0 transition-colors ${MOVE_TONE[a.tone]}`} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-white/80 leading-snug">{a.label}</span>
                    {a.why && <span className="block text-xs text-white/40 leading-snug mt-0.5">{a.why}</span>}
                  </span>
                  <ChevronRightIcon className="w-4 h-4 text-white/20 group-hover:text-violet-400 flex-shrink-0 transition-colors mt-0.5" strokeWidth={2} />
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => navigate({ to: '/piano' as any })}
            className="mt-4 w-full flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.06] py-2.5 text-sm text-white/50 transition hover:border-white/15 hover:text-white/80"
          >
            <CalendarDaysIcon className="w-4 h-4" strokeWidth={1.8} />
            {t('comando.viewFullPlan')}
          </button>
        </div>
      </div>

      <trialModal.StartTrialModal />
    </>
  )
}

// ─── outer (resolves project) ─────────────────────────────────────────────────

export function CommandCenter() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { activeProject, isLoading } = useActiveProject()

  if (isLoading) {
    return (
      <AppShell>
        <div className="animate-pulse">
          <div className="mb-8 space-y-2">
            <div className="h-2.5 w-20 rounded bg-white/[0.06]" />
            <div className="h-8 w-56 rounded-lg bg-white/[0.08]" />
            <div className="h-3 w-96 max-w-full rounded bg-white/[0.05]" />
          </div>
          <div className="grid lg:grid-cols-3 gap-5 mb-5">
            <div className="h-44 rounded-2xl border border-white/[0.06] bg-white/[0.02]" />
            <div className="lg:col-span-2 h-44 rounded-2xl border border-white/[0.06] bg-white/[0.02]" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-2xl border border-white/[0.06] bg-white/[0.02]" />
            ))}
          </div>
          <div className="grid lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 h-56 rounded-2xl border border-white/[0.06] bg-white/[0.02]" />
            <div className="h-56 rounded-2xl border border-white/[0.06] bg-white/[0.02]" />
          </div>
        </div>
      </AppShell>
    )
  }

  if (!activeProject) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto text-center py-32">
          <Squares2X2Icon className="w-12 h-12 text-violet-400/70 mx-auto mb-4" strokeWidth={1.4} />
          <h1 className="text-2xl font-bold text-white">{t('comando.createFirstSiteTitle')}</h1>
          <p className="text-white/40 mt-2 mb-8">
            {t('comando.createFirstSiteSub')}
          </p>
          <button
            onClick={() => navigate({ to: '/projects/new' as any })}
            className="px-6 py-3 rounded-full bg-white text-black font-semibold hover:bg-white/90 transition-all"
          >
            {t('comando.addSite')}
          </button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <CommandCenterInner project={activeProject} />
    </AppShell>
  )
}

export default CommandCenter

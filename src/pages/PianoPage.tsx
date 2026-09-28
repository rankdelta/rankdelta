/**
 * PianoPage — the full editorial plan (the "Pianifica" stage of the GEO loop).
 *
 * The Comando shows the TOP few "Prossima mossa" items as a glance widget; this page is the
 * COMPLETE, prioritized working backlog behind it, unifying the three real sources that are
 * otherwise scattered across the app:
 *
 *   • Pagine da aggiornare   ← the audit's stale-content scan (sitemap lastmod + GEO gaps)
 *   • Gap di citazione       ← visibility queries where competitors are cited but you aren't
 *   • Azioni dell'audit      ← the guided audit's prioritized content actions (new article, citability, schema)
 *   • Proposte pronte        ← already-drafted content proposals
 *
 * Every row says WHAT to do and WHY it matters, with a single-click action that deep-links into the
 * generator (refresh / write) — so "constant execution" is a worklist, not a blank page. Plus two
 * lighter sections for momentum: what's scheduled, and what's already published (throughput proof).
 *
 * No new services/network: reads data the app already stores. Stays in the dashboard paradigm.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowPathIcon,
  PencilSquareIcon,
  SparklesIcon,
  ShieldCheckIcon,
  CodeBracketIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline'
import { AppShell } from '../components/layout/AppShell'
import { useActiveProject } from '../hooks/useActiveProject'
import { useLatestSiteAudit } from '../hooks/useSiteAudit'
import { useVisibilityContentGaps } from '../hooks/useVisibilityTracker'
import { useContentProposals } from '../hooks/useContentProposals'
import { useContentList } from '../hooks/useContent'
import { useKeywordMetrics, formatVolume } from '../hooks/useKeywordMetrics'

type BadgeTone = 'refresh' | 'new' | 'gap' | 'citability' | 'schema'

interface Backlog {
  id: string
  badge: string
  tone: BadgeTone
  title: string
  why: string
  meta?: string
  /** The search term this item targets — used to look up real volume + difficulty. */
  keyword?: string
  priority: number
  actionLabel: string
  onAction: () => void
}

/** Pull a clean keyword from a plan title like `Aggiorna "Zero-Day Vulnerability"`. */
function keywordFromTitle(title: string): string {
  return (title.match(/[«"“]([^»"”]+)[»"”]/)?.[1] ?? title).trim()
}

const TONE: Record<BadgeTone, { chip: string; Icon: typeof ArrowPathIcon }> = {
  refresh: { chip: 'border-amber-500/30 bg-amber-500/10 text-amber-200', Icon: ArrowPathIcon },
  new: { chip: 'border-violet-500/30 bg-violet-500/10 text-violet-200', Icon: PencilSquareIcon },
  gap: { chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200', Icon: SparklesIcon },
  citability: { chip: 'border-sky-500/30 bg-sky-500/10 text-sky-200', Icon: ShieldCheckIcon },
  schema: { chip: 'border-white/15 bg-white/[0.06] text-white/60', Icon: CodeBracketIcon },
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return ''
  try {
    return new Date(s).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
  } catch {
    return ''
  }
}

export function PianoPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { activeProject, isLoading } = useActiveProject()
  const projectId = activeProject?.id

  const audit = useLatestSiteAudit(projectId)
  const gaps = useVisibilityContentGaps(projectId)
  const proposals = useContentProposals(projectId)
  const content = useContentList(projectId)

  const backlog = useMemo<Backlog[]>(() => {
    if (!projectId) return []
    const items: Backlog[] = []

    const goRefresh = (url: string) =>
      navigate({ to: '/agent/$projectId', params: { projectId }, search: { mode: 'refresh' as const, url } })
    const goGenerate = (topic?: string) =>
      navigate({
        to: '/agent/$projectId',
        params: { projectId },
        search: { mode: 'generate' as const, ...(topic ? { topic } : {}) },
      })
    const goAudit = () => navigate({ to: '/audit' as any })

    // 1. The guided audit's prioritized plan — the single source for audit-derived work. It already
    //    covers stale pages (refresh_page), page-quality defects (refresh_page), citability lifts,
    //    schema, and any new-content needs. We skip fix_technical (site-side guidance lives on Diagnosi).
    for (const p of audit.data?.plan ?? []) {
      if (p.kind === 'fix_technical') continue
      const meta = p.count && p.count > 1 ? t('pianoPage.pagesCount', { count: p.count }) : undefined
      if (p.kind === 'refresh_page') {
        items.push({
          id: p.id, badge: t('pianoPage.badgeRefresh'), tone: 'refresh', title: p.title, why: p.why, keyword: keywordFromTitle(p.title),
          ...(meta ? { meta } : {}), priority: p.priority, actionLabel: t('pianoPage.actionRefresh'),
          onAction: () => (p.target ? goRefresh(p.target) : goAudit()),
        })
      } else if (p.kind === 'improve_citability') {
        items.push({
          id: p.id, badge: t('pianoPage.badgeImproveCitability'), tone: 'citability', title: p.title, why: p.why, keyword: keywordFromTitle(p.title),
          ...(meta ? { meta } : {}), priority: p.priority, actionLabel: t('pianoPage.actionImprove'),
          onAction: () => (p.target ? goRefresh(p.target) : goAudit()),
        })
      } else if (p.kind === 'add_schema') {
        items.push({
          id: p.id, badge: t('pianoPage.badgeSchema'), tone: 'schema', title: p.title, why: p.why,
          ...(meta ? { meta } : {}), priority: p.priority, actionLabel: t('pianoPage.actionOpenDiagnosi'), onAction: goAudit,
        })
      } else if (p.kind === 'generate_content') {
        items.push({
          id: p.id, badge: t('pianoPage.badgeNewArticle'), tone: 'new', title: p.title, why: p.why, keyword: p.target || keywordFromTitle(p.title),
          ...(meta ? { meta } : {}), priority: p.priority, actionLabel: t('pianoPage.actionWrite'),
          onAction: () => goGenerate(p.target),
        })
      }
    }

    // 2. Citation gaps → write content to win the AI answer.
    for (const g of (gaps.data ?? []).slice(0, 25)) {
      items.push({
        id: `gap:${g.queryId}`,
        badge: t('pianoPage.badgeCitationGap'),
        tone: 'gap',
        title: t('pianoPage.winCitationTitle', { query: g.text }),
        keyword: g.text,
        why:
          g.competitorMentions > 0
            ? t('pianoPage.competitorsCitedYouNot', { count: g.competitorMentions })
            : t('pianoPage.notCitedInAiAnswer'),
        priority: 55 + g.competitorMentions * 5,
        actionLabel: t('pianoPage.actionWrite'),
        onAction: () => goGenerate(g.text),
      })
    }

    // 3. Pending proposals → ready-to-write drafts (open the proposals workspace).
    for (const pr of (proposals.data ?? []).filter((x) => x.status === 'pending').slice(0, 15)) {
      items.push({
        id: `proposal:${pr.id}`,
        badge: t('pianoPage.badgeProposal'),
        tone: 'new',
        title: pr.title,
        ...(pr.primaryKeyword ? { keyword: pr.primaryKeyword } : {}),
        why: pr.clusterName || pr.primaryKeyword || t('pianoPage.draftReady'),
        priority: 40,
        actionLabel: t('pianoPage.actionOpen'),
        onAction: () => navigate({ to: '/proposals' as any }),
      })
    }

    return items.sort((a, b) => b.priority - a.priority)
  }, [projectId, audit.data, gaps.data, proposals.data, navigate, t])

  // Real Google volume + difficulty for every keyword-bearing item — 2 bulk DataForSEO calls,
  // cached 30 min (cost-aware), so the whole list is enriched without per-row API spend.
  const planKeywords = useMemo(() => backlog.map((b) => b.keyword).filter((k): k is string => !!k), [backlog])
  const metrics = useKeywordMetrics(planKeywords, activeProject?.market, activeProject?.language)

  // ROI-aware re-rank: once real volume + difficulty land, tilt the backlog toward the highest-
  // opportunity work — high search volume (log-scaled, capped) lifts an item, high keyword difficulty
  // dampens it — WITHOUT letting traffic potential bury a genuine audit-critical fix. Falls back to the
  // base priority order until metrics load, so the list never sits empty or thrashes.
  const rankedBacklog = useMemo(() => {
    const m = metrics.data
    if (!m) return backlog
    return backlog
      .map((b) => {
        let adj = b.priority
        const km = b.keyword ? m.get(b.keyword.toLowerCase()) : undefined
        if (km && km.volume > 0) {
          adj += Math.min(Math.log10(km.volume + 1) * 7, 25) // volume opportunity (log, capped at +25)
          if (km.difficulty != null) adj -= (km.difficulty / 100) * 18 // difficulty penalty (0..-18)
        }
        return { b, adj }
      })
      .sort((x, y) => y.adj - x.adj)
      .map((s) => s.b)
  }, [backlog, metrics.data])

  const scheduled = useMemo(
    () =>
      (proposals.data ?? [])
        .filter((p) => p.status === 'approved' && p.scheduledDate)
        .sort((a, b) => (a.scheduledDate! < b.scheduledDate! ? -1 : 1)),
    [proposals.data],
  )

  const published = useMemo(
    () => (content.data ?? []).filter((c) => c.status === 'published' || c.status === 'draft'),
    [content.data],
  )

  // ---------- guards ----------
  if (isLoading) {
    return (
      <AppShell>
        <div className="animate-pulse space-y-3">
          <div className="h-2.5 w-20 rounded bg-white/[0.06]" />
          <div className="h-8 w-56 rounded-lg bg-white/[0.08]" />
          <div className="h-24 rounded-2xl bg-white/[0.04]" />
        </div>
      </AppShell>
    )
  }

  if (!activeProject) {
    return (
      <AppShell>
        <EmptyHero
          title={t('pianoPage.noActiveProjectTitle')}
          body={t('pianoPage.noActiveProjectBody')}
          cta={t('pianoPage.createSite')}
          onCta={() => navigate({ to: '/projects/new' as any })}
        />
      </AppShell>
    )
  }

  const loadingData = audit.isLoading || gaps.isLoading || proposals.isLoading
  const noAuditYet = !audit.isLoading && !audit.data

  return (
    <AppShell>
      <div className="mb-8">
        <p className="text-violet-300/70 text-xs tracking-[0.18em] uppercase mb-1.5 flex items-center gap-1.5">
          <CalendarDaysIcon className="w-3.5 h-3.5" />
          {t('pianoPage.eyebrow')}
        </p>
        <h1 className="text-3xl font-bold text-white">{t('pianoPage.title')}</h1>
        <p className="text-white/40 mt-1.5">
          {t('pianoPage.subtitle', { name: activeProject.name })}
        </p>
      </div>

      {/* Backlog */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <p className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('pianoPage.toDoNow')}</p>
          {backlog.length > 0 && <span className="text-xs text-white/40">{t('pianoPage.tasksCount', { count: backlog.length })}</span>}
        </div>

        {noAuditYet ? (
          <EmptyHero
            title={t('pianoPage.runDiagnosisFirstTitle')}
            body={t('pianoPage.runDiagnosisFirstBody')}
            cta={t('pianoPage.goToDiagnosi')}
            onCta={() => navigate({ to: '/audit' as any })}
          />
        ) : loadingData && backlog.length === 0 ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 rounded-2xl bg-white/[0.04] animate-pulse" />
            ))}
          </div>
        ) : backlog.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-5 py-8 text-center">
            <CheckCircleIcon className="w-9 h-9 text-emerald-400 mx-auto mb-2" />
            <p className="text-white font-medium">{t('pianoPage.allUnderControlTitle')}</p>
            <p className="text-sm text-white/50 mt-1">
              {t('pianoPage.allUnderControlBody')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {rankedBacklog.map((b) => {
              const tone = TONE[b.tone]
              const km = b.keyword ? metrics.data?.get(b.keyword.toLowerCase()) : undefined
              const hasVol = !!km && km.volume > 0
              return (
                <div
                  key={b.id}
                  className="group flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5 transition hover:border-white/15 hover:bg-white/[0.04]"
                >
                  <div className={`hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${tone.chip}`}>
                    <tone.Icon className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${tone.chip}`}>{b.badge}</span>
                      {hasVol && (
                        <span className="text-[11px] text-white/45 tabular-nums" title={t('pianoPage.volumeTooltip')}>
                          {t('pianoPage.volumePerMonth', { volume: formatVolume(km!.volume) })}
                          {km!.difficulty != null && <span className="text-white/30"> · {t('pianoPage.kd', { value: Math.round(km!.difficulty) })}</span>}
                        </span>
                      )}
                      {b.meta && <span className="text-[11px] text-white/35">{b.meta}</span>}
                    </div>
                    <p className="text-sm text-white truncate">{b.title}</p>
                    <p className="text-xs text-white/45 truncate">{b.why}</p>
                  </div>
                  <button
                    onClick={b.onAction}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.06] px-3.5 py-2 text-sm text-white transition hover:bg-violet-500 group-hover:bg-white/10"
                  >
                    {b.actionLabel}
                    <ArrowRightIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Scheduled + Published */}
      <div className="mt-10 grid lg:grid-cols-2 gap-6">
        <section>
          <p className="text-white/40 text-xs tracking-[0.18em] uppercase mb-3">{t('pianoPage.scheduledTitle')}</p>
          {scheduled.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-6 text-sm text-white/35">
              {t('pianoPage.scheduledEmpty')}
            </div>
          ) : (
            <div className="space-y-2">
              {scheduled.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <CalendarDaysIcon className="w-4 h-4 text-violet-300/70 shrink-0" />
                  <span className="text-sm text-white truncate flex-1">{p.title}</span>
                  <span className="text-xs text-white/40 shrink-0">{fmtDate(p.scheduledDate)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('pianoPage.publishedTitle')}</p>
            {published.length > 0 && <span className="text-xs text-emerald-300/70">{t('pianoPage.publishedTotal', { count: published.length })}</span>}
          </div>
          {published.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-6 text-sm text-white/35">
              {t('pianoPage.publishedEmpty')}
            </div>
          ) : (
            <div className="space-y-2">
              {published.slice(0, 8).map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate({ to: `/content/${c.id}` as any })}
                  className="w-full flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-left transition hover:bg-white/[0.04]"
                >
                  <CheckCircleIcon className={`w-4 h-4 shrink-0 ${c.status === 'published' ? 'text-emerald-400' : 'text-white/30'}`} />
                  <span className="text-sm text-white truncate flex-1">{c.title}</span>
                  <span className="text-xs text-white/40 shrink-0">{fmtDate(c.published_date || c.generated_date)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  )
}

function EmptyHero({ title, body, cta, onCta }: { title: string; body: string; cta: string; onCta: () => void }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-12 text-center">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="text-sm text-white/45 mt-1.5 max-w-md mx-auto">{body}</p>
      <button
        onClick={onCta}
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-500 px-5 py-2.5 font-medium text-white transition hover:bg-violet-400"
      >
        {cta}
        <ArrowRightIcon className="w-4 h-4" />
      </button>
    </div>
  )
}

/**
 * ContentRefreshPanel — the seo-geo skill's "audit & optimize existing content" flow.
 *
 * PRIMARY path is automated: crawl the site's public sitemap → scrape each page → score it →
 * surface the articles with the biggest GEO/SEO gaps, ranked. One click scrapes the chosen page
 * and runs the augment engine (keep the good body, ADD Risposta rapida / FAQ + schema /
 * nota-esperto with REAL verified sources / framework / internal links, deepen thin sections) —
 * with the same no-fabricated-stats/case-study guards as a fresh write.
 * A manual paste box remains as a fallback. Shows the before → after SEO/GEO lift + exports.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useMutationState } from '@tanstack/react-query'
import { useActiveProject } from '../hooks/useActiveProject'
import {
  useAugmentStandalone,
  useAugmentFromUrl,
  useFindStaleContent,
  contentRunKeys,
} from '../hooks/useAgentPipeline'
import type { AugmentResult, StaleCandidate } from '../services/agent/standaloneContent'
import { getMoneyPages } from '../services/moneyPages'
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentIcon,
  ArrowDownTrayIcon,
  DocumentTextIcon,
  ArrowRightIcon,
  PlusCircleIcon,
  MagnifyingGlassIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline'
import { AppShell } from '../components/layout/AppShell'
import { RecentGenerations, StagedProgress } from '../components/content/RecentGenerations'
import { sanitizeArticleHtml } from '../utils/sanitizeHtml'
import { TrackKeywordCta } from '../components/content/TrackKeywordCta'

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-white/40 text-xs tracking-[0.18em] uppercase">{children}</p>
}

function scoreTone(v: number) {
  return v >= 75 ? 'text-emerald-300' : v >= 50 ? 'text-amber-300' : 'text-rose-300'
}

function ScoreDelta({ label, before, after }: { label: string; before: number; after: number }) {
  const delta = after - before
  return (
    <div className="px-3.5 py-2 rounded-xl border border-white/[0.1] bg-white/[0.03]">
      <p className="text-[10px] uppercase tracking-wide text-white/40 mb-0.5">{label}</p>
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <span className="text-white/40 tabular-nums">{before}</span>
        <ArrowRightIcon className="w-3.5 h-3.5 text-white/30" />
        <span className={`tabular-nums ${scoreTone(after)}`}>{after}</span>
        {delta !== 0 && (
          <span className={`text-xs font-medium tabular-nums ${delta > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            ({delta > 0 ? '+' : ''}
            {delta})
          </span>
        )}
      </div>
    </div>
  )
}

function download(filename: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function ExportButton({ icon: Icon, label, onClick }: { icon: typeof ClipboardDocumentIcon; label: string; onClick: () => void }) {
  const { t } = useTranslation()
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        onClick()
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
      className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/15 text-white/70 text-sm font-medium hover:bg-white/[0.06] hover:text-white transition-all"
    >
      {done ? <CheckCircleIcon className="w-4 h-4 text-emerald-400" /> : <Icon className="w-4 h-4" strokeWidth={1.8} />}
      {done ? t('refresh.done') : label}
    </button>
  )
}

function MiniScore({ value }: { value: number }) {
  return (
    <span className={`text-xs font-semibold tabular-nums ${scoreTone(value)}`}>GEO {value}</span>
  )
}

// Module-scoped guard: which deep-linked URLs we've already auto-refreshed. Survives component
// remounts (HMR / StrictMode / navigate-away-and-back) so an EXPENSIVE augment run never fires twice.
const autoRunFiredUrls = new Set<string>()

export function ContentRefreshPanel({
  projectId,
  siteName,
  siteUrl,
  niche,
  autoUrl,
  hideHeader,
}: {
  projectId: string
  siteName: string
  siteUrl: string
  niche: string
  /** When set (e.g. arriving from the audit's "Aggiorna" action), auto-refresh this URL on mount. */
  autoUrl?: string
  hideHeader?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [existing, setExisting] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [result, setResult] = useState<AugmentResult | undefined>()
  const [busyUrl, setBusyUrl] = useState<string | null>(null)

  const find = useFindStaleContent()
  const aug = useAugmentStandalone()
  const augUrl = useAugmentFromUrl()
  // Real author (E-E-A-T) on refresh too — same source as generation; brand-team fallback when unset.
  const { projects } = useActiveProject()
  const project = projects?.find((p) => p.id === projectId)
  const authorLine = project?.author_name?.trim() || undefined
  // Money pages on refresh too — the engine weaves the commercial link into the refreshed article.
  const moneyPages = getMoneyPages(project)
  // Language fallback from project metadata — the engine detects the site's real language first.
  const languageHint = (project?.language as string) || project?.primary_language || undefined
  const candidates = (find.data as StaleCandidate[] | undefined) ?? []

  // Re-attach to runs across navigation: a generation keeps running when the user visits other
  // pages — on return we read pending/finished runs from the global mutation cache, so progress
  // and results are never "lost" by moving around the app.
  const bgPending = useMutationState({ filters: { mutationKey: contentRunKeys.augment, status: 'pending' } })
  const bgResults = useMutationState({
    filters: { mutationKey: contentRunKeys.augment, status: 'success' },
    select: (m) => m.state.data as AugmentResult,
  })
  const restored = bgResults.length > 0 ? bgResults[bgResults.length - 1] : undefined
  const shown = result ?? restored

  // Deep-linked from the audit ("Aggiorna" on a page) → scrape + refresh that URL immediately.
  // Guard with a module-scoped set so a remount can't re-fire the same expensive run, then CONSUME
  // the one-shot url param so a full page reload can't re-fire it either.
  useEffect(() => {
    if (autoUrl && siteUrl && !autoRunFiredUrls.has(autoUrl) && !augUrl.isPending && bgPending.length === 0) {
      autoRunFiredUrls.add(autoUrl)
      setBusyUrl(autoUrl)
      augUrl.mutate(
        { url: autoUrl, siteUrl, siteName, niche, projectId, ...(languageHint ? { languageHint } : {}), ...(authorLine ? { authorLine } : {}), ...(moneyPages.length ? { moneyPages } : {}) },
        { onSuccess: (r) => setResult(r), onSettled: () => setBusyUrl(null) },
      )
      window.history.replaceState(null, '', `${window.location.pathname}?mode=refresh`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoUrl, siteUrl])

  const isPending = aug.isPending || augUrl.isPending || bgPending.length > 0
  const hasSite = !!siteUrl.trim()

  const scan = () => {
    if (!hasSite) return
    setResult(undefined)
    find.mutate({ siteUrl, ...(languageHint ? { language: languageHint } : {}), limit: 18 })
  }

  const refreshCandidate = (c: StaleCandidate) => {
    setBusyUrl(c.url)
    setResult(undefined)
    augUrl.mutate(
      { url: c.url, keyword: c.title, siteUrl, siteName, niche, projectId, ...(languageHint ? { languageHint } : {}), ...(authorLine ? { authorLine } : {}), ...(moneyPages.length ? { moneyPages } : {}) },
      { onSuccess: (r) => setResult(r), onSettled: () => setBusyUrl(null) },
    )
  }

  const runManual = () => {
    if (!keyword.trim() || existing.trim().length < 200) return
    setResult(undefined)
    aug.mutate(
      { existingContent: existing.trim(), keyword: keyword.trim(), siteUrl, siteName, niche, projectId, ...(languageHint ? { languageHint } : {}), ...(authorLine ? { authorLine } : {}), ...(moneyPages.length ? { moneyPages } : {}) },
      { onSuccess: (r) => setResult(r) },
    )
  }

  const tooShort = existing.trim().length > 0 && existing.trim().length < 200

  return (
    <>
      {!hideHeader && (
        <div className="mb-8">
          <Eyebrow>{t('refresh.headerEyebrow')}</Eyebrow>
          <h1 className="text-3xl font-bold text-white mt-1.5">{t('refresh.headerTitle')}</h1>
          <p className="text-white/40 mt-1">
            {t('refresh.headerSubtitle')}
          </p>
        </div>
      )}

      {/* DISCOVERY — automated sitemap scan */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h3 className="text-white font-semibold">{t('refresh.discoveryTitle')}</h3>
            <p className="text-white/40 text-sm mt-0.5">
              {t('refresh.discoverySubtitle', {
                site: siteUrl.replace(/^https?:\/\//, '') || t('refresh.yourSite'),
              })}
            </p>
          </div>
          <button
            onClick={scan}
            disabled={!hasSite || find.isPending}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 transition-all disabled:opacity-50 shrink-0"
          >
            <MagnifyingGlassIcon className={`w-4 h-4 ${find.isPending ? 'animate-pulse' : ''}`} strokeWidth={2} />
            {find.isPending ? t('refresh.scanning') : t('refresh.scanSite')}
          </button>
        </div>

        {find.isError && (
          <p className="text-rose-300/80 text-sm mt-4">
            {t('refresh.scanFailed', {
              error: find.error instanceof Error ? find.error.message : t('refresh.tryAgain'),
            })}
          </p>
        )}

        {find.isPending && (
          <div className="mt-5 flex items-center gap-3 text-white/60 text-sm">
            <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            {t('refresh.readingSitemap')}
          </div>
        )}

        {find.isSuccess && candidates.length === 0 && (
          <p className="text-white/50 text-sm mt-4">
            {t('refresh.noPagesFound')}
          </p>
        )}

        {candidates.length > 0 && (
          <ul className="mt-5 space-y-2">
            {candidates.map((c) => (
              <li
                key={c.url}
                className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-white text-sm font-medium truncate">{c.title}</p>
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-white/30 hover:text-white/60 shrink-0">
                      <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                    </a>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                    <MiniScore value={c.geoScore} />
                    <span className="text-white/30 text-xs tabular-nums">{t('refresh.wordCount', { count: c.wordCount })}</span>
                    {c.missing.slice(0, 4).map((m) => (
                      <span key={m} className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/20 bg-amber-500/10 text-amber-300/90">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => refreshCandidate(c)}
                  disabled={isPending}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-full border border-white/15 text-white/80 text-sm font-medium hover:bg-white/[0.06] hover:text-white transition-all disabled:opacity-40 shrink-0"
                >
                  <ArrowPathIcon className={`w-4 h-4 ${busyUrl === c.url ? 'animate-spin' : ''}`} strokeWidth={1.8} />
                  {busyUrl === c.url ? t('refresh.refreshing') : t('refresh.refresh')}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* manual fallback toggle */}
        <button
          onClick={() => setShowManual((s) => !s)}
          className="mt-4 text-xs text-white/40 hover:text-white/70 underline underline-offset-2"
        >
          {showManual ? t('refresh.hideManual') : t('refresh.showManual')}
        </button>
      </div>

      {/* MANUAL paste (fallback) */}
      {showManual && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 mb-6">
          <label className="block text-sm font-medium text-white/60 mb-1.5">{t('refresh.keywordLabel')}</label>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t('refresh.keywordPlaceholder')}
            className="w-full px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.1] text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 text-sm mb-4"
          />
          <label className="block text-sm font-medium text-white/60 mb-1.5">{t('refresh.existingLabel')}</label>
          <textarea
            value={existing}
            onChange={(e) => setExisting(e.target.value)}
            placeholder={t('refresh.existingPlaceholder')}
            rows={8}
            className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.1] text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 text-sm font-mono leading-relaxed resize-y"
          />
          {tooShort && <p className="text-amber-300/80 text-xs mt-1.5">{t('refresh.tooShort')}</p>}
          <button
            onClick={runManual}
            disabled={!keyword.trim() || existing.trim().length < 200 || isPending}
            className="mt-4 flex items-center justify-center gap-2 px-6 py-2.5 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 transition-all disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-4 h-4 ${aug.isPending ? 'animate-spin' : ''}`} strokeWidth={2} />
            {aug.isPending ? t('refresh.refreshing') : t('refresh.refreshContent')}
          </button>
        </div>
      )}

      {/* loading — honest staged progress (runs take 2–4 min) */}
      {isPending && <StagedProgress mode="refresh" />}

      {/* error (url augment) */}
      {augUrl.isError && !isPending && (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-5 text-rose-300 text-sm">
          {t('refresh.refreshError', {
            error: augUrl.error instanceof Error ? augUrl.error.message : t('refresh.tryAgain'),
          })}
        </div>
      )}

      {/* result */}
      {shown && !isPending && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                {shown.validation.passed ? (
                  <CheckCircleIcon className="w-6 h-6 text-emerald-400" strokeWidth={1.6} />
                ) : (
                  <ExclamationTriangleIcon className="w-6 h-6 text-amber-400" strokeWidth={1.6} />
                )}
                <div>
                  <p className="text-white font-semibold leading-tight">{shown.article.title}</p>
                  <p className="text-white/40 text-xs mt-0.5">
                    {t('refresh.wordCount', { count: shown.article.wordCount })} ·{' '}
                    {shown.validation.passed ? t('refresh.qualityPassed') : t('refresh.qualityReview')}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <ScoreDelta label="SEO" before={shown.before.seoScore} after={shown.validation.seoScore} />
                <ScoreDelta label="GEO" before={shown.before.geoScore} after={shown.validation.geoScore} />
              </div>
            </div>

            {shown.addedElements.length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-white/40 mb-2">{t('refresh.addedElements')}</p>
                <div className="flex flex-wrap gap-2">
                  {shown.addedElements.map((el, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
                    >
                      <PlusCircleIcon className="w-3.5 h-3.5" />
                      {el}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {shown.validation.issues.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {shown.validation.issues.slice(0, 8).map((iss, i) => (
                  <span
                    key={i}
                    className={`text-[11px] px-2.5 py-1 rounded-full border ${
                      iss.severity === 'error'
                        ? 'text-rose-300 bg-rose-500/10 border-rose-500/20'
                        : 'text-amber-300 bg-amber-500/10 border-amber-500/20'
                    }`}
                  >
                    {iss.message}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-white/[0.06]">
              <ExportButton icon={ClipboardDocumentIcon} label={t('refresh.copyGutenberg')} onClick={() => navigator.clipboard.writeText(shown.exports.gutenberg)} />
              <ExportButton icon={ArrowDownTrayIcon} label={t('refresh.downloadHtml')} onClick={() => download(`${shown.article.slug}.html`, shown.exports.html, 'text/html')} />
              <ExportButton icon={DocumentTextIcon} label={t('refresh.downloadMarkdown')} onClick={() => download(`${shown.article.slug}.md`, shown.exports.markdown, 'text/markdown')} />
            </div>

            {/* Close the loop back to tracking: re-running the diagnosis records a new health point
                so the improvement shows up on the Diagnosi progress trend. */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] px-4 py-3">
              <p className="text-sm text-white/70">{t('refresh.retrackBody')}</p>
              <button
                onClick={() => navigate({ to: '/audit' as any })}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white/[0.1] hover:bg-white/[0.16] px-4 py-2 text-sm font-medium text-white transition-colors"
              >
                <ArrowPathIcon className="w-4 h-4" strokeWidth={1.8} /> {t('refresh.retrackCta')}
              </button>
            </div>

            {/* Close the create→measure loop on the KEYWORD: offer to track its Google ranking trend. */}
            <TrackKeywordCta projectId={projectId} keyword={keyword} />
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
            <Eyebrow>{t('refresh.previewEyebrow')}</Eyebrow>
            <div
              className="prose-invert mt-4 max-h-[600px] overflow-y-auto rounded-xl bg-white/[0.02] border border-white/[0.05] p-5 text-white/75 text-sm leading-relaxed [&_h2]:text-white [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-white/90 [&_h3]:font-semibold [&_h3]:mt-4 [&_a]:text-violet-400 [&_table]:w-full [&_td]:border [&_td]:border-white/10 [&_td]:px-2 [&_td]:py-1 [&_strong]:text-white"
              dangerouslySetInnerHTML={{ __html: sanitizeArticleHtml(shown.exports.html) }}
            />
          </div>
        </div>
      )}

      {/* persistent history — work is never lost */}
      <RecentGenerations projectId={projectId} refreshKey={shown?.savedContentId} />
    </>
  )
}

/** Standalone page wrapper (also usable as a route component). */
export function ContentRefreshPage() {
  const { t } = useTranslation()
  const { activeProject, isLoading } = useActiveProject()
  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-40">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    )
  }
  if (!activeProject) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto text-center py-32">
          <ArrowPathIcon className="w-12 h-12 text-violet-400/70 mx-auto mb-4" strokeWidth={1.4} />
          <h1 className="text-2xl font-bold text-white">{t('refresh.emptyTitle')}</h1>
          <p className="text-white/40 mt-2">{t('refresh.emptySubtitle')}</p>
        </div>
      </AppShell>
    )
  }
  return (
    <AppShell>
      <ContentRefreshPanel
        projectId={activeProject.id}
        siteName={activeProject.name}
        siteUrl={activeProject.website_url ?? ''}
        niche={(activeProject.vertical as string) ?? activeProject.main_topic ?? 'general'}
      />
    </AppShell>
  )
}

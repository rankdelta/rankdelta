/**
 * ContentGenerator — the platform's connector-less content surface.
 *
 * Generate a skill-grade, GEO-optimized article from a keyword + the active site URL,
 * see the quality verdict, preview it, and EXPORT (copy Gutenberg / download HTML / Markdown)
 * — no WordPress/Shopify connection required. Publishing is an optional last step.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { useMutationState } from '@tanstack/react-query'
import { scoreTone } from '../lib/score'
import { AppShell } from '../components/layout/AppShell'
import { useActiveProject } from '../hooks/useActiveProject'
import { useGenerateStandalone, usePublishStandalone, useWPConnection, contentRunKeys, type StandaloneResult } from '../hooks/useAgentPipeline'
import { RecentGenerations, StagedProgress } from '../components/content/RecentGenerations'
import { sanitizeArticleHtml } from '../utils/sanitizeHtml'
import { TrackKeywordCta } from '../components/content/TrackKeywordCta'
import { useSubscription } from '../hooks/useSubscription'
import { getMoneyPages } from '../services/moneyPages'
import { useStartTrialModal } from '../components/subscription/StartTrialModal'
import { creditsEnabled } from '../config/deployment'
import { useUpgradeModal } from '../components/subscription/UpgradeModal'
import {
  SparklesIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentIcon,
  ArrowDownTrayIcon,
  DocumentTextIcon,
  GlobeAltIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline'

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-white/40 text-xs tracking-[0.18em] uppercase">{children}</p>
}

function ScorePill({ label, value }: { label: string; value: number }) {
  return (
    <div className={`px-3 py-1.5 rounded-full border text-xs font-semibold tabular-nums ${scoreTone(value).chip}`}>
      {label} {value}/100
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
      {done ? t('generatore.exportDone') : label}
    </button>
  )
}

export function ContentGeneratorPanel({ projectId, siteName, siteUrl, niche, exampleKeyword, hideHeader }: { projectId: string; siteName: string; siteUrl: string; niche: string; exampleKeyword?: string; hideHeader?: boolean }) {
  const { t } = useTranslation()
  // Pre-fill from ?topic= so a "generate content for this gap" link from the AI-visibility
  // page lands here ready to go (closes the measure-gap → write-content loop).
  const [keyword, setKeyword] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('topic')?.trim() || ''
    } catch {
      return ''
    }
  })
  // Did the user arrive here from a visibility "Generate content" link (i.e. targeting a prompt where
  // AI doesn't cite them yet)? If so, frame the GEO opportunity so the closed loop is explicit.
  const [fromVisibilityGap] = useState(() => {
    try {
      return !!new URLSearchParams(window.location.search).get('topic')?.trim()
    } catch {
      return false
    }
  })
  const gen = useGenerateStandalone()
  // Real author (E-E-A-T) when the project has one set; else the engine falls back to the brand-team byline.
  const { projects } = useActiveProject()
  const activeProject = projects?.find((p) => p.id === projectId)
  const authorLine = activeProject?.author_name?.trim() || undefined
  // Language fallback from project metadata. The engine first detects the SITE's real language
  // (<html lang>) — this hint only applies when detection fails. Never hard-default here: an
  // English site once got an Italian article because a default 'it' shadowed the real language.
  const languageHint = (activeProject?.language as string) || activeProject?.primary_language || undefined
  // Commercial pages the article must funnel authority to (configured in project settings).
  const moneyPages = getMoneyPages(activeProject)
  const wp = useWPConnection(projectId)
  const publish = usePublishStandalone(projectId)
  const connected = !!wp.data

  // Engine gate: the diagnosis is free, but generating/publishing requires an active OR trialing
  // subscription. No sub → prompt the card-required trial; trialing/active but out of credits → upgrade.
  const { canUseEngine, creditsRemaining } = useSubscription()
  const trial = useStartTrialModal()
  const upgrade = useUpgradeModal()

  // Re-attach to runs across navigation: read pending/finished runs from the global mutation
  // cache so leaving the page and coming back never "loses" a generation in progress.
  const bgPending = useMutationState({ filters: { mutationKey: contentRunKeys.generate, status: 'pending' } })
  const bgResults = useMutationState({
    filters: { mutationKey: contentRunKeys.generate, status: 'success' },
    select: (m) => m.state.data as StandaloneResult,
  })
  const restored = bgResults.length > 0 ? bgResults[bgResults.length - 1] : undefined
  const result = (gen.data as StandaloneResult | undefined) ?? restored
  const isPending = gen.isPending || bgPending.length > 0

  const run = () => {
    if (!keyword.trim()) return
    // Gate: no active/trialing subscription → prompt the card-required trial instead of running.
    if (!canUseEngine) {
      trial.openTrialModal({ headline: t('trial.headlineGenerate') })
      return
    }
    // On the engine but out of credits → upgrade prompt (the backend would reject anyway).
    // Self-host has no credits (BYOK), so the credit gate doesn't apply there.
    if (creditsEnabled() && creditsRemaining <= 0) {
      upgrade.openModal({ reason: 'insufficient_credits' })
      return
    }
    // No word-target dial: the engine picks the right depth from the competitive analysis —
    // the user cares about the outcome, not token mechanics.
    gen.mutate({ keyword: keyword.trim(), siteUrl, siteName, niche, projectId, ...(languageHint ? { languageHint } : {}), ...(authorLine ? { authorLine } : {}), ...(moneyPages.length ? { moneyPages } : {}) })
  }

  return (
    <>
      {!hideHeader && (
        <div className="mb-8">
          <Eyebrow>{t('generatore.eyebrow')}</Eyebrow>
          <h1 className="text-3xl font-bold text-white mt-1.5">{t('generatore.title')}</h1>
          <p className="text-white/40 mt-1">
            {t('generatore.subtitle')}
          </p>
        </div>
      )}

      {/* input */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 mb-6">
        <label className="block text-sm font-medium text-white/60 mb-1.5">{t('generatore.keywordLabel')}</label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            placeholder={exampleKeyword ? t('generatore.keywordPlaceholderExample', { keyword: exampleKeyword }) : t('generatore.keywordPlaceholder')}
            className="flex-1 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.1] text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 text-sm"
          />
          <button
            onClick={run}
            disabled={!keyword.trim() || isPending}
            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 transition-all disabled:opacity-50"
          >
            <SparklesIcon className="w-4 h-4" strokeWidth={2} />
            {isPending ? t('generatore.generating') : t('generatore.generate')}
          </button>
        </div>
        <p className="text-white/30 text-xs mt-2">{t('generatore.siteInfo', { site: siteUrl.replace(/^https?:\/\//, '') })}</p>
        {moneyPages.length === 0 && (
          <p className="text-white/35 text-xs mt-1.5">
            {t('generatore.moneyPagesNudge')}{' '}
            <Link to={'/settings' as never} className="text-violet-300/80 hover:text-violet-200 underline underline-offset-2">
              {t('generatore.moneyPagesNudgeCta')}
            </Link>
          </p>
        )}
      </div>

      {/* GEO opportunity context — when the user came from an "Absent" tracked prompt, make the closed
          loop explicit: this article exists to win that AI citation. */}
      {fromVisibilityGap && !result && !isPending && (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4 mb-6 flex items-start gap-3">
          <SparklesIcon className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" strokeWidth={1.8} />
          <div>
            <p className="text-sm font-semibold text-white">{t('generatore.geoTargetTitle')}</p>
            <p className="text-sm text-white/55 mt-0.5 leading-relaxed">{t('generatore.geoTargetBody')}</p>
          </div>
        </div>
      )}

      {/* loading — honest staged progress (runs take 2–4 min) */}
      {isPending && <StagedProgress mode="generate" />}

      {/* error */}
      {gen.isError && (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-5 text-rose-300 text-sm">
          {t('generatore.generationError')} {gen.error instanceof Error ? gen.error.message : t('generatore.retry')}
        </div>
      )}

      {/* result */}
      {result && !isPending && (
        <div className="space-y-5">
          {/* verdict */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                {result.validation.passed ? (
                  <CheckCircleIcon className="w-6 h-6 text-emerald-400" strokeWidth={1.6} />
                ) : (
                  <ExclamationTriangleIcon className="w-6 h-6 text-amber-400" strokeWidth={1.6} />
                )}
                <div>
                  <p className="text-white font-semibold leading-tight">{result.article.title}</p>
                  <p className="text-white/40 text-xs mt-0.5">
                    {t('generatore.wordCount', { count: result.article.wordCount })} · {result.validation.passed ? t('generatore.passedQa') : t('generatore.needsReview')}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <ScorePill label="SEO" value={result.article.seoScore} />
                <ScorePill label="GEO" value={result.article.geoScore} />
              </div>
            </div>

            {/* issues */}
            {result.validation.issues.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {result.validation.issues.slice(0, 8).map((iss, i) => (
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

            {/* export + publish actions */}
            <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-white/[0.06]">
              <ExportButton icon={ClipboardDocumentIcon} label={t('generatore.copyGutenberg')} onClick={() => navigator.clipboard.writeText(result.exports.gutenberg)} />
              <ExportButton icon={ArrowDownTrayIcon} label={t('generatore.downloadHtml')} onClick={() => download(`${result.article.slug}.html`, result.exports.html, 'text/html')} />
              <ExportButton icon={DocumentTextIcon} label={t('generatore.downloadMarkdown')} onClick={() => download(`${result.article.slug}.md`, result.exports.markdown, 'text/markdown')} />
              {connected && !publish.data && (
                <button
                  onClick={() => {
                    if (!canUseEngine) {
                      trial.openTrialModal({ headline: t('trial.headlinePublish') })
                      return
                    }
                    publish.mutate({ article: result.article, status: 'draft' })
                  }}
                  disabled={publish.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 transition-all disabled:opacity-50"
                >
                  <GlobeAltIcon className="w-4 h-4" strokeWidth={1.8} />
                  {publish.isPending ? t('generatore.publishing') : t('generatore.publishDraftWp')}
                </button>
              )}
              {publish.data && (
                <a
                  href={publish.data.wpPostUrl}
                  target="_blank"
                  rel="noopener"
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm font-medium"
                >
                  <CheckCircleIcon className="w-4 h-4" /> {t('generatore.draftCreatedWp')}
                  <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
            {publish.isError && (
              <p className="text-rose-300 text-xs mt-2">
                {t('generatore.publishFailed')} {publish.error instanceof Error ? publish.error.message : t('generatore.retry')}
              </p>
            )}

            {/* Close the create→measure loop: track this keyword's ranking trend. */}
            <TrackKeywordCta projectId={projectId} keyword={keyword} />
          </div>

          {/* preview */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
            <Eyebrow>{t('generatore.preview')}</Eyebrow>
            <div
              className="prose-invert mt-4 max-h-[600px] overflow-y-auto rounded-xl bg-white/[0.02] border border-white/[0.05] p-5 text-white/75 text-sm leading-relaxed [&_h2]:text-white [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-white/90 [&_h3]:font-semibold [&_h3]:mt-4 [&_a]:text-violet-400 [&_table]:w-full [&_td]:border [&_td]:border-white/10 [&_td]:px-2 [&_td]:py-1 [&_strong]:text-white [&_.quick-answer-box]:!text-gray-800 [&_.quick-answer-box_*]:!text-gray-800 [&_.quick-answer-box_h2]:!text-blue-700 [&_img]:max-h-44 [&_img]:w-auto [&_img]:rounded-lg [&_img]:my-3 [&_figure]:my-3 [&_figure]:text-center [&_figcaption]:text-white/40 [&_figcaption]:text-xs [&_figcaption]:mt-1"
              dangerouslySetInnerHTML={{ __html: sanitizeArticleHtml(result.exports.html) }}
            />
          </div>
        </div>
      )}

      {/* gentle nudge: where the topics come from (closes the loop back to the prioritized plan) */}
      {!result && !isPending && (
        <p className="text-white/30 text-xs mb-5 -mt-1">
          {t('generatore.nudgePrefix')}{' '}
          <Link to={'/piano' as any} className="text-violet-300/80 hover:text-violet-200">
            {t('generatore.nudgeLink')}
          </Link>{' '}
          {t('generatore.nudgeSuffix')}
        </p>
      )}

      {/* persistent history — work is never lost */}
      <RecentGenerations projectId={projectId} refreshKey={result?.savedContentId} />

      {/* Engine gates */}
      <trial.StartTrialModal />
      <upgrade.UpgradeModal />
    </>
  )
}

export function ContentGenerator() {
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
          <SparklesIcon className="w-12 h-12 text-violet-400/70 mx-auto mb-4" strokeWidth={1.4} />
          <h1 className="text-2xl font-bold text-white">{t('generatore.noProjectTitle')}</h1>
          <p className="text-white/40 mt-2">{t('generatore.noProjectDesc')}</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <ContentGeneratorPanel
        projectId={activeProject.id}
        siteName={activeProject.name}
        siteUrl={activeProject.website_url ?? ''}
        niche={(activeProject.vertical as string) ?? activeProject.main_topic ?? 'general'}
        exampleKeyword={(activeProject.primary_keyword as string) ?? ''}
      />
    </AppShell>
  )
}

export default ContentGenerator

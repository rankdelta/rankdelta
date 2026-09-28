/**
 * SiteAuditPage — the product's FRONT DOOR: a guided SEO + GEO diagnosis that scores the site on
 * three honest dimensions (Tecnico · GEO · Freschezza contenuti), then tells the user EXACTLY what
 * to do next in priority order — with a one-click action behind every finding (refresh a weak page,
 * generate schema, write content, fix technical). Built for the user who knows what SEO is but not
 * what to do next.
 */

import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParseKeys, TFunction } from 'i18next'
import { useNavigate } from '@tanstack/react-router'
import { scoreTone } from '../lib/score'
import {
  ShieldCheckIcon,
  ArrowPathIcon,
  SparklesIcon,
  BoltIcon,
  CheckCircleIcon,
  CodeBracketSquareIcon,
  PencilSquareIcon,
  WrenchScrewdriverIcon,
  ClipboardDocumentIcon,
  XMarkIcon,
  DocumentMagnifyingGlassIcon,
  ArrowTopRightOnSquareIcon,
  SignalIcon,
  ArrowTrendingUpIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline'
import { AppShell } from '../components/layout/AppShell'
import { useActiveProject } from '../hooks/useActiveProject'
import { useLatestSiteAudit, useRunSiteAudit, useGenerateSchema, useSiteAuditHistory } from '../hooks/useSiteAudit'
import { useVisibilityMentionInsights, useCompetitorBrands } from '../hooks/useVisibilityTracker'
import type { GuidedAudit, GuidedAction, ActionKind } from '../services/agent/guidedAudit'
import type { SchemaGenerationResult, SchemaType } from '../services/schemaGenerator'

// Score colours come from the shared scoreTone() so Diagnosi, the generator and the Comando all
// use the SAME thresholds (≥80 ottimo · ≥50 da migliorare · <50 critico).
const scoreColor = (s: number) => scoreTone(s).stroke
const scoreRing = (s: number) =>
  scoreTone(s).level === 'good' ? 'border-emerald-500/40' : scoreTone(s).level === 'ok' ? 'border-amber-500/40' : 'border-rose-500/40'
const geoTone = (s: number) => scoreTone(s).text

const SEV_DOT = { critical: 'bg-rose-500', warning: 'bg-amber-400', opportunity: 'bg-sky-400' } as const

const ACTION_META: Record<ActionKind, { labelKey: ParseKeys; Icon: typeof BoltIcon }> = {
  refresh_page: { labelKey: 'diagnosi.actionRefresh', Icon: ArrowPathIcon },
  improve_citability: { labelKey: 'diagnosi.actionRefresh', Icon: SparklesIcon },
  generate_content: { labelKey: 'diagnosi.actionGenerate', Icon: PencilSquareIcon },
  add_schema: { labelKey: 'diagnosi.actionGenerateSchema', Icon: CodeBracketSquareIcon },
  fix_technical: { labelKey: 'diagnosi.actionOnYourSite', Icon: WrenchScrewdriverIcon },
}

/**
 * The single most important GEO signal: is the site ACTUALLY cited by AI? Read straight from the
 * Visibility engine (real ChatGPT/Perplexity/Google-AI answers) so the diagnosis is grounded in
 * measured citations, not just "has schema". Falls back to a nudge when no check has run yet.
 */
function AiCitationCard({ projectId, onOpen, onAddCompetitors, t }: { projectId?: string; onOpen: () => void; onAddCompetitors: () => void; t: TFunction }) {
  const ins = useVisibilityMentionInsights(projectId, 14)
  const { data: competitors } = useCompetitorBrands(projectId)
  const d = ins.data
  const hasData = !!d?.hasData
  const sov = d?.sovLast7d ?? d?.shareOfVoicePercent ?? null
  // SoV is only meaningful relative to competitors — flag when none are configured (otherwise a
  // lone brand shows a misleading 100%).
  const noCompetitors = hasData && (competitors?.length ?? 0) === 0

  if (ins.isLoading) {
    return <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 h-24 animate-pulse" />
  }

  return (
    <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.07] to-transparent p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SignalIcon className="w-4 h-4 text-violet-300" strokeWidth={1.8} />
            <h3 className="text-white font-semibold text-sm">{t('diagnosi.aiCitationTitle')}</h3>
          </div>
          {hasData ? (
            <>
              <div className="mt-3 flex flex-wrap gap-x-7 gap-y-2">
                <div>
                  <div className="text-2xl font-bold text-emerald-300 tabular-nums">{sov != null ? `${Math.round(sov)}%` : '—'}</div>
                  <div className="text-[11px] text-white/40">{t('diagnosi.aiCitationSov')}</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-violet-300 tabular-nums">{d!.yourBrandMentions}</div>
                  <div className="text-[11px] text-white/40">{t('diagnosi.aiCitationMentions')}</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-sky-300 tabular-nums">{d!.citationRatePercent != null ? `${Math.round(d!.citationRatePercent)}%` : '—'}</div>
                  <div className="text-[11px] text-white/40">{t('diagnosi.aiCitationRate')}</div>
                </div>
              </div>
              <p className="text-white/30 text-[11px] mt-3">{t('diagnosi.aiCitationEngines')}</p>
              {noCompetitors && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2">
                  <span className="text-[12px] text-amber-100/80">{t('diagnosi.sovNoCompetitors')}</span>
                  <button onClick={onAddCompetitors} className="text-[12px] font-medium text-amber-200 underline underline-offset-2 hover:text-amber-100">
                    {t('diagnosi.sovAddCompetitors')}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-white/45 text-sm mt-2 max-w-md">{t('diagnosi.aiCitationEmptyBody')}</p>
          )}
        </div>
        <button
          onClick={onOpen}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.12] px-4 py-2 text-xs font-medium text-white/90 transition-colors"
        >
          {t('diagnosi.aiCitationOpen')} <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

/**
 * Health-over-time trend — the "track your results" proof. Shows a compact sparkline of the composite
 * health across past audits + the delta since the first measurement, so acting on the plan and
 * re-auditing visibly pays off. With a single data point it nudges the user to re-audit after fixes.
 */
function ProgressTrend({ projectId, t }: { projectId?: string; t: TFunction }) {
  const { data: history } = useSiteAuditHistory(projectId)
  if (!history || history.length === 0) return null

  const points = history.map((h) => h.composite)
  const current = points[points.length - 1] ?? 0
  const first = points[0] ?? 0
  const delta = current - first

  if (history.length < 2) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
        <div className="flex items-center gap-2">
          <ArrowTrendingUpIcon className="w-4 h-4 text-violet-300" strokeWidth={1.8} />
          <h3 className="text-white font-semibold text-sm">{t('diagnosi.progressTitle')}</h3>
        </div>
        <p className="text-white/45 text-sm mt-2 max-w-md">{t('diagnosi.progressFirstHint')}</p>
      </div>
    )
  }

  const w = 220, h = 44, pad = 5
  const min = Math.min(...points), max = Math.max(...points)
  const range = max - min || 1
  const coords = points.map((p, i) => {
    const x = pad + (i / (points.length - 1)) * (w - pad * 2)
    const y = pad + (1 - (p - min) / range) * (h - pad * 2)
    return [x, y] as const
  })
  const path = coords.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(' ')
  const last = coords[coords.length - 1] ?? [pad, pad]
  const deltaColor = delta > 0 ? 'text-emerald-300' : delta < 0 ? 'text-rose-300' : 'text-white/50'
  const deltaSign = delta > 0 ? '+' : ''

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ArrowTrendingUpIcon className="w-4 h-4 text-violet-300" strokeWidth={1.8} />
            <h3 className="text-white font-semibold text-sm">{t('diagnosi.progressTitle')}</h3>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-2xl font-bold tabular-nums ${scoreColor(current)}`}>{current}</span>
            <span className={`text-sm font-semibold tabular-nums ${deltaColor}`}>{deltaSign}{delta} {t('diagnosi.progressSince')}</span>
          </div>
          <p className="text-[11px] text-white/35 mt-1">{t('diagnosi.progressChecks', { count: history.length })}</p>
        </div>
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 text-violet-400/70">
          <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={last[0]} cy={last[1]} r="3" className="fill-violet-300" />
        </svg>
      </div>
    </div>
  )
}

function SubScore({ label, score, icon: Icon, hint }: { label: string; score: number | null; icon: typeof BoltIcon; hint: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
      <div className="flex items-center gap-2 text-white/40 text-xs tracking-[0.14em] uppercase">
        <Icon className="w-4 h-4" strokeWidth={1.8} />
        {label}
      </div>
      <div className={`mt-2 text-3xl font-bold ${score == null ? 'text-white/30' : scoreColor(score)}`}>
        {score == null ? '—' : score}
        {score != null && <span className="text-white/30 text-lg font-normal">/100</span>}
      </div>
      <p className="mt-1 text-white/40 text-xs">{hint}</p>
    </div>
  )
}

export function SiteAuditPage() {
  const { t, i18n } = useTranslation()
  const { activeProject, isLoading } = useActiveProject()
  const navigate = useNavigate()
  const projectId = activeProject?.id
  const siteUrl = activeProject?.website_url ?? ''
  const { data: latest, isLoading: loadingLatest } = useLatestSiteAudit(projectId)
  const runAudit = useRunSiteAudit(projectId ?? '')
  const genSchema = useGenerateSchema()
  const [schemaResult, setSchemaResult] = useState<SchemaGenerationResult | null>(null)
  const [schemaForUrl, setSchemaForUrl] = useState<string | null>(null)
  const pagesRef = useRef<HTMLDivElement>(null)

  const result = (runAudit.data as GuidedAudit | undefined) ?? (latest as GuidedAudit | null) ?? null
  const running = runAudit.isPending

  const goRefresh = (url?: string) =>
    navigate({ to: '/agent/$projectId', params: { projectId: projectId! }, search: { mode: 'refresh' as const, ...(url ? { url } : {}) } })
  const goGenerate = (topic?: string) =>
    navigate({ to: '/agent/$projectId', params: { projectId: projectId! }, search: { mode: 'generate' as const, ...(topic ? { topic } : {}) } })

  const onAction = (a: GuidedAction) => {
    if (a.kind === 'refresh_page' || a.kind === 'improve_citability') goRefresh(a.target)
    else if (a.kind === 'generate_content') goGenerate()
    else if (a.kind === 'add_schema') {
      if (a.target) runSchema(a.target)
      else pagesRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    // fix_technical: guidance only (the "why" tells them what to do on their site)
  }

  const runSchema = (url: string) => {
    setSchemaForUrl(url)
    setSchemaResult(null)
    genSchema.mutate(
      { url, language: activeProject?.language || i18n.language },
      { onSuccess: (r) => setSchemaResult(r) },
    )
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-40">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    )
  }

  if (!activeProject || !siteUrl) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto text-center py-32">
          <ShieldCheckIcon className="w-12 h-12 text-violet-400/70 mx-auto mb-4" strokeWidth={1.4} />
          <h1 className="text-2xl font-bold text-white">{t('diagnosi.addSiteUrlTitle')}</h1>
          <p className="text-white/40 mt-2">{t('diagnosi.addSiteUrlBody')}</p>
        </div>
      </AppShell>
    )
  }

  const plan = result?.plan ?? []
  const stale = result?.staleContent ?? []
  const composite = result?.compositeHealth ?? result?.healthScore ?? 0

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <div className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('diagnosi.eyebrow')}</div>
          <h1 className="text-2xl font-bold text-white mt-1">{t('diagnosi.title')}</h1>
          <p className="text-white/45 text-sm mt-1">
            {t('diagnosi.subtitlePart1')} <em>{t('diagnosi.subtitleEmphasis')}</em> {t('diagnosi.subtitlePart2')}
          </p>
        </div>

        {runAudit.isError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.08] p-4 text-rose-200 text-sm mb-4">
            {(runAudit.error as Error)?.message ?? t('diagnosi.auditFailed')}
          </div>
        )}

        {loadingLatest && !result ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !result ? (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-10 text-center">
            <ShieldCheckIcon className="w-12 h-12 text-violet-400/70 mx-auto mb-4" strokeWidth={1.4} />
            <h2 className="text-xl font-bold text-white">{t('diagnosi.firstAuditTitle')}</h2>
            <p className="text-white/45 text-sm mt-2 max-w-md mx-auto">
              {t('diagnosi.firstAuditBodyPart1')} <strong>{t('diagnosi.firstAuditBodyEmphasis')}</strong> {t('diagnosi.firstAuditBodyPart2')}
            </p>
            <button
              onClick={() => runAudit.mutate({ siteUrl, language: activeProject?.language || i18n.language })}
              disabled={running}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-white text-black px-5 py-2.5 text-sm font-medium hover:bg-white/90 disabled:opacity-50"
            >
              {running ? (
                <><div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> {t('diagnosi.scanningInProgress')}</>
              ) : (
                <><BoltIcon className="w-4 h-4" strokeWidth={1.8} /> {t('diagnosi.startAudit')}</>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Health hero */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 flex items-center gap-6 flex-wrap">
              <div className={`w-28 h-28 rounded-full border-4 ${scoreRing(composite)} flex flex-col items-center justify-center shrink-0`}>
                <div className={`text-4xl font-bold ${scoreColor(composite)}`}>{composite}</div>
                <div className="text-white/30 text-[10px] uppercase tracking-wider">{t('diagnosi.health')}</div>
              </div>
              <div className="flex-1 min-w-[200px]">
                <div className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('diagnosi.heroEyebrow')}</div>
                <h2 className="text-xl font-bold text-white mt-1">{result.siteUrl.replace(/^https?:\/\//, '')}</h2>
                <p className="text-white/45 text-sm mt-1">
                  {result.pagesAudited === 1 ? t('diagnosi.pagesAnalyzed_one', { count: result.pagesAudited }) : t('diagnosi.pagesAnalyzed_other', { count: result.pagesAudited })}
                  {result.weakPageCount ? ` · ${t('diagnosi.weakPagesSuffix', { count: result.weakPageCount })}` : ''}
                </p>
              </div>
              <button
                onClick={() => runAudit.mutate({ siteUrl, language: activeProject?.language || i18n.language })}
                disabled={running}
                className="shrink-0 inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/[0.06] disabled:opacity-50"
              >
                <ArrowPathIcon className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} strokeWidth={1.8} />
                {running ? t('diagnosi.scanningShort') : t('diagnosi.rerun')}
              </button>
            </div>

            {/* Three honest dimensions */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <SubScore label={t('diagnosi.subScoreTechnicalLabel')} score={result.technicalScore} icon={BoltIcon} hint={t('diagnosi.subScoreTechnicalHint')} />
              <SubScore label={t('diagnosi.subScoreGeoLabel')} score={result.geoReadinessScore} icon={SparklesIcon} hint={t('diagnosi.subScoreGeoHint')} />
              <SubScore label={t('diagnosi.subScoreFreshnessLabel')} score={result.freshnessScore ?? null} icon={DocumentMagnifyingGlassIcon} hint={t('diagnosi.subScoreFreshnessHint')} />
            </div>

            {/* The real GEO signal: are you actually cited by AI? (grounds the GEO score in measured data) */}
            <AiCitationCard
              projectId={projectId}
              onOpen={() => navigate({ to: `/visibility/${projectId}/` as any })}
              onAddCompetitors={() => navigate({ to: `/visibility/${projectId}/competitors` as any })}
              t={t}
            />

            {/* Health over time — the "track your results" proof of the closed loop */}
            <ProgressTrend projectId={projectId} t={t} />

            {/* PIANO D'AZIONE — the guided next steps */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
              <div className="flex items-center gap-2 mb-1">
                <BoltIcon className="w-5 h-5 text-violet-300" strokeWidth={1.8} />
                <h3 className="text-white font-semibold">{t('diagnosi.actionPlanTitle')}</h3>
              </div>
              <p className="text-white/40 text-xs mb-4">{t('diagnosi.actionPlanHint')}</p>

              {plan.length === 0 ? (
                <div className="flex items-center gap-2 text-emerald-400 text-sm py-4">
                  <CheckCircleIcon className="w-5 h-5" strokeWidth={1.8} /> {t('diagnosi.actionPlanEmpty')}
                </div>
              ) : (
                <ol className="space-y-2.5">
                  {plan.slice(0, 10).map((a, idx) => {
                    const meta = ACTION_META[a.kind]
                    const Icon = meta.Icon
                    const actionable = a.kind !== 'fix_technical'
                    return (
                      <li key={a.id} className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                        <span className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-white/[0.06] text-white/50 text-xs font-semibold flex items-center justify-center tabular-nums">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEV_DOT[a.severity]}`} />
                            <span className="text-white text-sm font-medium">{a.title}</span>
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.06] text-white/40">
                              {a.dimension === 'geo' ? t('diagnosi.dimensionGeo') : a.dimension === 'freshness' ? t('diagnosi.dimensionFreshness') : t('diagnosi.dimensionSeo')}
                            </span>
                          </div>
                          <p className="mt-1 text-white/45 text-xs leading-relaxed">{a.why}</p>
                        </div>
                        <button
                          onClick={() => onAction(a)}
                          disabled={!actionable}
                          className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                            actionable
                              ? 'bg-white text-black hover:bg-white/90'
                              : 'border border-white/10 text-white/40 cursor-default'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" strokeWidth={1.8} />
                          {t(meta.labelKey)}
                        </button>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>

            {/* AI CRAWLER CONTEXT — neutral notes (training opt-outs are a publisher choice, NOT an action item) */}
            {(result.geoSignals?.aiTrainingOptOutNotes?.length ?? 0) > 0 && (
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <InformationCircleIcon className="w-5 h-5 text-white/50" strokeWidth={1.8} />
                  <h3 className="text-white font-semibold">{t('diagnosi.aiCrawlerContextTitle')}</h3>
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.06] text-white/40">
                    {t('diagnosi.aiCrawlerContextBadge')}
                  </span>
                </div>
                <p className="text-white/40 text-xs mb-4">{t('diagnosi.aiCrawlerContextHint')}</p>
                <ul className="space-y-2">
                  {result.geoSignals!.aiTrainingOptOutNotes.map((note, i) => (
                    <li key={i} className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                      <InformationCircleIcon className="w-4 h-4 text-white/30 shrink-0 mt-0.5" strokeWidth={1.8} />
                      <span className="text-white/55 text-xs leading-relaxed">{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* CITABILITÀ PER PAGINA — from the live sitemap scan */}
            {stale.length > 0 && (
              <div ref={pagesRef} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
                <div className="flex items-center gap-2 mb-1">
                  <DocumentMagnifyingGlassIcon className="w-5 h-5 text-white/50" strokeWidth={1.8} />
                  <h3 className="text-white font-semibold">{t('diagnosi.perPageTitle')}</h3>
                </div>
                <p className="text-white/40 text-xs mb-4">
                  {t('diagnosi.perPageHint')}
                </p>
                <ul className="space-y-2">
                  {stale.map((c) => {
                    const missingSchema = c.missing.includes('Schema FAQ')
                    return (
                      <li key={c.url} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-semibold tabular-nums ${geoTone(c.geoScore)}`}>GEO {c.geoScore}</span>
                            {c.ageDays != null && (
                              <span className="text-[10px] text-white/30 tabular-nums shrink-0">{t('diagnosi.updatedDaysAgo', { count: c.ageDays })}</span>
                            )}
                            <span className="text-white text-sm font-medium truncate">{c.title}</span>
                            <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-white/30 hover:text-white/60 shrink-0">
                              <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                            </a>
                          </div>
                          {c.missing.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {c.missing.slice(0, 5).map((m) => (
                                <span key={m} className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/20 bg-amber-500/10 text-amber-300/90">
                                  {m}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {missingSchema && (
                            <button
                              onClick={() => runSchema(c.url)}
                              disabled={genSchema.isPending}
                              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/[0.06] disabled:opacity-40"
                            >
                              <CodeBracketSquareIcon className={`w-3.5 h-3.5 ${genSchema.isPending && schemaForUrl === c.url ? 'animate-pulse' : ''}`} strokeWidth={1.8} />
                              {t('diagnosi.schema')}
                            </button>
                          )}
                          <button
                            onClick={() => goRefresh(c.url)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-white text-black px-3.5 py-1.5 text-xs font-medium hover:bg-white/90"
                          >
                            <ArrowPathIcon className="w-3.5 h-3.5" strokeWidth={1.8} />
                            {t('diagnosi.actionRefresh')}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Schema generator modal */}
      {(schemaForUrl || genSchema.isPending) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { setSchemaForUrl(null); setSchemaResult(null) }}>
          <div className="bg-[#141418] border border-white/[0.1] rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CodeBracketSquareIcon className="w-5 h-5 text-violet-300" strokeWidth={1.8} />
                <h3 className="text-white font-semibold">{t('diagnosi.schemaModalTitle')}</h3>
              </div>
              <button onClick={() => { setSchemaForUrl(null); setSchemaResult(null) }} className="text-white/40 hover:text-white">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {genSchema.isPending && (
              <div className="flex items-center gap-3 text-white/60 text-sm py-8 justify-center">
                <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                {t('diagnosi.schemaGenerating')}
              </div>
            )}

            {genSchema.isError && !genSchema.isPending && (
              <p className="text-rose-300 text-sm py-4">{(genSchema.error as Error)?.message ?? t('diagnosi.schemaGenerationFailed')}</p>
            )}

            {schemaResult && !genSchema.isPending && (
              <div className="space-y-4">
                <p className="text-white/50 text-xs">
                  {t('diagnosi.schemaPasteIntro')} <code className="text-white/70">&lt;head&gt;</code> {t('diagnosi.schemaPasteOutro')} <span className="text-white/70">{schemaResult.url}</span>
                </p>
                {schemaResult.generated.map((g) => (
                  <SchemaBlock
                    key={g.type}
                    label={schemaBlockLabel(g.type, (g.jsonLd as { mainEntity?: unknown[] }).mainEntity?.length ?? 0, t)}
                    code={`<script type="application/ld+json">\n${JSON.stringify(g.jsonLd, null, 2)}\n</script>`}
                  />
                ))}
                {schemaResult.generated.length === 0 && (
                  <p className="text-white/40 text-xs">{t('diagnosi.schemaNoFaq')}</p>
                )}
                {schemaResult.skipped.length > 0 && (
                  <ul className="text-white/35 text-xs space-y-1 pl-1">
                    {schemaResult.skipped.map((s) => (
                      <li key={s.type}>· {s.reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  )
}

/** Localized heading for a generated schema block, by schema.org type. */
function schemaBlockLabel(type: SchemaType, faqCount: number, t: ReturnType<typeof useTranslation>['t']): string {
  if (type === 'FAQPage') return t('diagnosi.schemaBlockFaq', { count: faqCount })
  if (type === 'Organization') return t('diagnosi.schemaBlockOrg')
  return t('diagnosi.schemaBlockArticle')
}

function SchemaBlock({ label, code }: { label: string; code: string }) {
  const { t } = useTranslation()
  const [done, setDone] = useState(false)
  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <span className="text-xs font-medium text-white/60">{label}</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code)
            setDone(true)
            setTimeout(() => setDone(false), 1500)
          }}
          className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white"
        >
          {done ? <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> : <ClipboardDocumentIcon className="w-3.5 h-3.5" />}
          {done ? t('diagnosi.copied') : t('diagnosi.copy')}
        </button>
      </div>
      <pre className="text-[11px] text-white/70 p-3 overflow-x-auto leading-relaxed font-mono whitespace-pre-wrap break-all">{code}</pre>
    </div>
  )
}

export default SiteAuditPage

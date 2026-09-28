/**
 * ResultsReportPage — a clean, branded, print/PDF-ready RESULTS report for a project.
 *
 * The "show your results" deliverable agencies/clients expect: it aggregates the health score,
 * AI Share of Voice (+ trend), Citation Rate, Position, the competitor leaderboard, and the top
 * recommended actions into one shareable page. Light theme + print CSS → "Salva come PDF" via the
 * browser produces a polished one-pager. No new dependencies, no recurring spend.
 */

import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeftIcon, PrinterIcon } from '@heroicons/react/24/outline'
import { useActiveProject } from '../hooks/useActiveProject'
import { useLatestSiteAudit } from '../hooks/useSiteAudit'
import { useVisibilityMentionInsights, useCompetitorBrands } from '../hooks/useVisibilityTracker'
import type { GuidedAudit } from '../services/agent/guidedAudit'
import { pickResultsVerdict } from '../lib/resultsMath'
import { getWhiteLabelBranding } from '../lib/whiteLabelReport'
import { isAgencyPlan } from '../lib/agencyReport/gating'
import { useSubscription } from '../hooks/useSubscription'
import { uiLocaleTag } from '../common/uiLocale';

function fmtPct(v: number | null | undefined, digits = 0) {
  return v != null ? `${v.toFixed(digits)}%` : '—'
}

/** Light SoV sparkline (white-theme, prints cleanly). */
function LightSpark({ data }: { data: Array<number | null> }) {
  const { t } = useTranslation()
  const pts = data.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v != null)
  if (pts.length < 2) return <p className="text-xs text-gray-400">{t('resultsPage.insufficientTrendData')}</p>
  const W = 560
  const H = 90
  const pad = 8
  const n = data.length
  const x = (i: number) => pad + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad * 2))
  const y = (v: number) => pad + (1 - v / 100) * (H - pad * 2)
  const line = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={t('resultsPage.sovTrendAriaLabel')}>
      {[0, 50, 100].map((g) => (
        <line key={g} x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="#e5e7eb" strokeWidth="1" />
      ))}
      <path d={line} fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function Metric({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-gray-900 tabular-nums">{value}</span>
        {delta}
      </p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

/**
 * Period-over-period change chip (last 7 days vs the 7 before). Green ▲ = improved, red ▼ = declined.
 * For metrics where lower is better (avg position), pass positiveIsGood=false so the colour still
 * reflects "better/worse", not raw sign. Hidden when there's no prior-window comparison.
 */
function DeltaChip({
  value,
  positiveIsGood = true,
  unit = 'pp',
  digits = 1,
}: {
  value: number | null | undefined
  positiveIsGood?: boolean
  unit?: string
  digits?: number
}) {
  if (value == null) return null
  const flat = Math.abs(value) < (digits === 0 ? 0.5 : 0.05)
  const good = positiveIsGood ? value > 0 : value < 0
  const arrow = flat ? '■' : good ? '▲' : '▼'
  const cls = flat ? 'text-gray-400' : good ? 'text-emerald-600' : 'text-red-500'
  const mag = Math.abs(value).toFixed(digits)
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${cls}`}>
      {arrow} {mag}{unit ? ` ${unit}` : ''}
    </span>
  )
}

export function ResultsReportPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { activeProject } = useActiveProject()
  const projectId = activeProject?.id
  const { data: audit } = useLatestSiteAudit(projectId)
  const { data: ins } = useVisibilityMentionInsights(projectId, 90)
  const { data: competitors = [] } = useCompetitorBrands(projectId)
  const { subscription } = useSubscription()
  const branding = getWhiteLabelBranding(activeProject, isAgencyPlan(subscription, null))

  const health = audit as (GuidedAudit & { compositeHealth?: number }) | null | undefined
  const compNameById = useMemo(() => new Map(competitors.map((c) => [c.id, c.name])), [competitors])
  const competitorRows = useMemo(() => {
    if (!ins) return []
    return Object.entries(ins.competitorMentionsById)
      .map(([id, count]) => ({ name: compNameById.get(id) ?? `${id.slice(0, 8)}…`, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
  }, [ins, compNameById])

  const today = new Date().toLocaleDateString(uiLocaleTag(), { day: 'numeric', month: 'long', year: 'numeric' })
  const composite = health?.compositeHealth ?? health?.healthScore ?? null
  const topActions = (health?.plan ?? []).filter((p) => p.kind !== 'fix_technical').slice(0, 5)
  const sov = ins?.shareOfVoicePercent ?? null
  const wow = ins?.sovWeekOverWeekDelta ?? null

  // Plain-language "are we winning?" takeaway — the DECISION (tone + which message) is the pure,
  // unit-tested pickResultsVerdict; here we just render the chosen message with real numbers.
  const verdictPick = pickResultsVerdict({
    sovPercent: sov,
    sovWowDelta: wow,
    comparisonAvailable: ins?.sovComparisonAvailable ?? false,
  })
  const verdict: { tone: 'good' | 'neutral' | 'bad'; text: string } | null =
    verdictPick && sov != null
      ? {
          tone: verdictPick.tone,
          text:
            verdictPick.key === 'verdictGaining'
              ? t('resultsPage.verdictGaining', { delta: `+${(wow ?? 0).toFixed(1)}`, sov: sov.toFixed(1) })
              : verdictPick.key === 'verdictSlipping'
                ? t('resultsPage.verdictSlipping', { delta: (wow ?? 0).toFixed(1), sov: sov.toFixed(1) })
                : verdictPick.key === 'verdictHolding'
                  ? t('resultsPage.verdictHolding', { sov: sov.toFixed(1) })
                  : t('resultsPage.verdictEarly', { sov: sov.toFixed(1) }),
        }
      : null

  return (
    <div className="min-h-screen bg-[#0b0b0f] print:bg-white">
      {/* toolbar (hidden when printing) */}
      <div className="print:hidden sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#0b0b0f]/90 backdrop-blur">
        <button
          onClick={() => navigate({ to: '/home' as any })}
          className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white"
        >
          <ArrowLeftIcon className="w-4 h-4" /> {t('resultsPage.backToCommand')}
        </button>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-full bg-white text-black px-4 py-2 text-sm font-semibold hover:bg-white/90"
        >
          <PrinterIcon className="w-4 h-4" /> {t('resultsPage.printSaveAsPdf')}
        </button>
      </div>

      {/* the report sheet (light, print-optimized) */}
      <div className="mx-auto my-6 max-w-[820px] bg-white text-gray-900 rounded-2xl print:my-0 print:rounded-none shadow-xl print:shadow-none p-8 sm:p-10">
        {/* header */}
        <div className="flex items-start justify-between border-b border-gray-200 pb-5">
          <div>
            {branding.logoUrl && (
              <img src={branding.logoUrl} alt="" className="h-10 mb-2 object-contain max-w-[180px]" />
            )}
            <p className="text-xs font-semibold tracking-[0.18em] uppercase" style={{ color: branding.primaryColor }}>
              {branding.agencyName ?? t('resultsPage.reportEyebrow')}
            </p>
            <h1 className="text-2xl font-bold mt-1">{activeProject?.name ?? t('resultsPage.yourSiteFallback')}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {(activeProject?.website_url ?? '').replace(/^https?:\/\//, '')} · {today}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">{t('resultsPage.healthLabel')}</p>
            <p className="text-4xl font-bold text-gray-900 tabular-nums">{composite ?? '—'}</p>
          </div>
        </div>

        {!ins?.hasData && !health ? (
          <p className="text-sm text-gray-500 mt-6">
            {t('resultsPage.noDataYet')}
          </p>
        ) : (
          <>
            {/* plain-language verdict — the at-a-glance takeaway */}
            {verdict && (
              <p
                className={`mt-6 rounded-xl border px-4 py-3 text-sm font-medium leading-relaxed ${
                  verdict.tone === 'good'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : verdict.tone === 'bad'
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : 'border-gray-200 bg-gray-50 text-gray-700'
                }`}
              >
                {verdict.text}
              </p>
            )}

            {/* headline metrics */}
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">{t('resultsPage.aiVisibilityTitle')}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Metric label={t('resultsPage.shareOfVoice')} value={fmtPct(sov, 1)} delta={<DeltaChip value={wow} positiveIsGood unit="pp" />} sub={t('resultsPage.vsCompetitor')} />
                <Metric label={t('resultsPage.citationRate')} value={fmtPct(ins?.citationRatePercent)} delta={<DeltaChip value={ins?.citationRateWeekOverWeekDelta} positiveIsGood unit="pp" />} sub={t('resultsPage.answersThatLinkYou')} />
                <Metric label={t('resultsPage.avgPosition')} value={ins?.avgPosition != null ? `#${ins.avgPosition.toFixed(1)}` : '—'} delta={<DeltaChip value={ins?.positionWeekOverWeekDelta} positiveIsGood={false} unit="" />} sub={t('resultsPage.amongCitedBrands')} />
                <Metric label={t('resultsPage.brandMentions')} value={String(ins?.yourBrandMentions ?? 0)} delta={<DeltaChip value={ins?.mentionsWeekOverWeekDelta} positiveIsGood unit="" digits={0} />} sub={t('resultsPage.ofCompetitors', { count: ins?.totalCompetitorMentions ?? 0 })} />
              </div>
              <p className="text-[11px] text-gray-400 mt-2">{t('resultsPage.wowCaption')}</p>
            </section>

            {/* trend */}
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('resultsPage.sovOverTime')}</h2>
              <LightSpark data={(ins?.trend ?? []).map((d) => d.sovPercent)} />
            </section>

            {/* health breakdown */}
            {health && (
              <section className="mt-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">{t('resultsPage.siteHealthTitle')}</h2>
                <div className="grid grid-cols-3 gap-3">
                  <Metric label={t('resultsPage.technicalSeo')} value={String(health.technicalScore ?? '—')} />
                  <Metric label={t('resultsPage.geoReadiness')} value={String(health.geoReadinessScore ?? '—')} />
                  <Metric label={t('resultsPage.freshness')} value={health.freshnessScore != null ? String(health.freshnessScore) : '—'} />
                </div>
              </section>
            )}

            {/* competitor leaderboard */}
            {competitorRows.length > 0 && (
              <section className="mt-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('resultsPage.topCitedCompetitors')}</h2>
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {competitorRows.map((r, i) => (
                      <tr key={r.name} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 text-gray-400 w-6 tabular-nums">{i + 1}</td>
                        <td className="py-2 text-gray-800">{r.name}</td>
                        <td className="py-2 text-right tabular-nums font-medium text-gray-900">{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </section>
            )}

            {/* recommended actions */}
            {topActions.length > 0 && (
              <section className="mt-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('resultsPage.recommendedActions')}</h2>
                <ol className="space-y-2">
                  {topActions.map((a, i) => (
                    <li key={a.id} className="flex gap-3">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-violet-100 text-violet-700 text-xs font-semibold flex items-center justify-center tabular-nums">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{a.title}</p>
                        <p className="text-xs text-gray-500">{a.why}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}

        <div className="mt-8 pt-4 border-t border-gray-200 text-[11px] text-gray-400 flex justify-between">
          <span>{t('resultsPage.generatedBy', { date: today })}</span>
          {!branding.hideAstroSeoFooter && <span>rankdelta.ai</span>}
          {branding.hideAstroSeoFooter && branding.agencyName && <span>{branding.agencyName}</span>}
        </div>
      </div>
    </div>
  )
}

export default ResultsReportPage

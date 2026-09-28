import { useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { AreaChart } from './lazyCharts'
import { CheckCircleIcon, SparklesIcon, XCircleIcon } from '@heroicons/react/24/outline'
import { buildHeroModel, HERO_MAX_PROMPTS } from '../../lib/agencyReport/heroModel'
import { fmtAxisDate, fmtPct } from '../../lib/agencyReport/reportUi'
import type { ReportData } from '../../lib/agencyReport/types'
import { DeltaChip } from './reportPrimitives'
import { readableOn } from '../../lib/agencyReport/colorContrast'

const HERO_BG = '#0e0f1d'

/** "ChatGPT", "ChatGPT and Perplexity", "ChatGPT, Gemini e Perplexity". */
function joinNames(names: string[], locale: string): string {
  if (names.length < 2) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')}${locale === 'it-IT' ? ' e ' : ' and '}${names[names.length - 1]}`
}

interface AiVisibilityHeroProps {
  data: ReportData | null | undefined
  accentColor?: string
  title?: string
}

const MAX_PROMPTS = HERO_MAX_PROMPTS

export { buildHeroModel, type HeroModel } from '../../lib/agencyReport/heroModel'

/**
 * A prompt list that shows the first `max` items with a "+N more" toggle. Client-side only:
 * items beyond `max` stay in the DOM (hidden on screen when collapsed) so print always shows the
 * full list — the PDF is never truncated — while the on-screen reader can expand/collapse.
 */
function ExpandablePromptList({ prompts, max, listClassName }: { prompts: string[]; max: number; listClassName?: string }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const extra = prompts.length - max
  return (
    <>
      <ul className={listClassName ?? 'mt-2 space-y-1.5'}>
        {prompts.map((p, i) => (
          <li
            key={p}
            className={`text-sm leading-snug text-white/85 ${i >= max && !expanded ? 'hidden print:list-item' : ''}`}
          >
            “{p}”
          </li>
        ))}
      </ul>
      {extra > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="print:hidden mt-1.5 text-xs font-medium text-white/60 underline-offset-2 hover:text-white/80 hover:underline"
        >
          {expanded ? t('agencyReport.hero.showLess') : t('agencyReport.hero.morePrompts', { count: extra })}
        </button>
      )}
    </>
  )
}

/**
 * AI visibility hero — the first content section after the briefing and the part no
 * Google-only report can show: share of voice in AI answers, per-engine leaderboard, the
 * actual prompts won and missed, citation rate, the mentions trend and the sources AI cites.
 */
export function AiVisibilityHero({ data, accentColor, title }: AiVisibilityHeroProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith('it') ? 'it-IT' : 'en-US'
  const model = useMemo(() => buildHeroModel(data), [data])
  if (!model) return null

  const accent = accentColor ?? '#7c3aed'
  // Accent as text on the dark panel: the brand colour, lightened just enough for WCAG AA.
  const accentText = readableOn(accent, HERO_BG)
  const heading = title ?? t('agencyReport.hero.title')
  const enginesLine = model.engines.map((e) => e.engine).join(' · ')
  // Name only the engines this report tracks (it used to promise Gemini "and the other assistants").
  const engineNames = model.engines.map((e) => e.engine)
  const enginesList = engineNames.length > 0 ? joinNames(engineNames, locale) : null
  const hasEngineVisits = model.engines.some((e) => e.sessions != null && e.sessions > 0)
  const maxEnginePct = Math.max(1, ...model.engines.map((e) => e.pct))
  const chartRows = model.trend.map((d) => ({
    date: fmtAxisDate(d.date, locale),
    [t('agencyReport.hero.you')]: d.yours,
    [t('agencyReport.hero.competitors')]: d.competitors,
  }))

  return (
    <section
      aria-label={heading}
      data-testid="ai-visibility-hero"
      className="relative overflow-hidden rounded-2xl bg-[#0e0f1d] p-5 text-white sm:p-7 print:break-inside-avoid"
      style={{ '--hero-accent': accent } as CSSProperties}
    >
      {/* accent glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl print:hidden"
        style={{ background: accent }}
      />

      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: accentText }}>
              <SparklesIcon className="h-3.5 w-3.5" aria-hidden />
              {t('agencyReport.hero.eyebrow')}
            </p>
            <h2 className="mt-1 text-lg font-bold leading-tight sm:text-xl">{heading}</h2>
          </div>
          {enginesLine && <p className="text-[11px] font-medium text-white/50">{enginesLine}</p>}
        </div>

        {/* Headline number */}
        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-8">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-white/50">{t('agencyReport.hero.sovLabel')}</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-3">
              <p className="text-5xl font-bold tabular-nums leading-none sm:text-6xl" data-testid="hero-sov">
                {model.sovPct != null ? fmtPct(model.sovPct, 1) : '—'}
              </p>
              {model.sovPct != null && model.sovHasBaseline && model.sovDelta != null ? (
                <span className="flex items-center gap-1.5 text-sm">
                  <DeltaChip value={model.sovDelta} unit="pt" digits={1} onDark />
                  <span className="text-white/50">{t('agencyReport.hero.vsPrevious')}</span>
                </span>
              ) : model.sovPct != null ? (
                <span className="text-xs text-white/60">{t('agencyReport.hero.firstReading')}</span>
              ) : null}
            </div>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/70">
              {model.promptsTotal > 0 && model.promptSplitOk
                ? t('agencyReport.hero.sovCaptionPrompts', {
                    count: model.promptsWon.length,
                    total: model.promptsTotal,
                    competitors: model.competitors.length,
                  })
                : model.promptsTotal > 0
                  ? t('agencyReport.hero.sovCaptionTracked', { total: model.promptsTotal, competitors: model.competitors.length })
                  : t('agencyReport.hero.sovCaptionNoPrompts', { competitors: model.competitors.length })}
            </p>
            {model.brandedPrompts.length > 0 && (
              <p className="mt-1 max-w-md text-xs leading-relaxed text-white/50" data-testid="hero-sov-discovery-note">
                {t('agencyReport.hero.sovDiscoveryNote', { count: model.brandedPrompts.length })}
              </p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                {model.promptSplitOk ? (
                  <>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-white/50">{t('agencyReport.hero.promptsWonShort')}</p>
                    <p className="mt-1 text-xl font-bold tabular-nums">
                      {model.promptsWon.length}
                      <span className="text-sm font-medium text-white/60">/{model.promptsTotal}</span>
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-white/50">{t('agencyReport.hero.trackedPrompts')}</p>
                    <p className="mt-1 text-xl font-bold tabular-nums">{model.promptsTotal}</p>
                  </>
                )}
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/50">{t('agencyReport.hero.citationRate')}</p>
                <p className="mt-1 flex items-baseline gap-2 text-xl font-bold tabular-nums">
                  {model.citationPct != null ? fmtPct(model.citationPct, model.citationPct >= 10 ? 0 : 1) : '—'}
                  {model.citationPct != null && model.citationHasBaseline && model.citationDelta != null && (
                    <DeltaChip value={model.citationDelta} unit="pt" digits={1} onDark />
                  )}
                </p>
                {model.citationPct != null && model.citationSample && (
                  <p className="mt-0.5 text-[10px] leading-tight text-white/60" data-testid="hero-citation-sample">
                    {t('agencyReport.hero.citationSample', { cited: model.citationSample.cited, total: model.citationSample.withSources })}
                  </p>
                )}
              </div>
              <div className="col-span-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 sm:col-span-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/50">{t('agencyReport.hero.competitorsTitle')}</p>
                <p className="mt-1 text-xl font-bold tabular-nums">{model.competitors.length}</p>
              </div>
            </div>
          </div>

          {/* Engine leaderboard */}
          {model.engines.length > 0 && (
            <div data-testid="hero-engines">
              <p className="text-xs font-medium uppercase tracking-wide text-white/50">{t('agencyReport.hero.engines')}</p>
              <ul className="mt-2 space-y-2.5">
                {model.engines.map((e) => (
                  <li key={e.engine}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium">{e.engine}</span>
                      <span className="flex items-center gap-2 tabular-nums">
                        {e.sessions != null && e.sessions > 0 && (
                          <span className="text-[11px] text-white/60">{t('agencyReport.hero.visits', { count: e.sessions })}</span>
                        )}
                        <span className="font-semibold">{fmtPct(e.pct, e.pct >= 10 ? 0 : 1)}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${e.engine}: ${fmtPct(e.pct)}`}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, (e.pct / maxEnginePct) * 100)}%`, background: accent }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-white/60">{t(hasEngineVisits ? 'agencyReport.hero.enginesCaptionVisits' : 'agencyReport.hero.enginesCaption')}</p>
            </div>
          )}
        </div>

        {/* Tracked prompts, neutral, when the mentioned / missing split cannot be trusted */}
        {model.promptsTotal > 0 && !model.promptSplitOk && (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4" data-testid="hero-prompts-tracked">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/50">{t('agencyReport.hero.trackedPrompts')}</p>
            <ExpandablePromptList
              prompts={[...model.promptsWon, ...model.promptsMissing]}
              max={MAX_PROMPTS * 2}
              listClassName="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2"
            />
            <p className="mt-2 text-[11px] text-white/60">{t('agencyReport.hero.promptSplitUnavailable')}</p>
          </div>
        )}

        {/* Prompts won / missing */}
        {model.promptsTotal > 0 && model.promptSplitOk && (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4" data-testid="hero-prompts-won">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-300">
                <CheckCircleIcon className="h-4 w-4" aria-hidden />
                {t('agencyReport.hero.promptsWon')}
                <span className="ml-auto shrink-0 whitespace-nowrap font-medium normal-case tracking-normal text-emerald-200/70">
                  {t('agencyReport.hero.promptsCount', { count: model.promptsWon.length, total: model.promptsTotal })}
                </span>
              </p>
              {model.promptsWon.length === 0 ? (
                <p className="mt-2 text-sm text-white/60">{t('agencyReport.hero.noPromptsWon')}</p>
              ) : (
                <ExpandablePromptList prompts={model.promptsWon} max={MAX_PROMPTS} />
              )}
            </div>
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-4" data-testid="hero-prompts-missing">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-rose-300">
                <XCircleIcon className="h-4 w-4" aria-hidden />
                {t('agencyReport.hero.promptsMissing')}
                <span className="ml-auto shrink-0 whitespace-nowrap font-medium normal-case tracking-normal text-rose-200/70">
                  {t('agencyReport.hero.promptsCount', { count: model.promptsMissing.length, total: model.promptsTotal })}
                </span>
              </p>
              {model.promptsMissing.length === 0 ? (
                <p className="mt-2 text-sm text-white/60">{t('agencyReport.hero.noPromptsMissing')}</p>
              ) : (
                <>
                  {model.leader && (
                    <p className="mt-1 text-[11px] text-rose-200/70">{t('agencyReport.hero.promptsMissingLed', { competitor: model.leader })}</p>
                  )}
                  <ExpandablePromptList prompts={model.promptsMissing} max={MAX_PROMPTS} />
                </>
              )}
            </div>
          </div>
        )}

        {/* Brand prompts: they name the brand, so they sit outside SoV and won / missing */}
        {model.brandedPrompts.length > 0 && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4" data-testid="hero-branded-prompts">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/50">
              {t('agencyReport.hero.brandedPrompts')}
              <span className="ml-2 font-medium normal-case tracking-normal text-white/60">
                {t('agencyReport.hero.promptsCount', {
                  count: model.brandedPrompts.filter((p) => p.mentioned).length,
                  total: model.brandedPrompts.length,
                })}
              </span>
            </p>
            <p className="mt-1 text-[11px] text-white/60">{t('agencyReport.hero.brandedPromptsHelp')}</p>
            <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2">
              {model.brandedPrompts.slice(0, MAX_PROMPTS).map((p) => (
                <li key={p.text} className="flex items-start gap-1.5 text-sm text-white/75">
                  {p.mentioned ? (
                    <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-label={t('agencyReport.hero.brandedMentioned')} />
                  ) : (
                    <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-label={t('agencyReport.hero.brandedNotMentioned')} />
                  )}
                  <span>&ldquo;{p.text}&rdquo;</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Trend + sources + competitors */}
        {(model.trend.length > 1 || model.sources.length > 0 || model.competitors.length > 0) && (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {model.trend.length > 1 && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 md:col-span-2" role="img" aria-label={t('agencyReport.hero.trend')}>
                <p className="text-xs font-semibold uppercase tracking-wide text-white/50">{t('agencyReport.hero.trend')}</p>
                <AreaChart
                  className="mt-2 h-36 [&_text]:fill-white/50"
                  data={chartRows}
                  index="date"
                  categories={[t('agencyReport.hero.you'), t('agencyReport.hero.competitors')]}
                  colors={['violet', 'slate']}
                  showLegend
                  showGridLines={false}
                  showYAxis={false}
                  curveType="monotone"
                />
              </div>
            )}
            {model.sources.length > 0 && (
              <div className={`rounded-xl border border-white/10 bg-white/[0.03] p-4 ${model.trend.length > 1 ? '' : 'md:col-span-2'}`} data-testid="hero-sources">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/50">{t('agencyReport.hero.sources')}</p>
                <ul className="mt-2 space-y-1.5">
                  {model.sources.map((s) => (
                    <li key={s.domain} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate text-white/85">{s.domain}</span>
                      <span className="shrink-0 text-xs tabular-nums text-white/60">{t('agencyReport.hero.citations', { count: s.count })}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-white/60">{t('agencyReport.hero.sourcesCaption')}</p>
              </div>
            )}
            {model.competitors.length > 0 && model.trend.length <= 1 && model.sources.length === 0 && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 md:col-span-3" data-testid="hero-competitors">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/50">{t('agencyReport.hero.competitorsTitle')}</p>
                <p className="mt-2 text-sm text-white/80">
                  {model.competitorCountsOk
                    ? model.competitors.map((c) => (c.mentions > 0 ? `${c.name} (${t('agencyReport.hero.mentions', { count: c.mentions })})` : `${c.name} (${t('agencyReport.hero.noMentions')})`)).join(' · ')
                    : model.competitors.map((c) => c.name).join(' · ')}
                </p>
              </div>
            )}
          </div>
        )}

        <p className="mt-5 text-[11px] leading-relaxed text-white/60">{enginesList ? t('agencyReport.hero.moat', { engines: enginesList }) : t('agencyReport.hero.moatGeneric')}</p>
        {model.modelOnlyEngines.length > 0 && (
          <p className="mt-1 text-[11px] leading-relaxed text-white/60" data-testid="hero-method-note">
            {t('agencyReport.hero.methodNote', { engines: joinNames(model.modelOnlyEngines, locale), count: model.modelOnlyEngines.length })}
          </p>
        )}
      </div>
    </section>
  )
}

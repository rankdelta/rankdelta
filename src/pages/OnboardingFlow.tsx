/**
 * OnboardingFlow — the guided "from URL to a live workspace" setup.
 *
 * This is the activation centerpiece (the move every competitor makes: AirOps, BabyLoveGrowth,
 * RankYak). The user types ONE thing — their URL — and we do the rest, showing each result as a
 * review step ("AI proposes → you confirm", which is also a data-quality safeguard):
 *
 *   1. Sito        — paste URL, we read the site
 *   2. Profilo     — confirm the auto-extracted business profile  → creates the project + brand
 *   3. Concorrenti — confirm auto-discovered competitors          → saved to tracking
 *   4. Domande     — auto-generate the AI prompts we'll track     → saved
 *   5. Pronto      — kicks off the (cheap) health diagnosis and lands on the Comando
 *
 * Unlike the competitors, the flow does NOT end in a separate report card — it ends INSIDE our
 * dashboard (the "salute generale" Comando), which is the paradigm we keep. No chatbot.
 *
 * Resilient by construction: every auto-step degrades gracefully (empty profile, zero competitors,
 * failed prompt gen) and the user can always edit/skip. The project is created at step 2, so an
 * abandoned wizard still leaves a usable workspace.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  SparklesIcon,
  GlobeAltIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  ArrowPathIcon,
  PlusIcon,
  UsersIcon,
  ChatBubbleLeftRightIcon,
  TrophyIcon,
  ArrowTrendingUpIcon,
  HeartIcon,
  CreditCardIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import { AppShell } from '../components/layout/AppShell'
import { useActiveProject } from '../hooks/useActiveProject'
import { useCreateProject, ProjectLimitError } from '../hooks/useProjects'
import { useSubscription } from '../hooks/useSubscription'
import { useAuth } from '../hooks/useAuth'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabaseClient'
import { scoreTone } from '../lib/score'
import {
  CONTENT_LANGUAGES,
  defaultUiContentLanguage,
  marketForContentLanguage,
  normalizeContentLanguage,
  prefersEnglishUi,
} from '../lib/contentLanguages'
import { analyzeWebsite, type WebsiteProfile } from '../services/websiteAnalysis'
import type { WorkspaceMarket } from '../types/database'
import { WorkspaceMarketSelectOptions } from '../lib/workspaceMarkets'
import { discoverCompetitors, type DiscoveredCompetitor } from '../services/competitorDiscovery'
import { generateVisibilityQueries } from '../services/visibilityOps'
import type { GuidedAudit } from '../services/agent/guidedAudit'
import { useVisibilityQueries, useDeleteVisibilityQuery, visibilityKeys } from '../hooks/useVisibilityTracker'
import { markAuditRunning, clearAuditRunning } from '../services/auditStatus'
import { requiresSubscription } from '../config/deployment'
import { TRIAL_DEFAULT_PLAN } from '../config/planPricing'
import { useStartTrialModal } from '../components/subscription/StartTrialModal'
import { patchOnboardingSnapshot, seedOnboardingQuery } from '../lib/onboardingSnapshot'
import { patchProjectMetadata } from '../lib/projectMetadata'
import { clearPendingCheck, readPendingCheck } from '../lib/pendingCheck'

type Goal = 'ai' | 'competitor' | 'traffic'

type Step = 0 | 1 | 2 | 3 | 4

const STEP_KEYS = ['stepperSito', 'stepperProfilo', 'stepperConcorrenti', 'stepperDomande'] as const

function hostOf(url: string): string {
  try {
    const u = url.includes('://') ? url : `https://${url}`
    return new URL(u).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/^www\./i, '').split('/')[0]?.toLowerCase() ?? ''
  }
}

function normalizeUrl(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  return t.includes('://') ? t : `https://${t}`
}

// Real AI-visibility result shown at the reveal — the actual "does ChatGPT cite you?" answer,
// fetched live from the public `ai-visibility-check` edge function
// (no auth, no app credits, server-side rate-limited + 7-day cached). Mirrors HeroVisibilityCheck.
type VisLevel = 'recommended' | 'known' | 'absent'
type VisibilityCheck = { brand: string; query: string; level: VisLevel; cited: boolean; competitors: string[] }

const VIS_COPY: Record<'en' | 'it', Record<VisLevel, { tone: 'good' | 'warn' | 'bad'; title: (b: string) => string; body: (q: string) => string }>> = {
  en: {
    recommended: { tone: 'good', title: (b) => `ChatGPT already recommends ${b}.`, body: (q) => `You show up for “${q}”. Now defend and grow your AI Share of Voice.` },
    known: { tone: 'warn', title: (b) => `ChatGPT knows ${b} — but rarely recommends it.`, body: (q) => `For “${q}” it points elsewhere. Your AI potential is still untapped:` },
    absent: { tone: 'bad', title: (b) => `ChatGPT doesn’t mention ${b} yet.`, body: (q) => `Asked “${q}”, it recommends instead:` },
  },
  it: {
    recommended: { tone: 'good', title: (b) => `ChatGPT consiglia già ${b}.`, body: (q) => `Compari per “${q}”. Ora difendi e fai crescere la tua Quota di Voce AI.` },
    known: { tone: 'warn', title: (b) => `ChatGPT conosce ${b} — ma raramente lo consiglia.`, body: (q) => `Per “${q}” indirizza altrove. Il tuo potenziale sull’AI è ancora inespresso:` },
    absent: { tone: 'bad', title: (b) => `ChatGPT non menziona ancora ${b}.`, body: (q) => `Alla domanda “${q}”, consiglia invece:` },
  },
}

const VIS_TONE = {
  good: { Icon: CheckCircleIcon, color: 'text-emerald-400' },
  warn: { Icon: ExclamationTriangleIcon, color: 'text-amber-400' },
  bad: { Icon: XCircleIcon, color: 'text-rose-400' },
} as const

export function OnboardingFlow() {
  const { t, i18n } = useTranslation()
  // The profile should be written in the language the user is reading the UI in, not the site's
  // language — otherwise an English user pointing us at an Italian site gets an Italian profile.
  const uiLang = defaultUiContentLanguage(i18n.language)
  const navigate = useNavigate()
  const { setActive } = useActiveProject()
  const createProject = useCreateProject()
  const { subscribe, canUseEngine, isTrialEligible } = useSubscription()
  const trialModal = useStartTrialModal()
  const { user } = useAuth()

  const [step, setStep] = useState<Step>(0)
  const [error, setError] = useState<string | null>(null)

  // Step 0 — URL + goal (the goal personalizes the final reveal copy)
  // Pre-filled from the landing page's free check when the user signed up right after it: the
  // visitor already typed this domain once, so the step opens on "Analyze" instead of an empty box.
  const [pendingDomain] = useState(() => readPendingCheck()?.domain ?? '')
  const [url, setUrl] = useState(pendingDomain)
  const continuingFromCheck = pendingDomain !== '' && url.trim() === pendingDomain
  const analyzeButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (pendingDomain) analyzeButtonRef.current?.focus()
  }, [pendingDomain])
  const [goal, setGoal] = useState<Goal | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  // Step 4 — personalized reveal (audit-backed, computed at finish; no per-signup live API spend)
  const [auditResult, setAuditResult] = useState<GuidedAudit | null>(null)
  // Real "does ChatGPT cite you?" result — the centerpiece aha of the reveal (see VIS_COPY).
  const [visibility, setVisibility] = useState<VisibilityCheck | null>(null)
  const [revealLoading, setRevealLoading] = useState(false)
  const [startingCheckout, setStartingCheckout] = useState(false)

  // Step 1 — profile (editable)
  const [profile, setProfile] = useState<WebsiteProfile | null>(null)
  // Target market, independent of the detected site language. null = follow the language (safe
  // default: keeps volume/SERP consistent); set explicitly for e.g. an English site targeting Italy.
  const [marketOverride, setMarketOverride] = useState<WorkspaceMarket | null>(null)
  const [creating, setCreating] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)

  // Step 2 — competitors
  const [discovering, setDiscovering] = useState(false)
  const [competitors, setCompetitors] = useState<Array<DiscoveredCompetitor & { selected: boolean }>>([])
  const [newCompName, setNewCompName] = useState('')
  const [newCompDomain, setNewCompDomain] = useState('')
  const [savingComps, setSavingComps] = useState(false)

  // Step 3 — prompts (generated, then REVIEWED before they're kept)
  const [generatingQueries, setGeneratingQueries] = useState(false)
  // IDs the user unchecked in the review list — deleted on confirm so only chosen prompts are tracked.
  const [deselectedQueries, setDeselectedQueries] = useState<Set<string>>(() => new Set())
  const qc = useQueryClient()
  const { data: generatedQueries = [] } = useVisibilityQueries(projectId ?? undefined)
  const deleteQuery = useDeleteVisibilityQuery(projectId ?? '')

  const setProfileField = useCallback(<K extends keyof WebsiteProfile>(key: K, value: WebsiteProfile[K]) => {
    setProfile((p) => (p ? { ...p, [key]: value } : p))
  }, [])

  // ----- Step 0 → 1: read the site -----
  async function handleAnalyze() {
    const normalized = normalizeUrl(url)
    if (!normalized || !hostOf(normalized)) {
      setError(t('onboarding2.errorInvalidUrl'))
      return
    }
    setError(null)
    setAnalyzing(true)
    try {
      const result = await analyzeWebsite(normalized, uiLang)
      setProfile(result)
      setUrl(normalized)
      setStep(1)
    } catch (e) {
      console.warn('[Onboarding] analyze failed:', e)
      // Never block — let the user fill it in manually.
      setProfile({
        brandName: hostOf(normalized).split('.')[0]?.replace(/\b\w/g, (c) => c.toUpperCase()) ?? '',
        description: '',
        targetAudience: [],
        primaryKeyword: '',
        mainTopic: '',
        expertise: '',
        locality: '',
        language: uiLang,
      })
      setUrl(normalized)
      setStep(1)
    } finally {
      setAnalyzing(false)
    }
  }

  // ----- Step 1 → 2: create the project + tracked brand, then discover competitors -----
  async function handleConfirmProfile() {
    if (!profile) return
    const name = profile.brandName.trim()
    if (!name) {
      setError(t('onboarding2.errorNoName'))
      return
    }
    setError(null)
    setCreating(true)
    try {
      const created = await createProject.mutateAsync({
        name,
        website_url: url,
        primary_keyword: profile.primaryKeyword || undefined,
        main_topic: profile.mainTopic || undefined,
        language: profile.language,
        // Keep both language columns in step: primary_language defaults to 'en' in the DB and
        // several readers (reports, prompts) still consult it.
        primary_language: profile.language,
        // Market defaults to the detected language's market (English site → ~0 volume against the IT
        // market), but the user can override it — e.g. an English-language site that targets Italy.
        market: marketOverride ?? marketForContentLanguage(profile.language),
        author_name: t('onboarding2.defaultAuthor', { name }),
        author_bio: profile.description || undefined,
        author_expertise: profile.expertise || undefined,
      })
      clearPendingCheck()
      setProjectId(created.id)
      setActive(created.id)

      const locality = profile.locality?.trim() ?? ''
      if (goal || locality) {
        void patchProjectMetadata(created.id, { ...(goal ? { goal } : {}), ...(locality ? { locality } : {}) }).catch((e: unknown) => {
          console.warn('[Onboarding] metadata save failed:', e)
        })
      }

      // Track the user's own brand (the baseline for Share of Voice). Best-effort.
      const host = hostOf(url)
      void supabase
        .from('tracked_brands')
        .insert({ project_id: created.id, name, domain: host || null, aliases: [] })
        .then(({ error: e }) => {
          if (e) console.warn('[Onboarding] tracked brand insert failed:', e.message)
        })

      setStep(2)
      void runDiscovery(created.id)
    } catch (e: any) {
      if (e instanceof ProjectLimitError) {
        setError(t('paywall.projectLimitTitle'))
        void navigate({ to: '/pricing' as any })
        return
      }
      setError(e?.message || t('onboarding2.errorCreateProject'))
    } finally {
      setCreating(false)
    }
  }

  // ----- Step 2: discover competitors -----
  async function runDiscovery(_pid: string) {
    if (!profile) return
    setDiscovering(true)
    try {
      const found = await discoverCompetitors({
        siteUrl: url,
        brandName: profile.brandName,
        keyword: profile.primaryKeyword || profile.mainTopic,
        niche: profile.expertise,
        language: profile.language,
        limit: 6,
      })
      setCompetitors(found.map((c) => ({ ...c, selected: true })))
    } catch (e) {
      console.warn('[Onboarding] competitor discovery failed:', e)
      setCompetitors([])
    } finally {
      setDiscovering(false)
    }
  }

  function toggleCompetitor(domain: string) {
    setCompetitors((list) => list.map((c) => (c.domain === domain ? { ...c, selected: !c.selected } : c)))
  }

  function addManualCompetitor() {
    const domain = hostOf(newCompDomain)
    if (!domain) return
    if (competitors.some((c) => c.domain === domain)) {
      setNewCompName('')
      setNewCompDomain('')
      return
    }
    const name = newCompName.trim() || domain.split('.')[0]?.replace(/\b\w/g, (c) => c.toUpperCase()) || domain
    setCompetitors((list) => [...list, { name, domain, selected: true }])
    setNewCompName('')
    setNewCompDomain('')
  }

  // ----- Step 2 → 3: save competitors, then generate tracked prompts -----
  async function handleConfirmCompetitors() {
    if (!projectId) return
    setSavingComps(true)
    try {
      const chosen = competitors.filter((c) => c.selected)
      if (chosen.length > 0) {
        const { error: e } = await supabase
          .from('competitor_brands')
          .insert(chosen.map((c) => ({ project_id: projectId, name: c.name, domain: c.domain, aliases: [] })))
        if (e) console.warn('[Onboarding] competitor insert failed:', e.message)
      }
      setStep(3)
      void runQueryGeneration(projectId)
    } finally {
      setSavingComps(false)
    }
  }

  // ----- Step 3: generate the AI prompts we'll track -----
  async function runQueryGeneration(pid: string) {
    setGeneratingQueries(true)
    try {
      await generateVisibilityQueries(pid, 12)
      // Pull the freshly-inserted prompts into the review list (we call the service directly, not the
      // mutation hook, so the cache won't refresh on its own).
      await qc.invalidateQueries({ queryKey: visibilityKeys.queries(pid) })
    } catch (e) {
      console.warn('[Onboarding] query generation failed:', e)
    } finally {
      setGeneratingQueries(false)
    }
  }

  // Confirm the review: delete any prompt the user unchecked (so only chosen ones are tracked), then finish.
  async function confirmPromptsAndFinish() {
    const toDelete = generatedQueries.filter((q) => deselectedQueries.has(q.id))
    if (toDelete.length > 0) {
      await Promise.all(toDelete.map((q) => deleteQuery.mutateAsync(q.id).catch(() => {})))
    }
    handleFinish()
  }

  // ----- Step 3 → 4: run the (free) health diagnosis and show a personalized reveal -----
  // We AWAIT the audit here (instead of fire-and-forget) because its scores power the reveal that
  // sits right before the paywall. Still persisted so the Comando shows it too. Always graceful:
  // a failed audit just yields a softer reveal, never a dead end.
  async function handleFinish() {
    setStep(4)
    if (!projectId || !url) return
    const pid = projectId
    const lang = profile?.language || 'it'
    markAuditRunning(pid)
    setRevealLoading(true)

    // Quick, capped audit (8 pages) just to power the reveal — the full audit can run later on the
    // Diagnosi page. Persisted so the Comando shows it too.
    const auditPromise = (async (): Promise<GuidedAudit | null> => {
      try {
        const [{ runGuidedAudit }, { saveSiteAudit }] = await Promise.all([
          import('../services/agent/guidedAudit'),
          import('../services/siteAudit'),
        ])
        const result = await runGuidedAudit({ siteUrl: url, language: lang, maxPages: 8, uiLanguage: i18n.language })
        await saveSiteAudit(pid, result)
        void patchOnboardingSnapshot(pid, {
          health: {
            compositeHealth: result.compositeHealth ?? result.healthScore ?? 0,
            geoReadinessScore: result.geoReadinessScore ?? null,
            at: new Date().toISOString(),
          },
        }).then(() => qc.invalidateQueries({ queryKey: ['projects'] }))
        void qc.invalidateQueries({ queryKey: ['siteAudit', pid, 'latest'] })
        return result
      } catch (e) {
        console.warn('[Onboarding] reveal audit failed:', e)
        return null
      } finally {
        clearAuditRunning(pid)
      }
    })()

    // The real aha: ask ChatGPT live whether this brand is cited (and who's cited instead). Uses the
    // ai-visibility-check edge function (public on the cloud, signed-in only on self-host) — no app credits, server-side rate-limited +
    // 7-day cached (so a visitor who already ran the landing check hits cache instantly here).
    // Graceful: any failure (no email, rate-limit, network) just falls back to the canned verdict.
    const visibilityPromise = (async (): Promise<VisibilityCheck | null> => {
      try {
        const host = hostOf(url)
        if (!host || !user?.email) return null
        // The user's session token: self-host instances only run this check for signed-in users.
        const { data: sessionData } = await supabase.auth.getSession()
        const bearer = sessionData.session?.access_token ?? SUPABASE_ANON_KEY
        const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-visibility-check`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${bearer}`,
          },
          body: JSON.stringify({ domain: host, email: user.email, lang }),
        })
        const data: any = await res.json().catch(() => null)
        if (!res.ok || !data || data.error || !data.level) return null
        const vis: VisibilityCheck = {
          brand: String(data.brand || profile?.brandName || host),
          query: String(data.query || ''),
          level: data.level as VisLevel,
          cited: !!data.cited,
          competitors: Array.isArray(data.competitors) ? data.competitors.slice(0, 5) : [],
        }
        try {
          await patchOnboardingSnapshot(pid, {
            visibility: { ...vis, at: new Date().toISOString() },
          })
          await seedOnboardingQuery({ projectId: pid, text: vis.query, language: lang })
          void qc.invalidateQueries({ queryKey: ['projects'] })
          void qc.invalidateQueries({ queryKey: visibilityKeys.queries(pid) })
        } catch (e) {
          console.warn('[Onboarding] persist visibility snapshot failed:', e)
        }
        return vis
      } catch (e) {
        console.warn('[Onboarding] visibility check failed:', e)
        return null
      }
    })()

    // Fill each panel in as it lands (even after the spinner stops).
    void auditPromise.then((r) => { if (r) setAuditResult(r) }).catch(() => {})
    void visibilityPromise.then((v) => { if (v) setVisibility(v) }).catch(() => {})

    // Never let the reveal hang: show it within 15s even if a check is slow. Whichever of the two
    // lands first ends the spinner; the other panel fills in afterwards.
    const timeoutPromise = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 15000))
    await Promise.race([visibilityPromise, auditPromise, timeoutPromise])
    setRevealLoading(false)
  }

  // Reveal CTA — trial users pick a plan in StartTrialModal; returning users go straight to pay-now checkout.
  // On failure, fall back to the dashboard so the user is never stuck (the Comando banner will re-offer upgrade).
  // Self-host has no trial/billing: go straight to the dashboard, everything is already unlocked.
  async function handleStartTrial() {
    if (!requiresSubscription()) {
      void navigate({ to: '/home' as any })
      return
    }
    if (isTrialEligible === false) {
      setStartingCheckout(true)
      try {
        await subscribe(TRIAL_DEFAULT_PLAN)
      } catch (e) {
        console.warn('[Onboarding] checkout failed, sending to dashboard:', e)
        void navigate({ to: '/home' as any })
      } finally {
        setStartingCheckout(false)
      }
      return
    }
    trialModal.openTrialModal()
  }

  return (
    <AppShell maxWidth="5xl">
      {/* Header + progress */}
      <div className="mb-8">
        <p className="text-violet-300/70 text-xs tracking-[0.18em] uppercase mb-1.5 flex items-center gap-1.5">
          <SparklesIcon className="w-3.5 h-3.5" />
          {t('onboarding2.eyebrow')}
        </p>
        <h1 className="text-3xl font-bold text-white">{t('onboarding2.title')}</h1>
        <p className="text-white/40 mt-1.5">
          {t('onboarding2.subtitle')}
        </p>
      </div>

      <Stepper current={step} />

      <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8">
        {error && (
          <div className="mb-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {/* STEP 0 — URL */}
        {step === 0 && (
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">{t('onboarding2.step0Label')}</label>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <GlobeAltIcon className="w-5 h-5 text-white/30 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !analyzing) handleAnalyze()
                  }}
                  placeholder={t('onboarding2.step0UrlPlaceholder')}
                  autoFocus={!pendingDomain}
                  disabled={analyzing}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.03] pl-11 pr-4 py-3 text-white placeholder-white/30 outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/40 disabled:opacity-60"
                />
              </div>
              <button
                ref={analyzeButtonRef}
                onClick={handleAnalyze}
                disabled={analyzing || !url.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-500 px-6 py-3 font-medium text-white transition hover:bg-violet-400 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {analyzing ? (
                  <>
                    <ArrowPathIcon className="w-5 h-5 animate-spin" />
                    {t('onboarding2.step0Reading')}
                  </>
                ) : (
                  <>
                    <SparklesIcon className="w-5 h-5" />
                    {t('onboarding2.step0Analyze')}
                  </>
                )}
              </button>
            </div>
            {continuingFromCheck ? (
              <p className="mt-3 text-xs text-violet-300/80">
                {t('onboarding2.step0FromCheck', { domain: pendingDomain })}
              </p>
            ) : (
              <p className="mt-3 text-xs text-white/40">
                {t('onboarding2.step0Helper')}
              </p>
            )}

            {/* Goal — a light personalization signal that tailors the final reveal copy. */}
            <div className="mt-6">
              <p className="text-sm font-medium text-white/60 mb-2">{t('onboarding2.goalLabel')}</p>
              <div className="flex flex-wrap gap-2">
                {([
                  { key: 'ai' as const, label: t('onboarding2.goalAI'), Icon: SparklesIcon },
                  { key: 'competitor' as const, label: t('onboarding2.goalCompetitor'), Icon: TrophyIcon },
                  { key: 'traffic' as const, label: t('onboarding2.goalTraffic'), Icon: ArrowTrendingUpIcon },
                ]).map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setGoal((g) => (g === key ? null : key))}
                    className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm transition ${
                      goal === key
                        ? 'border-violet-500/50 bg-violet-500/[0.12] text-white'
                        : 'border-white/10 bg-white/[0.02] text-white/60 hover:bg-white/[0.05]'
                    }`}
                  >
                    <Icon className="w-4 h-4" strokeWidth={1.8} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {analyzing && (
              <div className="mt-6 space-y-2 text-sm text-white/50">
                <LoadingLine text={t('onboarding2.step0Loading1')} />
                <LoadingLine text={t('onboarding2.step0Loading2')} />
                <LoadingLine text={t('onboarding2.step0Loading3')} />
              </div>
            )}
          </div>
        )}

        {/* STEP 1 — profile review */}
        {step === 1 && profile && (
          <div>
            <div className="mb-5 flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircleIcon className="w-5 h-5" />
              {t('onboarding2.step1Intro')}
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label={t('onboarding2.step1BrandLabel')}>
                <input
                  value={profile.brandName}
                  onChange={(e) => setProfileField('brandName', e.target.value)}
                  className={inputCls}
                  placeholder={t('onboarding2.step1BrandPlaceholder')}
                />
              </Field>
              <Field label={t('onboarding2.step1LanguageLabel')}>
                <select
                  value={profile.language}
                  onChange={(e) => setProfileField('language', normalizeContentLanguage(e.target.value))}
                  className={inputCls}
                >
                  {CONTENT_LANGUAGES.map((code) => (
                    <option key={code} value={code}>{t(`contentLang.${code}`)}</option>
                  ))}
                </select>
              </Field>
              <Field label={t('onboarding2.step1MarketLabel')}>
                <select
                  value={marketOverride ?? marketForContentLanguage(profile.language)}
                  onChange={(e) => setMarketOverride(e.target.value as WorkspaceMarket)}
                  className={inputCls}
                >
                  <WorkspaceMarketSelectOptions t={t} />
                </select>
              </Field>
              <Field label={t('onboarding2.step1KeywordLabel')}>
                <input
                  value={profile.primaryKeyword}
                  onChange={(e) => setProfileField('primaryKeyword', e.target.value)}
                  className={inputCls}
                  placeholder={t('onboarding2.step1KeywordPlaceholder')}
                />
              </Field>
              <Field label={t('onboarding2.step1TopicLabel')}>
                <input
                  value={profile.mainTopic}
                  onChange={(e) => setProfileField('mainTopic', e.target.value)}
                  className={inputCls}
                  placeholder={t('onboarding2.step1TopicPlaceholder')}
                />
              </Field>
            </div>

            <Field label={t('onboarding2.step1DescriptionLabel')} className="mt-4">
              <textarea
                value={profile.description}
                onChange={(e) => setProfileField('description', e.target.value)}
                rows={3}
                className={`${inputCls} resize-none`}
                placeholder={t('onboarding2.step1DescriptionPlaceholder')}
              />
            </Field>

            <Field label={t('onboarding2.step1LocalityLabel')} className="mt-4">
              <input
                value={profile.locality ?? ''}
                onChange={(e) => setProfileField('locality', e.target.value)}
                className={inputCls}
                placeholder={t('onboarding2.step1LocalityPlaceholder')}
              />
              <p className="mt-1 text-xs text-white/40">{t('onboarding2.step1LocalityHint')}</p>
            </Field>

            {profile.targetAudience.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-white/50 mb-2">{t('onboarding2.step1AudienceLabel')}</p>
                <div className="flex flex-wrap gap-2">
                  {profile.targetAudience.map((a) => (
                    <span
                      key={a}
                      className="rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-7 flex items-center justify-between">
              <button onClick={() => setStep(0)} className="text-sm text-white/50 hover:text-white/80">
                ← {t('onboarding2.back')}
              </button>
              <button
                onClick={handleConfirmProfile}
                disabled={creating}
                className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-6 py-3 font-medium text-white transition hover:bg-violet-400 disabled:opacity-50"
              >
                {creating ? (
                  <>
                    <ArrowPathIcon className="w-5 h-5 animate-spin" />
                    {t('onboarding2.step1Creating')}
                  </>
                ) : (
                  <>
                    {t('onboarding2.step1Confirm')}
                    <ArrowRightIcon className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* STEP 2 — competitors */}
        {step === 2 && (
          <div>
            <div className="mb-1 flex items-center gap-2 text-white font-medium">
              <UsersIcon className="w-5 h-5 text-violet-300" />
              {t('onboarding2.step2Title')}
            </div>
            <p className="text-sm text-white/40 mb-5">
              {t('onboarding2.step2Desc')}
            </p>

            {discovering ? (
              <div className="space-y-2 text-sm text-white/50">
                <LoadingLine text={t('onboarding2.step2Loading1')} />
                <LoadingLine text={t('onboarding2.step2Loading2')} />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {competitors.length === 0 && (
                    <p className="text-sm text-white/40 italic">
                      {t('onboarding2.step2Empty')}
                    </p>
                  )}
                  {competitors.map((c) => (
                    <label
                      key={c.domain}
                      className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition ${
                        c.selected
                          ? 'border-violet-500/40 bg-violet-500/[0.07]'
                          : 'border-white/10 bg-white/[0.02] opacity-60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={c.selected}
                        onChange={() => toggleCompetitor(c.domain)}
                        className="h-4 w-4 rounded border-white/20 bg-white/5 text-violet-500 focus:ring-violet-500/40"
                      />
                      <div className="min-w-0">
                        <div className="text-sm text-white truncate">{c.name}</div>
                        <div className="text-xs text-white/40 truncate">{c.domain}</div>
                      </div>
                    </label>
                  ))}
                </div>

                {/* Add manual */}
                <div className="mt-4 flex flex-col sm:flex-row gap-2">
                  <input
                    value={newCompName}
                    onChange={(e) => setNewCompName(e.target.value)}
                    placeholder={t('onboarding2.step2NamePlaceholder')}
                    className={`${inputCls} sm:max-w-[40%]`}
                  />
                  <input
                    value={newCompDomain}
                    onChange={(e) => setNewCompDomain(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addManualCompetitor()
                    }}
                    placeholder={t('onboarding2.step2DomainPlaceholder')}
                    className={inputCls}
                  />
                  <button
                    onClick={addManualCompetitor}
                    disabled={!newCompDomain.trim()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/80 transition hover:bg-white/10 disabled:opacity-40"
                  >
                    <PlusIcon className="w-4 h-4" />
                    {t('onboarding2.step2Add')}
                  </button>
                </div>
              </>
            )}

            <div className="mt-7 flex items-center justify-between">
              <span className="text-xs text-white/40">
                {t('onboarding2.step2SelectedCount', { count: competitors.filter((c) => c.selected).length })}
              </span>
              <button
                onClick={handleConfirmCompetitors}
                disabled={savingComps || discovering}
                className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-6 py-3 font-medium text-white transition hover:bg-violet-400 disabled:opacity-50"
              >
                {savingComps ? (
                  <>
                    <ArrowPathIcon className="w-5 h-5 animate-spin" />
                    {t('onboarding2.step2Saving')}
                  </>
                ) : (
                  <>
                    {t('onboarding2.continue')}
                    <ArrowRightIcon className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3 — prompts */}
        {step === 3 && (
          <div>
            <div className="mb-1 flex items-center gap-2 text-white font-medium">
              <ChatBubbleLeftRightIcon className="w-5 h-5 text-violet-300" />
              {t('onboarding2.step3Title')}
            </div>
            <p className="text-sm text-white/40 mb-5">
              {t('onboarding2.step3Desc')}
            </p>

            {generatingQueries ? (
              <div className="space-y-2 text-sm text-white/50">
                <LoadingLine text={t('onboarding2.step3Loading1')} />
                <LoadingLine text={t('onboarding2.step3Loading2')} />
              </div>
            ) : generatedQueries.length > 0 ? (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02]">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.06]">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">{t('onboarding2.step3ReviewHeading')}</p>
                    <p className="text-xs text-white/40 mt-0.5">
                      {t('onboarding2.step3SelectedOfTotal', {
                        count: generatedQueries.length - deselectedQueries.size,
                        total: generatedQueries.length,
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <button onClick={() => setDeselectedQueries(new Set())} className="text-violet-300 hover:text-violet-200">
                      {t('onboarding2.step3SelectAll')}
                    </button>
                    <span className="text-white/20">·</span>
                    <button
                      onClick={() => setDeselectedQueries(new Set(generatedQueries.map((q) => q.id)))}
                      className="text-white/50 hover:text-white/80"
                    >
                      {t('onboarding2.step3SelectNone')}
                    </button>
                  </div>
                </div>
                <ul className="max-h-72 overflow-y-auto divide-y divide-white/[0.04]">
                  {generatedQueries.map((q) => {
                    const checked = !deselectedQueries.has(q.id)
                    return (
                      <li key={q.id}>
                        <label className="flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.03]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setDeselectedQueries((prev) => {
                                const n = new Set(prev)
                                if (n.has(q.id)) n.delete(q.id)
                                else n.add(q.id)
                                return n
                              })
                            }
                            className="mt-0.5 h-4 w-4 rounded border-white/20 text-violet-500 focus:ring-violet-500/30"
                          />
                          <span className={`text-sm ${checked ? 'text-white/85' : 'text-white/35 line-through'}`}>{q.text}</span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-5 py-6 text-center">
                <CheckCircleIcon className="w-9 h-9 text-emerald-400 mx-auto mb-2" />
                <p className="text-lg font-semibold text-white">{t('onboarding2.step3ReadyGeneric')}</p>
                <p className="text-sm text-white/50 mt-1">{t('onboarding2.step3ReadyGenericDesc')}</p>
              </div>
            )}

            <div className="mt-7 flex items-center justify-end">
              <button
                onClick={confirmPromptsAndFinish}
                disabled={generatingQueries || deleteQuery.isPending}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 font-medium text-white transition hover:bg-emerald-400 disabled:opacity-50"
              >
                {t('onboarding2.step3Confirm')}
                <ArrowRightIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4 — personalized reveal → paywall */}
        {step === 4 && (
          revealLoading ? (
            <div className="py-10 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500">
                <SparklesIcon className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white">{t('onboarding2.revealAnalyzing')}…</h2>
              <div className="mt-6 inline-flex flex-col items-start gap-2 text-sm text-white/50">
                <LoadingLine text={t('onboarding2.revealAnalyzing1')} />
                <LoadingLine text={t('onboarding2.revealAnalyzing2')} />
              </div>
            </div>
          ) : (() => {
            const brand = profile?.brandName?.trim() || ''
            const compNames = competitors.filter((c) => c.selected).map((c) => c.name).slice(0, 2)
            const topPrompt =
              generatedQueries.find((q) => !deselectedQueries.has(q.id))?.text
              || profile?.primaryKeyword
              || profile?.mainTopic
              || ''
            const health = auditResult?.compositeHealth
            const aiReady = auditResult?.geoReadinessScore
            const verdict =
              compNames.length > 0 && topPrompt
                ? t('onboarding2.revealVerdictWithComp', { prompt: topPrompt, competitors: compNames.join(', '), brand })
                : t('onboarding2.revealVerdictNoComp', { brand })
            const lang2: 'it' | 'en' = prefersEnglishUi(profile?.language) ? 'en' : 'it'
            const vcopy = visibility ? VIS_COPY[lang2][visibility.level] : null
            const vtone = vcopy ? VIS_TONE[vcopy.tone] : null
            const ToneIcon = vtone?.Icon
            const goalLabel =
              goal === 'ai' ? t('onboarding2.goalAI')
              : goal === 'competitor' ? t('onboarding2.goalCompetitor')
              : goal === 'traffic' ? t('onboarding2.goalTraffic')
              : null
            return (
              <div className="py-2">
                <div className="text-center">
                  <p className="text-violet-300/70 text-xs tracking-[0.18em] uppercase mb-1.5">{t('onboarding2.revealEyebrow')}</p>
                  <h2 className="text-2xl font-bold text-white">{t('onboarding2.revealTitle', { brand })}</h2>
                  {goalLabel && (
                    <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">
                      <CheckCircleIcon className="w-3.5 h-3.5" strokeWidth={2} /> {goalLabel}
                    </span>
                  )}
                </div>

                {auditResult && (
                  <div className="mt-6 grid grid-cols-2 gap-3 max-w-md mx-auto">
                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 text-center">
                      <HeartIcon className="w-5 h-5 mx-auto mb-1.5 text-white/40" strokeWidth={1.6} />
                      <div className={`text-3xl font-bold tabular-nums ${health != null ? scoreTone(health).text : 'text-white/40'}`}>
                        {health != null ? health : '—'}<span className="text-base text-white/30">/100</span>
                      </div>
                      <p className="text-xs text-white/50 mt-1">{t('onboarding2.revealHealthLabel')}</p>
                    </div>
                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 text-center">
                      <SparklesIcon className="w-5 h-5 mx-auto mb-1.5 text-white/40" strokeWidth={1.6} />
                      <div className={`text-3xl font-bold tabular-nums ${aiReady != null ? scoreTone(aiReady).text : 'text-white/40'}`}>
                        {aiReady != null ? aiReady : '—'}<span className="text-base text-white/30">/100</span>
                      </div>
                      <p className="text-xs text-white/50 mt-1">{t('onboarding2.revealAiReadyLabel')}</p>
                    </div>
                  </div>
                )}

                {visibility && vcopy && ToneIcon ? (
                  <div className="mt-6 max-w-xl mx-auto rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.08] to-transparent p-5">
                    <div className="flex items-start gap-3">
                      <ToneIcon className={`w-6 h-6 shrink-0 ${vtone?.color ?? 'text-white/60'}`} strokeWidth={1.8} />
                      <p className="text-lg font-semibold text-white leading-snug">{vcopy.title(visibility.brand)}</p>
                    </div>
                    {visibility.query && <p className="text-white/55 text-sm mt-1.5 pl-9">{vcopy.body(visibility.query)}</p>}
                    {visibility.level !== 'recommended' && visibility.competitors.length > 0 && (
                      <div className="pl-9 mt-3 flex flex-wrap gap-2">
                        {visibility.competitors.map((c) => (
                          <span key={c} className="px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-white/75 text-sm">{c}</span>
                        ))}
                      </div>
                    )}
                    <p className="text-white/45 text-sm mt-3 pl-9">{t('onboarding2.revealFixLine')}</p>
                  </div>
                ) : (
                  <div className="mt-6 max-w-xl mx-auto rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.08] to-transparent p-5">
                    <p className="text-white/85 leading-relaxed">{verdict}</p>
                    <p className="text-white/45 text-sm mt-2">{t('onboarding2.revealFixLine')}</p>
                  </div>
                )}

                <div className="mt-7 flex flex-col items-center gap-3">
                  {canUseEngine ? (
                    // Already on an active/trialing plan — never push a trial at a paying user.
                    // Send them straight into the product to act on the diagnosis.
                    <button
                      onClick={() => navigate({ to: '/home' as any })}
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-7 py-3 font-semibold text-black transition hover:bg-white/90"
                    >
                      <ArrowRightIcon className="w-5 h-5" strokeWidth={2} /> {t('onboarding2.revealCtaGoDashboard')}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleStartTrial}
                        disabled={startingCheckout}
                        className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-7 py-3 font-semibold text-black transition hover:bg-white/90 disabled:opacity-60"
                      >
                        {startingCheckout ? (
                          <><ArrowPathIcon className="w-5 h-5 animate-spin" /> {t('onboarding2.step0Reading')}</>
                        ) : requiresSubscription() ? (
                          <><CreditCardIcon className="w-5 h-5" strokeWidth={2} /> {isTrialEligible === false ? t('onboarding2.revealCtaSubscribe') : t('onboarding2.revealCtaTrial')}</>
                        ) : (
                          <>{t('onboarding2.revealCtaDashboard')}</>
                        )}
                      </button>
                      {/* Cloud-only: the card-required trial has a secondary "just explore" link + reassurance.
                          Self-host already unlocks everything, so the primary CTA is the dashboard itself. */}
                      {requiresSubscription() && (
                        <>
                          <button
                            onClick={() => navigate({ to: '/home' as any })}
                            className="text-sm text-white/50 hover:text-white/80"
                          >
                            {t('onboarding2.revealCtaDashboard')}
                          </button>
                          <p className="text-xs text-white/35 mt-1">{t('onboarding2.revealReassure')}</p>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })()
        )}
      </div>
      <trialModal.StartTrialModal />
    </AppShell>
  )
}

/* ---------- small presentational helpers ---------- */

const inputCls =
  'w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/40'

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-white/50 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function LoadingLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <ArrowPathIcon className="w-4 h-4 animate-spin text-violet-300/70" />
      {text}…
    </div>
  )
}

function Stepper({ current }: { current: Step }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2">
      {STEP_KEYS.map((key, i) => {
        const done = i < current
        const active = i === current
        return (
          <div key={key} className="flex items-center gap-2 flex-1">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition ${
                done
                  ? 'bg-emerald-500 text-white'
                  : active
                    ? 'bg-violet-500 text-white'
                    : 'bg-white/10 text-white/40'
              }`}
            >
              {done ? <CheckCircleIcon className="w-4 h-4" /> : i + 1}
            </div>
            <span
              className={`text-xs whitespace-nowrap ${active ? 'text-white' : done ? 'text-white/60' : 'text-white/30'}`}
            >
              {t(`onboarding2.${key}`)}
            </span>
            {i < STEP_KEYS.length - 1 && (
              <div className={`h-px flex-1 ${done ? 'bg-emerald-500/40' : 'bg-white/10'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

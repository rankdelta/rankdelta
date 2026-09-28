/**
 * WPConnectionSetup — Onboarding step for connecting a WordPress site.
 *
 * Shown when no wp_connections row exists for the project.
 * Non-technical language: no jargon, step-by-step guide.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LinkIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
import { useSaveWPConnection } from '../../hooks/useAgentPipeline'
import { WordPressClient, isAllowedWpSiteUrl } from '../../services/wordpress'

interface Props {
  projectId: string
  onConnected: () => void
}

const STEPS: { n: number; titleKey: import('i18next').ParseKeys; detailKey: import('i18next').ParseKeys }[] = [
  {
    n: 1,
    titleKey: 'wpConnect.step1Title',
    detailKey: 'wpConnect.step1Detail',
  },
  {
    n: 2,
    titleKey: 'wpConnect.step2Title',
    detailKey: 'wpConnect.step2Detail',
  },
  {
    n: 3,
    titleKey: 'wpConnect.step3Title',
    detailKey: 'wpConnect.step3Detail',
  },
]

export function WPConnectionSetup({ projectId, onConnected }: Props) {
  const { t } = useTranslation()
  const [step, setStep] = useState<'guide' | 'form' | 'verifying' | 'done'>('guide')
  const [form, setForm] = useState({
    siteUrl: '',
    username: '',
    appPassword: '',
    siteNiche: '',
  })
  const [error, setError] = useState<string | null>(null)

  const save = useSaveWPConnection(projectId)

  async function handleConnect() {
    setError(null)
    setStep('verifying')

    try {
      if (!isAllowedWpSiteUrl(form.siteUrl.trim(), true)) {
        throw new Error('Enter a valid https website URL.')
      }
      const client = new WordPressClient({
        id: 'temp',
        siteUrl: form.siteUrl.trim(),
        username: form.username.trim(),
        appPassword: form.appPassword.trim(),
      })

      const ok = await client.ping()
      if (!ok) throw new Error(t('wpConnect.errorInvalidCredentials'))

      await save.mutateAsync({
        siteUrl: form.siteUrl.trim(),
        username: form.username.trim(),
        appPassword: form.appPassword.trim(),
        siteNiche: form.siteNiche.trim() || undefined,
      })

      setStep('done')
      setTimeout(onConnected, 1200)
    } catch (e) {
      const raw = e instanceof Error ? e.message : ''
      const msg =
        raw === 'Failed to fetch' || raw.includes('NetworkError') || raw.includes('CORS')
          ? t('wpConnect.errorUnreachable')
          : raw || t('wpConnect.errorConnection')
      setError(msg)
      setStep('form')
    }
  }

  if (step === 'guide') {
    return (
      <div className="max-w-lg mx-auto py-12 px-4">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-4">
            <LinkIcon className="w-7 h-7 text-violet-300" strokeWidth={1.8} />
          </div>
          <p className="text-white/40 text-xs tracking-[0.18em] uppercase mb-2">{t('wpConnect.guideEyebrow')}</p>
          <h2 className="text-2xl font-bold text-white">{t('wpConnect.guideTitle')}</h2>
          <p className="mt-2 text-white/50">
            {t('wpConnect.guideSubtitle')}
          </p>
        </div>

        <div className="space-y-4 mb-8">
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-4 p-4 rounded-2xl border border-white/[0.08] bg-white/[0.02]">
              <div className="w-8 h-8 bg-violet-500/20 border border-violet-500/40 text-violet-300 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
                {s.n}
              </div>
              <div>
                <p className="font-semibold text-white">{t(s.titleKey)}</p>
                <p className="text-sm text-white/50 mt-0.5">{t(s.detailKey)}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => setStep('form')}
          className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-full bg-white text-black font-semibold hover:bg-white/90 transition-all"
        >
          {t('wpConnect.copiedPasswordButton')}
          <ChevronRightIcon className="w-4 h-4" strokeWidth={2.5} />
        </button>
      </div>
    )
  }

  if (step === 'verifying') {
    return (
      <div className="max-w-lg mx-auto py-20 px-4 text-center">
        <div className="w-12 h-12 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-lg font-semibold text-white">{t('wpConnect.verifyingTitle')}</p>
        <p className="text-sm text-white/30 mt-1">{t('wpConnect.verifyingSubtitle')}</p>
      </div>
    )
  }

  if (step === 'done') {
    return (
      <div className="max-w-lg mx-auto py-20 px-4 text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
          <CheckCircleIcon className="w-8 h-8 text-emerald-400" strokeWidth={1.8} />
        </div>
        <p className="text-xl font-bold text-emerald-400">{t('wpConnect.doneTitle')}</p>
        <p className="text-sm text-white/40 mt-1">{t('wpConnect.doneSubtitle')}</p>
      </div>
    )
  }

  // form step
  return (
    <div className="max-w-lg mx-auto py-12 px-4">
      <button
        onClick={() => setStep('guide')}
        className="text-sm text-white/40 hover:text-white/70 transition-colors mb-6 flex items-center gap-1"
      >
        <ChevronLeftIcon className="w-4 h-4" strokeWidth={2} />
        {t('wpConnect.backToGuide')}
      </button>

      <p className="text-white/40 text-xs tracking-[0.18em] uppercase mb-2">{t('wpConnect.formEyebrow')}</p>
      <h2 className="text-xl font-bold text-white mb-6">{t('wpConnect.formTitle')}</h2>

      {error && (
        <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-white/60 mb-1.5">
            {t('wpConnect.labelSiteUrl')}
          </label>
          <input
            type="url"
            placeholder={t('wpConnect.siteUrlPlaceholder')}
            value={form.siteUrl}
            onChange={(e) => setForm((f) => ({ ...f, siteUrl: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.1] text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 text-sm transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-white/60 mb-1.5">
            {t('wpConnect.labelUsername')}
          </label>
          <input
            type="text"
            placeholder="admin"
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.1] text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 text-sm transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-white/60 mb-1.5">
            {t('wpConnect.labelAppPassword')}
          </label>
          <input
            type="password"
            placeholder="abcd efgh ijkl mnop"
            value={form.appPassword}
            onChange={(e) => setForm((f) => ({ ...f, appPassword: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.1] text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 text-sm font-mono transition-colors"
          />
          <p className="text-xs text-white/25 mt-1">
            {t('wpConnect.appPasswordHelper')}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-white/60 mb-1.5">
            {t('wpConnect.labelSiteNiche')} <span className="text-white/25">{t('wpConnect.optional')}</span>
          </label>
          <input
            type="text"
            placeholder={t('wpConnect.nichePlaceholder')}
            value={form.siteNiche}
            onChange={(e) => setForm((f) => ({ ...f, siteNiche: e.target.value }))}
            className="w-full px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.1] text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 text-sm transition-colors"
          />
        </div>
      </div>

      <button
        onClick={handleConnect}
        disabled={!form.siteUrl || !form.username || !form.appPassword}
        className="mt-6 w-full py-3 px-6 rounded-full bg-white text-black font-semibold hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        {t('wpConnect.connectButton')}
      </button>
    </div>
  )
}

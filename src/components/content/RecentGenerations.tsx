/**
 * RecentGenerations + StagedProgress — the two pieces that make the content engine feel safe.
 *
 * RecentGenerations: every generated/refreshed article is auto-saved to the `content` table; this
 * panel lists the recent ones so the user's work is NEVER lost (tab close, navigation, reload).
 * Copy/download straight from history.
 *
 * StagedProgress: long runs (2–4 min) get honest, staged feedback (research → writing → enrich →
 * QA) instead of a bare spinner that makes users think it's broken and leave.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParseKeys, TFunction } from 'i18next'
import { useQuery } from '@tanstack/react-query'
import {
  ClipboardDocumentIcon,
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ClockIcon,
  ArrowPathIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import { supabase } from '../../lib/supabaseClient'
import { toCleanHtml } from '../../services/agent/standaloneContent'

// ─── Recent generations (persistent history) ───────────────────────────────────

interface ContentRow {
  id: string
  title: string
  slug: string | null
  body: string
  seo_score: number | null
  generated_date: string
  metadata: { geoScore?: number; source?: string; sourceUrl?: string | null; wordCount?: number } | null
}

function timeAgo(iso: string, t: TFunction): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return t('recentGen.justNow')
  if (m < 60) return t('recentGen.minutesAgo', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('recentGen.hoursAgo', { n: h })
  return t('recentGen.daysAgo', { n: Math.floor(h / 24) })
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

function RowAction({ icon: Icon, label, onClick }: { icon: typeof ClipboardDocumentIcon; label: string; onClick: () => void }) {
  const { t } = useTranslation()
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        onClick()
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
      title={label}
      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border border-white/10 text-white/50 text-xs hover:bg-white/[0.06] hover:text-white transition-all"
    >
      {done ? <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> : <Icon className="w-3.5 h-3.5" strokeWidth={1.8} />}
      {done ? t('recentGen.done') : label}
    </button>
  )
}

/**
 * @param refreshKey pass the latest savedContentId (or any changing value) so a fresh save
 *                   re-fetches the list without extra plumbing.
 */
export function RecentGenerations({ projectId, refreshKey }: { projectId: string; refreshKey?: string }) {
  const { t } = useTranslation()
  const { data: rows = [] } = useQuery({
    queryKey: ['generatedContent', projectId, refreshKey ?? ''],
    queryFn: async (): Promise<ContentRow[]> => {
      const { data, error } = await supabase
        .from('content')
        .select('id, title, slug, body, seo_score, generated_date, metadata')
        .eq('project_id', projectId)
        .eq('status', 'generated')
        .order('generated_date', { ascending: false })
        .limit(6)
      if (error) throw error
      return (data ?? []) as ContentRow[]
    },
    enabled: !!projectId,
    staleTime: 30_000,
  })

  if (rows.length === 0) return null

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 mt-6">
      <div className="flex items-center gap-2 mb-1">
        <ClockIcon className="w-4 h-4 text-white/40" strokeWidth={1.8} />
        <h3 className="text-sm font-semibold text-white">{t('recentGen.title')}</h3>
      </div>
      <p className="text-xs text-white/40 mb-4">
        {t('recentGen.subtitle')}
      </p>
      <ul className="space-y-2">
        {rows.map((r) => {
          const geo = r.metadata?.geoScore
          const isRefresh = r.metadata?.source === 'refresh'
          return (
            <li key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {isRefresh ? (
                    <ArrowPathIcon className="w-3.5 h-3.5 text-amber-300/80 shrink-0" strokeWidth={1.8} />
                  ) : (
                    <SparklesIcon className="w-3.5 h-3.5 text-violet-300/80 shrink-0" strokeWidth={1.8} />
                  )}
                  <p className="text-sm text-white/85 font-medium truncate">{r.title}</p>
                </div>
                <p className="text-[11px] text-white/35 mt-0.5 ml-5.5 flex gap-2 flex-wrap">
                  <span>{timeAgo(r.generated_date, t)}</span>
                  {r.seo_score != null && <span>SEO {Math.round(r.seo_score)}</span>}
                  {geo != null && <span>GEO {Math.round(geo)}</span>}
                  {r.metadata?.wordCount != null && <span>{t('recentGen.words', { n: r.metadata.wordCount })}</span>}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <RowAction icon={ClipboardDocumentIcon} label={t('recentGen.copy')} onClick={() => navigator.clipboard.writeText(r.body)} />
                <RowAction
                  icon={ArrowDownTrayIcon}
                  label="HTML"
                  onClick={() => download(`${r.slug || 'articolo'}.html`, toCleanHtml(r.body), 'text/html')}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Staged progress (honest long-run feedback) ─────────────────────────────────

const GENERATE_STAGES: Array<{ labelKey: ParseKeys; seconds: number }> = [
  { labelKey: 'recentGen.stageResearch', seconds: 50 },
  { labelKey: 'recentGen.stageWrite', seconds: 100 },
  { labelKey: 'recentGen.stageEnrich', seconds: 60 },
  { labelKey: 'recentGen.stageQa', seconds: 70 },
]

const REFRESH_STAGES: Array<{ labelKey: ParseKeys; seconds: number }> = [
  { labelKey: 'recentGen.stageReadPage', seconds: 25 },
  { labelKey: 'recentGen.stageResearch', seconds: 50 },
  { labelKey: 'recentGen.stageEnrichRefresh', seconds: 100 },
  { labelKey: 'recentGen.stageQa', seconds: 70 },
]

export function StagedProgress({ mode }: { mode: 'generate' | 'refresh' }) {
  const { t } = useTranslation()
  const stages = mode === 'refresh' ? REFRESH_STAGES : GENERATE_STAGES
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Current stage from elapsed time (indicative — the steps reflect the real pipeline order).
  let acc = 0
  let current = stages.length - 1
  for (let i = 0; i < stages.length; i++) {
    acc += stages[i]!.seconds
    if (elapsed < acc) {
      current = i
      break
    }
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8">
      <ul className="max-w-md mx-auto space-y-3.5">
        {stages.map((s, i) => (
          <li key={s.labelKey} className="flex items-center gap-3">
            {i < current ? (
              <CheckCircleIcon className="w-5 h-5 text-emerald-400 shrink-0" strokeWidth={1.8} />
            ) : i === current ? (
              <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <span className="w-5 h-5 shrink-0 flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-white/15" />
              </span>
            )}
            <span className={`text-sm ${i < current ? 'text-white/40 line-through' : i === current ? 'text-white' : 'text-white/30'}`}>
              {t(s.labelKey)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-center text-white/30 text-xs mt-6">
        {t('recentGen.progressFooter')}
      </p>
    </div>
  )
}

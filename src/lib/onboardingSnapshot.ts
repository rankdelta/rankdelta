/**
 * First-session snapshot written during onboarding so the Command Center
 * shows the same aha the user just saw — not a blank dashboard.
 *
 * Stored on `projects.metadata.onboarding`. Real tracking (SoV 7d, audit table)
 * always wins once it exists; this is only the bridge.
 */

import { supabase } from './supabaseClient'
import type { Project } from '../types/database'

export type OnboardingVisLevel = 'recommended' | 'known' | 'absent'

export type OnboardingVisibility = {
  brand: string
  query: string
  level: OnboardingVisLevel
  cited: boolean
  competitors: string[]
  at: string
}

export type OnboardingHealth = {
  compositeHealth: number
  geoReadinessScore: number | null
  at: string
}

export type OnboardingGsc = {
  property: string
  clicks: number
  impressions: number
  at: string
}

export type OnboardingSnapshot = {
  visibility?: OnboardingVisibility
  health?: OnboardingHealth
  gsc?: OnboardingGsc
}

const KEY = 'onboarding'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function readOnboardingSnapshot(project: Project | null | undefined): OnboardingSnapshot | null {
  const o = asRecord(project?.metadata?.[KEY])
  if (!o) return null
  const snap: OnboardingSnapshot = {}

  const v = asRecord(o['visibility'])
  const level = v?.['level']
  if (v && (level === 'recommended' || level === 'known' || level === 'absent')) {
    const competitors = v['competitors']
    snap.visibility = {
      brand: String(v['brand'] || ''),
      query: String(v['query'] || ''),
      level,
      cited: !!v['cited'],
      competitors: Array.isArray(competitors) ? competitors.map(String).slice(0, 5) : [],
      at: String(v['at'] || ''),
    }
  }

  const h = asRecord(o['health'])
  const composite = h ? Number(h['compositeHealth']) : NaN
  if (h && Number.isFinite(composite)) {
    const geo = h['geoReadinessScore']
    snap.health = {
      compositeHealth: composite,
      geoReadinessScore: geo == null ? null : Number(geo),
      at: String(h['at'] || ''),
    }
  }

  const g = asRecord(o['gsc'])
  const property = g ? String(g['property'] || '') : ''
  if (g && property) {
    snap.gsc = {
      property,
      clicks: Number(g['clicks']) || 0,
      impressions: Number(g['impressions']) || 0,
      at: String(g['at'] || ''),
    }
  }

  return snap.visibility || snap.health || snap.gsc ? snap : null
}

export async function patchOnboardingSnapshot(projectId: string, patch: Partial<OnboardingSnapshot>): Promise<void> {
  const { data, error } = await supabase.from('projects').select('metadata').eq('id', projectId).single()
  if (error) throw error
  const current =
    data?.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : {}
  const prev = readOnboardingSnapshot({ metadata: current } as Project) ?? {}
  const next: OnboardingSnapshot = {
    visibility: patch.visibility ?? prev.visibility,
    health: patch.health ?? prev.health,
    gsc: patch.gsc ?? prev.gsc,
  }
  const { error: upErr } = await supabase
    .from('projects')
    .update({ metadata: { ...current, [KEY]: next } })
    .eq('id', projectId)
  if (upErr) throw upErr
}

/** Insert the ChatGPT aha query so Visibilità isn't empty after onboarding. */
export async function seedOnboardingQuery(args: {
  projectId: string
  text: string
  language: string
}): Promise<void> {
  const text = args.text.trim()
  if (!text) return
  const { data: existing, error: readErr } = await supabase
    .from('visibility_queries')
    .select('id')
    .eq('project_id', args.projectId)
    .ilike('text', text)
    .limit(1)
  if (readErr) throw readErr
  if ((existing?.length ?? 0) > 0) return
  const { error } = await supabase.from('visibility_queries').insert({
    project_id: args.projectId,
    text,
    language: args.language,
    intent_type: 'category',
    is_auto_generated: true,
    is_active: true,
  })
  if (error) throw error
}

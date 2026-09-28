/**
 * useAgentPipeline — React hook for the autonomous SEO/GEO agent.
 *
 * Provides:
 *   - pipeline status (running / idle / error)
 *   - activity feed from agent_activity table
 *   - content plan items
 *   - wp_connections check
 *   - trigger to start a pipeline run
 */

import { useEffect, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { runPipeline, type AutonomyLevel } from '../services/agent/orchestrator'
import { findRefreshCandidates, type RefreshCandidate } from '../services/agent/refreshLoop'
import { generateStandaloneArticle, augmentStandaloneArticle, augmentFromUrl, findStaleContent, publishStandaloneArticle, type StandaloneOptions, type StandaloneResult, type AugmentOptions } from '../services/agent/standaloneContent'
import type { ContentPlanItem, ActivityItem, AgentRun, ArticleContent } from '../services/agent/types'

// ─── AUTONOMY (trust dial) ─────────────────────────────────────────────────────
// Persisted per-project in localStorage; the orchestrator reads it to decide
// whether to auto-publish (review/auto) or always draft for review (manual).

const AUTONOMY_KEY = (projectId: string) => `astroseo:autonomy:${projectId}`

export function getStoredAutonomy(projectId: string): AutonomyLevel {
  try {
    const v = localStorage.getItem(AUTONOMY_KEY(projectId))
    if (v === 'manual' || v === 'review' || v === 'auto') return v
  } catch {
    /* ignore */
  }
  return 'review'
}

export function useAutonomy(projectId: string): [AutonomyLevel, (v: AutonomyLevel) => void] {
  const [level, setLevel] = useState<AutonomyLevel>(() => getStoredAutonomy(projectId))
  const set = useCallback(
    (v: AutonomyLevel) => {
      try {
        localStorage.setItem(AUTONOMY_KEY(projectId), v)
      } catch {
        /* ignore */
      }
      setLevel(v)
    },
    [projectId]
  )
  return [level, set]
}

const QUERY_KEYS = {
  wpConnection: (projectId: string) => ['wp-connection', projectId],
  contentPlan: (projectId: string) => ['content-plan', projectId],
  agentRuns: (projectId: string) => ['agent-runs', projectId],
  activity: (projectId: string) => ['agent-activity', projectId],
  dashboardSummary: (projectId: string) => ['dashboard-summary', projectId],
}

// ─── WP CONNECTION ────────────────────────────────────────────────────────────

export interface WPConnectionRow {
  id: string
  siteUrl: string
  username: string
  verified: boolean
  siteName: string | null
  siteLanguage: string
  siteNiche: string | null
  createdAt: string
}

export function useWPConnection(projectId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.wpConnection(projectId),
    queryFn: async (): Promise<WPConnectionRow | null> => {
      // maybeSingle (not single): a project with no WP connection is normal — single() makes
      // PostgREST return HTTP 406 (logged as a red error in the console on every render).
      // Explicit non-secret columns: app_password is column-locked for clients (migration 027),
      // so `select('*')` fails with 42501 once that migration is applied — and the browser must
      // never receive the password anyway (publishing goes through the wp-publish edge function).
      const { data, error } = await supabase
        .from('wp_connections')
        .select('id, site_url, username, verified, site_name, site_language, site_niche, created_at')
        .eq('project_id', projectId)
        .maybeSingle()

      if (error) throw error
      if (!data) return null // no connection yet

      return {
        id: data.id,
        siteUrl: data.site_url,
        username: data.username,
        verified: data.verified,
        siteName: data.site_name,
        siteLanguage: data.site_language,
        siteNiche: data.site_niche,
        createdAt: data.created_at,
      }
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useSaveWPConnection(projectId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (payload: {
      siteUrl: string
      username: string
      appPassword: string
      siteLanguage?: string
      siteNiche?: string
    }) => {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) throw new Error('Not authenticated')

      // No `.select()` after the upsert: RETURNING * would read app_password back, which the
      // client is not allowed to see (column-level grant) and does not need.
      const { error } = await supabase
        .from('wp_connections')
        .upsert(
          {
            project_id: projectId,
            user_id: userData.user.id,
            site_url: payload.siteUrl.replace(/\/$/, ''),
            username: payload.username,
            app_password: payload.appPassword,
            site_language: payload.siteLanguage ?? 'en',
            site_niche: payload.siteNiche ?? null,
            verified: false,
          },
          { onConflict: 'project_id' },
        )

      if (error) throw error
      return { project_id: projectId, site_url: payload.siteUrl.replace(/\/$/, ''), username: payload.username }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.wpConnection(projectId) })
    },
  })
}

// ─── CONTENT PLAN ─────────────────────────────────────────────────────────────

export function useContentPlan(projectId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.contentPlan(projectId),
    queryFn: async (): Promise<ContentPlanItem[]> => {
      const { data, error } = await supabase
        .from('content_plan')
        .select('*')
        .eq('project_id', projectId)
        .order('scheduled_for', { ascending: true })
        .limit(500)

      if (error) throw error

      return (data ?? []).map((r) => ({
        id: r.id,
        projectId: r.project_id,
        keyword: r.keyword,
        title: r.title,
        slug: r.slug,
        intent: r.intent,
        estimatedVolume: r.estimated_volume,
        difficulty: r.difficulty,
        scheduledFor: r.scheduled_for,
        status: r.status,
        wpPostId: r.wp_post_id,
        wpPostUrl: r.wp_post_url,
      }))
    },
    staleTime: 2 * 60 * 1000,
  })
}

// ─── AGENT RUNS ───────────────────────────────────────────────────────────────

export function useAgentRuns(projectId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.agentRuns(projectId),
    queryFn: async (): Promise<AgentRun[]> => {
      const { data, error } = await supabase
        .from('agent_runs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(30)

      if (error) throw error
      return (data ?? []).map((r) => ({
        id: r.id,
        projectId: r.project_id,
        stage: r.stage,
        status: r.status,
        input: r.input ?? {},
        output: r.output,
        errorMessage: r.error_message,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        costCents: r.cost_cents ?? 0,
        createdAt: r.created_at,
      }))
    },
    refetchInterval: (query) => {
      // Poll every 3s while a run is in progress
      const runs = query.state.data
      const hasRunning = runs?.some((r) => r.status === 'running')
      return hasRunning ? 3000 : false
    },
  })
}

// ─── ACTIVITY FEED ────────────────────────────────────────────────────────────

export function useAgentActivity(projectId: string, limit = 20) {
  return useQuery({
    queryKey: QUERY_KEYS.activity(projectId),
    queryFn: async (): Promise<ActivityItem[]> => {
      const { data, error } = await supabase
        .from('agent_activity')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error

      return (data ?? []).map((r) => ({
        type: r.type,
        description: r.description,
        url: r.url,
        timestamp: r.created_at,
        metadata: r.metadata,
      }))
    },
    staleTime: 30 * 1000,
  })
}

// ─── DASHBOARD SUMMARY ────────────────────────────────────────────────────────

export interface DashboardSummary {
  articlesPublished: number
  articlesPlanned: number
  avgSeoScore: number | null
  avgGeoScore: number | null
  lastPublishedAt: string | null
  nextScheduledAt: string | null
  totalCostCentsThisMonth: number
}

export function useDashboardSummary(projectId: string) {
  const plan = useContentPlan(projectId)
  const runs = useAgentRuns(projectId)

  const items = plan.data ?? []
  const agentRuns = runs.data ?? []

  const published = items.filter((i) => i.status === 'completed')
  const planned = items.filter((i) => i.status === 'planned')

  const totalCost = agentRuns.reduce((sum, r) => sum + r.costCents, 0)

  const lastPublished = published.length > 0
    ? published.reduce((latest, i) =>
        i.scheduledFor > (latest?.scheduledFor ?? '') ? i : latest
      )?.scheduledFor ?? null
    : null

  const nextScheduled = planned.length > 0 ? (planned[0]?.scheduledFor ?? null) : null

  return {
    isLoading: plan.isLoading || runs.isLoading,
    data: {
      articlesPublished: published.length,
      articlesPlanned: planned.length,
      avgSeoScore: null, // TODO: pull from DB aggregate
      avgGeoScore: null,
      lastPublishedAt: lastPublished,
      nextScheduledAt: nextScheduled,
      totalCostCentsThisMonth: totalCost,
    } as DashboardSummary,
  }
}

// ─── REFRESH CANDIDATES (closed loop) ──────────────────────────────────────────

export type { RefreshCandidate }

/** Published articles losing AI share-of-voice / Google rank — the loop's "Aggiorna" feed. */
export function useRefreshCandidates(projectId: string) {
  return useQuery({
    queryKey: ['refresh-candidates', projectId],
    queryFn: () => findRefreshCandidates(projectId),
    staleTime: 5 * 60 * 1000,
  })
}

// ─── STANDALONE GENERATION (connector-less) ────────────────────────────────────

export type { StandaloneResult }

/**
 * Mutation keys for the EXPENSIVE content runs. Keys make the runs observable from anywhere via
 * useMutationState — so navigating away and back doesn't "lose" an in-flight generation: the
 * panel can re-attach to the pending run and show its result when it lands.
 */
export const contentRunKeys = {
  generate: ['contentRun', 'generate'] as const,
  augment: ['contentRun', 'augment'] as const,
}

/** Generate a GEO article from a keyword + public URL — no CMS connection needed. */
export function useGenerateStandalone() {
  return useMutation({
    mutationKey: contentRunKeys.generate,
    mutationFn: (opts: StandaloneOptions) => generateStandaloneArticle(opts),
  })
}

/** Refresh/augment an existing article: add the missing GEO/SEO elements + depth. */
export function useAugmentStandalone() {
  return useMutation({
    mutationKey: contentRunKeys.augment,
    mutationFn: (opts: AugmentOptions) => augmentStandaloneArticle(opts),
  })
}

/** Crawl the public sitemap → scrape → list the pages with the biggest refresh opportunity. */
export function useFindStaleContent() {
  return useMutation({
    mutationFn: (vars: { siteUrl: string; language?: string; limit?: number }) =>
      findStaleContent(vars.siteUrl, { language: vars.language, limit: vars.limit }),
  })
}

/** Scrape a public URL and run the full refresh/augment on it in one step. */
export function useAugmentFromUrl() {
  return useMutation({
    mutationKey: contentRunKeys.augment,
    mutationFn: (opts: Parameters<typeof augmentFromUrl>[0]) => augmentFromUrl(opts),
  })
}

/** Publish an already-generated article to the project's connected WordPress site. */
export function usePublishStandalone(projectId: string) {
  return useMutation({
    mutationFn: (vars: { article: ArticleContent; status?: 'publish' | 'draft' }) =>
      publishStandaloneArticle(projectId, vars.article, vars.status ?? 'draft'),
  })
}

// ─── PIPELINE TRIGGER ─────────────────────────────────────────────────────────

export interface PipelineOptions {
  projectId: string
  siteName: string
  ctaHtml?: string
  articlesPerMonth?: number
  autonomy?: AutonomyLevel
}

export function useTriggerPipeline(projectId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (options: PipelineOptions) => {
      return runPipeline({
        projectId: options.projectId,
        siteName: options.siteName,
        ctaHtml: options.ctaHtml,
        articlesPerMonth: options.articlesPerMonth ?? 4,
        autonomy: options.autonomy ?? getStoredAutonomy(options.projectId),
      })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.agentRuns(projectId) })
      qc.invalidateQueries({ queryKey: QUERY_KEYS.activity(projectId) })
      qc.invalidateQueries({ queryKey: QUERY_KEYS.contentPlan(projectId) })
    },
  })
}

// ─── REALTIME SUBSCRIPTION ────────────────────────────────────────────────────

export function useAgentRealtimeUpdates(projectId: string) {
  const qc = useQueryClient()

  useEffect(() => {
    // Realtime is a progressive enhancement (live pipeline updates). If the user's
    // browser or network can't open a WebSocket — corporate firewall, privacy/ad-block
    // extension blocking wss://, restrictive proxy — realtime-js throws
    // "WebSocket not available" synchronously from .subscribe(). That must NEVER crash
    // the whole app via the root error boundary: degrade to no live updates (queries
    // still refetch on their own cadence / on manual reload).
    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      channel = supabase
        .channel(`agent-updates-${projectId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'agent_runs',
            filter: `project_id=eq.${projectId}`,
          },
          () => {
            qc.invalidateQueries({ queryKey: QUERY_KEYS.agentRuns(projectId) })
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'agent_activity',
            filter: `project_id=eq.${projectId}`,
          },
          () => {
            qc.invalidateQueries({ queryKey: QUERY_KEYS.activity(projectId) })
          }
        )
        .subscribe()
    } catch (err) {
      console.warn('[realtime] agent live updates unavailable, continuing without them:', err)
    }

    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [projectId, qc])
}

/**
 * Refresh Loop — the closed-loop differentiator.
 *
 * The tracker tells the agent what's losing, and the agent rewrites it to win back
 * the citation. No competitor closes this loop for WordPress owners.
 *
 *   findRefreshCandidates() → published articles that are losing AI share-of-voice
 *                             or Google rank, or have simply gone stale.
 *
 * The in-place rewrite (`refreshArticle`) was removed: nothing called it, and in 'manual'
 * autonomy it would have sent status 'draft' to a LIVE post, taking it offline. If it comes
 * back, an update must never downgrade a published post.
 */

import { supabase } from '../../lib/supabaseClient'

export interface RefreshCandidate {
  planItemId: string
  keyword: string
  title: string
  wpPostId: number | null
  wpPostUrl: string | null
  reason: 'rank_drop' | 'no_geo' | 'stale'
  detail: string
  priority: number // higher = more urgent
}

const STALE_DAYS = 90

/**
 * Cross-reference published content with the latest monitoring snapshot + visibility
 * data to find what's slipping. Returns [] gracefully when there's no monitoring data yet.
 */
export async function findRefreshCandidates(projectId: string): Promise<RefreshCandidate[]> {
  // 1. published articles
  const { data: planRows } = await supabase
    .from('content_plan')
    .select('id, keyword, title, wp_post_id, wp_post_url, status, scheduled_for')
    .eq('project_id', projectId)
    .eq('status', 'completed')

  const published = planRows ?? []
  if (published.length === 0) return []

  // 2. latest monitor snapshot (rank positions + geo mentions per keyword)
  const { data: monitorRuns } = await supabase
    .from('agent_runs')
    .select('output, created_at')
    .eq('project_id', projectId)
    .eq('stage', 'monitor')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)

  const snapshot = (monitorRuns?.[0]?.output ?? null) as
    | { rankPositions?: Record<string, number | null>; geoMentions?: number }
    | null

  const candidates: RefreshCandidate[] = []
  const now = Date.now()

  for (const row of published) {
    const kw = row.keyword as string
    const ageDays = row.scheduled_for ? (now - new Date(row.scheduled_for).getTime()) / 86_400_000 : 0

    const pos = snapshot?.rankPositions?.[kw]
    if (snapshot && (pos == null || pos > 20)) {
      candidates.push({
        planItemId: row.id, keyword: kw, title: row.title,
        wpPostId: row.wp_post_id, wpPostUrl: row.wp_post_url,
        reason: 'rank_drop',
        detail: pos == null ? 'Non posizionato in top 100 su Google' : `Posizione Google ${pos} (fuori dalla prima pagina)`,
        priority: 80,
      })
      continue
    }

    if (snapshot && (snapshot.geoMentions ?? 0) === 0) {
      candidates.push({
        planItemId: row.id, keyword: kw, title: row.title,
        wpPostId: row.wp_post_id, wpPostUrl: row.wp_post_url,
        reason: 'no_geo',
        detail: 'Nessuna citazione nelle risposte AI — riscrivi per conquistarla',
        priority: 70,
      })
      continue
    }

    if (ageDays > STALE_DAYS) {
      candidates.push({
        planItemId: row.id, keyword: kw, title: row.title,
        wpPostId: row.wp_post_id, wpPostUrl: row.wp_post_url,
        reason: 'stale',
        detail: `Pubblicato ${Math.round(ageDays)} giorni fa — aggiorna freschezza e dati`,
        priority: 40,
      })
    }
  }

  return candidates.sort((a, b) => b.priority - a.priority)
}

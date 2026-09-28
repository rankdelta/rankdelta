import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { saveSiteAudit, getLatestSiteAudit, getSiteAuditHistory, type SiteAuditResult } from '../services/siteAudit'
import { runGuidedAudit, type GuidedAudit } from '../services/agent/guidedAudit'
import { generateSchemaForUrl, type SchemaGenerationResult } from '../services/schemaGenerator'
import { isAuditRunning } from '../services/auditStatus'

const keys = {
  latest: (projectId: string) => ['siteAudit', projectId, 'latest'] as const,
  history: (projectId: string) => ['siteAudit', projectId, 'history'] as const,
}

/** Health-score snapshots over time, for the "track your progress" trend on Diagnosi. */
export function useSiteAuditHistory(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.history(projectId || ''),
    queryFn: () => getSiteAuditHistory(projectId!),
    enabled: !!projectId,
  })
}

/**
 * Latest stored audit. Persisted results are GuidedAudit (a superset of SiteAuditResult), so
 * existing consumers that read healthScore/issues keep working, while the audit page can read the
 * guided extras (plan, staleContent, freshnessScore) when present.
 */
export function useLatestSiteAudit(projectId: string | undefined) {
  return useQuery({
    queryKey: keys.latest(projectId || ''),
    queryFn: async (): Promise<(SiteAuditResult & Partial<GuidedAudit>) | null> => {
      if (!projectId) return null
      return (await getLatestSiteAudit(projectId)) as (SiteAuditResult & Partial<GuidedAudit>) | null
    },
    enabled: !!projectId,
    staleTime: 60_000,
    // A freshly-created project auto-runs its audit in the background (~1-2 min). Poll until it
    // lands so "Salute del sito" appears on the Comando without a manual refresh, then stop.
    // Poll fast (6s) while an audit is actively running for a snappy reveal; slower otherwise.
    refetchInterval: (query) => {
      if (query.state.data) return false
      return isAuditRunning(projectId) ? 6_000 : 30_000
    },
  })
}

/** Run a fresh GUIDED audit (technical + GEO + sitemap content scan) and persist it. */
export function useRunSiteAudit(projectId: string) {
  const qc = useQueryClient()
  const { i18n } = useTranslation()
  return useMutation({
    mutationFn: async (args: { siteUrl: string; maxPages?: number; language?: string; uiLanguage?: string }): Promise<GuidedAudit> => {
      const result = await runGuidedAudit({
        siteUrl: args.siteUrl,
        maxPages: args.maxPages,
        language: args.language,
        // User-facing plan labels follow the UI locale, not the site's content language.
        uiLanguage: args.uiLanguage ?? i18n.language,
      })
      await saveSiteAudit(projectId, result)
      return result
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.latest(projectId) })
      void qc.invalidateQueries({ queryKey: keys.history(projectId) })
    },
  })
}

/** Generate ready-to-paste JSON-LD (Article + FAQ + Organization) from a real page's own content. */
export function useGenerateSchema() {
  return useMutation({
    mutationFn: (opts: { url: string; language?: string }): Promise<SchemaGenerationResult> =>
      generateSchemaForUrl(opts.url, { language: opts.language }),
  })
}

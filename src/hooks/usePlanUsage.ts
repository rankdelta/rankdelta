/**
 * Real plan usage for the current account — research lookups, visibility checks, API spend.
 * Backed by my_account_plan_usage() RPC (migration 030).
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './useAuth'
import { ACCOUNT_MONTHLY_HARD_CAP_CENTS } from '../config/costModel'

export interface PlanUsage {
  researchUsed: number
  researchCap: number | null
  visibilityUsed: number
  visibilityCap: number | null
  apiSpentCents: number
  apiCapCents: number
  resetAt: string | null
}

function parseUsage(raw: unknown): PlanUsage {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    researchUsed: Math.max(0, Number(o['research_used']) || 0),
    researchCap: o['research_cap'] == null ? null : Math.max(0, Number(o['research_cap']) || 0),
    visibilityUsed: Math.max(0, Number(o['visibility_used']) || 0),
    visibilityCap: o['visibility_cap'] == null ? null : Math.max(0, Number(o['visibility_cap']) || 0),
    apiSpentCents: Math.max(0, Number(o['api_spent_cents']) || 0),
    apiCapCents: Math.max(1, Number(o['api_cap_cents']) || ACCOUNT_MONTHLY_HARD_CAP_CENTS),
    resetAt: typeof o['reset_at'] === 'string' ? o['reset_at'] : null,
  }
}

export function usePlanUsage() {
  const { user } = useAuth()

  return useQuery<PlanUsage>({
    queryKey: ['plan-usage', user?.id],
    enabled: !!user?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_account_plan_usage')
      if (error) throw new Error(error.message)
      return parseUsage(data)
    },
  })
}

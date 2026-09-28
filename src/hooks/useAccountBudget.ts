/**
 * useAccountBudget — the account's real API spend for the current calendar month, against the
 * hard monthly cap enforced server-side (supabase/functions/_shared/accountBudget.ts).
 *
 * Reads via the my_account_api_spend_this_month_cents() RPC (SECURITY INVOKER, RLS-scoped to the
 * caller), so it only ever totals the signed-in account's own spend. Used to show "€X / €50".
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './useAuth';
import { ACCOUNT_MONTHLY_HARD_CAP_CENTS } from '../config/costModel';

export interface AccountBudget {
  spentCents: number;
  capCents: number;
  /** 0..1 fraction of the cap consumed (clamped). */
  fraction: number;
  /** True once spend has reached the cap — paid actions are blocked server-side. */
  isOver: boolean;
  /** Approaching the cap (≥80%). */
  isNear: boolean;
}

export function useAccountBudget() {
  const { user } = useAuth();

  return useQuery<AccountBudget>({
    queryKey: ['account-budget', user?.id],
    enabled: !!user?.id,
    // Spend changes only when a paid call runs; a short stale window keeps the display fresh
    // without hammering the DB.
    staleTime: 30_000,
    queryFn: async (): Promise<AccountBudget> => {
      // The cap is decided server-side (standard vs internal account, env override): read it from
      // the same RPC the sidebar meter uses instead of assuming the UI constant.
      const [spend, usage] = await Promise.all([
        supabase.rpc('my_account_api_spend_this_month_cents'),
        supabase.rpc('my_account_plan_usage'),
      ]);
      if (spend.error) throw new Error(spend.error.message);
      const serverCap = Number((usage.data as Record<string, unknown> | null)?.['api_cap_cents']);
      const capCents = Number.isFinite(serverCap) && serverCap > 0 ? serverCap : ACCOUNT_MONTHLY_HARD_CAP_CENTS;
      const spentCents = Math.max(0, Number(spend.data) || 0);
      const fraction = capCents > 0 ? Math.min(1, spentCents / capCents) : 0;
      return {
        spentCents,
        capCents,
        fraction,
        isOver: spentCents >= capCents,
        isNear: fraction >= 0.8,
      };
    },
  });
}

/**
 * Subscription & Credits Hook
 * 
 * Provides subscription state, credit balance, and usage statistics.
 * Combines subscription and credits into a unified interface.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './useAuth';
import { requiresSubscription } from '../config/deployment';
import {
  getCreditBalance,
  getUsageStats,
  getRecentTransactions,
  hasEnoughCredits,
  consumeCredits,
  canCreateProject,
  estimateFullContentCredits,
} from '../services/credits';
import {
  createCheckoutSession,
  startTrialCheckout,
  createPortalSession,
  cancelSubscription,
  getPlans,
  changePlan,
} from '../services/stripe';
import { fetchTrialEligibility } from '../services/trialEligibility';
import { canStartTrial } from '../lib/trialEligibility';
import type {
  Subscription,
  CreditBalance,
  PlanConfiguration,
  SubscriptionPlan,
  CreditTransaction,
  UsageStats,
  CreditTransactionType,
} from '../types/subscription';

interface UseSubscriptionReturn {
  // State
  subscription: Subscription | null;
  creditBalance: CreditBalance | null;
  usageStats: UsageStats | null;
  currentPlan: PlanConfiguration | null;
  allPlans: PlanConfiguration[];
  recentTransactions: CreditTransaction[];
  isLoading: boolean;
  error: string | null;
  /** True when the subscription row could not be read (network/PostgREST error) — plan state is UNKNOWN, not free. */
  isSubscriptionError: boolean;
  
  // Derived state
  isFreePlan: boolean;
  isPaidPlan: boolean;
  canUpgrade: boolean;
  creditsRemaining: number;
  projectsRemaining: number;
  daysUntilRenewal: number | null;
  // Trial / engine-access gating
  isTrialing: boolean;
  trialDaysRemaining: number | null;
  /** True when the user may run credit-consuming engine actions (active or trialing subscription). */
  canUseEngine: boolean;
  /** Server-derived: user has never had a trial or paid subscription. null while loading. */
  isTrialEligible: boolean | null;
  
  // Actions
  checkCredits: (needed: number) => Promise<{ hasEnough: boolean; available: number }>;
  useCredits: (actionType: CreditTransactionType, credits: number, options?: {
    description?: string;
    projectId?: string;
    contentId?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  checkCanCreateProject: () => Promise<{ canCreate: boolean; needsUpgrade: boolean }>;
  estimateContentCredits: (wordCount: number, options?: {
    includePerplexity?: boolean;
    includeFactCheck?: boolean;
    includeSerpAnalysis?: boolean;
  }) => Promise<{ total: number; breakdown: Array<{ action: string; credits: number }> }>;
  
  // Subscription actions
  subscribe: (plan: SubscriptionPlan, isYearly?: boolean) => Promise<void>;
  /** Start the card-required free trial (defaults to Starter). Redirects to Stripe Checkout. */
  startTrial: (plan?: SubscriptionPlan, isYearly?: boolean) => Promise<void>;
  /** Change plan on the EXISTING Stripe subscription (upgrade/downgrade) — never a second checkout. */
  changePlan: (plan: SubscriptionPlan, isYearly?: boolean) => Promise<void>;
  /** True when the account already has a live Stripe subscription (active/trialing/past_due). */
  hasLiveSubscription: boolean;
  openPortal: () => Promise<void>;
  cancel: () => Promise<{ success: boolean; error?: string }>;
  
  // Refresh
  refresh: () => void;
}

export const useSubscription = (): UseSubscriptionReturn => {
  const { user, isLoading: isLoadingAuth } = useAuth();
  const queryClient = useQueryClient();
  
  // Fetch subscription
  const { data: subscription, isLoading: isLoadingSub, error: subError } = useQuery({
    queryKey: ['subscription', user?.id],
    queryFn: async (): Promise<Subscription | null> => {
      if (!user?.id) return null;
      
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .single();
      
      if (error) {
        console.error('Error fetching subscription:', error);
        // Throw (don't return null): a transient read failure must surface as an error state,
        // otherwise a paying user is rendered as "free" (upgrade banners, engine locked).
        throw error;
      }
      
      return data as Subscription;
    },
    enabled: !!user?.id,
    staleTime: 30 * 1000, // 30 seconds
    retry: 3,
  });
  // Subscription read failed and we have no (cached) row: plan state is UNKNOWN. Engine
  // access fails CLOSED (do not treat unknown as paid). Upgrade banners stay hidden until
  // the row loads so a transient error does not nag a paying customer.
  const isSubscriptionError = !!subError;
  const subscriptionUnknown = isSubscriptionError && !subscription;
  
  // Fetch credit balance
  const { data: creditBalance, isLoading: isLoadingCredits } = useQuery({
    queryKey: ['creditBalance', user?.id],
    queryFn: async (): Promise<CreditBalance | null> => {
      if (!user?.id) return null;
      return getCreditBalance(user.id);
    },
    enabled: !!user?.id,
    staleTime: 10 * 1000, // 10 seconds - more frequent updates
  });
  
  // Fetch usage stats
  const { data: usageStats } = useQuery({
    queryKey: ['usageStats', user?.id],
    queryFn: async (): Promise<UsageStats | null> => {
      if (!user?.id) return null;
      return getUsageStats(user.id);
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000, // 1 minute
  });
  
  // Fetch all plans
  const { data: allPlans = [] } = useQuery({
    queryKey: ['plans'],
    queryFn: getPlans,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
  
  // Fetch current plan config
  const { data: currentPlan } = useQuery({
    queryKey: ['currentPlan', subscription?.plan],
    queryFn: async (): Promise<PlanConfiguration | null> => {
      if (!subscription?.plan) return null;
      
      const { data, error } = await supabase
        .from('plan_configurations')
        .select('*')
        .eq('plan', subscription.plan)
        .single();
      
      if (error) return null;
      return data as PlanConfiguration;
    },
    enabled: !!subscription?.plan,
  });
  
  // Fetch trial eligibility (server-backed; falls back to subscription row)
  const { data: trialEligibility } = useQuery({
    queryKey: ['trialEligibility', user?.id, subscription?.status, subscription?.trial_start, subscription?.stripe_subscription_id],
    queryFn: async (): Promise<boolean> => {
      const { canTrial } = await fetchTrialEligibility(subscription ?? null);
      return canTrial;
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
    // Optimistic default from the row we already have while the edge function resolves.
    placeholderData: () => canStartTrial(subscription ?? null),
  });
  const { data: recentTransactions = [] } = useQuery({
    queryKey: ['creditTransactions', user?.id],
    queryFn: async (): Promise<CreditTransaction[]> => {
      if (!user?.id) return [];
      return getRecentTransactions(user.id, 20);
    },
    enabled: !!user?.id,
    staleTime: 30 * 1000,
  });
  
  // Derived state
  const isFreePlan = !subscriptionUnknown && String(subscription?.plan) === 'free';
  const isPaidPlan = !subscriptionUnknown && !isFreePlan && !!subscription;
  const canUpgrade = !subscriptionUnknown && subscription?.plan !== 'agency';
  const creditsRemaining = (creditBalance?.credits_remaining ?? 0) + (creditBalance?.bonus_credits ?? 0);
  
  // Calculate projects remaining
  const projectsRemaining = usageStats
    ? (usageStats.projectsLimit === Infinity 
        ? Infinity 
        : usageStats.projectsLimit - usageStats.projectsUsed)
    : 0;
  
  // Calculate days until renewal
  const daysUntilRenewal = subscription?.current_period_end
    ? Math.max(0, Math.ceil(
        (new Date(subscription.current_period_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      ))
    : null;

  // Trial state. canUseEngine is the single gate the UI checks before any credit-consuming action:
  // the free diagnosis (audit + visibility) stays open to everyone, but generating/publishing
  // requires an active OR trialing subscription — in the CLOUD. A self-hosted (open edition) install
  // has no subscription concept and is BYOK, so the gate is always open there.
  const isTrialing = subscription?.status === 'trialing';
  const trialDaysRemaining = isTrialing && subscription?.trial_end
    ? Math.max(0, Math.ceil(
        (new Date(subscription.trial_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      ))
    : null;
  const canUseEngine = !requiresSubscription()
    || subscription?.status === 'active' || subscription?.status === 'trialing';
  
  // Actions
  const checkCredits = async (needed: number) => {
    if (!user?.id) return { hasEnough: false, available: 0 };
    const result = await hasEnoughCredits(user.id, needed);
    return { hasEnough: result.hasEnough, available: result.available };
  };
  
  const useCredits = async (
    actionType: CreditTransactionType,
    credits: number,
    options?: { description?: string; projectId?: string; contentId?: string }
  ) => {
    if (!user?.id) return { success: false, error: 'Non autenticato' };
    
    const result = await consumeCredits(user.id, actionType, credits, options);
    
    if (result.success) {
      // Invalidate credit-related queries
      queryClient.invalidateQueries({ queryKey: ['creditBalance', user.id] });
      queryClient.invalidateQueries({ queryKey: ['usageStats', user.id] });
      queryClient.invalidateQueries({ queryKey: ['creditTransactions', user.id] });
    }
    
    return {
      success: result.success,
      error: result.error,
    };
  };
  
  const checkCanCreateProject = async () => {
    // Self-host has no plans/billing — never gate project creation on a (non-existent) subscription,
    // otherwise a self-hoster hits the default free-tier project cap with no way to "upgrade".
    if (!requiresSubscription()) return { canCreate: true, needsUpgrade: false };
    if (!user?.id) return { canCreate: false, needsUpgrade: true };
    return canCreateProject(user.id);
  };
  
  const estimateContentCredits = async (
    wordCount: number,
    options?: {
      includePerplexity?: boolean;
      includeFactCheck?: boolean;
      includeSerpAnalysis?: boolean;
    }
  ) => {
    return estimateFullContentCredits(wordCount, options);
  };
  
  // Subscribe mutation
  const subscribeMutation = useMutation({
    mutationFn: async ({ plan, isYearly }: { plan: SubscriptionPlan; isYearly?: boolean }) => {
      const { url, error } = await createCheckoutSession(plan, isYearly);
      if (error) throw new Error(error);
      if (url) {
        window.location.href = url;
      }
    },
  });

  // Start-trial mutation (card-required free trial)
  const startTrialMutation = useMutation({
    mutationFn: async ({ plan, isYearly }: { plan?: SubscriptionPlan; isYearly?: boolean }) => {
      const { url, error } = await startTrialCheckout(plan ?? 'growth', isYearly);
      if (error) throw new Error(error);
      // A missing checkout URL is a failure, not a silent no-op (the modal would spin forever).
      if (!url) throw new Error('Checkout URL not available');
      window.location.href = url;
    },
  });
  
  // Change-plan mutation (existing subscription → update-subscription, no new checkout)
  const changePlanMutation = useMutation({
    mutationFn: async ({ plan, isYearly }: { plan: SubscriptionPlan; isYearly?: boolean }) => {
      const { success, error } = await changePlan(plan, isYearly);
      if (!success) throw new Error(error ?? 'plan_change_failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['planUsage'] });
    },
  });

  const hasLiveSubscription =
    !!subscription?.stripe_subscription_id &&
    (subscription.status === 'active' || subscription.status === 'trialing' || subscription.status === 'past_due');

  // Portal mutation
  const portalMutation = useMutation({
    mutationFn: async () => {
      const { url, error } = await createPortalSession();
      if (error) throw new Error(error);
      if (url) {
        window.location.href = url;
      }
    },
  });
  
  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription', user?.id] });
    },
  });
  
  // Refresh function
  const refresh = () => {
    if (user?.id) {
      queryClient.invalidateQueries({ queryKey: ['subscription', user.id] });
      queryClient.invalidateQueries({ queryKey: ['creditBalance', user.id] });
      queryClient.invalidateQueries({ queryKey: ['usageStats', user.id] });
      queryClient.invalidateQueries({ queryKey: ['creditTransactions', user.id] });
    }
  };
  
  return {
    // State
    subscription: subscription ?? null,
    creditBalance: creditBalance ?? null,
    usageStats: usageStats ?? null,
    currentPlan: currentPlan ?? null,
    allPlans,
    recentTransactions,
    // While the session is still being restored the subscription query is disabled, and a
    // disabled query does not count as loading: paying users flashed "upgrade to Pro" screens.
    isLoading: isLoadingAuth || isLoadingSub || isLoadingCredits,
    error: subError ? 'Errore nel caricamento subscription' : null,
    isSubscriptionError,
    
    // Derived state
    isFreePlan,
    isPaidPlan,
    canUpgrade,
    creditsRemaining,
    projectsRemaining: Number.isFinite(projectsRemaining) ? projectsRemaining : Infinity,
    daysUntilRenewal,
    isTrialing,
    trialDaysRemaining,
    canUseEngine,
    isTrialEligible: trialEligibility ?? null,

    // Actions
    checkCredits,
    useCredits,
    checkCanCreateProject,
    estimateContentCredits,
    
    // Subscription actions
    subscribe: (plan, isYearly) => subscribeMutation.mutateAsync({ plan, isYearly }),
    startTrial: (plan, isYearly) => startTrialMutation.mutateAsync({ plan, isYearly }),
    changePlan: (plan, isYearly) => changePlanMutation.mutateAsync({ plan, isYearly }),
    hasLiveSubscription,
    openPortal: () => portalMutation.mutateAsync(),
    cancel: async () => {
      const result = await cancelMutation.mutateAsync();
      return { success: result.success, error: result.error ?? undefined };
    },
    
    // Refresh
    refresh,
  };
};

/**
 * Simple hook just for credit checking (lightweight)
 */
export const useCredits = () => {
  const { user } = useAuth();
  
  const { data: balance, isLoading } = useQuery({
    queryKey: ['creditBalance', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      return getCreditBalance(user.id);
    },
    enabled: !!user?.id,
    staleTime: 10 * 1000,
  });
  
  const total = (balance?.credits_remaining ?? 0) + (balance?.bonus_credits ?? 0);
  
  return {
    credits: total,
    regular: balance?.credits_remaining ?? 0,
    bonus: balance?.bonus_credits ?? 0,
    used: balance?.credits_used_this_period ?? 0,
    monthly: balance?.monthly_credits ?? 0,
    isLoading,
  };
};

/**
 * Hook for checking if action can be performed (has enough credits)
 */
export const useCanPerformAction = (actionType: CreditTransactionType, units?: number) => {
  const { user } = useAuth();
  const { credits } = useCredits();
  
  const { data: canPerform, isLoading } = useQuery({
    queryKey: ['canPerformAction', user?.id, actionType, units, credits],
    queryFn: async () => {
      if (!user?.id) return { canPerform: false, creditsNeeded: 0, creditsAvailable: 0 };
      
      const { getCreditsForAction } = await import('../services/credits');
      const creditsNeeded = await getCreditsForAction(actionType, units);
      
      return {
        canPerform: credits >= creditsNeeded,
        creditsNeeded,
        creditsAvailable: credits,
      };
    },
    enabled: !!user?.id,
    staleTime: 5 * 1000,
  });
  
  return {
    canPerform: canPerform?.canPerform ?? false,
    creditsNeeded: canPerform?.creditsNeeded ?? 0,
    creditsAvailable: canPerform?.creditsAvailable ?? 0,
    isLoading,
  };
};


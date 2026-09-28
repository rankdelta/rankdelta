/**
 * Credit Management Service
 * 
 * Handles credit consumption, balance checking, and transaction logging.
 * All API operations should check credits before executing.
 */

import { supabase } from '../lib/supabaseClient';
import { resolveProjectLimit } from '../lib/projectLimit';
import type {
  CreditBalance,
  CreditTransaction,
  CreditTransactionType,
  CreditConsumptionResult,
  CreditCost,
  ContentCreditEstimate,
  UsageStats,
} from '../types/subscription';

// Cache for credit costs (refreshed periodically)
let creditCostsCache: CreditCost[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get credit costs from database (with caching)
 */
export const getCreditCosts = async (): Promise<CreditCost[]> => {
  const now = Date.now();
  
  if (creditCostsCache && (now - cacheTimestamp) < CACHE_DURATION) {
    return creditCostsCache;
  }
  
  const { data, error } = await supabase
    .from('credit_costs')
    .select('*')
    .eq('is_active', true);
  
  if (error) {
    console.error('Error fetching credit costs:', error);
    // Return defaults if fetch fails
    return getDefaultCreditCosts();
  }
  
  creditCostsCache = data as CreditCost[];
  cacheTimestamp = now;
  
  return creditCostsCache;
};

/**
 * Default credit costs (fallback if DB not available)
 */
const getDefaultCreditCosts = (): CreditCost[] => [
  {
    id: 'default-content',
    action_type: 'content_generation',
    base_credits: 10,
    variable_unit: 'words',
    credits_per_unit: 0.008,
    min_credits: 10,
    max_credits: 50,
    display_name: 'Content Generation',
    description: 'AI-powered article generation',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'default-research',
    action_type: 'perplexity_research',
    base_credits: 5,
    variable_unit: null,
    credits_per_unit: null,
    min_credits: null,
    max_credits: null,
    display_name: 'Perplexity Research',
    description: 'Pre-generation research',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'default-factcheck',
    action_type: 'perplexity_factcheck',
    base_credits: 3,
    variable_unit: null,
    credits_per_unit: null,
    min_credits: null,
    max_credits: null,
    display_name: 'Fact-checking',
    description: 'Post-generation verification',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'default-serp',
    action_type: 'serp_analysis',
    base_credits: 2,
    variable_unit: null,
    credits_per_unit: null,
    min_credits: null,
    max_credits: null,
    display_name: 'SERP Analysis',
    description: 'Search results analysis',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'default-keywords',
    action_type: 'keyword_research',
    base_credits: 3,
    variable_unit: 'keywords',
    credits_per_unit: 0.2,
    min_credits: 3,
    max_credits: 15,
    display_name: 'Keyword Research',
    description: 'Keyword data lookup',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'default-topical',
    action_type: 'topical_map',
    base_credits: 15,
    variable_unit: null,
    credits_per_unit: null,
    min_credits: null,
    max_credits: null,
    display_name: 'Topical Map',
    description: 'Generate topical map',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

/**
 * Get user's current credit balance
 */
export const getCreditBalance = async (userId: string): Promise<CreditBalance | null> => {
  const { data, error } = await supabase
    .from('credit_balances')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  if (error) {
    console.error('Error fetching credit balance:', error);
    return null;
  }
  
  return data as CreditBalance;
};

/**
 * Calculate credits needed for content generation
 */
export const calculateContentCredits = async (
  wordCount: number,
  includePerplexity: boolean = true,
  includeFactCheck: boolean = true
): Promise<ContentCreditEstimate> => {
  const costs = await getCreditCosts();
  
  // Content generation cost
  const contentCost = costs.find(c => c.action_type === 'content_generation');
  const baseCredits = contentCost?.base_credits ?? 10;
  let variableCredits = 0;
  
  if (contentCost?.credits_per_unit && contentCost.variable_unit === 'words') {
    variableCredits = Math.ceil(wordCount * contentCost.credits_per_unit);
  }
  
  let contentCredits = baseCredits + variableCredits;
  
  // Apply min/max
  if (contentCost?.min_credits) {
    contentCredits = Math.max(contentCredits, contentCost.min_credits);
  }
  if (contentCost?.max_credits) {
    contentCredits = Math.min(contentCredits, contentCost.max_credits);
  }
  
  // Add Perplexity research cost
  let totalCredits = contentCredits;
  if (includePerplexity) {
    const researchCost = costs.find(c => c.action_type === 'perplexity_research');
    totalCredits += researchCost?.base_credits ?? 5;
  }
  
  // Add fact-check cost
  if (includeFactCheck) {
    const factCheckCost = costs.find(c => c.action_type === 'perplexity_factcheck');
    totalCredits += factCheckCost?.base_credits ?? 3;
  }
  
  return {
    wordCount,
    baseCredits,
    variableCredits,
    totalCredits,
    includesPerplexity: includePerplexity,
    includesFactCheck: includeFactCheck,
  };
};

/**
 * Check if user has enough credits for an action
 */
export const hasEnoughCredits = async (
  userId: string,
  creditsNeeded: number
): Promise<{ hasEnough: boolean; available: number; needed: number }> => {
  const balance = await getCreditBalance(userId);
  
  if (!balance) {
    return { hasEnough: false, available: 0, needed: creditsNeeded };
  }
  
  const totalAvailable = balance.credits_remaining + balance.bonus_credits;
  
  return {
    hasEnough: totalAvailable >= creditsNeeded,
    available: totalAvailable,
    needed: creditsNeeded,
  };
};

/**
 * Consume credits for an action
 * This should be called BEFORE executing the API operation
 */
export const consumeCredits = async (
  userId: string,
  actionType: CreditTransactionType,
  credits: number,
  options?: {
    description?: string;
    metadata?: Record<string, unknown>;
    projectId?: string;
    contentId?: string;
  }
): Promise<CreditConsumptionResult> => {
  try {
    // Call the database function to consume credits atomically
    const { data, error } = await supabase.rpc('consume_credits', {
      p_user_id: userId,
      p_action_type: actionType,
      p_credits: credits,
      p_description: options?.description ?? null,
      p_metadata: options?.metadata ?? {},
      p_project_id: options?.projectId ?? null,
      p_content_id: options?.contentId ?? null,
    });
    
    if (error) {
      console.error('Error consuming credits:', error);
      return {
        success: false,
        error: error.message,
      };
    }
    
    return data as CreditConsumptionResult;
  } catch (error) {
    console.error('Exception consuming credits:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Get credits cost for a specific action
 */
export const getCreditsForAction = async (
  actionType: CreditTransactionType,
  units?: number
): Promise<number> => {
  const costs = await getCreditCosts();
  const cost = costs.find(c => c.action_type === actionType);
  
  if (!cost) {
    console.warn(`No credit cost found for action: ${actionType}`);
    return 5; // Default cost
  }
  
  let totalCredits = cost.base_credits;
  
  // Add variable cost if applicable
  if (cost.credits_per_unit && units && units > 0) {
    totalCredits += Math.ceil(units * cost.credits_per_unit);
  }
  
  // Apply limits
  if (cost.min_credits) {
    totalCredits = Math.max(totalCredits, cost.min_credits);
  }
  if (cost.max_credits) {
    totalCredits = Math.min(totalCredits, cost.max_credits);
  }
  
  return totalCredits;
};

/**
 * Effective project cap for a user (-1 = unlimited).
 *
 * plan_configurations is the source of truth for the plan's cap; subscriptions.max_projects is a
 * per-account value copied at checkout that can drift, so it may only widen the cap. Internal
 * (staff / test) accounts are never capped. See lib/projectLimit.ts.
 */
export const getProjectLimit = async (
  userId: string
): Promise<{ maxProjects: number; plan: string | null }> => {
  const { data: subscription, error: subError } = await supabase
    .from('subscriptions')
    .select('max_projects, plan, is_internal')
    .eq('user_id', userId)
    .single();

  if (subError) {
    console.error('Error fetching subscription:', subError);
    return { maxProjects: 1, plan: null };
  }

  let planMax: number | null = null;
  if (subscription?.plan) {
    const { data: planConfig, error: planError } = await supabase
      .from('plan_configurations')
      .select('max_projects')
      .eq('plan', subscription.plan)
      .maybeSingle();
    if (planError) {
      console.error('Error fetching plan configuration:', planError);
    }
    planMax = planConfig?.max_projects ?? null;
  }

  return {
    maxProjects: resolveProjectLimit({
      subscriptionMax: subscription?.max_projects,
      planMax,
      isInternal: subscription?.is_internal,
    }),
    plan: subscription?.plan ?? null,
  };
};

/**
 * Get usage statistics for a user
 */
export const getUsageStats = async (userId: string): Promise<UsageStats | null> => {
  // Get credit balance
  const balance = await getCreditBalance(userId);
  if (!balance) return null;
  
  // Get project count
  const { count: projectCount, error: projectError } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  
  if (projectError) {
    console.error('Error counting projects:', projectError);
  }
  
  
  // Calculate usage stats
  const totalCredits = balance.monthly_credits + balance.bonus_credits;
  const creditsRemaining = balance.credits_remaining + balance.bonus_credits;
  const usagePercentage = totalCredits > 0 
    ? Math.round((balance.credits_used_this_period / totalCredits) * 100)
    : 0;
  
  // Calculate days remaining in period
  const periodEnd = balance.period_end ? new Date(balance.period_end) : null;
  const now = new Date();
  const daysRemaining = periodEnd 
    ? Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 30;
  
  // Calculate average daily usage
  const periodStart = new Date(balance.period_start);
  const daysPassed = Math.max(1, Math.ceil((now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)));
  const averageDailyUsage = Math.round(balance.credits_used_this_period / daysPassed);
  
  // Project monthly usage
  const projectedMonthlyUsage = averageDailyUsage * 30;

  const { maxProjects } = await getProjectLimit(userId);
  
  return {
    creditsUsedThisPeriod: balance.credits_used_this_period,
    creditsRemaining,
    totalCredits,
    usagePercentage,
    projectsUsed: projectCount ?? 0,
    // -1 means unlimited — normalise so consumers never compute a negative "remaining".
    projectsLimit: maxProjects === -1 ? Infinity : maxProjects,
    daysRemainingInPeriod: daysRemaining,
    averageDailyUsage,
    projectedMonthlyUsage,
  };
};

/**
 * Get recent credit transactions
 */
export const getRecentTransactions = async (
  userId: string,
  limit: number = 20
): Promise<CreditTransaction[]> => {
  const { data, error } = await supabase
    .from('credit_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) {
    console.error('Error fetching transactions:', error);
    return [];
  }
  
  return data as CreditTransaction[];
};

/**
 * Check if user can create a new project
 */
export const canCreateProject = async (userId: string): Promise<{
  canCreate: boolean;
  currentCount: number;
  maxAllowed: number;
  needsUpgrade: boolean;
}> => {
  // Get current project count
  const { count, error: countError } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  
  if (countError) {
    console.error('Error counting projects:', countError);
    return { canCreate: false, currentCount: 0, maxAllowed: 1, needsUpgrade: true };
  }
  
  const currentCount = count ?? 0;
  const { maxProjects: maxAllowed } = await getProjectLimit(userId);
  
  // -1 means unlimited
  const canCreate = maxAllowed === -1 || currentCount < maxAllowed;
  
  return {
    canCreate,
    currentCount,
    maxAllowed: maxAllowed === -1 ? Infinity : maxAllowed,
    needsUpgrade: !canCreate,
  };
};

/**
 * Pre-calculate total credits for full content generation pipeline
 */
export const estimateFullContentCredits = async (
  wordCount: number,
  options?: {
    includePerplexity?: boolean;
    includeFactCheck?: boolean;
    includeSerpAnalysis?: boolean;
  }
): Promise<{
  total: number;
  breakdown: Array<{ action: string; credits: number }>;
}> => {
  const breakdown: Array<{ action: string; credits: number }> = [];
  
  // Content generation
  const contentCredits = await getCreditsForAction('content_generation', wordCount);
  breakdown.push({ action: 'Generazione contenuto', credits: contentCredits });
  
  // Perplexity research (default: true)
  if (options?.includePerplexity !== false) {
    const researchCredits = await getCreditsForAction('perplexity_research');
    breakdown.push({ action: 'Ricerca Perplexity', credits: researchCredits });
  }
  
  // Fact-check (default: true)
  if (options?.includeFactCheck !== false) {
    const factCheckCredits = await getCreditsForAction('perplexity_factcheck');
    breakdown.push({ action: 'Fact-checking', credits: factCheckCredits });
  }
  
  // SERP analysis (default: true)
  if (options?.includeSerpAnalysis !== false) {
    const serpCredits = await getCreditsForAction('serp_analysis');
    breakdown.push({ action: 'Analisi SERP', credits: serpCredits });
  }
  
  const total = breakdown.reduce((sum, item) => sum + item.credits, 0);
  
  return { total, breakdown };
};


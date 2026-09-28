/**
 * Subscription & Credit System Types
 * 
 * Type definitions for the subscription and credit management system.
 */

// Subscription Plans (no free plan - users must subscribe)
export type SubscriptionPlan = 'starter' | 'growth' | 'pro' | 'agency';

// Subscription Status
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'paused' | 'incomplete' | 'unpaid';

// Credit Transaction Types
export type CreditTransactionType =
  | 'subscription_reset'
  | 'content_generation'
  | 'perplexity_research'
  | 'perplexity_factcheck'
  | 'serp_analysis'
  | 'keyword_research'
  | 'rank_tracking'
  | 'topical_map'
  | 'content_refresh'
  | 'bonus_credit'
  | 'refund'
  | 'admin_adjustment';

// Subscription entity
export interface Subscription {
  id: string;
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  trial_start: string | null;
  trial_end: string | null;
  max_projects: number;
  is_internal?: boolean;
  created_at: string;
  updated_at: string;
}

// Credit Balance entity
export interface CreditBalance {
  id: string;
  user_id: string;
  credits_remaining: number;
  credits_used_this_period: number;
  monthly_credits: number;
  bonus_credits: number;
  period_start: string;
  period_end: string | null;
  created_at: string;
  updated_at: string;
}

// Credit Transaction entity
export interface CreditTransaction {
  id: string;
  user_id: string;
  transaction_type: CreditTransactionType;
  credits_change: number;
  credits_before: number;
  credits_after: number;
  description: string | null;
  metadata: Record<string, unknown>;
  project_id: string | null;
  content_id: string | null;
  created_at: string;
}

// Plan Configuration entity
export interface PlanConfiguration {
  id: string;
  plan: SubscriptionPlan;
  stripe_price_id: string | null;
  stripe_price_id_yearly: string | null;
  price_monthly_cents: number;
  price_yearly_cents: number | null;
  monthly_credits: number;
  max_projects: number;
  features: PlanFeatures;
  /** Per-plan quotas (plan_configurations columns, migration 019). */
  research_lookups_monthly?: number | null;
  visibility_prompts?: number | null;
  visibility_engines?: number | null;
  visibility_checks_monthly?: number | null;
  rank_keywords?: number | null;
  articles_monthly?: number | null;
  display_name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Plan Features
export interface PlanFeatures {
  content_generation: boolean;
  basic_seo: boolean;
  perplexity_research: boolean;
  rank_tracking: boolean;
  topical_maps: boolean;
  content_refresh: boolean;
  gpt4o: boolean;
  priority_support?: boolean;
  api_access?: boolean;
  white_label?: boolean;
  dedicated_support?: boolean;
  team_members?: number;
  max_content_words?: number;
}

// Credit Cost Configuration
export interface CreditCost {
  id: string;
  action_type: CreditTransactionType;
  base_credits: number;
  variable_unit: string | null;
  credits_per_unit: number | null;
  min_credits: number | null;
  max_credits: number | null;
  display_name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Combined Subscription State (for hooks)
export interface SubscriptionState {
  subscription: Subscription | null;
  creditBalance: CreditBalance | null;
  plan: PlanConfiguration | null;
  isLoading: boolean;
  error: string | null;
}

// Credit Consumption Result
export interface CreditConsumptionResult {
  success: boolean;
  credits_consumed?: number;
  credits_remaining?: number;
  bonus_credits?: number;
  error?: string;
  credits_required?: number;
}

// Credit Calculation for Content
export interface ContentCreditEstimate {
  wordCount: number;
  baseCredits: number;
  variableCredits: number;
  totalCredits: number;
  includesPerplexity: boolean;
  includesFactCheck: boolean;
}

// Upgrade/Downgrade Info
export interface PlanChangeInfo {
  currentPlan: SubscriptionPlan;
  targetPlan: SubscriptionPlan;
  isUpgrade: boolean;
  priceDifference: number;
  creditsDifference: number;
  projectsDifference: number;
  effectiveDate: string;
}

// Usage Statistics
export interface UsageStats {
  creditsUsedThisPeriod: number;
  creditsRemaining: number;
  totalCredits: number;
  usagePercentage: number;
  projectsUsed: number;
  projectsLimit: number;
  daysRemainingInPeriod: number;
  averageDailyUsage: number;
  projectedMonthlyUsage: number;
}

// Content Length Options with Credit Costs
export interface ContentLengthOption {
  label: string;
  wordCount: number;
  credits: number;
  description: string;
  recommended?: boolean;
}

// Pre-defined content length options
// COMPETITIVE PRICING: ~20 credits per full article (2000 words)
// Formula: content_credits + 2 (research) + 1 (factcheck) + 1 (serp) = total
// Target: 500 credits = 25 articles, 700 = 35, 2000 = 100, 8000 = 400
export const CONTENT_LENGTH_OPTIONS: Array<ContentLengthOption> = [
  {
    label: 'Breve',
    wordCount: 1000,
    credits: 16,  // 12 content + 2 research + 1 factcheck + 1 serp
    description: 'Articolo rapido, ideale per news o aggiornamenti',
  },
  {
    label: 'Standard',
    wordCount: 2000,
    credits: 20,  // 16 content + 2 research + 1 factcheck + 1 serp
    description: 'Lunghezza ottimale per blog post',
    recommended: true,
  },
  {
    label: 'Lungo',
    wordCount: 3000,
    credits: 24,  // 20 content + 2 research + 1 factcheck + 1 serp
    description: 'Guida approfondita o pillar content',
  },
  {
    label: 'Premium',
    wordCount: 4000,
    credits: 28,  // 24 content + 2 research + 1 factcheck + 1 serp
    description: 'Contenuto completo per alta autorità topicale',
  },
  {
    label: 'Ultimate',
    wordCount: 5000,
    credits: 34,  // 30 content (max cap) + 2 research + 1 factcheck + 1 serp
    description: 'Guida definitiva, massima copertura',
  },
];

// Helper function to calculate credits for word count (content generation only)
// COMPETITIVE: Base 8 + words * 0.004 = ~16 credits for 2000 words
export const calculateCreditsForWords = (wordCount: number): number => {
  const baseCredits = 8;
  const creditsPerWord = 0.004;
  const minCredits = 10;
  const maxCredits = 30;
  
  const calculated = baseCredits + Math.ceil(wordCount * creditsPerWord);
  return Math.max(minCredits, Math.min(maxCredits, calculated));
};

// Calculate full pipeline credits (content + research + factcheck + serp)
// Target: ~20 credits for 2000-word article
export const calculateFullPipelineCredits = (wordCount: number): {
  content: number;
  research: number;
  factcheck: number;
  serp: number;
  total: number;
} => {
  const content = calculateCreditsForWords(wordCount);
  const research = 2;  // Perplexity research (competitive)
  const factcheck = 1; // Perplexity fact-check (competitive)
  const serp = 1;      // SERP analysis
  
  return {
    content,
    research,
    factcheck,
    serp,
    total: content + research + factcheck + serp,
  };
};

// =============================================================================
// GEO TRACKING - PREMIUM FEATURE (Pro+ plans only)
// DataforSEO LLM Mentions API: ~$0.15 per query ($0.10 request + ~$0.05 rows)
// Reference: https://dataforseo.com/pricing/ai-optimization/llm-mentions
// =============================================================================

// GEO queries are a SEPARATE allocation, not from main credits pool
// This is a key differentiator - most competitors don't have this!
export const GEO_MONTHLY_LIMITS = {
  starter: 0,    // ❌ No GEO - upgrade to Pro
  growth: 0,     // ❌ No GEO - upgrade to Pro
  pro: 50,       // ✅ 50 queries/month (~$7.50 API cost)
  agency: 200,   // ✅ 200 queries/month (~$30 API cost)
} as const;

// Platforms supported for GEO tracking
export const GEO_PLATFORMS = ['chatgpt', 'perplexity', 'claude', 'gemini'] as const;
export type GEOPlatform = typeof GEO_PLATFORMS[number];

// Helper function to get plan display info
export const getPlanDisplayInfo = (plan: string): { 
  name: string; 
  color: string; 
  bgColor: string;
  borderColor: string;
} => {
  const planInfo: Record<string, { name: string; color: string; bgColor: string; borderColor: string }> = {
    starter: { 
      name: 'Rankdelta Starter', 
      color: 'text-blue-600', 
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-300'
    },
    growth: { 
      name: 'Rankdelta Growth', 
      color: 'text-green-600', 
      bgColor: 'bg-green-50',
      borderColor: 'border-green-300'
    },
    pro: { 
      name: 'Rankdelta Pro', 
      color: 'text-purple-600', 
      bgColor: 'bg-purple-50',
      borderColor: 'border-purple-300'
    },
    agency: { 
      name: 'Rankdelta Agency', 
      color: 'text-amber-600', 
      bgColor: 'bg-amber-50',
      borderColor: 'border-amber-300'
    },
  };
  
  return planInfo[plan] ?? { 
    name: 'Nessun Piano', 
    color: 'text-gray-600', 
    bgColor: 'bg-gray-100',
    borderColor: 'border-gray-300'
  };
};

// Format credits for display
export const formatCredits = (credits: number): string => {
  if (credits >= 1000) {
    return `${(credits / 1000).toFixed(1)}k`;
  }
  return credits.toString();
};

// Format price for display
export const formatPrice = (cents: number, currency: string = 'USD'): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);
};


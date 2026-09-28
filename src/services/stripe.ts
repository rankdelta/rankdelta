/**
 * Stripe Integration Service
 * 
 * Handles Stripe checkout, customer portal, and subscription management.
 * 
 * ⚠️ SECURITY NOTE:
 * - This service creates checkout sessions via Supabase Edge Function
 * - Webhook handling is done server-side (Edge Function)
 * - Never expose Stripe secret key in frontend
 */

import { supabase } from '../lib/supabaseClient';
import type { SubscriptionPlan, PlanConfiguration } from '../types/subscription';

// Stripe publishable key from environment (public by design — safe to ship in the client).
// Trimmed because a stray space/newline pasted into the env var would silently break checkout.
const STRIPE_PUBLISHABLE_KEY = (import.meta.env['VITE_STRIPE_PUBLISHABLE_KEY'] as string | undefined)?.trim() || undefined;

// Base URL for redirects
const getBaseUrl = (): string => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'http://localhost:5173';
};

/**
 * Check if Stripe is configured
 */
export const isStripeConfigured = (): boolean => {
  return !!STRIPE_PUBLISHABLE_KEY;
};

/**
 * Get all available plans
 */
export const getPlans = async (): Promise<PlanConfiguration[]> => {
  const { data, error } = await supabase
    .from('plan_configurations')
    .select('*')
    .eq('is_active', true)
    .order('price_monthly_cents', { ascending: true });
  
  if (error) {
    console.error('Error fetching plans:', error);
    return [];
  }
  
  return data as PlanConfiguration[];
};

/**
 * Create a Stripe Checkout session for subscription
 * This calls a Supabase Edge Function that creates the session server-side
 */
export const createCheckoutSession = async (
  plan: SubscriptionPlan,
  isYearly: boolean = false
): Promise<{ url: string | null; error: string | null }> => {
  try {
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return { url: null, error: 'Devi essere autenticato per sottoscrivere un piano' };
    }
    
    // Get plan configuration
    const { data: planConfig, error: planError } = await supabase
      .from('plan_configurations')
      .select('stripe_price_id, stripe_price_id_yearly')
      .eq('plan', plan)
      .single();
    
    if (planError || !planConfig) {
      return { url: null, error: 'Piano non trovato' };
    }
    
    const priceId = isYearly 
      ? planConfig.stripe_price_id_yearly 
      : planConfig.stripe_price_id;
    
    if (!priceId) {
      return { url: null, error: 'Prezzo Stripe non configurato per questo piano' };
    }
    
    // Call Edge Function to create checkout session
    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: {
        priceId,
        plan,
        successUrl: `${getBaseUrl()}/billing?checkout=success`,
        cancelUrl: `${getBaseUrl()}/billing?checkout=canceled`,
        customerEmail: user.email,
        userId: user.id,
      },
    });
    
    if (error) {
      console.error('Error creating checkout session:', error);
      return { url: null, error: 'Errore nella creazione della sessione di pagamento' };
    }
    
    return { url: data?.url ?? null, error: null };
  } catch (error) {
    console.error('Exception creating checkout session:', error);
    return { 
      url: null, 
      error: error instanceof Error ? error.message : 'Errore sconosciuto' 
    };
  }
};

/**
 * Number of days for the card-required free trial (reverse trial offered after onboarding).
 * Kept here so the FE copy and the checkout call stay in sync. The capped trial credit grant
 * lives server-side in the stripe-webhook (TRIAL_CREDITS).
 */
export const TRIAL_DAYS = 7;

/**
 * Start a card-required free trial.
 *
 * Same as createCheckoutSession but enrolls the user in a trial (Stripe collects the card now,
 * charges nothing until the trial ends, then auto-converts to the paid plan). Defaults to the
 * cheapest plan (Starter); the user can change/choose plan anytime before the trial converts.
 */
export const startTrialCheckout = async (
  plan: SubscriptionPlan = 'growth',
  isYearly: boolean = false
): Promise<{ url: string | null; error: string | null }> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return { url: null, error: 'Devi essere autenticato per avviare la prova' };
    }

    const { data: planConfig, error: planError } = await supabase
      .from('plan_configurations')
      .select('stripe_price_id, stripe_price_id_yearly')
      .eq('plan', plan)
      .single();

    if (planError || !planConfig) {
      return { url: null, error: 'Piano non trovato' };
    }

    const priceId = isYearly ? planConfig.stripe_price_id_yearly : planConfig.stripe_price_id;

    if (!priceId) {
      return { url: null, error: 'Prezzo Stripe non configurato per questo piano' };
    }

    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: {
        priceId,
        plan,
        trialDays: TRIAL_DAYS,
        successUrl: `${getBaseUrl()}/home?trial=started`,
        cancelUrl: `${getBaseUrl()}/home?trial=canceled`,
        customerEmail: user.email,
        userId: user.id,
      },
    });

    if (error) {
      console.error('Error creating trial checkout session:', error);
      return { url: null, error: 'Errore nell\'avvio della prova' };
    }

    return { url: data?.url ?? null, error: null };
  } catch (error) {
    console.error('Exception creating trial checkout session:', error);
    return {
      url: null,
      error: error instanceof Error ? error.message : 'Errore sconosciuto',
    };
  }
};

/**
 * Create a Stripe Customer Portal session
 * Allows users to manage their subscription, update payment method, etc.
 */
export const createPortalSession = async (): Promise<{ url: string | null; error: string | null }> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return { url: null, error: 'Devi essere autenticato' };
    }
    
    // Get customer ID from subscription
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();
    
    if (subError || !subscription?.stripe_customer_id) {
      return { url: null, error: 'Nessuna subscription attiva trovata' };
    }
    
    // Call Edge Function to create portal session
    const { data, error } = await supabase.functions.invoke('create-portal-session', {
      body: {
        customerId: subscription.stripe_customer_id,
        returnUrl: `${getBaseUrl()}/billing`,
      },
    });
    
    if (error) {
      console.error('Error creating portal session:', error);
      return { url: null, error: 'Errore nella creazione del portale' };
    }
    
    return { url: data?.url ?? null, error: null };
  } catch (error) {
    console.error('Exception creating portal session:', error);
    return { 
      url: null, 
      error: error instanceof Error ? error.message : 'Errore sconosciuto' 
    };
  }
};

/**
 * Cancel subscription at period end
 */
export const cancelSubscription = async (): Promise<{ success: boolean; error: string | null }> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return { success: false, error: 'Devi essere autenticato' };
    }
    
    const { data, error } = await supabase.functions.invoke('cancel-subscription', {
      body: { userId: user.id },
    });
    
    if (error) {
      console.error('Error canceling subscription:', error);
      return { success: false, error: 'Errore nella cancellazione' };
    }
    
    return { success: data?.success ?? false, error: null };
  } catch (error) {
    console.error('Exception canceling subscription:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Errore sconosciuto' 
    };
  }
};

/**
 * Resume a canceled subscription (before period end)
 */
export const resumeSubscription = async (): Promise<{ success: boolean; error: string | null }> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return { success: false, error: 'Devi essere autenticato' };
    }
    
    const { data, error } = await supabase.functions.invoke('resume-subscription', {
      body: { userId: user.id },
    });
    
    if (error) {
      console.error('Error resuming subscription:', error);
      return { success: false, error: 'Errore nel ripristino' };
    }
    
    return { success: data?.success ?? false, error: null };
  } catch (error) {
    console.error('Exception resuming subscription:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Errore sconosciuto' 
    };
  }
};

/**
 * Change subscription plan
 */
export const changePlan = async (
  newPlan: SubscriptionPlan,
  isYearly: boolean = false
): Promise<{ success: boolean; error: string | null }> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return { success: false, error: 'Devi essere autenticato' };
    }
    
    // Get current subscription
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('stripe_subscription_id, plan')
      .eq('user_id', user.id)
      .single();
    
    if (subError || !subscription) {
      // No existing subscription, create checkout
      const { url, error } = await createCheckoutSession(newPlan, isYearly);
      if (url) {
        window.location.href = url;
        return { success: true, error: null };
      }
      return { success: false, error };
    }
    
    // Get new plan price ID
    const { data: planConfig, error: planError } = await supabase
      .from('plan_configurations')
      .select('stripe_price_id, stripe_price_id_yearly')
      .eq('plan', newPlan)
      .single();
    
    if (planError || !planConfig) {
      return { success: false, error: 'Piano non trovato' };
    }
    
    const newPriceId = isYearly 
      ? planConfig.stripe_price_id_yearly 
      : planConfig.stripe_price_id;
    
    if (!newPriceId) {
      return { success: false, error: 'Prezzo non configurato' };
    }
    
    // Call Edge Function to update subscription
    const { data, error } = await supabase.functions.invoke('update-subscription', {
      body: {
        subscriptionId: subscription.stripe_subscription_id,
        newPriceId,
        newPlan,
      },
    });
    
    if (error) {
      console.error('Error updating subscription:', error);
      return { success: false, error: 'Errore nel cambio piano' };
    }
    
    return { success: data?.success ?? false, error: null };
  } catch (error) {
    console.error('Exception changing plan:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Errore sconosciuto' 
    };
  }
};

/**
 * Get subscription details
 */
export const getSubscriptionDetails = async (): Promise<{
  subscription: {
    plan: SubscriptionPlan;
    status: string;
    periodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  error: string | null;
}> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return { subscription: null, error: 'Non autenticato' };
    }
    
    const { data, error } = await supabase
      .from('subscriptions')
      .select('plan, status, current_period_end, cancel_at_period_end')
      .eq('user_id', user.id)
      .single();
    
    if (error) {
      console.error('Error fetching subscription:', error);
      return { subscription: null, error: 'Errore nel recupero subscription' };
    }
    
    return {
      subscription: {
        plan: data.plan,
        status: data.status,
        periodEnd: data.current_period_end,
        cancelAtPeriodEnd: data.cancel_at_period_end,
      },
      error: null,
    };
  } catch (error) {
    console.error('Exception fetching subscription:', error);
    return { 
      subscription: null, 
      error: error instanceof Error ? error.message : 'Errore sconosciuto' 
    };
  }
};

/**
 * Calculate plan comparison
 */
export const comparePlans = (
  currentPlan: PlanConfiguration,
  targetPlan: PlanConfiguration
): {
  isUpgrade: boolean;
  priceDifference: number;
  creditsDifference: number;
  projectsDifference: number;
} => {
  const isUpgrade = targetPlan.price_monthly_cents > currentPlan.price_monthly_cents;
  const priceDifference = targetPlan.price_monthly_cents - currentPlan.price_monthly_cents;
  const creditsDifference = targetPlan.monthly_credits - currentPlan.monthly_credits;
  
  const currentProjects = currentPlan.max_projects === -1 ? Infinity : currentPlan.max_projects;
  const targetProjects = targetPlan.max_projects === -1 ? Infinity : targetPlan.max_projects;
  const projectsDifference = targetProjects - currentProjects;
  
  return {
    isUpgrade,
    priceDifference,
    creditsDifference,
    projectsDifference: Number.isFinite(projectsDifference) ? projectsDifference : 0,
  };
};


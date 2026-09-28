/**
 * Deployment mode — the single switch that makes ONE codebase serve both the managed cloud and a
 * self-hosted (open-source) install. Set at build time via Vite env.
 *
 *   VITE_DEPLOYMENT_MODE=selfhost   → open edition: BYOK, no billing/paywall/credits, everything
 *                                     unlocked. The user runs their own Supabase + API keys.
 *   (unset | anything else)         → 'cloud' (default): the managed product, unchanged.
 *
 * Cloud behaviour is the default, so this is purely additive — with the env unset, nothing changes.
 * Gate every cloud-only concern (Stripe, reverse-trial, pooled credits, the account budget cap,
 * managed keys) behind these helpers rather than checking the raw env elsewhere.
 */

export type DeploymentMode = 'cloud' | 'selfhost';

const raw = import.meta.env['VITE_DEPLOYMENT_MODE'] as string | undefined;

export const deploymentMode: DeploymentMode = raw === 'selfhost' ? 'selfhost' : 'cloud';

export const isSelfHost = (): boolean => deploymentMode === 'selfhost';
export const isCloud = (): boolean => deploymentMode === 'cloud';

/** Billing, checkout, paywall, reverse-trial — only in the managed cloud. */
export const billingEnabled = (): boolean => isCloud();

/** Credit metering + the per-account spend cap — cloud only (self-host is BYOK, uncapped by us). */
export const creditsEnabled = (): boolean => isCloud();

/**
 * Whether value actions (generate/publish/scan) are gated by a subscription. Self-host never gates —
 * the operator brought their own keys and pays the APIs directly.
 */
export const requiresSubscription = (): boolean => isCloud();

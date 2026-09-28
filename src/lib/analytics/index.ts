// Analytics hooks. The open edition ships no trackers: every call is a no-op.
// Wire your own provider here if you want product analytics on your instance.

export { sanitizeUrlForAnalytics } from "./sanitizeUrl";
export { getConsent } from "./consent";

export function initAnalytics(): void {}

/** Fire on every SPA route change. */
export function trackPageview(_rawUrl: string): void {}

/** Generic product event. */
export function track(_event: string, _props?: Record<string, unknown>): void {}

export function trackConversion(_name: string, _eventId?: string, _props?: Record<string, unknown>): void {}

export function trackSignup(_props?: Record<string, unknown>): void {}

export function trackFreeCheck(_props?: Record<string, unknown>): void {}

export function trackPurchase(_props?: Record<string, unknown>): void {}

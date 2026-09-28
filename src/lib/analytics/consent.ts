// Lightweight consent state for analytics/ad trackers.
// Stored per-browser in localStorage. `null` = not decided yet (show the banner).
// Cookieless providers (Vercel Web Analytics, PostHog in memory mode, GA under
// Consent Mode) may run before consent; the X/Twitter ad pixel loads only after
// an explicit "granted".

export type ConsentState = "granted" | "denied";

const STORAGE_KEY = "rd_analytics_consent";
const EVENT = "rd:consent-change";

export function getConsent(): ConsentState | null {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return v === "granted" || v === "denied" ? v : null;
	} catch {
		return null;
	}
}

export function setConsent(state: ConsentState): void {
	try {
		localStorage.setItem(STORAGE_KEY, state);
	} catch {
		/* storage unavailable (private mode etc.) — keep going in-memory */
	}
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent<ConsentState>(EVENT, { detail: state }));
	}
}

export function onConsentChange(cb: (state: ConsentState) => void): () => void {
	const handler = (e: Event): void => cb((e as CustomEvent<ConsentState>).detail);
	window.addEventListener(EVENT, handler);
	return () => window.removeEventListener(EVENT, handler);
}

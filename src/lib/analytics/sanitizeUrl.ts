/**
 * Strip anything auth-related from a URL before it leaves the browser.
 * Supabase recovery / confirm / OAuth redirects carry `#access_token=…&refresh_token=…` (implicit
 * flow) or `?code=…` (PKCE); auth-js clears them only after an async round-trip, so the very first
 * pageview would otherwise ship live session tokens to every analytics provider.
 */
const SENSITIVE_PARAMS = ["code", "token", "access_token", "refresh_token", "state", "token_hash", "api_key"];
export function sanitizeUrlForAnalytics(url: string): string {
	try {
		const u = new URL(url, typeof window === "undefined" ? "http://localhost" : window.location.origin);
		u.hash = "";
		for (const k of SENSITIVE_PARAMS) u.searchParams.delete(k);
		return u.toString();
	} catch {
		return url.split("#")[0] ?? "";
	}
}

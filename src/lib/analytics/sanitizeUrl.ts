/**
 * Strip anything auth-related from a URL before it leaves the browser.
 * Supabase recovery / confirm / OAuth redirects carry `#access_token=…&refresh_token=…` (implicit
 * flow) or `?code=…` (PKCE); auth-js clears them only after an async round-trip, so the very first
 * pageview would otherwise ship live session tokens to every analytics provider.
 */
const SENSITIVE_PARAMS = ["code", "token", "access_token", "refresh_token", "state", "token_hash", "api_key"];

/**
 * A shared client report lives at /r/<token>, and the token is what opens it: analytics gets
 * "/r/:token" instead (the static teaser pages /r/<name>.html keep their readable slug).
 */
const SHARE_PATH_RE = /\/r\/[0-9a-f]{16,}(?=[/?#]|$)/i;
export function redactSharePath(path: string): string {
	return path.replace(SHARE_PATH_RE, "/r/:token");
}

export function sanitizeUrlForAnalytics(url: string): string {
	try {
		const u = new URL(url, typeof window === "undefined" ? "http://localhost" : window.location.origin);
		u.hash = "";
		for (const k of SENSITIVE_PARAMS) u.searchParams.delete(k);
		u.pathname = redactSharePath(u.pathname);
		return u.toString();
	} catch {
		return redactSharePath(url.split("#")[0] ?? "");
	}
}

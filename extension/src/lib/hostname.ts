/**
 * Hostname normalization helpers.
 *
 * The popup reads the active tab's URL and must reduce it to the registrable
 * host we hand to the MCP tools (e.g. `https://www.Example.com/path` → `example.com`).
 */

/**
 * Extract a normalized hostname from a full URL or a bare host string.
 *
 * - lowercases the host
 * - strips a leading `www.`
 * - drops any port, path, query or fragment
 *
 * Returns `null` for URLs that have no meaningful web host (chrome://, about:,
 * file://, extension pages, empty input, etc.).
 */
export function normalizeHostname(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  let host: string;
  try {
    // Accept both full URLs and bare hostnames by giving the parser a scheme.
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
    const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    // Only http(s) tabs carry a domain we can analyze.
    if (hasScheme && url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    host = url.hostname;
  } catch {
    return null;
  }

  host = host.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('www.')) host = host.slice(4);

  // Reject non-web hosts: localhost, bare IPs are fine to reject for an SEO tool,
  // and anything without a dot is not a public domain.
  if (!host || !host.includes('.')) return null;

  return host;
}

/** True when a string looks like a Rankdelta personal API key. */
export function looksLikeApiKey(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^sk_rankdelta_[A-Za-z0-9_-]{8,}$/.test(value.trim());
}

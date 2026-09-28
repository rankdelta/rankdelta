/**
 * Safe URL helpers for Site Explorer / Keyword Research tables.
 * DataForSEO returns full page URLs (`url_from`, `url_to`) — the UI must
 * open those pages, never just print a hostname.
 */

const UNSAFE = /^(javascript|data|vbscript|file):/i;
const HOSTISH = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+([/:?#].*)?$/i;

/** Absolute http(s) href, or null if the value is empty / unsafe. */
export function hrefOf(raw?: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t || UNSAFE.test(t)) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith('//') && !UNSAFE.test(t.slice(2))) return `https:${t}`;
  if (HOSTISH.test(t)) return `https://${t}`;
  return null;
}

/** True for http(s) URLs (and mailto: for editor links). Rejects javascript:/data:/vbscript:. */
export function isSafeHref(raw?: string | null): boolean {
  if (!raw) return false;
  const t = raw.trim();
  if (/^mailto:[^\s]+$/i.test(t) && !UNSAFE.test(t)) return true;
  return hrefOf(t) !== null;
}

/** Hostname without www, for compact table cells. */
export function hostOf(raw?: string | null): string {
  if (!raw) return '';
  try {
    const href = hrefOf(raw);
    if (href) return new URL(href).hostname.replace(/^www\./i, '');
  } catch { /* fall through */ }
  return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[/:?#].*$/, '');
}

/** Path + query (no hash), or empty when the URL is domain-only. */
export function pathOf(raw?: string | null): string {
  const href = hrefOf(raw);
  if (!href) return '';
  try {
    const u = new URL(href);
    const path = `${u.pathname || ''}${u.search || ''}`;
    return path === '/' ? '' : path;
  } catch {
    return '';
  }
}

/** Ahrefs-style compact URL: host + path, no protocol. */
export function displayUrl(raw?: string | null): string {
  if (!raw) return '';
  const host = hostOf(raw);
  const path = pathOf(raw);
  if (host && path) return `${host}${path}`;
  if (host) return host;
  return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
}

/** Public Google SERP for a keyword in a given market — no API cost. */
export function googleSearchHref(keyword: string, lang = 'en', country = 'us'): string {
  const q = new URLSearchParams({
    q: keyword,
    hl: lang || 'en',
    gl: (country || 'us').toLowerCase(),
  });
  return `https://www.google.com/search?${q.toString()}`;
}

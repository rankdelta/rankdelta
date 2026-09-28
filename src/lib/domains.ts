/**
 * domains — tiny pure helpers for normalizing and comparing web domains.
 *
 * Citation source_domains, brand domains, and competitor domains all arrive in inconsistent shapes
 * (with/without protocol, www, trailing path, casing). Normalizing here keeps "is this the same site"
 * comparisons correct and in one tested place.
 */

/** Strip protocol, leading www., any path/query, and lowercase. `"https://www.Foo.com/x"` → `"foo.com"`. */
export function normalizeDomain(input: string | null | undefined): string {
  return (input ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .replace(/[?#].*$/, '')
    .toLowerCase();
}

/**
 * True when `candidate` is the same site as `base`, or a subdomain of it (e.g. blog.foo.com matches
 * foo.com). Both are normalized first. Empty inputs never match.
 */
export function isSameOrSubdomain(candidate: string | null | undefined, base: string | null | undefined): boolean {
  const c = normalizeDomain(candidate);
  const b = normalizeDomain(base);
  if (!c || !b) return false;
  return c === b || c.endsWith(`.${b}`);
}

/** Build an absolute, safe href for a domain or URL. Returns null for empty/placeholder values. */
export function toHref(domainOrUrl: string | null | undefined): string | null {
  const v = (domainOrUrl ?? '').trim();
  if (!v || v.toLowerCase() === 'unknown') return null;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

/**
 * Typed views over the "top rows" arrays the edge assembler stores as `unknown[]`.
 *
 * GSC rows come straight from the Search Analytics API (`{ key, clicks, impressions, ctr, position }`,
 * with `ctr` as a 0–1 fraction); GA4 rows from the Data API (`{ key, sessions, users, pageviews }`).
 * Both parsers are tolerant: a malformed row is dropped, never rendered as NaN.
 */

export interface GscTopRow {
  key: string
  clicks: number
  impressions: number
  /** 0–1 fraction as returned by Search Console. */
  ctr: number
  position: number | null
}

export interface Ga4PageRow {
  key: string
  sessions: number
  users: number | null
  pageviews: number | null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

export function gscTopRows(rows: unknown[] | null | undefined): GscTopRow[] {
  if (!Array.isArray(rows)) return []
  const out: GscTopRow[] = []
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as { [k: string]: unknown }
    const key = str(r['key']) ?? str(r['query']) ?? str(r['page'])
    if (!key) continue
    const clicks = num(r['clicks']) ?? 0
    const impressions = num(r['impressions']) ?? 0
    const rawCtr = num(r['ctr'])
    // Some CSV imports store CTR as a percent; normalise to a fraction.
    const ctr = rawCtr == null ? (impressions > 0 ? clicks / impressions : 0) : rawCtr > 1 ? rawCtr / 100 : rawCtr
    out.push({ key, clicks, impressions, ctr, position: num(r['position']) })
  }
  return out
}

export function ga4PageRows(rows: unknown[] | null | undefined): Ga4PageRow[] {
  if (!Array.isArray(rows)) return []
  const out: Ga4PageRow[] = []
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as { [k: string]: unknown }
    const key = str(r['key']) ?? str(r['page']) ?? str(r['path'])
    if (!key) continue
    out.push({ key, sessions: num(r['sessions']) ?? 0, users: num(r['users']), pageviews: num(r['pageviews']) })
  }
  return out
}

/** "https://site.com/a/b/" → "/a/b/"; a bare path is returned unchanged; the homepage reads "/". */
export function pagePath(url: string): string {
  try {
    if (/^https?:\/\//i.test(url)) {
      const u = new URL(url)
      return `${u.pathname}${u.search}` || '/'
    }
  } catch {
    // fall through
  }
  return url || '/'
}

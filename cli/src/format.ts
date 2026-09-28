/**
 * Human-friendly output formatters. All pure: they take already-extracted MCP
 * data and return a string. `--json` bypasses these entirely.
 */

export interface SiteRecord {
  id: string;
  name?: string | null;
  website_url?: string | null;
}

/** Render an aligned monospace table. Empty rows → a placeholder line. */
export function renderTable(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
  emptyMessage = '(none)',
): string {
  if (rows.length === 0) return emptyMessage;

  const cells = rows.map((r) => r.map(cell));
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...cells.map((r) => (r[i] ?? '').length)),
  );

  const line = (values: string[]) =>
    values.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();

  const out = [line(headers), line(widths.map((w) => '-'.repeat(w)))];
  for (const r of cells) out.push(line(headers.map((_, i) => r[i] ?? '')));
  return out.join('\n');
}

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return String(v);
}

/** Coerce arbitrary MCP data to an array (some tools wrap results in objects). */
function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const rec = data as Record<string, unknown>;
    for (const key of ['sites', 'rows', 'items', 'results', 'data']) {
      if (Array.isArray(rec[key])) return rec[key] as unknown[];
    }
  }
  return [];
}

export function formatSites(data: unknown): string {
  const sites = asArray(data) as SiteRecord[];
  if (sites.length === 0) {
    return 'No sites yet. Add one at rankdelta.ai to start tracking.';
  }
  const rows = sites.map((s) => [s.id, s.name ?? '-', s.website_url ?? '-']);
  return renderTable(['SITE ID', 'NAME', 'URL'], rows) + `\n\n${sites.length} site(s).`;
}

interface EngineRow {
  engine?: string;
  yourMentions?: number;
  competitorMentions?: number;
  yourRecommended?: number;
  shareOfVoice?: number;
}

export function formatVisibility(data: unknown, label?: string): string {
  const rec = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  if (rec.status === 'not_configured') {
    return (
      `AI visibility is not configured${label ? ` for ${label}` : ''} yet.\n` +
      `${rec.message ? String(rec.message) : 'Run setup_ai_visibility from the Rankdelta app or MCP.'}`
    );
  }

  const perEngine = Array.isArray(rec.perEngine) ? (rec.perEngine as EngineRow[]) : [];
  const overall = rec.overallShareOfVoice;
  const header =
    `AI Share of Voice${label ? ` — ${label}` : ''}: ` +
    `${overall === undefined || overall === null ? 'n/a' : `${overall}%`} (last 30 days)`;

  if (perEngine.length === 0) return header + '\n(no per-engine breakdown available)';

  const rows = perEngine.map((e) => [
    e.engine ?? '-',
    e.shareOfVoice === undefined ? '-' : `${e.shareOfVoice}%`,
    e.yourMentions ?? 0,
    e.competitorMentions ?? 0,
    e.yourRecommended ?? 0,
  ]);
  return (
    header +
    '\n\n' +
    renderTable(['ENGINE', 'SOV', 'YOU', 'COMPETITORS', 'RECOMMENDED'], rows)
  );
}

interface RankRow {
  keyword?: string;
  phrase?: string;
  latest_position?: number | null;
  ranking_url?: string | null;
  is_active?: boolean;
  latest_checked_at?: string | null;
}

export function formatRanks(data: unknown, label?: string): string {
  const rows = asArray(data) as RankRow[];
  if (rows.length === 0) {
    return `No tracked keywords${label ? ` for ${label}` : ''}. Add some with the Rank Tracker.`;
  }
  const table = rows.map((r) => [
    r.keyword ?? r.phrase ?? '-',
    r.latest_position ?? '-',
    r.is_active === false ? 'paused' : 'active',
    r.ranking_url ?? '-',
    formatDate(r.latest_checked_at),
  ]);
  return (
    `Tracked keywords${label ? ` — ${label}` : ''}\n\n` +
    renderTable(['KEYWORD', 'POSITION', 'STATUS', 'RANKING URL', 'CHECKED'], table) +
    `\n\n${rows.length} keyword(s).`
  );
}

export function formatAudit(data: unknown): string {
  const rec = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const url = typeof rec.url === 'string' ? rec.url : '(url)';
  const result = (rec.result && typeof rec.result === 'object' ? rec.result : rec) as Record<
    string,
    unknown
  >;
  const meta = (result.meta && typeof result.meta === 'object' ? result.meta : {}) as Record<
    string,
    unknown
  >;
  const checks = (result.checks && typeof result.checks === 'object' ? result.checks : {}) as Record<
    string,
    unknown
  >;
  const timing = (result.page_timing && typeof result.page_timing === 'object'
    ? result.page_timing
    : {}) as Record<string, unknown>;

  // Render boolean checks neutrally — polarity differs per key.
  const boolChecks = Object.entries(checks)
    .filter(([, v]) => typeof v === 'boolean')
    .map(([k, v]) => `${k}=${v}`)
    .slice(0, 6);

  const rows: Array<[string, string | number | null | undefined]> = [
    ['URL', url],
    ['Status code', num(result.status_code)],
    ['Title', str(meta.title)],
    ['Title length', num(meta.title_length)],
    ['Description', str(meta.description)],
    ['H1', firstOf(meta.htags, 'h1')],
    ['Word count', num(wordCount(meta))],
    ['Internal links', num(meta.internal_links_count)],
    ['External links', num(meta.external_links_count)],
    ['Images', num(meta.images_count)],
    ['Time to render (ms)', num(timing.dom_complete ?? timing.time_to_interactive)],
    ['Checks reported', boolChecks.length ? boolChecks.join(', ') : '-'],
  ];

  const table = renderTable(
    ['FIELD', 'VALUE'],
    rows.map(([k, v]) => [k, truncate(v, 80)]),
  );
  return `Page audit\n\n${table}\n\nUse --json for the full DataForSEO payload.`;
}

// ── small value helpers ──

function str(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v : '-';
}
function num(v: unknown): number | string {
  return typeof v === 'number' ? v : '-';
}
function wordCount(meta: Record<string, unknown>): unknown {
  const direct = meta.plain_text_word_count;
  if (typeof direct === 'number') return direct;
  const content = meta.content;
  if (content && typeof content === 'object') {
    return (content as Record<string, unknown>).plain_text_word_count;
  }
  return undefined;
}
function firstOf(htags: unknown, tag: string): string {
  if (htags && typeof htags === 'object') {
    const arr = (htags as Record<string, unknown>)[tag];
    if (Array.isArray(arr) && arr.length && typeof arr[0] === 'string') return arr[0];
  }
  return '-';
}
function formatDate(v: string | null | undefined): string {
  if (!v) return '-';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
}
function truncate(v: string | number | null | undefined, max: number): string {
  const s = v === null || v === undefined ? '-' : String(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Resolve a user-supplied site reference (id, name, or domain/url) to a site id
 * using the list_sites payload. Pure so command wiring stays testable.
 * Returns { id } on a unique match, { error } otherwise.
 */
export function resolveSiteId(
  sites: SiteRecord[],
  query: string,
): { id: string } | { error: string; candidates?: SiteRecord[] } {
  const q = query.trim().toLowerCase();
  if (!q) {
    if (sites.length === 1) return { id: sites[0].id };
    return { error: 'No site specified.', candidates: sites };
  }

  // Exact id match wins.
  const byId = sites.find((s) => s.id.toLowerCase() === q);
  if (byId) return { id: byId.id };

  const normDomain = (u: string | null | undefined) =>
    (u ?? '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '');
  const qDomain = normDomain(q);

  const matches = sites.filter((s) => {
    const name = (s.name ?? '').toLowerCase();
    const dom = normDomain(s.website_url);
    return (
      name === q ||
      dom === qDomain ||
      (qDomain.length > 1 && dom.includes(qDomain)) ||
      (q.length > 1 && name.includes(q))
    );
  });

  if (matches.length === 1) return { id: matches[0].id };
  if (matches.length === 0) return { error: `No site matches "${query}".`, candidates: sites };
  return { error: `"${query}" is ambiguous — matches ${matches.length} sites.`, candidates: matches };
}

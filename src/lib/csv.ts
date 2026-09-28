/**
 * csv.ts — client-side CSV export for data tables (keyword research, bulk analysis, Site Explorer).
 * Free: runs on data already in the browser, no API calls. Every serious SEO tool exports its tables.
 */

const esc = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Build a CSV string from rows + an ordered column spec (header label → value getter). */
export function toCsv<T>(rows: T[], columns: { header: string; value: (row: T) => unknown }[]): string {
  const head = columns.map((c) => esc(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(c.value(r))).join(',')).join('\n');
  return `${head}\n${body}`;
}

/** Trigger a browser download of `content` as `filename`. */
export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Slugify a seed/domain into a safe filename stem. */
export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'export';

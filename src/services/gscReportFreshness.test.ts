import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guard for GSC data-freshness reporting.
 *
 * Context: gsc_analytics_cache is written ONLY by the gsc-connect edge function,
 * which runs only on a manual user connect/sync. No scheduled refresh exists.
 * So a project can stay "connected" while its cached snapshot ages
 * indefinitely — observed in production: a connected project whose cache was
 * fetched 28 days before the report was generated.
 *
 * When the cached daily_data predates the report period, the period filter
 * yields no rows, so clicks/impressions sum to 0 while avg_position still shows
 * the old cache-level aggregate. Rendering that inside a report that carries an
 * explicit period_start/period_end presents stale numbers as current ones.
 *
 * The assembler must therefore carry the freshness signal (dataAsOf /
 * coversPeriod / stale) so the UI can label or suppress the section.
 */

function readGscAssembler(): string {
  const source = readFileSync(
    resolve(process.cwd(), 'supabase/functions/_shared/reportAssemble.ts'),
    'utf8',
  );
  const start = source.indexOf("key: 'gsc'");
  expect(start, 'gsc section not found in reportAssemble.ts').toBeGreaterThan(-1);
  return source;
}

function stripComments(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

describe('GSC report freshness', () => {
  it('selects fetched_at from the cache so the age is knowable', () => {
    const code = stripComments(readGscAssembler());
    expect(code).toMatch(/daily_data,\s*fetched_at/);
  });

  it('declares fetched_at on the gscCache type', () => {
    const code = stripComments(readGscAssembler());
    expect(code).toMatch(/fetched_at:\s*string\s*\|\s*null/);
  });

  it('emits the freshness fields on the gsc section', () => {
    const code = stripComments(readGscAssembler());
    expect(code).toMatch(/dataAsOf/);
    expect(code).toMatch(/coversPeriod/);
    expect(code).toMatch(/stale/);
  });
});

describe('GSC staleness logic (behavioural)', () => {
  type Daily = { date: string };

  /** Mirrors the staleness rule in the gsc assembler. */
  function evaluate(fetchedAt: string | null, curDaily: Daily[], periodEnd: string) {
    const coversPeriod = curDaily.length > 0;
    const stale = Boolean(fetchedAt) && fetchedAt! < periodEnd && !coversPeriod;
    return { coversPeriod, stale };
  }

  it('flags a cache fetched before the period with no covering rows', () => {
    // The production shape: connected project, cache fetched 2026-08-24,
    // report period ending 2026-09-21.
    const r = evaluate('2026-08-24T00:00:00Z', [], '2026-09-21');
    expect(r.coversPeriod).toBe(false);
    expect(r.stale).toBe(true);
  });

  it('does not flag a cache that actually covers the period', () => {
    const r = evaluate('2026-09-20T00:00:00Z', [{ date: '2026-09-19' }], '2026-09-21');
    expect(r.coversPeriod).toBe(true);
    expect(r.stale).toBe(false);
  });

  it('does not flag when fetched_at is unknown', () => {
    // No timestamp means we cannot claim staleness; stay silent rather than
    // put a wrong "stale" label on a report.
    const r = evaluate(null, [], '2026-09-21');
    expect(r.stale).toBe(false);
  });

  it('does not flag a cache fetched after the period end', () => {
    const r = evaluate('2026-09-22T00:00:00Z', [{ date: '2026-09-20' }], '2026-09-21');
    expect(r.stale).toBe(false);
  });
});

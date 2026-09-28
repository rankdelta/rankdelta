import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard for the check_ranks keyword rotation.
 *
 * The bug: check_ranks ordered candidates by `serp_rank_keywords.updated_at`
 * ascending, intending "least recently checked first". But nothing in the check
 * path ever writes that column (visibility-ops/serp_rank.ts only SELECTs the
 * row), so the order was static: the same head of the list was re-checked on
 * every run and the tail was never checked at all. Observed in production on a
 * 26-keyword project: 12 checked repeatedly, 14 with no snapshot at all six
 * days after being tracked.
 *
 * The fix orders by the real signal, serp_rank_snapshots.checked_at, with
 * never-checked keywords first.
 */

function readCheckRanksHandler(): string {
  const source = readFileSync(
    resolve(process.cwd(), 'supabase/functions/mcp/index.ts'),
    'utf8',
  );
  const start = source.indexOf("if (name === 'check_ranks')");
  expect(start, 'check_ranks handler not found in mcp/index.ts').toBeGreaterThan(-1);
  const end = source.indexOf("if (name === 'keyword_research')", start);
  expect(end, 'could not bound the check_ranks handler').toBeGreaterThan(start);
  return source.slice(start, end);
}

/** Strip // comments so explanatory prose never satisfies an assertion. */
function stripComments(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

describe('check_ranks keyword rotation', () => {
  it('does not order candidates by serp_rank_keywords.updated_at', () => {
    const code = stripComments(readCheckRanksHandler());
    expect(code).not.toMatch(/order\(\s*['"]updated_at['"]/);
  });

  it('uses serp_rank_snapshots.checked_at as the recency signal', () => {
    const code = stripComments(readCheckRanksHandler());
    expect(code).toMatch(/serp_rank_snapshots/);
    expect(code).toMatch(/checked_at/);
  });

  it('puts never-checked keywords first', () => {
    const code = stripComments(readCheckRanksHandler());
    // A null last-checked value must sort ahead of any timestamp.
    expect(code).toMatch(/aAt === null/);
    expect(code).toMatch(/return -1/);
  });

  it('reports coverage so partial runs are visible to the caller', () => {
    const code = stripComments(readCheckRanksHandler());
    expect(code).toMatch(/tracked_total/);
    expect(code).toMatch(/remaining_unchecked_this_run/);
  });

  it('still caps the batch and keeps the no-keywords guard', () => {
    const code = stripComments(readCheckRanksHandler());
    expect(code).toMatch(/Math\.min\(\s*20/);
    expect(code).toMatch(/no_tracked_keywords/);
  });
});

describe('check_ranks rotation ordering (behavioural)', () => {
  type Kw = { id: string };

  /** Mirrors the comparator in the check_ranks handler. */
  function orderByLastChecked(candidates: Kw[], lastChecked: Map<string, string | null>): Kw[] {
    return [...candidates].sort((a, b) => {
      const aAt = lastChecked.get(a.id) ?? null;
      const bAt = lastChecked.get(b.id) ?? null;
      if (aAt === bAt) return 0;
      if (aAt === null) return -1;
      if (bAt === null) return 1;
      return aAt < bAt ? -1 : 1;
    });
  }

  it('selects never-checked keywords before recently-checked ones', () => {
    const candidates: Kw[] = [{ id: 'fresh' }, { id: 'never' }, { id: 'old' }];
    const lastChecked = new Map<string, string | null>([
      ['fresh', '2026-09-21T22:52:00Z'],
      ['never', null],
      ['old', '2026-09-01T00:00:00Z'],
    ]);
    const order = orderByLastChecked(candidates, lastChecked).map((k) => k.id);
    expect(order).toEqual(['never', 'old', 'fresh']);
  });

  it('covers every keyword across successive runs instead of starving the tail', () => {
    // 26 tracked keywords, batch of 12 — the production shape of the bug.
    const candidates: Kw[] = Array.from({ length: 26 }, (_, i) => ({ id: `kw${i}` }));
    const lastChecked = new Map<string, string | null>(candidates.map((k) => [k.id, null]));

    const checked = new Set<string>();
    let clock = 0;
    for (let run = 0; run < 3; run += 1) {
      const batch = orderByLastChecked(candidates, lastChecked).slice(0, 12);
      for (const kw of batch) {
        checked.add(kw.id);
        clock += 1;
        // Simulate run_serp_rank writing a snapshot: monotonically increasing.
        lastChecked.set(kw.id, `2026-09-21T00:00:${String(clock).padStart(2, '0')}Z`);
      }
    }

    expect(checked.size).toBe(26);
  });

  it('would starve the tail if selection were static (documents the old bug)', () => {
    const candidates: Kw[] = Array.from({ length: 26 }, (_, i) => ({ id: `kw${i}` }));
    const checked = new Set<string>();
    // Old behaviour: the ordering key never changes, so the same slice wins forever.
    for (let run = 0; run < 3; run += 1) {
      for (const kw of candidates.slice(0, 12)) checked.add(kw.id);
    }
    expect(checked.size).toBe(12);
  });
});

/**
 * Pure report-build math — delta comparisons, ranking distribution buckets.
 * Shared by vitest and the report-build edge function (logic duplicated in _shared).
 */

export type RankBucket = '1' | '2-3' | '4-10' | '11-20' | '21+';

export interface MetricWithDelta {
  value: number | null;
  delta: number | null;
  deltaPct: number | null;
}

export interface PeriodRange {
  start: string;
  end: string;
}

/** Inclusive day count between two YYYY-MM-DD dates. */
export function periodDayCount(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0;
  return Math.round((e - s) / 86_400_000) + 1;
}

/** Previous period of equal length immediately before [start, end]. */
export function previousPeriod(start: string, end: string): PeriodRange {
  const days = periodDayCount(start, end);
  const startMs = new Date(`${start}T00:00:00Z`).getTime();
  const prevEndMs = startMs - 86_400_000;
  const prevStartMs = prevEndMs - (days - 1) * 86_400_000;
  return {
    start: new Date(prevStartMs).toISOString().slice(0, 10),
    end: new Date(prevEndMs).toISOString().slice(0, 10),
  };
}

export function computeDelta(current: number | null, previous: number | null): MetricWithDelta {
  if (current == null && previous == null) {
    return { value: null, delta: null, deltaPct: null };
  }
  const cur = current ?? 0;
  const prev = previous ?? 0;
  const delta = cur - prev;
  const deltaPct = prev !== 0 ? Math.round((1000 * delta) / prev) / 10 : cur !== 0 ? 100 : 0;
  return { value: current, delta, deltaPct };
}

/** Map a SERP absolute rank to a distribution bucket. */
export function positionDistributionBucket(rank: number | null | undefined): RankBucket | null {
  if (rank == null || !Number.isFinite(rank) || rank <= 0) return null;
  const r = Math.floor(rank);
  if (r === 1) return '1';
  if (r <= 3) return '2-3';
  if (r <= 10) return '4-10';
  if (r <= 20) return '11-20';
  return '21+';
}

const BUCKET_ORDER: RankBucket[] = ['1', '2-3', '4-10', '11-20', '21+'];

export function buildDistributionBuckets(ranks: Array<number | null | undefined>): Record<RankBucket, number> {
  const out: Record<RankBucket, number> = {
    '1': 0,
    '2-3': 0,
    '4-10': 0,
    '11-20': 0,
    '21+': 0,
  };
  for (const r of ranks) {
    const b = positionDistributionBucket(r);
    if (b) out[b] += 1;
  }
  return out;
}

export function emptyDistributionBuckets(): Record<RankBucket, number> {
  return buildDistributionBuckets([]);
}

/** Sum numeric field from daily rows within [start, end] inclusive. */
export function sumDailyField<T extends { date: string }>(
  rows: T[],
  start: string,
  end: string,
  field: keyof T,
): number {
  let sum = 0;
  for (const row of rows) {
    if (row.date < start || row.date > end) continue;
    const v = row[field];
    if (typeof v === 'number' && Number.isFinite(v)) sum += v;
  }
  return sum;
}

/** Filter daily rows to a date range. */
export function filterDailyRows<T extends { date: string }>(rows: T[], start: string, end: string): T[] {
  return rows.filter((r) => r.date >= start && r.date <= end).sort((a, b) => a.date.localeCompare(b.date));
}

/** Nearest GSC/GA4 cache window for a custom period length. */
export function nearestCachePeriodDays(dayCount: number): 7 | 28 | 90 {
  const opts: Array<7 | 28 | 90> = [7, 28, 90];
  let best: 7 | 28 | 90 = 28;
  for (const o of opts) {
    if (Math.abs(o - dayCount) < Math.abs(best - dayCount)) best = o;
  }
  return best;
}

export { BUCKET_ORDER };

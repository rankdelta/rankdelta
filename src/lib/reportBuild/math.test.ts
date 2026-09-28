import { describe, it, expect } from 'vitest';
import {
  computeDelta,
  positionDistributionBucket,
  buildDistributionBuckets,
  previousPeriod,
  periodDayCount,
  sumDailyField,
  nearestCachePeriodDays,
} from './math';

describe('reportBuild delta math', () => {
  it('computes absolute and percent delta', () => {
    expect(computeDelta(120, 100)).toEqual({ value: 120, delta: 20, deltaPct: 20 });
    expect(computeDelta(80, 100)).toEqual({ value: 80, delta: -20, deltaPct: -20 });
  });

  it('handles null previous as zero baseline', () => {
    expect(computeDelta(50, null)).toEqual({ value: 50, delta: 50, deltaPct: 100 });
  });

  it('handles both null', () => {
    expect(computeDelta(null, null)).toEqual({ value: null, delta: null, deltaPct: null });
  });

  it('previous period is equal-length window before start', () => {
    expect(previousPeriod('2026-02-01', '2026-02-07')).toEqual({
      start: '2026-01-25',
      end: '2026-01-31',
    });
    expect(periodDayCount('2026-02-01', '2026-02-07')).toBe(7);
  });

  it('sums daily field within range', () => {
    const rows = [
      { date: '2026-01-01', clicks: 10 },
      { date: '2026-01-02', clicks: 5 },
      { date: '2026-01-03', clicks: 20 },
    ];
    expect(sumDailyField(rows, '2026-01-01', '2026-01-02', 'clicks')).toBe(15);
  });

  it('clamps to nearest cache period', () => {
    expect(nearestCachePeriodDays(6)).toBe(7);
    expect(nearestCachePeriodDays(30)).toBe(28);
    expect(nearestCachePeriodDays(80)).toBe(90);
  });
});

describe('reportBuild distribution buckets', () => {
  it('maps ranks to buckets', () => {
    expect(positionDistributionBucket(1)).toBe('1');
    expect(positionDistributionBucket(2)).toBe('2-3');
    expect(positionDistributionBucket(3)).toBe('2-3');
    expect(positionDistributionBucket(5)).toBe('4-10');
    expect(positionDistributionBucket(15)).toBe('11-20');
    expect(positionDistributionBucket(25)).toBe('21+');
    expect(positionDistributionBucket(null)).toBeNull();
  });

  it('builds distribution counts', () => {
    expect(buildDistributionBuckets([1, 2, 5, 15, 30, null])).toEqual({
      '1': 1,
      '2-3': 1,
      '4-10': 1,
      '11-20': 1,
      '21+': 1,
    });
  });
});

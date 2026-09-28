import { describe, it, expect } from 'vitest';
import {
  classifyRunOutcome,
  aggregateQueryStanding,
  pickResultsVerdict,
  shareOfVoice,
  averageBrandPosition,
  utcDayKey,
  weekOverWeekWindows,
  classifyDayWindow,
  isLowConfidenceSov,
  type RankEntity,
} from './resultsMath';

describe('isLowConfidenceSov', () => {
  it('flags a tiny sample (e.g. 100% from one prompt) as low confidence', () => {
    expect(isLowConfidenceSov(2, 0)).toBe(true);
    expect(isLowConfidenceSov(0, 0)).toBe(true);
  });
  it('does not flag a healthy sample', () => {
    expect(isLowConfidenceSov(6, 4)).toBe(false);
    expect(isLowConfidenceSov(8, 0)).toBe(false);
  });
  it('respects a custom minSample', () => {
    expect(isLowConfidenceSov(3, 1, 3)).toBe(false);
    expect(isLowConfidenceSov(1, 1, 3)).toBe(true);
  });
});

describe('utcDayKey', () => {
  it('returns the UTC calendar day of an ISO timestamp', () => {
    expect(utcDayKey('2026-06-12T10:30:00Z')).toBe('2026-06-12');
  });
  it('rolls into the next UTC day for late-UTC times', () => {
    expect(utcDayKey('2026-06-12T23:59:59Z')).toBe('2026-06-12');
    expect(utcDayKey('2026-06-13T00:00:00Z')).toBe('2026-06-13');
  });
});

describe('weekOverWeekWindows / classifyDayWindow', () => {
  // 14 consecutive days, deliberately passed out of order to prove sorting happens inside.
  const days = [
    '2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07',
    '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14',
  ];
  const shuffled = [...days].reverse(); // newest-first → proves sorting happens inside
  const w = weekOverWeekWindows(shuffled);

  it('puts the most recent 7 days in last7', () => {
    expect([...w.last7].sort()).toEqual(days.slice(7));
  });
  it('puts the 7 days before those in prior7', () => {
    expect([...w.prior7].sort()).toEqual(days.slice(0, 7));
  });
  it('the two windows never overlap', () => {
    const overlap = [...w.last7].filter((d) => w.prior7.has(d));
    expect(overlap).toEqual([]);
  });
  it('classifies the boundary days correctly (off-by-one guard)', () => {
    expect(classifyDayWindow('2026-06-14', w)).toBe('last'); // newest
    expect(classifyDayWindow('2026-06-08', w)).toBe('last'); // first day of last7
    expect(classifyDayWindow('2026-06-07', w)).toBe('prior'); // last day of prior7
    expect(classifyDayWindow('2026-06-01', w)).toBe('prior'); // oldest in window
  });
  it('returns null for days outside both windows', () => {
    const only10 = weekOverWeekWindows(days.slice(4)); // 10 days → prior7 = days[0..2] of the slice
    expect(classifyDayWindow('2026-06-01', only10)).toBeNull(); // dropped off the back
  });
});

describe('shareOfVoice', () => {
  it('is null when there are no mentions at all', () => {
    expect(shareOfVoice(0, 0)).toBeNull();
  });
  it('is 100% when only you are mentioned', () => {
    expect(shareOfVoice(3, 0)).toBe(100);
  });
  it('is 0% when only competitors are mentioned', () => {
    expect(shareOfVoice(0, 5)).toBe(0);
  });
  it('computes the proportional share', () => {
    expect(shareOfVoice(1, 3)).toBe(25);
  });
});

describe('averageBrandPosition', () => {
  const E = (you: boolean, entityId: string, pos: number): RankEntity => ({ you, entityId, pos });

  it('is null when you are never named', () => {
    expect(averageBrandPosition([[E(false, 'c1', 0), E(false, 'c2', 5)]])).toBeNull();
  });
  it('is #1 when you appear before every competitor', () => {
    expect(averageBrandPosition([[E(true, '__you__', 0), E(false, 'c1', 5)]])).toBe(1);
  });
  it('counts distinct competitors appearing before you', () => {
    // two different competitors earlier than you → rank 3
    expect(
      averageBrandPosition([[E(false, 'c1', 0), E(false, 'c2', 5), E(true, '__you__', 10)]]),
    ).toBe(3);
  });
  it('counts a repeated competitor only once', () => {
    // same competitor named twice before you → still rank 2
    expect(
      averageBrandPosition([[E(false, 'c1', 0), E(false, 'c1', 3), E(true, '__you__', 10)]]),
    ).toBe(2);
  });
  it('uses your EARLIEST mention to decide who is ahead', () => {
    // competitor at 5 is after your earliest (2) → not counted → rank 1
    expect(
      averageBrandPosition([[E(true, '__you__', 2), E(false, 'c1', 5), E(true, '__you__', 8)]]),
    ).toBe(1);
  });
  it('averages across answers and skips ones where you are absent', () => {
    const answers = [
      [E(true, '__you__', 0)], // rank 1
      [E(false, 'c1', 0), E(true, '__you__', 5)], // rank 2
      [E(false, 'c1', 0)], // you absent → skipped
    ];
    expect(averageBrandPosition(answers)).toBe(1.5);
  });
});

describe('classifyRunOutcome', () => {
  it('returns null for non-completed runs regardless of flags', () => {
    expect(classifyRunOutcome({ status: 'failed', cited: true, mentioned: true })).toBeNull();
    expect(classifyRunOutcome({ status: 'pending', cited: false, mentioned: false })).toBeNull();
  });
  it('ranks cited above mentioned', () => {
    expect(classifyRunOutcome({ status: 'completed', cited: true, mentioned: true })).toBe('cited');
  });
  it('returns mentioned when named but not linked', () => {
    expect(classifyRunOutcome({ status: 'completed', cited: false, mentioned: true })).toBe('mentioned');
  });
  it('returns not_mentioned when completed but absent', () => {
    expect(classifyRunOutcome({ status: 'completed', cited: false, mentioned: false })).toBe('not_mentioned');
  });
});

describe('aggregateQueryStanding', () => {
  const runs = [
    { id: 'r1', query_id: 'qA', status: 'completed' }, // mentioned
    { id: 'r2', query_id: 'qA', status: 'completed' }, // cited → qA should end up "cited"
    { id: 'r3', query_id: 'qB', status: 'completed' }, // absent
    { id: 'r4', query_id: 'qC', status: 'failed' }, // ignored
    { id: 'r5', query_id: 'qD', status: 'completed' }, // mentioned only
  ];
  const cited = new Set(['r2']);
  const mentioned = new Set(['r1', 'r5']);
  const map = aggregateQueryStanding(runs, cited, mentioned);

  it('keeps the best standing across a prompt’s runs (cited wins over mentioned)', () => {
    expect(map.get('qA')).toBe('cited');
  });
  it('marks a completed-but-unmentioned prompt as absent', () => {
    expect(map.get('qB')).toBe('absent');
  });
  it('omits prompts with only non-completed runs (renders as "not run")', () => {
    expect(map.has('qC')).toBe(false);
  });
  it('marks a mentioned-only prompt as mentioned', () => {
    expect(map.get('qD')).toBe('mentioned');
  });
  it('is order-independent (mentioned seen after cited still yields cited)', () => {
    const reordered = runs.slice(0, 2).reverse(); // [r2 cited, r1 mentioned]
    expect(aggregateQueryStanding(reordered, cited, mentioned).get('qA')).toBe('cited');
  });
});

describe('pickResultsVerdict', () => {
  it('returns null when there is no Share of Voice yet', () => {
    expect(pickResultsVerdict({ sovPercent: null, sovWowDelta: 1, comparisonAvailable: true })).toBeNull();
  });
  it('falls back to an early read when there is no prior-window comparison', () => {
    expect(pickResultsVerdict({ sovPercent: 40, sovWowDelta: null, comparisonAvailable: false })).toEqual({
      tone: 'neutral',
      key: 'verdictEarly',
    });
  });
  it('is gaining when the delta clears the positive threshold', () => {
    expect(pickResultsVerdict({ sovPercent: 40, sovWowDelta: 2, comparisonAvailable: true })).toEqual({
      tone: 'good',
      key: 'verdictGaining',
    });
  });
  it('is slipping when the delta clears the negative threshold', () => {
    expect(pickResultsVerdict({ sovPercent: 40, sovWowDelta: -2, comparisonAvailable: true })).toEqual({
      tone: 'bad',
      key: 'verdictSlipping',
    });
  });
  it('holds inside the dead-band', () => {
    expect(pickResultsVerdict({ sovPercent: 40, sovWowDelta: 0.2, comparisonAvailable: true })).toEqual({
      tone: 'neutral',
      key: 'verdictHolding',
    });
    expect(pickResultsVerdict({ sovPercent: 40, sovWowDelta: -0.4, comparisonAvailable: true })).toEqual({
      tone: 'neutral',
      key: 'verdictHolding',
    });
  });
});

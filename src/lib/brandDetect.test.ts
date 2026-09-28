import { describe, expect, it } from 'vitest';
import {
  type BrandDetectEntry,
  detectBrandMentions,
  findNamePosition,
  foldForMatch,
} from '../../supabase/functions/visibility-ops/brand_detect';

const tracked = (id: string, ...names: string[]): BrandDetectEntry => ({ kind: 'tracked', id, names });
const comp = (id: string, ...names: string[]): BrandDetectEntry => ({ kind: 'competitor', id, names });

describe('foldForMatch', () => {
  it('lowercases, strips diacritics, and collapses whitespace', () => {
    expect(foldForMatch("L'Oréal")).toBe("l'oreal");
    expect(foldForMatch('  Björn   Borg ')).toBe('bjorn borg');
    expect(foldForMatch('CafÉ')).toBe('cafe');
  });
});

describe('findNamePosition', () => {
  const answer = foldForMatch('We recommend Ora and the HP printer for your café.');

  it('finds a bounded name and returns its offset', () => {
    expect(findNamePosition(answer, 'Ora')).toBe(answer.indexOf('ora'));
    expect(findNamePosition(answer, 'HP')).toBeGreaterThan(0);
  });

  it('does NOT match a short name buried inside another word', () => {
    // "Ora" must not match inside "decoration"; this is the core substring bug being fixed.
    const buried = foldForMatch('Great decoration ideas for the storage room.');
    expect(findNamePosition(buried, 'Ora')).toBe(-1);
    expect(findNamePosition(buried, 'age')).toBe(-1);
  });

  it('matches across accent differences in both directions', () => {
    expect(findNamePosition(foldForMatch("The L'Oreal serum"), "L'Oréal")).toBeGreaterThanOrEqual(0);
    expect(findNamePosition(foldForMatch("The L'Oréal serum"), "L'Oreal")).toBeGreaterThanOrEqual(0);
  });

  it('matches names with flexible internal whitespace and punctuation', () => {
    expect(findNamePosition(foldForMatch('I love Ben & Jerry’s ice cream'), "Ben & Jerry's")).toBeGreaterThanOrEqual(-1);
    expect(findNamePosition(foldForMatch('I love Ben  &  Jerry ice cream'), 'Ben & Jerry')).toBeGreaterThanOrEqual(0);
  });

  it('ignores single-character names as too noisy to attribute', () => {
    expect(findNamePosition(foldForMatch('X marks the spot'), 'X')).toBe(-1);
  });
});

describe('detectBrandMentions', () => {
  it('detects your brand and competitors, once each, ordered by appearance', () => {
    const answer = 'For running shoes, Nike and Adidas lead, though Hoka is rising fast.';
    const res = detectBrandMentions(answer, [
      tracked('me', 'Hoka'),
      comp('c1', 'Nike'),
      comp('c2', 'Adidas'),
    ]);
    expect(res.map((r) => r.id)).toEqual(['c1', 'c2', 'me']); // Nike < Adidas < Hoka by position
    expect(res.filter((r) => r.kind === 'tracked')).toHaveLength(1);
  });

  it('flags a tracked brand as recommended only within the top N appearances', () => {
    const answer = 'Nike, Adidas, and Puma are classic; our pick Hoka comes fourth.';
    const res = detectBrandMentions(
      answer,
      [tracked('me', 'Hoka'), comp('c1', 'Nike'), comp('c2', 'Adidas'), comp('c3', 'Puma')],
      { recommendedTopN: 3 },
    );
    const me = res.find((r) => r.id === 'me')!;
    expect(me.rank).toBe(3);
    expect(me.isRecommended).toBe(false); // 4th place → not a top-3 recommendation
  });

  it('marks the tracked brand recommended when it appears first', () => {
    const answer = 'Hoka is our top pick, ahead of Nike and Adidas.';
    const res = detectBrandMentions(answer, [tracked('me', 'Hoka'), comp('c1', 'Nike')]);
    const me = res.find((r) => r.id === 'me')!;
    expect(me.rank).toBe(0);
    expect(me.isRecommended).toBe(true);
  });

  it('never marks a competitor as recommended', () => {
    const answer = 'Nike is the clear leader here.';
    const res = detectBrandMentions(answer, [tracked('me', 'Hoka'), comp('c1', 'Nike')]);
    expect(res).toHaveLength(1);
    expect(res[0]!.id).toBe('c1');
    expect(res[0]!.isRecommended).toBe(false);
  });

  it('uses the earliest-appearing alias for a brand', () => {
    const answer = 'People say Big Blue, some still say IBM.';
    const res = detectBrandMentions(answer, [tracked('me', 'IBM', 'Big Blue')]);
    expect(res[0]!.name).toBe('Big Blue'); // appears before "IBM"
  });

  it('does not double-count a brand named twice', () => {
    const answer = 'Nike here, Nike there, Nike everywhere.';
    const res = detectBrandMentions(answer, [comp('c1', 'Nike')]);
    expect(res).toHaveLength(1);
  });

  it('avoids the substring false positive that inflated Share of Voice', () => {
    // Competitor "Ora" must NOT be counted from "decoration" — the exact bug that corrupted SoV.
    const answer = 'These decoration and storage tips help; our brand Lumen is featured.';
    const res = detectBrandMentions(answer, [tracked('me', 'Lumen'), comp('c1', 'Ora')]);
    expect(res.map((r) => r.id)).toEqual(['me']); // Ora not falsely detected
  });

  it('returns an empty list when nothing matches', () => {
    expect(detectBrandMentions('No brands mentioned at all.', [tracked('me', 'Hoka')])).toEqual([]);
    expect(detectBrandMentions('', [tracked('me', 'Hoka')])).toEqual([]);
  });
});

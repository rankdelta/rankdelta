import { describe, expect, it } from 'vitest';
import {
  competitionOf,
  competitionPct,
  monthlyVolumes,
  posDistribution,
  posDistributionTotal,
  rankDeltaOf,
  serpItemFeatures,
  serpTypesToFeatures,
} from './labsMetrics';

describe('posDistribution', () => {
  it('reads the full-index buckets DataForSEO already returns on domain overview', () => {
    const p = posDistribution({
      pos_1: 11,
      pos_2_3: 28,
      pos_4_10: 100,
      pos_11_20: 135,
      pos_21_30: 157,
      pos_31_40: 174,
      pos_91_100: 126,
      is_new: 661,
      is_up: 757,
      is_down: 418,
      is_lost: 547,
    });
    expect(p.pos1).toBe(11);
    expect(p.pos2_3).toBe(28);
    expect(p.pos4_10).toBe(100);
    expect(p.pos11_20).toBe(135);
    expect(p.pos21plus).toBe(157 + 174 + 126);
    expect(p.isNew).toBe(661);
    expect(posDistributionTotal(p)).toBe(11 + 28 + 100 + 135 + 157 + 174 + 126);
  });
});

describe('rankDeltaOf', () => {
  it('uses previous − current so a move 7 → 4 is +3 (improved)', () => {
    const d = rankDeltaOf({ rank_changes: { previous_rank_absolute: 7, is_up: true } }, 4);
    expect(d.previous).toBe(7);
    expect(d.delta).toBe(3);
    expect(d.isUp).toBe(true);
    expect(d.isNew).toBe(false);
  });

  it('marks new rankings', () => {
    const d = rankDeltaOf({ rank_changes: { is_new: true, previous_rank_absolute: null } }, 9);
    expect(d.isNew).toBe(true);
    expect(d.delta).toBeNull();
  });
});

describe('monthlyVolumes / competition / features', () => {
  it('sorts monthly_searches oldest to newest and keeps the last 12', () => {
    expect(monthlyVolumes({
      monthly_searches: [
        { year: 2026, month: 2, search_volume: 200 },
        { year: 2026, month: 1, search_volume: 100 },
        { year: 2025, month: 12, search_volume: 90 },
      ],
    })).toEqual([90, 100, 200]);
  });

  it('shows paid competition as 0–100', () => {
    expect(competitionPct(0.42)).toBe(42);
    expect(competitionPct(80)).toBe(80);
  });

  it('collects SERP feature flags already on the ranked element', () => {
    expect(serpItemFeatures({ is_featured_snippet: true, is_video: true })).toEqual(['snippet', 'video']);
  });

  it('reads SERP feature flags from checks with legacy fallback', () => {
    expect(serpItemFeatures({ checks: { is_featured_snippet: true, is_video: true } })).toEqual(['snippet', 'video']);
    expect(serpItemFeatures({ checks: { is_image: true, is_news: true, is_shopping: true } })).toEqual(['image', 'news', 'shopping']);
    expect(serpItemFeatures({ is_news: true })).toEqual(['news']);
  });

  it('maps keyword_suggestions serp_item_types without duplicating', () => {
    expect(serpTypesToFeatures([
      'organic', 'featured_snippet', 'people_also_ask', 'ai_overview', 'images', 'featured_snippet',
    ])).toEqual(['snippet', 'paa', 'ai', 'image']);
  });

  it('prefers competition_index over the 0–1 competition float', () => {
    expect(competitionOf({ competition_index: 67, competition: 0.42 })).toBe(67);
    expect(competitionOf({ competition: 0.42 })).toBe(0.42);
  });
});

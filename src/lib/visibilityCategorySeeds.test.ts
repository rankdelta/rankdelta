import { describe, expect, it } from 'vitest';
import { buildCategorySeeds } from '../../supabase/functions/visibility-ops/category_seeds';

describe('buildCategorySeeds', () => {
  it('merges seed_keywords with primary_keyword and main_topic, deduped', () => {
    expect(
      buildCategorySeeds({
        seed_keywords: ['pour-over coffee'],
        primary_keyword: 'coffee dripper kit',
        main_topic: 'pour-over coffee',
      }),
    ).toEqual(['pour-over coffee', 'coffee dripper kit']);
  });

  it('uses primary_keyword and main_topic when seed_keywords is empty', () => {
    expect(
      buildCategorySeeds({
        seed_keywords: [],
        primary_keyword: 'pour-over coffee kit',
        main_topic: 'coffee accessories',
      }),
    ).toEqual(['pour-over coffee kit', 'coffee accessories']);
  });

  it('ignores blank and non-string values', () => {
    expect(
      buildCategorySeeds({
        seed_keywords: ['  ', 'valid seed'],
        primary_keyword: '  keyword  ',
        main_topic: null,
      }),
    ).toEqual(['valid seed', 'keyword']);
  });

  it('returns empty array when no category signals exist', () => {
    expect(buildCategorySeeds({ seed_keywords: null, primary_keyword: '', main_topic: undefined })).toEqual(
      [],
    );
  });
});

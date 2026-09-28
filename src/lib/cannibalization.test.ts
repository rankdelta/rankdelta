import { describe, expect, it, vi } from 'vitest';
import {
  analyzeStoredSnapshots,
  applyKeywordCap,
  classifySeverity,
  DATAFORSEO_SERP_LIVE_ADVANCED,
  DEFAULT_MAX_KEYWORDS_PER_CHECK,
  estimateRefreshUsd,
  executeCannibalization,
  extractSiteHitsFromRawResponse,
  readMaxKeywordsPerCheck,
  recommendationFor,
  refreshKeywordsViaSerp,
  resolveExecutionMode,
  sameIntentCluster,
  type RankKeywordInput,
  type RankSnapshotInput,
} from '../../supabase/functions/_shared/cannibalization';

function dfsRaw(items: Array<{ url: string; position: number }>): unknown {
  return {
    tasks: [
      {
        status_code: 20000,
        cost: 0.02,
        result: [
          {
            items: items.map((it) => ({
              type: 'organic',
              url: it.url,
              rank_absolute: it.position,
              rank_group: it.position,
            })),
          },
        ],
      },
    ],
  };
}

function snap(
  keywordId: string,
  items: Array<{ url: string; position: number }>,
  checkedAt = '2026-08-01T00:00:00.000Z',
): RankSnapshotInput {
  return {
    keyword_id: keywordId,
    rank_absolute: items[0]?.position ?? null,
    ranking_url: items[0]?.url ?? null,
    raw_response: dfsRaw(items),
    status: 'completed',
    checked_at: checkedAt,
  };
}

const SITE = 'https://example.com';
const NOW = new Date('2026-08-20T00:00:00.000Z');

describe('grouping: ≥2 distinct site URLs in top 100', () => {
  it('emits one item when two site URLs rank for the same keyword', () => {
    const items = analyzeStoredSnapshots({
      keywords: [{ id: 'k1', phrase: 'best crm software' }],
      snapshots: [
        snap('k1', [
          { url: 'https://example.com/blog/crm', position: 4 },
          { url: 'https://example.com/guides/crm-software', position: 12 },
          { url: 'https://other.com/crm', position: 2 },
        ]),
      ],
      siteUrl: SITE,
      days: 90,
      now: NOW,
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.keyword).toBe('best crm software');
    expect(items[0]!.urls).toEqual([
      'https://example.com/blog/crm',
      'https://example.com/guides/crm-software',
    ]);
    expect(items[0]!.best_position_each).toEqual([4, 12]);
  });

  it('does not emit when only one site URL ranks', () => {
    const items = analyzeStoredSnapshots({
      keywords: [{ id: 'k1', phrase: 'best crm software' }],
      snapshots: [snap('k1', [{ url: 'https://example.com/blog/crm', position: 4 }])],
      siteUrl: SITE,
      days: 90,
      now: NOW,
    });
    expect(items).toEqual([]);
  });

  it('canonicalizes www / trailing slash so the same page is not double-counted', () => {
    const items = analyzeStoredSnapshots({
      keywords: [{ id: 'k1', phrase: 'crm' }],
      snapshots: [
        snap('k1', [
          { url: 'https://www.example.com/blog/crm/', position: 4 },
          { url: 'https://example.com/blog/crm', position: 8 },
        ]),
      ],
      siteUrl: SITE,
      days: 90,
      now: NOW,
    });
    expect(items).toEqual([]);
  });

  it('falls back to ranking_url when raw_response is missing', () => {
    const items = analyzeStoredSnapshots({
      keywords: [{ id: 'k1', phrase: 'crm software guide' }],
      snapshots: [
        {
          keyword_id: 'k1',
          rank_absolute: 40,
          ranking_url: 'https://example.com/blog/crm-software',
          raw_response: null,
          status: 'completed',
          checked_at: '2026-08-01T00:00:00.000Z',
        },
        {
          keyword_id: 'k1',
          rank_absolute: 55,
          ranking_url: 'https://example.com/guides/crm-software',
          raw_response: null,
          status: 'completed',
          checked_at: '2026-08-10T00:00:00.000Z',
        },
      ],
      siteUrl: SITE,
      days: 90,
      now: NOW,
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.severity).toBe('LOW');
  });
});

describe('severity thresholds', () => {
  it('HIGH when both URLs are top-20 → consolidate', () => {
    expect(classifySeverity([4, 18], 'kw', ['https://a.com/x', 'https://a.com/y'])).toBe('HIGH');
    expect(recommendationFor('HIGH')).toBe('consolidate into stronger URL');
  });

  it('MEDIUM when one is top-10 and one is 11–30 → internal-link', () => {
    expect(classifySeverity([7, 24], 'kw', ['https://a.com/x', 'https://a.com/y'])).toBe('MEDIUM');
    expect(recommendationFor('MEDIUM')).toBe('internal-link from weaker to stronger');
  });

  it('LOW when both are below 30 and URL paths share intent tokens → differentiate', () => {
    expect(
      classifySeverity(
        [41, 58],
        'best crm software',
        ['https://example.com/blog/crm-software', 'https://example.com/guides/crm-software'],
      ),
    ).toBe('LOW');
    expect(recommendationFor('LOW')).toBe('differentiate intent');
  });

  it('omits LOW when both are below 30 but paths do not share intent', () => {
    expect(
      classifySeverity(
        [41, 58],
        'best crm software',
        ['https://example.com/about', 'https://example.com/contact'],
      ),
    ).toBeNull();
  });

  it('does not classify 5 + 50 as any severity (outside the three rules)', () => {
    expect(classifySeverity([5, 50], 'kw', ['https://a.com/x', 'https://a.com/y'])).toBeNull();
  });
});

describe('token-overlap intent cluster (no LLM)', () => {
  it('clusters overlapping slugs', () => {
    expect(
      sameIntentCluster('best crm software', [
        'https://example.com/blog/crm-software',
        'https://example.com/guides/crm-software-comparison',
      ]),
    ).toBe(true);
  });

  it('does not cluster unrelated paths', () => {
    expect(
      sameIntentCluster('best crm software', [
        'https://example.com/about',
        'https://example.com/contact',
      ]),
    ).toBe(false);
  });
});

describe('extractSiteHitsFromRawResponse', () => {
  it('keeps only this site\'s organic URLs in the top 100', () => {
    const hits = extractSiteHitsFromRawResponse(
      dfsRaw([
        { url: 'https://example.com/a', position: 3 },
        { url: 'https://rival.com/a', position: 4 },
        { url: 'https://example.com/b', position: 101 },
        { url: 'https://blog.example.com/c', position: 9 },
      ]),
      SITE,
    );
    expect(hits.map((h) => h.url)).toEqual([
      'https://example.com/a',
      'https://blog.example.com/c',
    ]);
  });
});

describe('dry-run no-execution guarantee', () => {
  it('returns count + estimated USD, cost_usd 0, and never calls refreshSerp', async () => {
    const refreshSerp = vi.fn(async () => {
      throw new Error('SERP must not run in dry_run');
    });
    const keywords: RankKeywordInput[] = [
      { id: 'k1', phrase: 'a' },
      { id: 'k2', phrase: 'b' },
      { id: 'k3', phrase: 'c' },
    ];
    const out = await executeCannibalization({
      siteId: 'site-1',
      engine: 'google',
      days: 90,
      refresh: true,
      dryRun: true,
      maxKeywordsPerCheck: 100,
      siteUrl: SITE,
      keywords,
      snapshots: [snap('k1', [{ url: 'https://example.com/a', position: 4 }])],
      refreshSerp,
    });
    expect(refreshSerp).not.toHaveBeenCalled();
    expect(out.dry_run).toBe(true);
    expect(out.executed).toBe(false);
    expect(out.mode).toBe('dry_run');
    expect(out.keyword_count).toBe(3);
    expect(out.estimated_usd).toBe(estimateRefreshUsd(3));
    expect(out.cost_usd).toBe(0);
    expect(out.items).toEqual([]);
  });

  it('dry_run wins over refresh in resolveExecutionMode', () => {
    expect(resolveExecutionMode(true, true)).toBe('dry_run');
    expect(resolveExecutionMode(true, false)).toBe('refresh');
    expect(resolveExecutionMode(false, false)).toBe('stored');
  });
});

describe('plan cap enforcement (max_keywords_per_check)', () => {
  it('defaults to 100 and slices overflow', () => {
    expect(readMaxKeywordsPerCheck({})).toBe(DEFAULT_MAX_KEYWORDS_PER_CHECK);
    const many = Array.from({ length: 150 }, (_, i) => ({ id: `k${i}`, phrase: `kw ${i}` }));
    const { selected, capped, total } = applyKeywordCap(many, 100);
    expect(total).toBe(150);
    expect(selected).toHaveLength(100);
    expect(capped).toBe(true);
    expect(selected[0]!.id).toBe('k0');
    expect(selected[99]!.id).toBe('k99');
  });

  it('reads project metadata override then plan value', () => {
    expect(readMaxKeywordsPerCheck({ projectMetadata: { max_keywords_per_check: 250 } })).toBe(250);
    expect(readMaxKeywordsPerCheck({ planValue: 80 })).toBe(80);
    expect(
      readMaxKeywordsPerCheck({ projectMetadata: { max_keywords_per_check: 40 }, planValue: 200 }),
    ).toBe(40);
  });

  it('executeCannibalization only analyzes / refreshes the capped set', async () => {
    const keywords = Array.from({ length: 150 }, (_, i) => ({ id: `k${i}`, phrase: `phrase ${i}` }));
    const snapshots = keywords.map((k, i) =>
      snap(k.id, [
        { url: `https://example.com/page-${i}-a`, position: 4 },
        { url: `https://example.com/page-${i}-b`, position: 11 },
      ]),
    );
    const refreshSerp = vi.fn(async (selected: RankKeywordInput[]) => ({
      costUsd: 0,
      snapshots: [],
      httpCalls: 0,
      selected,
    }));

    const stored = await executeCannibalization({
      siteId: 'site-1',
      maxKeywordsPerCheck: 100,
      siteUrl: SITE,
      keywords,
      snapshots,
      now: NOW,
      limit: 200,
    });
    expect(stored.keywords_total).toBe(150);
    expect(stored.keywords_capped).toBe(true);
    expect(stored.keywords_considered).toBe(100);
    expect(stored.cost_usd).toBe(0);
    expect(stored.items.length).toBeLessThanOrEqual(100);

    const refreshed = await executeCannibalization({
      siteId: 'site-1',
      refresh: true,
      maxKeywordsPerCheck: 100,
      siteUrl: SITE,
      keywords,
      snapshots,
      now: NOW,
      refreshSerp,
    });
    expect(refreshSerp).toHaveBeenCalledTimes(1);
    expect(refreshSerp.mock.calls[0]![0]).toHaveLength(100);
    expect(refreshed.keywords_considered).toBe(100);
  });
});

describe('default stored mode cost', () => {
  it('always returns cost_usd 0.0 and does not refresh', async () => {
    const refreshSerp = vi.fn(async () => ({ costUsd: 9.99, snapshots: [], httpCalls: 1 }));
    const out = await executeCannibalization({
      siteId: 'site-1',
      siteUrl: SITE,
      keywords: [{ id: 'k1', phrase: 'crm software' }],
      snapshots: [
        snap('k1', [
          { url: 'https://example.com/blog/crm-software', position: 3 },
          { url: 'https://example.com/guides/crm-software', position: 8 },
        ]),
      ],
      now: NOW,
      refreshSerp,
    });
    expect(refreshSerp).not.toHaveBeenCalled();
    expect(out.mode).toBe('stored');
    expect(out.cost_usd).toBe(0);
    expect(out.executed).toBe(false);
    expect(out.items[0]!.severity).toBe('HIGH');
  });
});

describe('refreshKeywordsViaSerp — one batched call', () => {
  it('issues exactly one HTTP POST with every affected keyword', async () => {
    const fetchFn = vi.fn(async () => ({
      json: async () => ({
        cost: 0.05,
        tasks: [
          { status_code: 20000, cost: 0.025, result: [{ items: [] }] },
          { status_code: 20000, cost: 0.025, result: [{ items: [] }] },
        ],
      }),
    }));
    const result = await refreshKeywordsViaSerp({
      fetchFn: fetchFn as unknown as typeof fetch,
      login: 'user',
      password: 'pass',
      keywords: [
        { id: 'k1', phrase: 'alpha' },
        { id: 'k2', phrase: 'beta' },
      ],
      languageCode: 'en',
      locationCode: 2840,
      siteUrl: SITE,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.httpCalls).toBe(1);
    expect(result.costUsd).toBe(0.05);
    const calls = fetchFn.mock.calls as unknown as Array<[string, RequestInit]>;
    const call = calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe(DATAFORSEO_SERP_LIVE_ADVANCED);
    const body = JSON.parse(String((init as RequestInit).body)) as Array<{ keyword: string; depth: number }>;
    expect(body).toHaveLength(2);
    expect(body[0]!.keyword).toBe('alpha');
    expect(body[1]!.keyword).toBe('beta');
    expect(body[0]!.depth).toBe(100);
  });

  it('does not call the network when the keyword list is empty', async () => {
    const fetchFn = vi.fn();
    const result = await refreshKeywordsViaSerp({
      fetchFn: fetchFn as unknown as typeof fetch,
      login: 'user',
      password: 'pass',
      keywords: [],
      languageCode: 'en',
      locationCode: 2840,
      siteUrl: SITE,
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.httpCalls).toBe(0);
    expect(result.costUsd).toBe(0);
  });
});

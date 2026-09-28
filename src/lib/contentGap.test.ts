import { describe, expect, it } from 'vitest';
import {
  analyzeContentGaps,
  buildContentGapResponse,
  CONTENT_GAP_COST_USD,
  extractOrganicHits,
  latestSnapshotPerKeyword,
  type RankKeywordInput,
  type RankSnapshotInput,
} from '../../supabase/functions/_shared/contentGap';

function dfsRaw(items: Array<{ url: string; position: number; domain?: string; type?: string }>): unknown {
  return {
    tasks: [
      {
        status_code: 20000,
        result: [
          {
            items: items.map((it) => ({
              type: it.type ?? 'organic',
              url: it.url,
              domain: it.domain,
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
  items: Array<{ url: string; position: number; domain?: string; type?: string }>,
  extra: Partial<RankSnapshotInput> = {},
): RankSnapshotInput {
  return {
    keyword_id: keywordId,
    rank_absolute: items.find((i) => i.url.includes('oursite.com'))?.position ?? null,
    ranking_url: items.find((i) => i.url.includes('oursite.com'))?.url ?? null,
    raw_response: dfsRaw(items),
    status: 'completed',
    checked_at: '2026-08-01T00:00:00.000Z',
    ...extra,
  };
}

const SITE = 'https://oursite.com';
const COMPETITOR = 'rival.com';
const KW: RankKeywordInput[] = [{ id: 'k1', phrase: 'best crm software' }];

describe('extractOrganicHits', () => {
  it('keeps organic rows and drops featured-snippet / people-also-ask', () => {
    const hits = extractOrganicHits(
      dfsRaw([
        { url: 'https://rival.com/crm', position: 3, type: 'organic' },
        { url: 'https://rival.com/faq', position: 1, type: 'people_also_ask' },
      ]),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.url).toBe('https://rival.com/crm');
  });
});

describe('content-gap join/filter', () => {
  it('includes a keyword where competitor is top-20 and the site is absent from top-100', () => {
    const items = analyzeContentGaps({
      keywords: KW,
      snapshots: [
        snap('k1', [
          { url: 'https://rival.com/guides/crm', position: 4, domain: 'rival.com' },
          { url: 'https://other.com/crm', position: 8 },
        ]),
      ],
      siteUrl: SITE,
      competitorDomain: COMPETITOR,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      keyword: 'best crm software',
      competitor_url: 'https://rival.com/guides/crm',
      competitor_position: 4,
      est_volume_if_stored: null,
    });
  });

  it('excludes when the competitor is position 21 (not top-20)', () => {
    const items = analyzeContentGaps({
      keywords: KW,
      snapshots: [snap('k1', [{ url: 'https://rival.com/crm', position: 21 }])],
      siteUrl: SITE,
      competitorDomain: COMPETITOR,
    });
    expect(items).toEqual([]);
  });

  it('excludes when the site also ranks in the top 100', () => {
    const items = analyzeContentGaps({
      keywords: KW,
      snapshots: [
        snap('k1', [
          { url: 'https://rival.com/crm', position: 6 },
          { url: 'https://oursite.com/blog/crm', position: 44 },
        ]),
      ],
      siteUrl: SITE,
      competitorDomain: COMPETITOR,
    });
    expect(items).toEqual([]);
  });

  it('treats www / subdomain of the site as a site ranking (not a gap)', () => {
    const items = analyzeContentGaps({
      keywords: KW,
      snapshots: [
        snap('k1', [
          { url: 'https://rival.com/crm', position: 2 },
          { url: 'https://www.oursite.com/crm', position: 90 },
        ]),
      ],
      siteUrl: SITE,
      competitorDomain: COMPETITOR,
    });
    expect(items).toEqual([]);
  });

  it('matches a competitor subdomain as the competitor', () => {
    const items = analyzeContentGaps({
      keywords: KW,
      snapshots: [snap('k1', [{ url: 'https://docs.rival.com/crm', position: 11, domain: 'docs.rival.com' }])],
      siteUrl: SITE,
      competitorDomain: COMPETITOR,
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.competitor_url).toBe('https://docs.rival.com/crm');
    expect(items[0]!.competitor_position).toBe(11);
  });

  it('uses only the latest snapshot per keyword', () => {
    const items = analyzeContentGaps({
      keywords: KW,
      snapshots: [
        snap(
          'k1',
          [{ url: 'https://rival.com/old', position: 3 }],
          { checked_at: '2026-07-01T00:00:00.000Z' },
        ),
        snap(
          'k1',
          [
            { url: 'https://rival.com/new', position: 5 },
            { url: 'https://oursite.com/now-ranking', position: 12 },
          ],
          { checked_at: '2026-08-10T00:00:00.000Z' },
        ),
      ],
      siteUrl: SITE,
      competitorDomain: COMPETITOR,
    });
    expect(items).toEqual([]);
  });

  it('ignores failed snapshots', () => {
    const items = analyzeContentGaps({
      keywords: KW,
      snapshots: [
        snap('k1', [{ url: 'https://rival.com/crm', position: 2 }], { status: 'failed' }),
      ],
      siteUrl: SITE,
      competitorDomain: COMPETITOR,
    });
    expect(items).toEqual([]);
  });

  it('falls back to rank_absolute when raw_response has no organic items', () => {
    const items = analyzeContentGaps({
      keywords: KW,
      snapshots: [
        {
          keyword_id: 'k1',
          rank_absolute: 7,
          ranking_url: 'https://oursite.com/crm',
          raw_response: { tasks: [{ result: [{ items: [] }] }] },
          status: 'completed',
          checked_at: '2026-08-01T00:00:00.000Z',
        },
      ],
      siteUrl: SITE,
      competitorDomain: COMPETITOR,
    });
    expect(items).toEqual([]);
  });

  it('sorts by stored volume desc when any volume is present', () => {
    const items = analyzeContentGaps({
      keywords: [
        { id: 'k1', phrase: 'low volume' },
        { id: 'k2', phrase: 'high volume' },
        { id: 'k3', phrase: 'no volume' },
      ],
      snapshots: [
        snap('k1', [{ url: 'https://rival.com/a', position: 2 }]),
        snap('k2', [{ url: 'https://rival.com/b', position: 8 }]),
        snap('k3', [{ url: 'https://rival.com/c', position: 1 }]),
      ],
      siteUrl: SITE,
      competitorDomain: COMPETITOR,
      volumes: new Map([
        ['low volume', 100],
        ['high volume', 9000],
      ]),
    });
    expect(items.map((i) => i.keyword)).toEqual(['high volume', 'low volume', 'no volume']);
    expect(items[0]!.est_volume_if_stored).toBe(9000);
  });

  it('sorts by competitor position when no volumes are stored', () => {
    const items = analyzeContentGaps({
      keywords: [
        { id: 'k1', phrase: 'later' },
        { id: 'k2', phrase: 'sooner' },
      ],
      snapshots: [
        snap('k1', [{ url: 'https://rival.com/a', position: 14 }]),
        snap('k2', [{ url: 'https://rival.com/b', position: 3 }]),
      ],
      siteUrl: SITE,
      competitorDomain: COMPETITOR,
    });
    expect(items.map((i) => i.keyword)).toEqual(['sooner', 'later']);
  });

  it('respects limit', () => {
    const keywords = [1, 2, 3].map((n) => ({ id: `k${n}`, phrase: `kw ${n}` }));
    const items = analyzeContentGaps({
      keywords,
      snapshots: keywords.map((k, i) => snap(k.id, [{ url: 'https://rival.com/x', position: i + 1 }])),
      siteUrl: SITE,
      competitorDomain: COMPETITOR,
      limit: 2,
    });
    expect(items).toHaveLength(2);
  });
});

describe('buildContentGapResponse', () => {
  it('always reports cost_usd 0 and never fabricates rows', () => {
    const res = buildContentGapResponse({
      siteId: 'site-1',
      competitorDomain: 'https://www.rival.com/about',
      keywords: KW,
      snapshots: [],
      siteUrl: SITE,
    });
    expect(res.cost_usd).toBe(CONTENT_GAP_COST_USD);
    expect(res.cost_usd).toBe(0);
    expect(res.items).toEqual([]);
    expect(res.competitor_domain).toBe('rival.com');
    expect(res.data_source).toBe('serp_rank_snapshots');
  });
});

describe('latestSnapshotPerKeyword', () => {
  it('prefers the newest completed snapshot', () => {
    const map = latestSnapshotPerKeyword([
      snap('k1', [{ url: 'https://a.com', position: 1 }], { checked_at: '2026-01-01T00:00:00.000Z' }),
      snap('k1', [{ url: 'https://b.com', position: 2 }], { checked_at: '2026-08-01T00:00:00.000Z' }),
    ]);
    expect(extractOrganicHits(map.get('k1')!.raw_response)[0]!.url).toBe('https://b.com');
  });
});

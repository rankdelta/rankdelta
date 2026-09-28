import { describe, expect, it } from 'vitest';
import {
  ACTION_HINT,
  coverageOf,
  DFS_BACKLINKS_REQUEST_USD,
  DFS_BACKLINKS_ROW_USD,
  DFS_DOMAIN_INTERSECTION_ENDPOINT,
  estimateBacklinksLiveUsd,
  executeLinkIntersect,
  extractReferringDomainRows,
  intersectReferringDomains,
  LINK_INTERSECT_COST_USD,
  resolveExecutionMode,
  type StoredReferringDomainRow,
} from '../../supabase/functions/_shared/linkIntersect';

const SITE = 'oursite.com';
const COMP = 'rival.com';

function row(
  target: string,
  ref: string,
  extra: Partial<StoredReferringDomainRow> = {},
): StoredReferringDomainRow {
  return {
    target_domain: target,
    referring_domain: ref,
    referring_rank: extra.referring_rank ?? 40,
    links_to_target: extra.links_to_target ?? 3,
    sample_target_urls: extra.sample_target_urls ?? [`https://${target}/page`],
  };
}

describe('intersectReferringDomains join/filter', () => {
  it('keeps domains that link to the competitor but not to the site', () => {
    const items = intersectReferringDomains({
      siteDomain: SITE,
      competitorDomain: COMP,
      rows: [
        row(COMP, 'nytimes.com', { referring_rank: 90, links_to_target: 4, sample_target_urls: ['https://rival.com/press'] }),
        row(SITE, 'oursite-friend.com', { referring_rank: 20 }),
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      referring_domain: 'nytimes.com',
      links_to_competitor: 4,
      sample_target_urls: ['https://rival.com/press'],
      action_hint: ACTION_HINT,
      referring_rank: 90,
    });
    expect(items[0]!.action_hint).toBe('outreach prospect');
  });

  it('excludes a referring domain that already links to the site', () => {
    const items = intersectReferringDomains({
      siteDomain: SITE,
      competitorDomain: COMP,
      rows: [row(COMP, 'forbes.com', { referring_rank: 80 }), row(SITE, 'forbes.com', { referring_rank: 10 })],
    });
    expect(items).toEqual([]);
  });

  it('normalizes www / protocol so the same referrer is not double-counted', () => {
    const items = intersectReferringDomains({
      siteDomain: 'https://www.oursite.com',
      competitorDomain: 'https://rival.com/about',
      rows: [
        row('www.rival.com', 'https://www.TechCrunch.com/x', { referring_rank: 70 }),
        row('https://oursite.com', 'techcrunch.com'),
      ],
    });
    expect(items).toEqual([]);
  });

  it('ranks by competitor referring-domain authority (rank desc)', () => {
    const items = intersectReferringDomains({
      siteDomain: SITE,
      competitorDomain: COMP,
      rows: [
        row(COMP, 'low-auth.com', { referring_rank: 12, links_to_target: 99 }),
        row(COMP, 'high-auth.com', { referring_rank: 88, links_to_target: 1 }),
        row(SITE, 'oursite-friend.com'),
      ],
    });
    expect(items.map((i) => i.referring_domain)).toEqual(['high-auth.com', 'low-auth.com']);
  });

  it('drops the site and competitor themselves as referring domains', () => {
    const items = intersectReferringDomains({
      siteDomain: SITE,
      competitorDomain: COMP,
      rows: [row(COMP, SITE), row(COMP, COMP), row(SITE, 'friend.com')],
    });
    expect(items).toEqual([]);
  });

  it('does not fabricate prospects when only site-side rows exist', () => {
    const items = intersectReferringDomains({
      siteDomain: SITE,
      competitorDomain: COMP,
      rows: [row(SITE, 'friend.com')],
    });
    expect(items).toEqual([]);
  });
});

describe('executeLinkIntersect cost + dry_run', () => {
  const covered: StoredReferringDomainRow[] = [
    row(COMP, 'prospect.com', { referring_rank: 55, links_to_target: 2, sample_target_urls: ['https://rival.com/a'] }),
    row(SITE, 'friend.com'),
  ];

  it('default stored mode returns items and cost_usd 0', () => {
    const res = executeLinkIntersect({
      siteId: 'p1',
      siteDomain: SITE,
      competitorDomain: COMP,
      rows: covered,
    });
    expect(res.cost_usd).toBe(LINK_INTERSECT_COST_USD);
    expect(res.cost_usd).toBe(0);
    expect(res.executed).toBe(false);
    expect(res.mode).toBe('stored');
    expect(res.coverage).toBe('ok');
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.referring_domain).toBe('prospect.com');
  });

  it('missing competitor coverage returns no items and does not invent data', () => {
    const res = executeLinkIntersect({
      siteId: 'p1',
      siteDomain: SITE,
      competitorDomain: COMP,
      rows: [row(SITE, 'friend.com')],
    });
    expect(res.coverage).toBe('missing_competitor');
    expect(res.items).toEqual([]);
    expect(res.cost_usd).toBe(0);
    expect(res.note).toContain('domain_intersection');
    expect(res.note).not.toContain('LINK-INTERSECT-FEASIBILITY');
  });

  it('missing both sides is reported honestly', () => {
    const res = executeLinkIntersect({
      siteId: 'p1',
      siteDomain: SITE,
      competitorDomain: COMP,
      rows: [],
    });
    expect(res.coverage).toBe('missing_both');
    expect(res.items).toEqual([]);
    expect(res.cost_usd).toBe(0);
  });

  it('missing site-side coverage refuses to emit prospects (cannot prove NOT-to-site)', () => {
    const res = executeLinkIntersect({
      siteId: 'p1',
      siteDomain: SITE,
      competitorDomain: COMP,
      rows: [row(COMP, 'prospect.com')],
    });
    expect(res.coverage).toBe('missing_site');
    expect(res.items).toEqual([]);
    expect(res.cost_usd).toBe(0);
  });

  it('dry_run returns an estimate and executes nothing even when coverage exists', () => {
    const res = executeLinkIntersect({
      siteId: 'p1',
      siteDomain: SITE,
      competitorDomain: COMP,
      rows: covered,
      dryRun: true,
      estimateRows: 100,
    });
    expect(res.mode).toBe('dry_run');
    expect(res.dry_run).toBe(true);
    expect(res.executed).toBe(false);
    expect(res.items).toEqual([]);
    expect(res.cost_usd).toBe(0);
    expect(res.estimated_usd).toBe(estimateBacklinksLiveUsd(100));
    expect(res.estimate_endpoint).toBe(DFS_DOMAIN_INTERSECTION_ENDPOINT);
    expect(res.note).toContain('DRY RUN');
  });

  it('refresh=true is refused (not a trivial stored refresh) and never spends', () => {
    const res = executeLinkIntersect({
      siteId: 'p1',
      siteDomain: SITE,
      competitorDomain: COMP,
      rows: covered,
      refresh: true,
    });
    expect(res.mode).toBe('refresh_refused');
    expect(res.executed).toBe(false);
    expect(res.items).toEqual([]);
    expect(res.cost_usd).toBe(0);
    expect(res.note).toContain('refused');
  });

  it('dry_run wins over refresh (estimate first, execute never)', () => {
    expect(resolveExecutionMode(true, true)).toBe('dry_run');
    const res = executeLinkIntersect({
      siteId: 'p1',
      siteDomain: SITE,
      competitorDomain: COMP,
      rows: covered,
      refresh: true,
      dryRun: true,
    });
    expect(res.mode).toBe('dry_run');
    expect(res.executed).toBe(false);
  });
});

describe('pricing helpers', () => {
  it('matches DataForSEO Backlinks pay-as-you-go: $0.024 + $0.000036/row', () => {
    expect(estimateBacklinksLiveUsd(1000)).toBe(
      Math.round((DFS_BACKLINKS_REQUEST_USD + DFS_BACKLINKS_ROW_USD * 1000) * 1_000_000) / 1_000_000,
    );
    expect(estimateBacklinksLiveUsd(1000)).toBe(0.06);
    expect(estimateBacklinksLiveUsd(50)).toBe(0.0258);
  });
});

describe('coverageOf', () => {
  it('classifies the four coverage states', () => {
    expect(coverageOf(1, 1)).toBe('ok');
    expect(coverageOf(1, 0)).toBe('missing_competitor');
    expect(coverageOf(0, 1)).toBe('missing_site');
    expect(coverageOf(0, 0)).toBe('missing_both');
  });
});

describe('extractReferringDomainRows (persist parser)', () => {
  it('parses referring_domains/live items', () => {
    const rows = extractReferringDomainRows(
      '/backlinks/referring_domains/live',
      { target: 'https://www.rival.com' },
      {
        tasks: [
          {
            result: [
              {
                items: [
                  { domain: 'nytimes.com', rank: 91, backlinks: 6 },
                  { domain: 'forbes.com', rank: 80, backlinks: 2 },
                ],
              },
            ],
          },
        ],
      },
    );
    expect(rows).toEqual([
      {
        target_domain: 'rival.com',
        referring_domain: 'nytimes.com',
        referring_rank: 91,
        links_to_target: 6,
        sample_target_urls: [],
      },
      {
        target_domain: 'rival.com',
        referring_domain: 'forbes.com',
        referring_rank: 80,
        links_to_target: 2,
        sample_target_urls: [],
      },
    ]);
  });

  it('groups backlinks/live by domain_from and samples url_to', () => {
    const rows = extractReferringDomainRows(
      '/backlinks/backlinks/live',
      { target: 'rival.com' },
      {
        tasks: [
          {
            result: [
              {
                items: [
                  { domain_from: 'nytimes.com', url_to: 'https://rival.com/a', rank: 10 },
                  { domain_from: 'nytimes.com', url_to: 'https://rival.com/b', rank: 40 },
                ],
              },
            ],
          },
        ],
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.referring_domain).toBe('nytimes.com');
    expect(rows[0]!.links_to_target).toBe(2);
    expect(rows[0]!.sample_target_urls).toEqual(['https://rival.com/a', 'https://rival.com/b']);
    expect(rows[0]!.referring_rank).toBe(40);
  });

  it('returns [] for endpoints that are not persistable referring-domain lists', () => {
    expect(
      extractReferringDomainRows('/backlinks/summary/live', { target: 'rival.com' }, { tasks: [] }),
    ).toEqual([]);
  });
});

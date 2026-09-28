import { describe, expect, it } from 'vitest';
import {
  computeSourceGaps,
  domainMatchesAnyOwn,
  flattenCitedSources,
  normalizeGapDomain,
} from '../../supabase/functions/_shared/sourceGaps';

const cited = (domain: string, url?: string) => ({ domain, url: url ?? `https://${domain}/page` });

describe('flattenCitedSources', () => {
  it('accepts the run_query shape {url, domain} plus bare URL strings', () => {
    const flat = flattenCitedSources([
      { url: 'https://www.Nytimes.com/tech', domain: 'nytimes.com', title: 'A' },
      { url: 'https://blog.asana.com/x', domain: null },
      'https://www.monday.com/w/',
      { url: null, domain: '' },
      42,
    ]);
    expect(flat.map((r) => r.domain)).toEqual(['nytimes.com', 'blog.asana.com', 'monday.com']);
  });

  it('returns [] for null / non-array payloads', () => {
    expect(flattenCitedSources(null)).toEqual([]);
    expect(flattenCitedSources({})).toEqual([]);
  });
});

describe('own-domain matching', () => {
  it('treats www/protocol/subdomains as the site, not suffix collisions', () => {
    expect(normalizeGapDomain('https://www.Acme.io/pricing')).toBe('acme.io');
    expect(domainMatchesAnyOwn('docs.acme.io', ['acme.io'])).toBe(true);
    expect(domainMatchesAnyOwn('notacme.io', ['acme.io'])).toBe(false);
    expect(domainMatchesAnyOwn('acme.io', ['https://www.acme.io'])).toBe(true);
  });
});

describe('computeSourceGaps math', () => {
  // 10 citations: 2 on the site (acme.io), 5 nytimes, 3 asana.
  // your_share = 2/10 = 0.2
  // gap_score = citation_count * (1 - 0.2) = citation_count * 0.8
  const runs = [
    [cited('nytimes.com', 'https://nytimes.com/a'), cited('nytimes.com', 'https://nytimes.com/b'), cited('asana.com')],
    [cited('nytimes.com', 'https://nytimes.com/c'), cited('www.acme.io', 'https://www.acme.io/blog')],
    [
      cited('nytimes.com', 'https://nytimes.com/d'),
      cited('nytimes.com', 'https://nytimes.com/e'),
      cited('asana.com', 'https://asana.com/2'),
      cited('asana.com', 'https://asana.com/3'),
      cited('docs.acme.io', 'https://docs.acme.io/api'),
    ],
  ];

  const result = computeSourceGaps({
    siteId: 'site-1',
    ownDomains: ['https://www.acme.io'],
    citedSources: runs,
    limit: 20,
    windowDays: 30,
  });

  it('counts every stored citation and the owned share', () => {
    expect(result.total_citations).toBe(10);
    expect(result.your_citations).toBe(2);
    expect(result.your_share).toBeCloseTo(0.2);
    expect(result.site_id).toBe('site-1');
    expect(result.window_days).toBe(30);
  });

  it('sets gap_score = citations × (1 − your_share) and sorts desc', () => {
    expect(result.gaps.map((g) => g.domain)).toEqual(['nytimes.com', 'asana.com', 'acme.io', 'docs.acme.io']);
    expect(result.gaps[0]).toMatchObject({
      domain: 'nytimes.com',
      citation_count: 5,
      your_presence: false,
      gap_score: 4, // 5 * 0.8
    });
    expect(result.gaps[1]).toMatchObject({
      domain: 'asana.com',
      citation_count: 3,
      your_presence: false,
      gap_score: 2.4, // 3 * 0.8
    });
    const acme = result.gaps.find((g) => g.domain === 'acme.io')!;
    expect(acme.your_presence).toBe(true);
    expect(acme.gap_score).toBeCloseTo(0.8); // 1 * 0.8
    const docs = result.gaps.find((g) => g.domain === 'docs.acme.io')!;
    expect(docs.your_presence).toBe(true);
    expect(docs.citation_count).toBe(1);
  });

  it('keeps up to 3 unique sample URLs per domain', () => {
    const nyt = result.gaps[0]!;
    expect(nyt.sample_urls).toEqual([
      'https://nytimes.com/a',
      'https://nytimes.com/b',
      'https://nytimes.com/c',
    ]);
  });

  it('honors limit after sorting', () => {
    const top1 = computeSourceGaps({
      siteId: 'site-1',
      ownDomains: ['acme.io'],
      citedSources: runs,
      limit: 1,
    });
    expect(top1.gaps).toHaveLength(1);
    expect(top1.gaps[0]!.domain).toBe('nytimes.com');
  });

  it('returns an empty ranking when nothing has been cited yet', () => {
    const empty = computeSourceGaps({ siteId: 's', ownDomains: ['acme.io'], citedSources: [null, []] });
    expect(empty).toMatchObject({
      total_citations: 0,
      your_citations: 0,
      your_share: 0,
      gaps: [],
    });
  });

  it('scores a 0-share site as gap_score === citation_count', () => {
    const none = computeSourceGaps({
      siteId: 's',
      ownDomains: ['acme.io'],
      citedSources: [[cited('nytimes.com'), cited('asana.com'), cited('asana.com')]],
    });
    expect(none.your_share).toBe(0);
    expect(none.gaps[0]).toMatchObject({ domain: 'asana.com', citation_count: 2, gap_score: 2, your_presence: false });
    expect(none.gaps[1]).toMatchObject({ domain: 'nytimes.com', citation_count: 1, gap_score: 1 });
  });
});

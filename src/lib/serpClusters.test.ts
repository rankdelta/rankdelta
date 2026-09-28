import { describe, expect, it } from 'vitest';
import { clusterKeywordsBySerp, normalizeSerpUrl, type SerpClusterInput } from './serpClusters';

const kw = (keyword: string, volume: number, urls: string[]): SerpClusterInput => ({ keyword, volume, urls });

describe('normalizeSerpUrl', () => {
  it('drops protocol, www, query, fragment and trailing slash; lowercases', () => {
    expect(normalizeSerpUrl('HTTPS://www.Example.com/Page/?q=1#top')).toBe('example.com/page');
    expect(normalizeSerpUrl('http://example.com/')).toBe('example.com');
    expect(normalizeSerpUrl('')).toBe('');
  });
  it('treats the same page from different keywords as equal', () => {
    expect(normalizeSerpUrl('https://site.com/a')).toBe(normalizeSerpUrl('http://www.site.com/a/?utm=x'));
  });
});

describe('clusterKeywordsBySerp', () => {
  it('groups keywords that share >= minShared SERP URLs and keeps distinct intents apart', () => {
    const shoes = ['a.com/1', 'b.com/2', 'c.com/3', 'd.com/4'];
    const inputs = [
      kw('best running shoes', 1000, shoes),
      kw('top running shoes', 800, ['a.com/1', 'b.com/2', 'c.com/3', 'z.com/9']), // shares 3 with shoes
      kw('running shoe deals', 500, ['a.com/1', 'b.com/2', 'x.com/8', 'y.com/7']), // shares 2 → separate
    ];
    const clusters = clusterKeywordsBySerp(inputs, { minShared: 3, method: 'centroid', topN: 10 });
    expect(clusters.length).toBe(2);
    const primary = clusters.find((c) => c.pivot === 'best running shoes')!;
    expect(primary.keywords.map((k) => k.keyword).sort()).toEqual(['best running shoes', 'top running shoes']);
    expect(primary.totalVolume).toBe(1800);
    // The 2-overlap keyword is its own cluster.
    expect(clusters.some((c) => c.pivot === 'running shoe deals' && c.size === 1)).toBe(true);
  });

  it('picks the highest-volume member as pivot and sorts clusters by total volume', () => {
    const urls = ['p.com/1', 'p.com/2', 'p.com/3'];
    const inputs = [
      kw('low vol', 10, urls),
      kw('high vol', 900, urls),
      kw('unrelated', 5000, ['q.com/1', 'q.com/2', 'q.com/3']),
    ];
    const clusters = clusterKeywordsBySerp(inputs, { minShared: 3 });
    expect(clusters[0]!.pivot).toBe('unrelated'); // highest total volume first
    const shared = clusters.find((c) => c.size === 2)!;
    expect(shared.pivot).toBe('high vol'); // pivot = max volume in the cluster, not input order
    expect(shared.keywords[0]!.keyword).toBe('high vol');
  });

  it("keeps a keyword with an empty SERP as its own singleton", () => {
    const inputs = [kw('has serp', 100, ['a.com/1', 'a.com/2', 'a.com/3']), kw('no serp', 100, [])];
    const clusters = clusterKeywordsBySerp(inputs, { minShared: 3 });
    expect(clusters.length).toBe(2);
    expect(clusters.some((c) => c.pivot === 'no serp' && c.size === 1)).toBe(true);
  });

  it('connected mode is transitive (A~B, B~C ⇒ one cluster even if A and C do not overlap)', () => {
    const a = ['u1', 'u2', 'u3', 'u4', 'u5'];
    const b = ['u3', 'u4', 'u5', 'u6', 'u7']; // shares 3 with A
    const c = ['u5', 'u6', 'u7', 'u8', 'u9']; // shares 3 with B, only 1 with A
    const inputs = [kw('A', 300, a), kw('B', 200, b), kw('C', 100, c)];
    const connected = clusterKeywordsBySerp(inputs, { minShared: 3, method: 'connected' });
    expect(connected.length).toBe(1);
    expect(connected[0]!.size).toBe(3);
    // Complete (hard) linkage refuses C into {A,B} because C⊥A, so it stays separate.
    const complete = clusterKeywordsBySerp(inputs, { minShared: 3, method: 'complete' });
    expect(complete.length).toBe(2);
  });

  it('respects topN when comparing overlap', () => {
    // Shared URLs sit at ranks 9-11; with topN=8 they are out of range → no cluster.
    const base = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 's1', 's2', 's3'];
    const other = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 's1', 's2', 's3'];
    const inputs = [kw('one', 100, base), kw('two', 90, other)];
    expect(clusterKeywordsBySerp(inputs, { minShared: 3, topN: 8 }).length).toBe(2);
    expect(clusterKeywordsBySerp(inputs, { minShared: 3, topN: 11 }).length).toBe(1);
  });
});

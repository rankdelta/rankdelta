import { describe, it, expect } from 'vitest';
import { buildHostVariants } from './sitemapAnalyzer';

describe('buildHostVariants', () => {
  it('adds the www variant for a bare host (the example-shop.com case)', () => {
    expect(buildHostVariants('https://example-shop.com')).toEqual([
      'https://example-shop.com',
      'https://www.example-shop.com',
    ]);
  });

  it('adds the non-www variant for a www host, user host first', () => {
    expect(buildHostVariants('https://www.example.com')).toEqual([
      'https://www.example.com',
      'https://example.com',
    ]);
  });

  it('preserves protocol and tolerates a missing scheme', () => {
    expect(buildHostVariants('http://example.com')[0]).toBe('http://example.com');
    expect(buildHostVariants('example.com')).toEqual([
      'https://example.com',
      'https://www.example.com',
    ]);
  });
});

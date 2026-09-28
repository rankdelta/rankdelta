import { describe, expect, it } from 'vitest';
import { displayUrl, googleSearchHref, hostOf, hrefOf, isSafeHref, pathOf } from './seoUrls';

describe('hrefOf', () => {
  it('keeps absolute http(s) URLs', () => {
    expect(hrefOf('https://rover.com/it/blog/omega-3')).toBe('https://rover.com/it/blog/omega-3');
    expect(hrefOf('http://example.com')).toBe('http://example.com');
  });

  it('adds https to bare hosts and protocol-relative URLs', () => {
    expect(hrefOf('thefocus.news')).toBe('https://thefocus.news');
    expect(hrefOf('//livelycity.com/post')).toBe('https://livelycity.com/post');
  });

  it('rejects empty and unsafe values', () => {
    expect(hrefOf('')).toBeNull();
    expect(hrefOf(null)).toBeNull();
    expect(hrefOf('javascript:alert(1)')).toBeNull();
    expect(hrefOf('data:text/html,hi')).toBeNull();
  });
});

describe('isSafeHref', () => {
  it('allows http(s) and mailto', () => {
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('mailto:hi@example.com')).toBe(true);
  });

  it('rejects javascript: and data:', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('data:text/html,hi')).toBe(false);
  });
});

describe('display helpers', () => {
  it('splits host and path like Ahrefs', () => {
    expect(hostOf('https://www.rover.com/it/blog/omega-3?utm=1')).toBe('rover.com');
    expect(pathOf('https://www.rover.com/it/blog/omega-3?utm=1')).toBe('/it/blog/omega-3?utm=1');
    expect(displayUrl('https://www.rover.com/it/blog/omega-3')).toBe('rover.com/it/blog/omega-3');
  });

  it('omits a lone slash path', () => {
    expect(pathOf('https://example-news.it/')).toBe('');
    expect(displayUrl('https://example-news.it/')).toBe('example-news.it');
  });

  it('maps DataForSEO url_from / url_to into real page hrefs (Site Explorer From/To)', () => {
    const from = 'https://thefocus.news/pets/omega-3-guide';
    const to = 'https://www.rover.com/it/blog/omega-3';
    // Same fields backlinksList reads from DataForSEO (`url_from`, `url_to`).
    expect(hrefOf(from)).toBe(from);
    expect(hrefOf(to)).toBe(to);
    expect(displayUrl(from)).toBe('thefocus.news/pets/omega-3-guide');
    expect(displayUrl(to)).toBe('rover.com/it/blog/omega-3');
  });
});

describe('googleSearchHref', () => {
  it('builds a localized Google search URL', () => {
    expect(googleSearchHref('dog sitter basel', 'de', 'ch')).toBe(
      'https://www.google.com/search?q=dog+sitter+basel&hl=de&gl=ch',
    );
  });
});

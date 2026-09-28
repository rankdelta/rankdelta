import { describe, expect, it } from 'vitest';
import { siteSummaryText, summarizeSiteHtml } from '../../supabase/functions/_shared/siteSummary';

describe('summarizeSiteHtml', () => {
  it('reads title, meta description and the first headings, without scripts', () => {
    const html = `<html lang="en"><head>
      <title>Visit Example &amp; Co | Guided tours</title>
      <meta content="Walking tours of the baroque towns." name="description">
      <script>var h1 = "<h1>not a heading</h1>";</script>
    </head><body>
      <h1 class="hero">Discover the <em>baroque</em> towns</h1>
      <h2>Tours</h2><h2>Tours</h2><h2>Where to stay</h2>
    </body></html>`;
    expect(summarizeSiteHtml(html)).toEqual({
      title: 'Visit Example & Co | Guided tours',
      description: 'Walking tours of the baroque towns.',
      headings: ['Discover the baroque towns', 'Tours', 'Where to stay'],
    });
  });

  it('falls back to Open Graph tags and survives empty input', () => {
    const og = summarizeSiteHtml('<meta property="og:title" content="Shop"><meta property="og:description" content="Dog food">');
    expect(og.title).toBe('Shop');
    expect(og.description).toBe('Dog food');
    expect(summarizeSiteHtml(null)).toEqual({ title: '', description: '', headings: [] });
  });
});

describe('siteSummaryText', () => {
  it('joins what is there and is empty when nothing is', () => {
    expect(siteSummaryText({ title: 'A', description: '', headings: ['B', 'C'] })).toBe('Title: A. Headings: B | C');
    expect(siteSummaryText({ title: '', description: '', headings: [] })).toBe('');
  });
});

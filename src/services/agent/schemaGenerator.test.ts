import { describe, expect, it } from 'vitest';
import { buildArticleSchemaBlock, buildFaqJsonLdBlock, buildFaqRankMathBlock, jsonLdScript, sanitizeFaqHtml } from './schemaGenerator';

describe('sanitizeFaqHtml', () => {
  it('strips script, event handlers and javascript: URLs', () => {
    const out = sanitizeFaqHtml('<p onclick="alert(1)">ok</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<p');
  });
});

describe('jsonLdScript', () => {
  it('unicode-escapes < so </script> cannot break out of the tag', () => {
    const html = jsonLdScript({ headline: '</script><script>alert(1)</script>' });
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).not.toMatch(/<\/script><script>/);
    expect(html).toContain('\\u003c/script>');
  });
});

describe('buildFaqRankMathBlock', () => {
  it('HTML-escapes question titles interpolated into the inner HTML', () => {
    const html = buildFaqRankMathBlock([
      { question: '<img src=x onerror=alert(1)>', answer: 'Safe answer' },
    ]);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('strips XSS from FAQ answers while keeping wrapping <p>', () => {
    const html = buildFaqRankMathBlock([
      { question: 'What is it?', answer: '<p onclick="steal()">keep</p><script>alert(1)</script>' },
    ]);
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script');
    expect(html).toContain('keep');
  });
});

describe('buildFaqJsonLdBlock / buildArticleSchemaBlock', () => {
  it('escapes script breakout in JSON-LD wrappers', () => {
    const faq = buildFaqJsonLdBlock([{ question: '</script><script>alert(1)</script>', answer: 'no' }]);
    expect(faq).not.toMatch(/<\/script><script>/);
    const article = buildArticleSchemaBlock({
      headline: '</script><script>alert(1)</script>',
      authorName: 'A',
      datePublished: '2026-01-01',
      publisherName: 'P',
      publisherUrl: 'https://example.com/?q=</script>',
    });
    expect(article).not.toMatch(/<\/script><script>/);
  });
});

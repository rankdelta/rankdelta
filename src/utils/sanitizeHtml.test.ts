import { describe, expect, it } from 'vitest';
import { sanitizeArticleHtml } from './sanitizeHtml';

describe('sanitizeArticleHtml', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizeArticleHtml('')).toBe('');
  });

  it('strips scripts, event handlers and javascript: URLs', () => {
    const out = sanitizeArticleHtml('<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('javascript:');
  });

  it('drops <style> blocks', () => {
    expect(sanitizeArticleHtml('<style>body{display:none}</style><p>ok</p>')).toBe('<p>ok</p>');
  });

  it('forces rel="noopener noreferrer" on target="_blank" links', () => {
    const out = sanitizeArticleHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');

    const overridden = sanitizeArticleHtml('<a href="https://example.com" target="_blank" rel="opener">x</a>');
    expect(overridden).toContain('rel="noopener noreferrer"');
    expect(overridden).not.toContain('rel="opener"');
  });

  it('leaves links without target="_blank" untouched', () => {
    expect(sanitizeArticleHtml('<a href="https://example.com">x</a>')).toBe('<a href="https://example.com">x</a>');
  });
});

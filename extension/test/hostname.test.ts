import { describe, expect, it } from 'vitest';
import { looksLikeApiKey, normalizeHostname } from '../src/lib/hostname';

describe('normalizeHostname', () => {
  it('strips scheme, www, path and lowercases', () => {
    expect(normalizeHostname('https://www.Example.com/path?q=1')).toBe('example.com');
    expect(normalizeHostname('http://EXAMPLE.co.uk')).toBe('example.co.uk');
  });

  it('handles bare hostnames without a scheme', () => {
    expect(normalizeHostname('www.foo.io')).toBe('foo.io');
    expect(normalizeHostname('sub.domain.dev')).toBe('sub.domain.dev');
  });

  it('drops ports and trailing dots', () => {
    expect(normalizeHostname('https://example.com:8443/')).toBe('example.com');
    expect(normalizeHostname('https://example.com./')).toBe('example.com');
  });

  it('only strips a leading www., not internal www', () => {
    expect(normalizeHostname('https://wwwstuff.com')).toBe('wwwstuff.com');
    expect(normalizeHostname('https://www.www.com')).toBe('www.com');
  });

  it('rejects non-web and empty inputs', () => {
    expect(normalizeHostname('chrome://extensions')).toBeNull();
    expect(normalizeHostname('about:blank')).toBeNull();
    expect(normalizeHostname('file:///Users/a/x.html')).toBeNull();
    expect(normalizeHostname('localhost')).toBeNull();
    expect(normalizeHostname('')).toBeNull();
    expect(normalizeHostname('   ')).toBeNull();
    expect(normalizeHostname(null)).toBeNull();
    expect(normalizeHostname(undefined)).toBeNull();
  });
});

describe('looksLikeApiKey', () => {
  it('accepts well-formed keys', () => {
    expect(looksLikeApiKey('sk_rankdelta_abcdef123456')).toBe(true);
    expect(looksLikeApiKey('  sk_rankdelta_ABC-def_789  ')).toBe(true);
  });

  it('rejects malformed keys', () => {
    expect(looksLikeApiKey('sk_rankdelta_short')).toBe(false);
    expect(looksLikeApiKey('sk_openai_abcdef123456')).toBe(false);
    expect(looksLikeApiKey('random')).toBe(false);
    expect(looksLikeApiKey('')).toBe(false);
    expect(looksLikeApiKey(null)).toBe(false);
  });
});

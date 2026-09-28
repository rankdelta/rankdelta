import { describe, it, expect } from 'vitest';
import { normalizeDomain, isSameOrSubdomain, toHref } from './domains';

describe('normalizeDomain', () => {
  it('strips protocol, www, path, query and lowercases', () => {
    expect(normalizeDomain('https://www.Foo.com/blog/x?y=1')).toBe('foo.com');
  });
  it('handles a bare domain unchanged', () => {
    expect(normalizeDomain('foo.com')).toBe('foo.com');
  });
  it('keeps non-www subdomains', () => {
    expect(normalizeDomain('http://blog.foo.com')).toBe('blog.foo.com');
  });
  it('returns empty string for null/empty', () => {
    expect(normalizeDomain(null)).toBe('');
    expect(normalizeDomain('   ')).toBe('');
  });
});

describe('isSameOrSubdomain', () => {
  it('matches identical domains regardless of www/protocol/case', () => {
    expect(isSameOrSubdomain('https://www.Foo.com', 'foo.com')).toBe(true);
  });
  it('matches a subdomain against the base', () => {
    expect(isSameOrSubdomain('blog.foo.com', 'foo.com')).toBe(true);
  });
  it('does not match a different domain', () => {
    expect(isSameOrSubdomain('foobar.com', 'foo.com')).toBe(false);
  });
  it('does not treat a suffix collision as a subdomain', () => {
    // "notfoo.com" ends with "foo.com" textually but is NOT a subdomain of foo.com
    expect(isSameOrSubdomain('notfoo.com', 'foo.com')).toBe(false);
  });
  it('never matches when either side is empty', () => {
    expect(isSameOrSubdomain('', 'foo.com')).toBe(false);
    expect(isSameOrSubdomain('foo.com', null)).toBe(false);
  });
});

describe('toHref', () => {
  it('prefixes https for a bare domain', () => {
    expect(toHref('foo.com')).toBe('https://foo.com');
  });
  it('keeps an existing URL as-is', () => {
    expect(toHref('http://foo.com/x')).toBe('http://foo.com/x');
  });
  it('returns null for empty or placeholder values', () => {
    expect(toHref('')).toBeNull();
    expect(toHref('unknown')).toBeNull();
    expect(toHref(null)).toBeNull();
  });
});

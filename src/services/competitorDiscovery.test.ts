import { describe, it, expect } from 'vitest';
import { isGeneric } from './competitorDiscovery';

describe('competitor discovery — generic/mega-host exclusion', () => {
  it('treats mega-tech platforms as generic (never a niche competitor)', () => {
    // The reported bug: "Microsoft" suggested as a competitor for a niche software.
    expect(isGeneric('microsoft.com')).toBe(true);
    expect(isGeneric('learn.microsoft.com')).toBe(true);
    expect(isGeneric('google.com')).toBe(true);
    expect(isGeneric('bing.com')).toBe(true);
    expect(isGeneric('oracle.com')).toBe(true);
    expect(isGeneric('apple.com')).toBe(true);
    expect(isGeneric('amazon.it')).toBe(true);
  });

  it('still allows real niche competitor domains through', () => {
    expect(isGeneric('compass-security.com')).toBe(false);
    expect(isGeneric('acme-niche-saas.io')).toBe(false);
    expect(isGeneric('bravalo.it')).toBe(false);
  });
});

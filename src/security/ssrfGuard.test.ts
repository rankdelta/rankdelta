import { describe, expect, it } from 'vitest';
import {
  assertSafePublicDomain,
  dnsResolvesToBlocked,
  isBlockedHostname,
  isBlockedIpv4,
  parseHttpUrl,
  resolveSafeRedirectTarget,
} from '../../supabase/functions/_shared/ssrf';

describe('isBlockedIpv4', () => {
  it('blocks loopback, RFC1918, link-local, CGNAT', () => {
    expect(isBlockedIpv4(127, 0, 0, 1)).toBe(true);
    expect(isBlockedIpv4(10, 0, 0, 1)).toBe(true);
    expect(isBlockedIpv4(192, 168, 1, 1)).toBe(true);
    expect(isBlockedIpv4(172, 16, 0, 1)).toBe(true);
    expect(isBlockedIpv4(169, 254, 169, 254)).toBe(true);
    expect(isBlockedIpv4(100, 64, 0, 1)).toBe(true);
    expect(isBlockedIpv4(0, 0, 0, 0)).toBe(true);
  });

  it('allows public unicast', () => {
    expect(isBlockedIpv4(1, 1, 1, 1)).toBe(false);
    expect(isBlockedIpv4(8, 8, 8, 8)).toBe(false);
  });
});

describe('isBlockedHostname', () => {
  it('blocks localhost, metadata, and private IP literals', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('metadata.google.internal')).toBe(true);
    expect(isBlockedHostname('169.254.169.254')).toBe(true);
    expect(isBlockedHostname('10.1.2.3')).toBe(true);
  });

  it('does not treat public hostnames starting with fc/fd as IPv6 ULA', () => {
    expect(isBlockedHostname('fdic.gov')).toBe(false);
    expect(isBlockedHostname('fcbarcelona.com')).toBe(false);
  });

  it('blocks IPv6 literals', () => {
    expect(isBlockedHostname('::1')).toBe(true);
    expect(isBlockedHostname('[::1]')).toBe(true);
  });
});

describe('parseHttpUrl', () => {
  it('rejects credentials, javascript, and private hosts', () => {
    expect(parseHttpUrl('javascript:alert(1)')).toBeNull();
    expect(parseHttpUrl('https://user:pass@example.com/')).toBeNull();
    expect(parseHttpUrl('https://127.0.0.1/')).toBeNull();
    expect(parseHttpUrl('https://example.com/path')?.hostname).toBe('example.com');
  });

  it('httpsOnly rejects http', () => {
    expect(parseHttpUrl('http://example.com', { httpsOnly: true })).toBeNull();
    expect(parseHttpUrl('https://example.com', { httpsOnly: true })?.hostname).toBe('example.com');
  });
});

describe('dnsResolvesToBlocked', () => {
  it('fail-closed when lookup returns no answers or errors', async () => {
    expect(await dnsResolvesToBlocked('example.com', async () => null)).toBe(true);
    expect(await dnsResolvesToBlocked('example.com', async () => [])).toBe(true);
  });

  it('blocks when any A record is private', async () => {
    expect(await dnsResolvesToBlocked('evil.test', async () => ['1.1.1.1', '169.254.169.254'])).toBe(
      true,
    );
    expect(await dnsResolvesToBlocked('ok.test', async () => ['1.1.1.1'])).toBe(false);
  });
});

describe('resolveSafeRedirectTarget / assertSafePublicDomain', () => {
  it('rejects a redirect onto a private host without DNS', async () => {
    expect(
      await resolveSafeRedirectTarget('https://example.com/', 'https://127.0.0.1/secret', {
        lookup: async () => ['1.1.1.1'],
      }),
    ).toBeNull();
    expect(await assertSafePublicDomain('localhost')).toBe(false);
    expect(await assertSafePublicDomain('example.com', async () => ['1.1.1.1'])).toBe(true);
    expect(await assertSafePublicDomain('example.com', async () => ['10.0.0.1'])).toBe(false);
  });
});

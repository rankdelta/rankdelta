/**
 * Per-IP rate limits count IPv6 by /64 (red team 28/09): a single connection is usually handed a
 * whole /64, so limiting on the full address is bypassed by rotating the interface id.
 */
import { describe, expect, it } from 'vitest'
import { ipRateLimitBucket } from '../../supabase/functions/_shared/clientIp'

describe('ipRateLimitBucket', () => {
  it('keeps IPv4 as is', () => {
    expect(ipRateLimitBucket('203.0.113.7')).toBe('203.0.113.7')
    expect(ipRateLimitBucket(' 198.51.100.1 ')).toBe('198.51.100.1')
  })

  it('puts every address of one IPv6 /64 in the same bucket', () => {
    const a = ipRateLimitBucket('2a01:4f8:c010:1234:1111:2222:3333:4444')
    const b = ipRateLimitBucket('2a01:4f8:c010:1234:dead:beef:0:1')
    const c = ipRateLimitBucket('2a01:04f8:c010:1234::9')
    expect(a).toBe('2a01:4f8:c010:1234::/64')
    expect(b).toBe(a)
    expect(c).toBe(a)
  })

  it('keeps different /64s apart', () => {
    expect(ipRateLimitBucket('2a01:4f8:c010:1234::1')).not.toBe(ipRateLimitBucket('2a01:4f8:c010:1235::1'))
  })

  it('handles compressed, bracketed, zoned and upper-case forms', () => {
    expect(ipRateLimitBucket('2001:DB8::1')).toBe('2001:db8:0:0::/64')
    expect(ipRateLimitBucket('[2606:4700::6810:84e5]')).toBe('2606:4700:0:0::/64')
    expect(ipRateLimitBucket('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
    expect(ipRateLimitBucket('::1')).toBe('0:0:0:0::/64')
  })

  it('treats IPv4-mapped IPv6 as the IPv4 address', () => {
    expect(ipRateLimitBucket('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(ipRateLimitBucket('::ffff:cb00:7107')).toBe('203.0.113.7')
  })

  it('returns anything unparseable unchanged (the limiter still counts it)', () => {
    expect(ipRateLimitBucket('unknown')).toBe('unknown')
    expect(ipRateLimitBucket('1::2::3')).toBe('1::2::3')
    expect(ipRateLimitBucket('')).toBe('')
  })
})

import { describe, expect, it } from 'vitest'
import { billingIssuedAtVerdict, ENTITLEMENTS_MAX_AGE_SEC, issuedAtRequired } from '../../supabase/functions/_shared/billingReplay'

// connector-api /v1/entitlements/sync: a signed billing payload without issued_at verified forever,
// so an old ACTIVE payload could be replayed to restore a cancelled plan.
describe('billing payload replay window', () => {
  const now = Date.UTC(2026, 8, 29, 10, 0, 0)
  const nowSec = now / 1000

  it('requires issued_at unless the env explicitly opts out', () => {
    expect(issuedAtRequired(undefined)).toBe(true)
    expect(issuedAtRequired('')).toBe(true)
    expect(issuedAtRequired('true')).toBe(true)
    expect(issuedAtRequired(' FALSE ')).toBe(false)
    expect(billingIssuedAtVerdict(undefined, now, true)).toBe('required')
    expect(billingIssuedAtVerdict('', now, true)).toBe('required')
    expect(billingIssuedAtVerdict(null, now, false)).toBe('ok')
  })

  it('accepts a fresh issued_at as number or string', () => {
    expect(billingIssuedAtVerdict(nowSec, now, true)).toBe('ok')
    expect(billingIssuedAtVerdict(String(nowSec - 60), now, true)).toBe('ok')
  })

  it('rejects a stale, future or malformed issued_at even when not required', () => {
    expect(billingIssuedAtVerdict(nowSec - ENTITLEMENTS_MAX_AGE_SEC - 1, now, false)).toBe('stale')
    expect(billingIssuedAtVerdict(nowSec + ENTITLEMENTS_MAX_AGE_SEC + 1, now, true)).toBe('stale')
    expect(billingIssuedAtVerdict('yesterday', now, false)).toBe('stale')
  })
})

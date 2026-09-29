/**
 * Replay window for the signed Shopify billing payload (connector-api /v1/entitlements/sync).
 *
 * `issued_at` (unix seconds) is part of the HMAC canonical string (shopifyBillingCanonical), so a
 * captured payload cannot be re-sent later to restore a cancelled plan — but only if it is
 * required: a signed payload WITHOUT issued_at verifies forever. It is required by default; the
 * ENTITLEMENTS_REQUIRE_ISSUED_AT=false override exists only for a legacy signer.
 */

export const ENTITLEMENTS_MAX_AGE_SEC = 10 * 60

export type IssuedAtVerdict = 'ok' | 'stale' | 'required'

export function billingIssuedAtVerdict(raw: unknown, nowMs: number, required: boolean): IssuedAtVerdict {
  const issuedAt = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : null
  if (issuedAt === null) return required ? 'required' : 'ok'
  if (!Number.isFinite(issuedAt) || Math.abs(nowMs / 1000 - issuedAt) > ENTITLEMENTS_MAX_AGE_SEC) return 'stale'
  return 'ok'
}

/** Required unless the env explicitly says `false`. */
export function issuedAtRequired(envValue: string | undefined): boolean {
  return (envValue ?? '').trim().toLowerCase() !== 'false'
}

/**
 * Bot filters for the public ai-visibility-check endpoint.
 *
 * Two call contracts share this URL:
 *  - Landing widget: sends honeypot `website` (must be empty) and `formStartedAt`
 *    (epoch ms when the email step mounts). Instant / autofilled submissions are rejected.
 *  - Server-to-server integrations: `{ domain, email, lang }` only, without `formStartedAt`.
 *    Set CHECK_INTEGRATION_SECRET to require authenticated integrations: callers must then send
 *    it in the `x-rankdelta-integration-secret` header, otherwise the request is handled as a
 *    widget request (timing check and widget limits apply).
 *
 * Both fail with the same generic invalid_request body so bots cannot probe which filter fired.
 * Pure so vitest can cover the contract without Deno.
 */

import { secretsMatch } from '../_shared/secrets.ts'

export const MIN_FORM_MS = 1500
/** Homepage widget: 5 checks per IP per hour. */
export const WIDGET_IP_MAX_PER_HOUR = 5
/**
 * Server-to-server integrations may run from a single IP. Still capped so the programmatic
 * contract cannot be used without bound.
 */
export const PROGRAMMATIC_IP_MAX_PER_HOUR = 80

/** Header carrying the shared secret for server-to-server integrations. */
export const INTEGRATION_SECRET_HEADER = 'x-rankdelta-integration-secret'

/**
 * May this request use the programmatic (server-to-server) contract?
 * Set CHECK_INTEGRATION_SECRET to require authenticated integrations. When it is set, only a
 * request presenting the same value (constant-time compare) qualifies. When it is unset, any
 * request that omits `formStartedAt` qualifies.
 */
export function isTrustedIntegration(
  configuredSecret: string | null | undefined,
  presentedSecret: string | null | undefined,
): boolean {
  const expected = (configuredSecret ?? '').trim()
  if (!expected) return true
  return secretsMatch((presentedSecret ?? '').trim(), expected)
}

export const INVALID_REQUEST = {
  error: 'invalid_request',
  message: 'Something went wrong. Please try again.',
} as const

export type PublicCheckGuard =
  | { ok: true; programmatic: boolean }
  | { ok: false; status: 400; body: typeof INVALID_REQUEST }

function isOmitted(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/**
 * @param nowMs injectible for tests
 * @param trustedIntegration result of isTrustedIntegration(); when false, omitting
 *   `formStartedAt` does not select the programmatic contract.
 */
export function guardPublicCheckBots(
  body: unknown,
  nowMs = Date.now(),
  trustedIntegration = true,
): PublicCheckGuard {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}

  // Honeypot: landing widget renders a hidden `website` input that humans leave empty.
  // Integrations omit the field; String(undefined ?? '') === '' so that still passes.
  const honeypot = String(b['website'] ?? '')
  if (honeypot !== '') {
    return { ok: false, status: 400, body: INVALID_REQUEST }
  }

  // Timing gate applies unless this is a trusted server-to-server integration that omitted
  // formStartedAt ({domain, email, lang} contract).
  if (trustedIntegration && isOmitted(b['formStartedAt'])) {
    return { ok: true, programmatic: true }
  }

  const startedAt = Number(b['formStartedAt'])
  if (!Number.isFinite(startedAt) || startedAt <= 0 || nowMs - startedAt < MIN_FORM_MS) {
    return { ok: false, status: 400, body: INVALID_REQUEST }
  }
  return { ok: true, programmatic: false }
}

/**
 * Who gets the result email. A visitor who typed their own address into the site widget always
 * does. Server-to-server integrations may pass an address that did not request the email, so
 * they must opt in with `sendEmail: true`.
 */
export function wantsResultEmail(programmatic: boolean, body: unknown): boolean {
  if (!programmatic) return true
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  return b['sendEmail'] === true
}

/** email_error codes that are decisions, not delivery failures (the ops watchdog ignores them). */
export const EMAIL_SKIP_CODES = ['rate_capped', 'not_requested'] as const

/**
 * Widget submissions still 429/503 when report-email caps are hit.
 * Integrations still get the visibility payload; the email send is skipped instead.
 */
export function shouldBlockOnEmailCap(programmatic: boolean, overRecipient: boolean, overGlobal: boolean): boolean {
  return !programmatic && (overRecipient || overGlobal)
}

/**
 * Widget: 5/h per IP. Programmatic: higher per-IP hour cap (integrations may share one IP).
 * OpenAI/upstream failures are NOT mapped here — they return check_failed 500.
 */
export function shouldBlockOnIpCap(programmatic: boolean, ipCount: number): boolean {
  const max = programmatic ? PROGRAMMATIC_IP_MAX_PER_HOUR : WIDGET_IP_MAX_PER_HOUR
  return ipCount >= max
}

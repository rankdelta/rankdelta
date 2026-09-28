/**
 * Share-link validation mirroring get_shared_report SQL (min 16 chars, trimmed).
 */

const MIN_SHARE_TOKEN_LENGTH = 16

/** Returns true when a token is eligible for get_shared_report lookup. */
export function isValidShareToken(token: string | null | undefined): boolean {
  if (token == null) return false
  const trimmed = token.trim()
  return trimmed.length >= MIN_SHARE_TOKEN_LENGTH
}

/** Public fields returned by get_shared_report — used for contract tests. */
export const SHARED_REPORT_PUBLIC_FIELDS = [
  'id',
  'project_id',
  'period_start',
  'period_end',
  'sections',
  'data',
  'narrative',
  'branding',
  'goals',
  'layout',
  'created_at',
] as const

/** Fields that must never appear in a public share payload. */
export const SHARED_REPORT_FORBIDDEN_FIELDS = ['user_id', 'share_token', 'refresh_token'] as const

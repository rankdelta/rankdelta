/**
 * Share-link validation mirroring get_shared_report SQL (min 16 chars, trimmed).
 */
import { isSelfHostEnv } from './appOrigin.ts'

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

/*
 * Issuing links. Only Agency / white-label plans may hold one. The UI hid the option for other
 * plans, but report-build honoured { share: true } from anyone, and the DB trigger that enforces
 * the rule (20260912190000_enforce_agency_share_token) is not applied everywhere: the check lives
 * here too, with the same entitlement (plan + paying status). Self-hosted installs have no plans.
 */
/** 24 random bytes as hex: the whole credential of a share link. */
export function generateShareToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const ENTITLED_STATUSES = ['active', 'trialing', 'past_due']

interface ShareAdmin {
  from(table: string): any
}

export async function canShareReports(admin: ShareAdmin, userId: string, selfHost = isSelfHostEnv()): Promise<boolean> {
  if (selfHost) return true
  const { data: sub } = await admin
    .from('subscriptions')
    .select('plan, status')
    .eq('user_id', userId)
    .in('status', ENTITLED_STATUSES)
    .limit(1)
    .maybeSingle()
  const plan = typeof sub?.plan === 'string' ? sub.plan.toLowerCase() : ''
  if (!plan) return false
  if (plan === 'agency') return true
  const { data: config } = await admin.from('plan_configurations').select('features').eq('plan', plan).maybeSingle()
  return config?.features?.white_label === true
}

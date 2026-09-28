/**
 * The free AI-visibility check on the landing page already asked the visitor for their domain and
 * email. Carry both into signup (email) and onboarding (domain) so the highest-intent moment —
 * "ChatGPT doesn't mention you" → "Fix this" — does not restart with two empty fields.
 *
 * Kept in localStorage (never in the URL: personal data must not end up in query strings, logs or
 * referrers), short-lived, and cleared once onboarding has used it.
 */

export interface PendingCheck {
  domain: string
  email: string
  lang?: string
  level?: 'recommended' | 'known' | 'absent'
  brand?: string
  /** ms epoch */
  savedAt: number
}

const KEY = 'rankdelta.pendingCheck'
const TTL_MS = 7 * 24 * 60 * 60 * 1000

export function savePendingCheck(check: Omit<PendingCheck, 'savedAt'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...check, savedAt: Date.now() }))
  } catch {
    /* private mode / blocked storage: the funnel still works, just without prefill */
  }
}

export function clearPendingCheck(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export function readPendingCheck(): PendingCheck | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingCheck>
    if (typeof parsed.domain !== 'string' || typeof parsed.email !== 'string' || typeof parsed.savedAt !== 'number') return null
    if (Date.now() - parsed.savedAt > TTL_MS) {
      clearPendingCheck()
      return null
    }
    return parsed as PendingCheck
  } catch {
    return null
  }
}

/**
 * requireAuth — session check that survives hard reloads.
 *
 * Route guards used to call supabase.auth.getSession() directly in beforeLoad: on a hard page
 * load the client may not have finished restoring the session from storage yet, so getSession()
 * returned null and a LOGGED-IN user got bounced to /login (intermittent, timing-dependent).
 *
 * getSessionSafe() keeps the exact same return shape as getSession(), but when the first answer
 * is null it waits briefly for the client's INITIAL_SESSION restore event before giving up —
 * a real logged-out user still resolves (null) quickly and lands on /login as before.
 */

import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

let restoreSettled = false

export async function getSessionSafe(): Promise<{ data: { session: Session | null } }> {
  const first = await supabase.auth.getSession()
  if (first.data.session || restoreSettled) {
    restoreSettled = true
    return first
  }

  // No session yet and we've never seen the client settle — give it one short chance to
  // hydrate from storage (INITIAL_SESSION fires fast, with the session or with null).
  const session = await new Promise<Session | null>((resolve) => {
    const timer = setTimeout(() => {
      sub.data.subscription.unsubscribe()
      resolve(null)
    }, 1500)
    const sub = supabase.auth.onAuthStateChange((_event, s) => {
      clearTimeout(timer)
      sub.data.subscription.unsubscribe()
      resolve(s)
    })
  })
  restoreSettled = true
  return { data: { session } }
}

/**
 * auditStatus — a tiny, tab-local signal for "the first audit is computing right now".
 *
 * A freshly-created project kicks off its guided audit in the background (~60-90s). Until the
 * result lands, the Comando would otherwise show "Salute —/esegui la diagnosi", which reads as
 * "nothing happened". This flag lets the dashboard show a live "Calcolo del punteggio…" state
 * instead, so the user knows the score is on its way (not that they must trigger it manually).
 *
 * Backed by sessionStorage (survives the in-app navigation from onboarding → Comando, scoped to
 * the tab) with a TTL so a crashed/abandoned audit never leaves the spinner stuck forever.
 */

const KEY = (projectId: string) => `astroseo:auditing:${projectId}`
const TTL_MS = 4 * 60 * 1000 // a guided audit should never take longer than this

export function markAuditRunning(projectId: string): void {
  try {
    sessionStorage.setItem(KEY(projectId), String(Date.now()))
  } catch {
    /* ignore */
  }
}

export function clearAuditRunning(projectId: string): void {
  try {
    sessionStorage.removeItem(KEY(projectId))
  } catch {
    /* ignore */
  }
}

/** True while a background audit for this project is expected to be running (and not stale). */
export function isAuditRunning(projectId: string | undefined | null): boolean {
  if (!projectId) return false
  try {
    const t = sessionStorage.getItem(KEY(projectId))
    if (!t) return false
    if (Date.now() - Number(t) > TTL_MS) {
      sessionStorage.removeItem(KEY(projectId))
      return false
    }
    return true
  } catch {
    return false
  }
}

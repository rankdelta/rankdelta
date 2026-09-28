/**
 * Clamp a post-call provider cost so finalize cannot raise reserved spend past the monthly cap.
 * Pure helper (no Deno) — Edge Functions and unit tests share it.
 *
 * `spentExcludingThisEvent` is other events this month (the reserved row is excluded).
 * Room is `cap - spentOthers`; reported cost is never written above that room.
 */
export function clampFinalCostCents(
  reportedCents: number,
  spentExcludingThisEvent: number,
  capCents: number,
): number {
  const cost = Math.max(0, Math.round(Number(reportedCents)) || 0)
  const spent = Math.max(0, Math.round(Number(spentExcludingThisEvent)) || 0)
  const cap = Math.max(0, Math.round(Number(capCents)) || 0)
  const room = Math.max(0, cap - spent)
  return Math.min(cost, room)
}

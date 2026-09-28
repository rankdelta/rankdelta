/** ISO timestamp for the start of the current calendar month, in UTC. */
export function monthStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function projectSpendExceeded(
  spendCentsAcc: number,
  capCents: number | null,
  additionalCents = 0,
): boolean {
  if (capCents == null) return false;
  if (capCents <= 0) return true;
  return spendCentsAcc + additionalCents > capCents;
}

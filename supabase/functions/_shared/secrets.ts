/**
 * Constant-time compare for shared cron / webhook secrets.
 * Length mismatch returns false immediately (length leak is acceptable).
 */
export function secretsMatch(presented: string | null | undefined, expected: string | null | undefined): boolean {
  if (!presented || !expected || presented.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < presented.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

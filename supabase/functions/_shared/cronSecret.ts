/**
 * Shared-secret check for pg_cron → Edge calls.
 *
 * pg_cron reads the secret from Vault and sends it as a header. Comparing only against a function
 * env var (VISIBILITY_CRON_SECRET, REPORT_SCHEDULE_CRON_SECRET) would require setting the same
 * value in two places, and a missing env var makes every cron call fail silently. The Edge side
 * therefore also accepts the Vault value (read through the service-role-only `get_cron_secret`
 * RPC), so creating the Vault secret is the single step.
 *
 * The env var still wins when present, and either value is accepted, so a deployment that already
 * set the env var keeps working unchanged.
 */
import { secretsMatch } from './secrets.ts'

type RpcDb = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

const MIN_LEN = 16

// Positive results only: a secret created after the worker booted must be picked up.
const vaultCache = new Map<string, string>()

export async function vaultCronSecret(admin: RpcDb, vaultName: string): Promise<string | null> {
  const hit = vaultCache.get(vaultName)
  if (hit) return hit
  try {
    const { data, error } = await admin.rpc('get_cron_secret', { p_name: vaultName })
    if (error || typeof data !== 'string') return null
    const v = data.trim()
    if (v.length < MIN_LEN) return null
    vaultCache.set(vaultName, v)
    return v
  } catch {
    return null
  }
}

export async function cronSecretMatches(
  admin: RpcDb,
  presented: string | null | undefined,
  envName: string,
  vaultName: string,
): Promise<boolean> {
  if (!presented) return false
  const env = (Deno.env.get(envName) ?? '').trim()
  if (env.length >= MIN_LEN && secretsMatch(presented, env)) return true
  const fromVault = await vaultCronSecret(admin, vaultName)
  return !!fromVault && secretsMatch(presented, fromVault)
}

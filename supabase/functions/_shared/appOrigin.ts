/**
 * Public origin of the web app, and the browser origins allowed to call the edge functions.
 *
 * - Cloud: https://rankdelta.ai (plus www and the Vite dev/preview ports).
 * - Self-host (SELF_HOST=true): APP_ORIGIN, or the Docker default http://localhost:8080 when unset.
 *   The cloud domains are not trusted on a self-hosted backend.
 * - ALLOWED_ORIGINS (comma-separated) adds more origins in both modes.
 *
 * Env is injectable so the rules can be tested without Deno.
 */

export type EnvReader = { get(name: string): string | undefined }

const denoEnv: EnvReader = {
  get: (name) => (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(name),
}

export const CLOUD_ORIGIN = 'https://rankdelta.ai'
export const SELF_HOST_DEFAULT_ORIGIN = 'http://localhost:8080'
const CLOUD_ORIGINS = [CLOUD_ORIGIN, 'https://www.rankdelta.ai']
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:4173']

const trimOrigin = (value: string | undefined): string => (value ?? '').trim().replace(/\/+$/, '')

export function isSelfHostEnv(env: EnvReader = denoEnv): boolean {
  return (env.get('SELF_HOST') ?? '').toLowerCase() === 'true'
}

/** Where users reach the app: links in emails, OAuth pages, MCP docs. No trailing slash. */
export function appOrigin(env: EnvReader = denoEnv): string {
  const configured = trimOrigin(env.get('APP_ORIGIN'))
  if (configured) return configured
  return isSelfHostEnv(env) ? SELF_HOST_DEFAULT_ORIGIN : CLOUD_ORIGIN
}

/**
 * Origins whose browser requests get CORS headers. `extra` keeps per-function legacy domains
 * (cloud only).
 */
export function allowedBrowserOrigins(extra: readonly string[] = [], env: EnvReader = denoEnv): Set<string> {
  const configured = (env.get('ALLOWED_ORIGINS') ?? '').split(',').map(trimOrigin).filter(Boolean)
  const base = isSelfHostEnv(env) ? [] : [...CLOUD_ORIGINS, ...extra]
  return new Set([...configured, appOrigin(env), ...base, ...DEV_ORIGINS])
}

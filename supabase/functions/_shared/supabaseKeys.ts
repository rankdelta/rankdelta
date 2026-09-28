/**
 * One place that answers "which Supabase API key do I use?".
 *
 * Supabase is retiring the legacy JWT-based keys. The dashboard already marks both reserved
 * secrets DEPRECATED:
 *   SUPABASE_ANON_KEY         -> "Legacy anonymous key. Use SUPABASE_PUBLISHABLE_KEYS instead"
 *   SUPABASE_SERVICE_ROLE_KEY -> "Legacy service role key. Use SUPABASE_SECRET_KEYS instead"
 *
 * The two shapes are NOT the same:
 *   - the legacy vars hold a bare key string;
 *   - the new vars hold a JSON dictionary of keys, each under the name it was created with.
 *     The key created by the migration flow is named `default`:
 *       JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['default']
 *     https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys#step-4-update-edge-functions
 *
 * Selection rule, in order:
 *   1. the `default` entry  — what Supabase's own migration guide tells you to read;
 *   2. the only entry, when the dictionary holds exactly one key and it isn't called `default`
 *      — unambiguous, so honouring it beats failing;
 *   3. otherwise (several named keys, none `default`) we do NOT guess which one this project
 *      wants: fall back to the legacy var so behaviour stays identical, and log once.
 *
 * A malformed / empty / non-string value never throws — it falls back to the legacy var and
 * logs once per isolate. Today nothing sets the new vars, so every call resolves to 'legacy'
 * and behaviour is unchanged; the day Supabase removes the legacy vars, adding the new secrets
 * is enough.
 */

const PUBLISHABLE_NEW = 'SUPABASE_PUBLISHABLE_KEYS'
const PUBLISHABLE_LEGACY = 'SUPABASE_ANON_KEY'
const SECRET_NEW = 'SUPABASE_SECRET_KEYS'
const SECRET_LEGACY = 'SUPABASE_SERVICE_ROLE_KEY'

export type KeySource = 'new' | 'legacy' | 'missing'

interface Resolved {
  key: string
  source: KeySource
}

/** Deno.env.get can throw when --allow-env is scoped; treat any failure as "unset". */
function env(name: string): string {
  try {
    return (Deno.env.get(name) ?? '').trim()
  } catch {
    return ''
  }
}

const warned = new Set<string>()
function warnOnce(name: string, reason: string): void {
  if (warned.has(name)) return
  warned.add(name)
  // eslint-disable-next-line no-console
  console.warn(`[supabaseKeys] ${name}: ${reason}; falling back to the legacy key variable`)
}

/**
 * Pull the usable key out of a new-style var. Returns '' when the value can't be used, so the
 * caller falls back to the legacy var. Never throws.
 */
function fromNewVar(name: string): string {
  const raw = env(name)
  if (!raw) return ''

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Not JSON: Supabase keys (sb_publishable_… / sb_secret_…) are bare strings, so a plain
    // value here is the key itself. This also covers a hand-set secret.
    return raw
  }

  if (typeof parsed === 'string') return parsed.trim()
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    warnOnce(name, 'value is JSON but not a dictionary of keys')
    return ''
  }

  const dict = parsed as Record<string, unknown>
  const usable = Object.entries(dict).filter(
    ([, value]) => typeof value === 'string' && value.trim() !== '',
  ) as [string, string][]
  if (usable.length === 0) {
    warnOnce(name, 'dictionary holds no usable string key')
    return ''
  }

  const preferred = usable.find(([entry]) => entry === 'default')
  if (preferred) return preferred[1].trim()
  if (usable.length === 1) return usable[0][1].trim()

  warnOnce(
    name,
    `dictionary has no "default" entry and ${usable.length} named keys (${usable
      .map(([entry]) => entry)
      .join(', ')}), so the right one is ambiguous`,
  )
  return ''
}

function resolve(newName: string, legacyName: string): Resolved {
  const fresh = fromNewVar(newName)
  if (fresh) return { key: fresh, source: 'new' }
  const legacy = env(legacyName)
  if (legacy) return { key: legacy, source: 'legacy' }
  return { key: '', source: 'missing' }
}

// Cached at module scope: these secrets cannot change within the life of an isolate.
let publishableCache: Resolved | null = null
let secretCache: Resolved | null = null

function resolvedPublishable(): Resolved {
  publishableCache ??= resolve(PUBLISHABLE_NEW, PUBLISHABLE_LEGACY)
  return publishableCache
}

function resolvedSecret(): Resolved {
  secretCache ??= resolve(SECRET_NEW, SECRET_LEGACY)
  return secretCache
}

/**
 * The public (RLS-respecting) key: SUPABASE_PUBLISHABLE_KEYS, else the legacy SUPABASE_ANON_KEY.
 * Returns '' when neither is set — callers keep their own "missing key" handling.
 */
export function publishableKey(): string {
  return resolvedPublishable().key
}

/**
 * The privileged (RLS-bypassing) key: SUPABASE_SECRET_KEYS, else the legacy
 * SUPABASE_SERVICE_ROLE_KEY. Returns '' when neither is set.
 */
export function secretKey(): string {
  return resolvedSecret().key
}

/** Which variable each key actually came from — so a function can log the path it took. */
export function keySource(): { publishable: KeySource; secret: KeySource } {
  return { publishable: resolvedPublishable().source, secret: resolvedSecret().source }
}

/** Test-only: drop the module-scope cache so a test can change the environment between cases. */
export function resetKeyCacheForTests(): void {
  publishableCache = null
  secretCache = null
  warned.clear()
}

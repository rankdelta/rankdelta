/**
 * Hashing of client IPs for rate limiting without storing raw addresses.
 *
 * The pepper is IP_HASH_PEPPER when set. Otherwise it is derived from the server-only Supabase
 * secret key (SHA-256 with a fixed label), so it is never a public constant and never throws.
 */
import { secretKey } from './supabaseKeys.ts'

const DERIVED_PEPPER_LABEL = 'rankdelta:ip-hash-pepper:v1'

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function configuredPepper(): string {
  try {
    return (Deno.env.get('IP_HASH_PEPPER') ?? '').trim()
  } catch {
    return ''
  }
}

/** The pepper used by hashClientIp. */
export async function ipHashPepper(): Promise<string> {
  const configured = configuredPepper()
  if (configured) return configured
  return await sha256Hex(`${DERIVED_PEPPER_LABEL}:${secretKey()}`)
}

/** SHA-256 hex of `${pepper}:${ip}`. Deterministic, so per-IP rate limits keep working. */
export async function hashClientIp(ip: string): Promise<string> {
  return await sha256Hex(`${await ipHashPepper()}:${ip}`)
}

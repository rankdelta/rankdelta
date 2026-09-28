/**
 * clientIp.ts — resolve the caller's IP for rate limiting / abuse counters.
 *
 * Why not `x-forwarded-for[0]`: that first hop is client-supplied — any caller can prepend a
 * fake address and rotate past a per-IP limiter. The trustworthy values are the ones the
 * platform edge sets itself: `cf-connecting-ip` (Cloudflare in front of Supabase), then
 * `x-real-ip`, then the LAST hop of `x-forwarded-for` (appended by the proxy that actually
 * received the connection, so it cannot be spoofed by the client).
 */
export function getClientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return real
  const hops = (req.headers.get('x-forwarded-for') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return hops[hops.length - 1] ?? 'unknown'
}

/**
 * The key per-IP rate limiters count on. IPv4 as is. IPv6 by its /64 prefix: one connection is
 * usually handed a whole /64 (2^64 addresses), so a limiter on the full address is bypassed by
 * rotating the interface id. IPv4-mapped IPv6 (::ffff:a.b.c.d) counts as its IPv4 address.
 * Unparseable input is returned unchanged.
 */
export function ipRateLimitBucket(ip: string): string {
  let raw = String(ip || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? ''
  if (!raw.includes(':')) return raw
  const original = raw
  // An embedded dotted IPv4 tail (::ffff:1.2.3.4) becomes two hex groups first.
  const dotted = raw.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (dotted) {
    const q = dotted.slice(1).map(Number) as [number, number, number, number]
    if (q.some((n) => n > 255)) return original
    raw = raw.slice(0, raw.length - dotted[0].length) + `${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`
  }
  const halves = raw.split('::')
  if (halves.length > 2) return original
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = 8 - head.length - tail.length
  if ((halves.length === 2 && fill < 1) || (halves.length === 1 && head.length !== 8)) return original
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail]
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return original
  const n = groups.map((g) => parseInt(g, 16))
  // IPv4-mapped (::ffff:a.b.c.d): the IPv4 address itself.
  if (n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff) {
    const a = n[6] as number, b = n[7] as number
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
  }
  return `${n.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`
}

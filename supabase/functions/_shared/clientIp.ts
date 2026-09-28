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
  return hops.length ? hops[hops.length - 1] : 'unknown'
}

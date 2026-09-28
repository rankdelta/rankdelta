/**
 * SSRF helpers shared by seo-proxy, wp-publish, public widgets, and Shopify probes.
 * Pure hostname/IP checks are sync; DNS lookup (DoH) is optional and fail-closed.
 */

export function isBlockedIpv4(a: number, b: number, c: number, d: number): boolean {
  if ([a, b, c, d].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  if (a === 127 || a === 10 || a === 0 || a === 255) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  return false
}

/** Expand an IPv6 address (optionally with an embedded dotted IPv4 tail) to 8 hextets, or null. */
function ipv6Hextets(raw: string): number[] | null {
  let ip = raw.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? ''
  const tail = ip.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (tail) {
    const q = tail.slice(1).map(Number)
    if (q.some((n) => n > 255)) return null
    ip = ip.slice(0, ip.length - tail[0].length) + `${((q[0]! << 8) | q[1]!).toString(16)}:${((q[2]! << 8) | q[3]!).toString(16)}`
  }
  const halves = ip.split('::')
  if (halves.length > 2) return null
  const parse = (part: string) => (part ? part.split(':') : [])
  const head = parse(halves[0] ?? '')
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : []
  const fill = 8 - head.length - rest.length
  if ((halves.length === 2 && fill < 1) || (halves.length === 1 && head.length !== 8)) return null
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...rest]
  const out: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    out.push(parseInt(g, 16))
  }
  return out.length === 8 ? out : null
}

/**
 * True for IPv6 addresses a server-side fetch must never reach: unspecified, loopback, unique-local
 * (fc00::/7), link-local (fe80::/10), multicast, documentation, and every form that embeds an IPv4
 * address (mapped ::ffff:0:0/96, compatible ::/96, NAT64 64:ff9b::/96, 6to4 2002::/16, Teredo
 * 2001::/32) — those are blocked outright rather than decoded. Unparseable input is blocked.
 */
export function isBlockedIpv6(raw: string): boolean {
  const h = ipv6Hextets(raw)
  if (!h) return true
  const [a, b] = h as [number, number, ...number[]]
  if (h.slice(0, 6).every((x) => x === 0)) return true // ::, ::1, ::a.b.c.d
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return true // ::ffff:a.b.c.d
  if ((a & 0xfe00) === 0xfc00) return true // fc00::/7
  if ((a & 0xffc0) === 0xfe80) return true // fe80::/10
  if ((a & 0xff00) === 0xff00) return true // multicast
  if (a === 0x64 && b === 0xff9b) return true // NAT64
  if (a === 0x2002) return true // 6to4
  if (a === 0x2001 && (b === 0 || b === 0x0db8)) return true // Teredo, documentation
  if (a === 0x0100 && h.slice(1, 4).every((x) => x === 0)) return true // discard-only 100::/64
  return false
}

/** An address from a DNS answer: IPv4 through the hostname rules, IPv6 through isBlockedIpv6. */
export function isBlockedResolvedIp(ip: string): boolean {
  return ip.includes(':') ? isBlockedIpv6(ip) : isBlockedHostname(ip)
}

/** Hostname-only SSRF denylist. Does not resolve DNS. IPv6 literals are blocked. */
export function isBlockedHostname(hostname: string): boolean {
  const h = String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '')
  if (!h) return true
  if (
    h === 'localhost' ||
    h === 'metadata.google.internal' ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  ) {
    return true
  }
  if (h.includes(':') || h.startsWith('[')) return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) return isBlockedIpv4(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]))
  return false
}

export function parseHttpUrl(raw: string, opts?: { httpsOnly?: boolean }): URL | null {
  try {
    const u = new URL(raw)
    if (opts?.httpsOnly) {
      if (u.protocol !== 'https:') return null
    } else if (!/^https?:$/.test(u.protocol)) {
      return null
    }
    if (u.username || u.password) return null
    if (isBlockedHostname(u.hostname)) return null
    return u
  } catch {
    return null
  }
}

export type DnsLookup = (hostname: string) => Promise<string[] | null>

async function cloudflareQuery(hostname: string, type: 'A' | 'AAAA'): Promise<string[] | null> {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
      { headers: { Accept: 'application/dns-json' } },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { Answer?: Array<{ type: number; data: string }> }
    const want = type === 'A' ? 1 : 28
    return (data.Answer ?? []).filter((a) => a.type === want).map((a) => String(a.data))
  } catch {
    return null
  }
}

/**
 * A and AAAA answers. Checking A only let a host with a public A record and an internal AAAA record
 * through (fetch may connect over IPv6). Null when neither query answered (fail-closed upstream).
 */
async function cloudflareLookup(hostname: string): Promise<string[] | null> {
  const [v4, v6] = await Promise.all([cloudflareQuery(hostname, 'A'), cloudflareQuery(hostname, 'AAAA')])
  if (v4 === null && v6 === null) return null
  return [...(v4 ?? []), ...(v6 ?? [])]
}

export async function dnsResolvesToBlocked(
  hostname: string,
  lookup: DnsLookup = cloudflareLookup,
): Promise<boolean> {
  if (isBlockedHostname(hostname)) return true
  const ips = await lookup(hostname)
  if (ips === null || ips.length === 0) return true
  return ips.some((ip) => isBlockedResolvedIp(ip))
}

export function cachedLookup(lookup: DnsLookup = cloudflareLookup): DnsLookup {
  const cache = new Map<string, Promise<string[] | null>>()
  return (hostname: string) => {
    const hit = cache.get(hostname)
    if (hit) return hit
    const pending = lookup(hostname)
    cache.set(hostname, pending)
    return pending
  }
}

export async function assertSafeOutboundUrl(
  raw: string,
  opts?: { httpsOnly?: boolean; lookup?: DnsLookup },
): Promise<URL | null> {
  const u = parseHttpUrl(raw, { httpsOnly: opts?.httpsOnly })
  if (!u) return null
  if (await dnsResolvesToBlocked(u.hostname, opts?.lookup)) return null
  return u
}

/** Resolve a redirect Location against the current URL and re-run the SSRF guard. */
export async function resolveSafeRedirectTarget(
  current: string | URL,
  location: string | null,
  opts?: { httpsOnly?: boolean; lookup?: DnsLookup },
): Promise<URL | null> {
  if (!location) return null
  try {
    return await assertSafeOutboundUrl(new URL(location, current).toString(), opts)
  } catch {
    return null
  }
}

/** Domain-only public-widget check (no scheme). Fail-closed on DNS errors. */
export async function assertSafePublicDomain(
  domain: string,
  lookup?: DnsLookup,
): Promise<boolean> {
  const host = String(domain || '')
    .toLowerCase()
    .replace(/\.$/, '')
  if (!host || isBlockedHostname(host)) return false
  return !(await dnsResolvesToBlocked(host, lookup))
}

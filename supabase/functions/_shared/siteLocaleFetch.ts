/**
 * Edge-side companion of siteLocale.ts: read a site's homepage (SSRF-guarded on every hop,
 * bounded in time and size) so a new project gets the site's real language. Best-effort —
 * any failure returns the URL/TLD-based guess, which defaults to English.
 */

import { assertSafeOutboundUrl, cachedLookup, resolveSafeRedirectTarget } from './ssrf.ts'
import { inferSiteLocale, type SiteLanguage, type SiteMarket } from './siteLocale.ts'

const MAX_BYTES = 64 * 1024

export async function fetchHomepageHead(rawUrl: string, timeoutMs: number): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const lookup = cachedLookup()
  try {
    let current = await assertSafeOutboundUrl(rawUrl, { lookup })
    for (let hop = 0; current && hop <= 3; hop++) {
      const res = await fetch(current.toString(), {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': 'RankdeltaBot/1.0 (+https://rankdelta.ai)', accept: 'text/html' },
      })
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel()
        current = await resolveSafeRedirectTarget(current, res.headers.get('location'), { lookup })
        continue
      }
      if (!res.ok || !res.body) return null
      // The <html lang> sits in the first bytes; never buffer a whole page.
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      while (size < MAX_BYTES) {
        const { done, value } = await reader.read()
        if (done || !value) break
        chunks.push(value)
        size += value.length
      }
      await reader.cancel()
      const buf = new Uint8Array(size)
      let offset = 0
      for (const c of chunks) {
        buf.set(c, offset)
        offset += c.length
      }
      return new TextDecoder().decode(buf)
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function detectSiteLocale(opts: {
  url: string
  language?: string | null
  market?: string | null
  timeoutMs?: number
}): Promise<{ language: SiteLanguage; market: SiteMarket }> {
  const needsPage = !opts.language
  const html = needsPage ? await fetchHomepageHead(opts.url, opts.timeoutMs ?? 5000) : null
  return inferSiteLocale({ url: opts.url, html, language: opts.language, market: opts.market })
}

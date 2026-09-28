/**
 * HTML / header / cart.js Online Store fingerprint + in-process fetch.
 * Keep in sync with src/lib/connectorContract.ts and ai-visibility-check.
 * Packed into Checkout, prestashop-connector, squarespace-oauth-callback,
 * and shopify-storefront-probe.
 * Connector-api inlines a slimmer copy instead of importing this file (MCP size).
 * Recency selectors stay in shopifyStorefront.ts.
 */

import { assertSafeOutboundUrl, cachedLookup, isBlockedHostname, resolveSafeRedirectTarget } from './ssrf.ts'

export function htmlLooksLikeShopifyStorefront(html: string): boolean {
  const s = String(html || '').toLowerCase()
  return Boolean(s) && (
    s.includes('cdn.shopify.com/shopifycloud') ||
    s.includes('cdn.shopify.com/s/javascripts') ||
    s.includes('cdn.shopify.com/s/assets') ||
    s.includes('cdn.shopifycdn.net') ||
    s.includes('/cdn/shop/') ||
    s.includes('monorail-edge.shopifysvc.com') ||
    s.includes('shopify-section') ||
    s.includes('id="shopify-features"') ||
    s.includes("id='shopify-features'") ||
    s.includes('window.shopify') ||
    /\bshopify\.theme\b/.test(s) ||
    /\bshopify\.shop\b/.test(s)
  )
}

export function headerTextLooksLikeShopifyStorefront(headerText: string): boolean {
  const s = String(headerText || '').toLowerCase()
  return Boolean(s) && (
    /(?:^|[\n\r])(?:x-)?powered-by:[^\n\r]*\bshopify\b/.test(s) ||
    /(?:^|[\n\r])x-shopid:/.test(s) ||
    /(?:^|[\n\r])x-shopify-stage:/.test(s) ||
    /(?:^|[\n\r])x-sorting-hat-shopid:/.test(s) ||
    /(?:^|[\n\r])shopify-complexity-score:/.test(s) ||
    /_shopify_(y|s|essential|tm|tw)=/.test(s)
  )
}

type ShopifyCartJs = {
  token?: unknown
  items?: unknown
  item_count?: unknown
  currency?: unknown
  items_subtotal_price?: unknown
  original_total_price?: unknown
}

export function cartJsLooksLikeShopifyStorefront(body: string): boolean {
  const t = String(body || '').trim()
  if (!t.startsWith('{')) return false
  try {
    const j = JSON.parse(t) as ShopifyCartJs
    return (
      typeof j.token === 'string' &&
      j.token.length > 0 &&
      Array.isArray(j.items) &&
      typeof j.item_count === 'number' &&
      typeof j.currency === 'string' &&
      (typeof j.items_subtotal_price === 'number' || typeof j.original_total_price === 'number')
    )
  } catch {
    return false
  }
}

export function httpLooksLikeShopifyStorefront(input: {
  headerText?: string | null
  html?: string | null
}): boolean {
  return headerTextLooksLikeShopifyStorefront(input.headerText || '') ||
    htmlLooksLikeShopifyStorefront(input.html || '')
}

export function isShopifyOwnedOnboardingHost(input: string): boolean {
  try {
    const host = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`).hostname.toLowerCase().replace(/\.$/, '')
    return host === 'myshopify.com' || host.endsWith('.myshopify.com') ||
      host === 'admin.shopify.com' || host === 'checkout.shopify.com'
  } catch {
    return false
  }
}

function isBlockedFetchHost(hostname: string): boolean {
  return isBlockedHostname(hostname)
}

/** Manual redirect follower — re-validates every hop (hostname + DNS). */
async function fetchWithSsrfGuard(
  startUrl: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? 4000
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const lookup = cachedLookup()
  try {
    const start = await assertSafeOutboundUrl(startUrl, { lookup })
    if (!start) throw new Error('blocked_redirect')
    let current = start
    let res: Response
    for (let hop = 0; ; hop++) {
      res = await fetch(current.toString(), { ...init, signal: ctrl.signal, redirect: 'manual' })
      if (res.status < 300 || res.status >= 400) return res
      const loc = res.headers.get('location')
      if (!loc || hop >= 5) throw new Error('too_many_redirects')
      const next = await resolveSafeRedirectTarget(current, loc, { lookup })
      if (!next) throw new Error('blocked_redirect')
      current = next
    }
  } finally {
    clearTimeout(timer)
  }
}

export function headerTextFromResponse(res: Response): string {
  const lines: string[] = []
  res.headers.forEach((v, k) => lines.push(`${k}: ${v}`))
  const cookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  if (typeof cookies === 'function') for (const c of cookies.call(res.headers)) lines.push(`set-cookie: ${c}`)
  return lines.join('\n')
}

async function originCartLooksLikeShopify(pageUrl: string): Promise<boolean> {
  try {
    const cartUrl = new URL('/cart.js', pageUrl)
    if (isBlockedFetchHost(cartUrl.hostname) || isShopifyOwnedOnboardingHost(cartUrl.hostname)) {
      return isShopifyOwnedOnboardingHost(cartUrl.hostname)
    }
    const res = await fetchWithSsrfGuard(cartUrl.toString(), {
      method: 'GET',
      timeoutMs: 2500,
      headers: { 'user-agent': 'Rankdelta-ShopifyGuard/1.0', accept: 'application/json,text/javascript,*/*' },
    })
    if (res.url && isShopifyOwnedOnboardingHost(res.url)) return true
    try {
      if (isBlockedFetchHost(new URL(res.url || cartUrl.toString()).hostname)) return false
    } catch { return false }
    return cartJsLooksLikeShopifyStorefront((await res.text()).slice(0, 20_000))
  } catch { return false }
}

export type ShopifyStorefrontFetchVerdict = 'shopify' | 'clear' | 'unknown'

/**
 * Fetch HTML / headers / cart.js. `unknown` means we could not prove the host
 * is or is not an Online Store (timeout, SSRF block, DNS). Do not return
 * shopify:false in that case.
 */
export async function classifyShopifyStorefrontUrl(url: string): Promise<ShopifyStorefrontFetchVerdict> {
  try {
    if (isShopifyOwnedOnboardingHost(url)) return 'shopify'
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'unknown'
    if (isBlockedFetchHost(parsed.hostname)) return 'unknown'
    try {
      const res = await fetchWithSsrfGuard(parsed.toString(), {
        method: 'GET',
        timeoutMs: 4000,
        headers: { 'user-agent': 'Rankdelta-ShopifyGuard/1.0', accept: 'text/html' },
      })
      if (res.url && isShopifyOwnedOnboardingHost(res.url)) return 'shopify'
      const buf = await res.arrayBuffer()
      const html = new TextDecoder('utf-8', { fatal: false }).decode(buf.byteLength > 400_000 ? buf.slice(0, 400_000) : buf)
      if (httpLooksLikeShopifyStorefront({ headerText: headerTextFromResponse(res), html })) return 'shopify'
      if (await originCartLooksLikeShopify(res.url || parsed.toString())) return 'shopify'
      return 'clear'
    } catch { return 'unknown' }
  } catch { return 'unknown' }
}

/** True only when the host is definitely an Online Store. Billing must use storefrontVerdictRefusesStripe. */
export async function urlLooksLikeShopifyStorefront(url: string): Promise<boolean> {
  return (await classifyShopifyStorefrontUrl(url)) === 'shopify'
}

/** App Store 1.2: refuse Stripe unless a live fetch proved this is not an Online Store. */
export function storefrontVerdictRefusesStripe(verdict: ShopifyStorefrontFetchVerdict): boolean {
  return verdict !== 'clear'
}

/** True when any probed homepage is Shopify or unverified (do not fail-open Checkout). */
export async function anyStorefrontUrlRefusesStripe(urls: string[]): Promise<boolean> {
  if (urls.length === 0) return false
  const verdicts = await Promise.all(urls.map((u) => classifyShopifyStorefrontUrl(u)))
  return verdicts.some(storefrontVerdictRefusesStripe)
}

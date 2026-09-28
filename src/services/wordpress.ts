/**
 * WordPress REST API connector.
 *
 * Supports two auth methods:
 *   1. Application Password (recommended for production)
 *   2. JWT token (for sites with JWT Auth plugin)
 *
 * Connection is stored in Supabase `wp_connections`. Since migration 027 the `app_password`
 * column is column-locked for browser clients: any client `select('*')` on wp_connections fails
 * with 42501, and the password must never reach the browser. Authenticated writes (create/update
 * post, media upload, category, Rank Math meta) run server-side in the `wp-publish` edge
 * function — use `publishViaEdge()` below. The browser only ever holds `WPSiteInfo`.
 */

import { supabase } from '../lib/supabaseClient'
import { isProxyEnabled, proxyFetchText } from './edgeProxy'
import { parseHttpUrl } from '../../supabase/functions/_shared/ssrf'

/** True when the URL is http(s), has no userinfo, and is not a private/loopback host. */
export function isAllowedWpSiteUrl(raw: string, requireHttps = true): boolean {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return false
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return parseHttpUrl(withProto, { httpsOnly: requireHttps }) !== null
}

export function normalizeWpSiteUrl(raw: string, requireHttps = true): string {
  const trimmed = String(raw || '').trim()
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const parsed = parseHttpUrl(withProto, { httpsOnly: requireHttps })
  if (!parsed) throw new Error('WordPress site URL not allowed')
  return parsed.origin.replace(/\/$/, '')
}

/**
 * Credentials typed by the user in the CURRENT session (connection setup / ping).
 * Never build one of these from the database — the password is not readable there.
 */
export interface WPConnection {
  id: string
  siteUrl: string
  username: string
  appPassword: string
}

/** Non-secret connection info readable by browser clients (no app password). */
export interface WPSiteInfo {
  id: string
  siteUrl: string
  username: string
}

export interface WPPost {
  id: number
  link: string
  slug: string
  title: { rendered: string }
  content?: { rendered: string } // omitted by the public reads (getPosts/getPages) to keep payloads small
  status: 'publish' | 'draft' | 'pending'
  featured_media: number
  categories: number[]
  tags: number[]
  meta: Record<string, unknown>
}

export interface WPMediaUpload {
  id: number
  source_url: string
  alt_text: string
}

export interface PublishPayload {
  title: string
  content: string       // Gutenberg block HTML
  slug: string
  status?: 'publish' | 'draft'
  categories?: number[]
  tags?: number[]
  featuredMediaId?: number
  rankMathMeta?: {
    title: string
    description: string
    focusKeyword: string
  }
}

export interface SitemapEntry {
  url: string
  lastmod?: string
  priority?: number
}

/**
 * Direct WordPress REST client.
 *
 * MUST only be constructed with credentials the user typed in the current session (the
 * connection-setup ping), or with EMPTY credentials for public, unauthenticated reads
 * (`getSitemapUrls`, `getPosts`, `getPages`). Never construct it from a database row: the
 * application password is column-locked for browser clients (migration 027). Every
 * authenticated write goes through `publishViaEdge()` (wp-publish edge function).
 */
export class WordPressClient {
  private baseUrl: string
  private authHeader: string
  private hasCredentials: boolean

  constructor(connection: WPConnection) {
    this.hasCredentials = Boolean(connection.username && connection.appPassword)
    this.baseUrl = normalizeWpSiteUrl(connection.siteUrl, this.hasCredentials)
    this.authHeader = this.hasCredentials
      ? `Basic ${btoa(`${connection.username}:${connection.appPassword}`)}`
      : ''
  }

  /**
   * Public (unauthenticated) GET on the site's REST API. Goes through the seo-proxy edge
   * function when enabled (avoids CORS on customer sites), else a direct fetch without auth.
   */
  private async publicGet<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}/wp-json/wp/v2${endpoint}`
    if (isProxyEnabled()) {
      const text = await proxyFetchText(url)
      if (!text) throw new Error(`WP public API empty response on ${endpoint}`)
      return JSON.parse(text) as T
    }
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`WP API ${res.status} on ${endpoint}: ${body.slice(0, 200)}`)
    }
    return res.json() as T
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/wp-json/wp/v2${endpoint}`
    const res = await fetch(url, {
      ...options,
      headers: {
        ...(this.hasCredentials ? { Authorization: this.authHeader } : {}),
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`WP API ${res.status} on ${endpoint}: ${body.slice(0, 200)}`)
    }

    return res.json() as T
  }

  /** Verify credentials work. Never sends Basic auth to a non-https or private URL. */
  async ping(): Promise<{ name: string; url: string; version: string }> {
    if (!this.hasCredentials) throw new Error('WordPress credentials required')
    const res = await fetch(`${this.baseUrl}/wp-json`, {
      headers: { Authorization: this.authHeader },
    })
    if (!res.ok) throw new Error(`Cannot connect to ${this.baseUrl}`)
    const data = (await res.json()) as { name?: string; url?: string; namespaces?: string }
    return { name: data.name ?? '', url: data.url ?? '', version: data.namespaces ?? '' }
  }

  /** Get all published posts (paginated). Public read — works without credentials. */
  async getPosts(page = 1, perPage = 100): Promise<WPPost[]> {
    return this.publicGet<WPPost[]>(
      `/posts?per_page=${perPage}&page=${page}&status=publish&_fields=id,link,slug,title,status,categories,featured_media`
    )
  }

  /** Get all pages. Public read — works without credentials. */
  async getPages(): Promise<WPPost[]> {
    return this.publicGet<WPPost[]>(
      '/pages?per_page=100&status=publish&_fields=id,link,slug,title'
    )
  }

  /** Get existing categories */
  async getCategories(): Promise<Array<{ id: number; name: string; slug: string }>> {
    return this.request('/categories?per_page=100')
  }

  /** Create category if not exists, return ID */
  async ensureCategory(name: string): Promise<number> {
    const categories = await this.getCategories()
    const existing = categories.find(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    )
    if (existing) return existing.id

    const created = await this.request<{ id: number }>('/categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    return created.id
  }

  /** Upload image from URL, return media ID */
  async uploadImageFromUrl(
    imageUrl: string,
    filename: string,
    altText: string
  ): Promise<WPMediaUpload> {
    // Fetch the image as blob
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) throw new Error(`Cannot fetch image: ${imageUrl}`)
    const blob = await imgRes.blob()

    const formData = new FormData()
    formData.append('file', blob, filename)
    formData.append('alt_text', altText)

    const res = await fetch(`${this.baseUrl}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: { Authorization: this.authHeader },
      body: formData,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Media upload failed: ${err.slice(0, 200)}`)
    }

    return res.json() as Promise<WPMediaUpload>
  }

  /** Publish a new post */
  async publishPost(payload: PublishPayload): Promise<WPPost> {
    const body: Record<string, unknown> = {
      title: payload.title,
      content: payload.content,
      slug: payload.slug,
      status: payload.status ?? 'publish',
    }

    if (payload.categories?.length) body['categories'] = payload.categories
    if (payload.tags?.length) body['tags'] = payload.tags
    if (payload.featuredMediaId) body['featured_media'] = payload.featuredMediaId

    const post = await this.request<WPPost>('/posts', {
      method: 'POST',
      body: JSON.stringify(body),
    })

    // Set Rank Math meta if available
    if (payload.rankMathMeta) {
      await this.setRankMathMeta(post.id, payload.rankMathMeta)
    }

    return post
  }

  /** Update an existing post (preserves URL & backlinks). */
  async updatePost(postId: number, payload: Partial<PublishPayload>): Promise<WPPost> {
    const updated = await this.request<WPPost>(`/posts/${postId}`, {
      method: 'POST',
      body: JSON.stringify({
        ...(payload.title && { title: payload.title }),
        ...(payload.content && { content: payload.content }),
        ...(payload.status && { status: payload.status }),
        ...(payload.featuredMediaId && { featured_media: payload.featuredMediaId }),
      }),
    })
    if (payload.rankMathMeta) {
      await this.setRankMathMeta(postId, payload.rankMathMeta)
    }
    return updated
  }

  /** Set Rank Math SEO meta via post meta */
  private async setRankMathMeta(
    postId: number,
    meta: { title: string; description: string; focusKeyword: string }
  ): Promise<void> {
    await this.request(`/posts/${postId}`, {
      method: 'POST',
      body: JSON.stringify({
        meta: {
          rank_math_title: meta.title,
          rank_math_description: meta.description,
          rank_math_focus_keyword: meta.focusKeyword,
        },
      }),
    })
  }

  /** Fetch and parse sitemap to get all indexed URLs */
  async getSitemapUrls(): Promise<SitemapEntry[]> {
    const urls: SitemapEntry[] = []

    const tryFetch = async (sitemapUrl: string): Promise<string | null> => {
      try {
        if (isProxyEnabled()) return (await proxyFetchText(sitemapUrl)) || null
        const res = await fetch(sitemapUrl)
        if (!res.ok) return null
        return res.text()
      } catch {
        return null
      }
    }

    // Try common sitemap locations
    const candidates = [
      `${this.baseUrl}/sitemap.xml`,
      `${this.baseUrl}/sitemap_index.xml`,
      `${this.baseUrl}/wp-sitemap.xml`,
    ]

    for (const candidate of candidates) {
      const xml = await tryFetch(candidate)
      if (!xml) continue

      // Extract sub-sitemaps if index
      if (xml.includes('<sitemapindex')) {
        const subMatches = xml.matchAll(/<loc>(.*?)<\/loc>/g)
        for (const m of subMatches) {
          const subLoc = m[1]?.trim()
          if (!subLoc) continue
          const subXml = await tryFetch(subLoc)
          if (subXml) {
            urls.push(...this.parseUrlset(subXml))
          }
        }
        break
      }

      // Direct urlset
      if (xml.includes('<urlset')) {
        urls.push(...this.parseUrlset(xml))
        break
      }
    }

    return urls
  }

  private parseUrlset(xml: string): SitemapEntry[] {
    const entries: SitemapEntry[] = []
    const urlMatches = xml.matchAll(/<url>([\s\S]*?)<\/url>/g)
    for (const m of urlMatches) {
      const block = m[1]
      if (!block) continue
      const loc = block.match(/<loc>(.*?)<\/loc>/)?.[1]?.trim()
      const lastmod = block.match(/<lastmod>(.*?)<\/lastmod>/)?.[1]?.trim()
      const priority = parseFloat(
        block.match(/<priority>(.*?)<\/priority>/)?.[1] ?? '0.5'
      )
      if (loc) entries.push({ url: loc, lastmod, priority })
    }
    return entries
  }
}

/**
 * Create a WP client from credentials the user typed in the current session.
 * Never pass a database row — see the WordPressClient doc comment.
 */
export function createWPClient(connection: WPConnection): WordPressClient {
  return new WordPressClient(connection)
}

/** Read-only client for a site's PUBLIC endpoints (sitemap, published posts). No credentials. */
export function createPublicWPClient(site: { siteUrl: string }): WordPressClient {
  return new WordPressClient({ id: 'public', siteUrl: site.siteUrl, username: '', appPassword: '' })
}

// ─── SERVER-SIDE PUBLISHING (wp-publish edge function) ───────────────────────

export interface EdgePublishArticle {
  title: string
  slug?: string
  contentHtml: string
  excerpt?: string
  featuredImageUrl?: string
  categoryName?: string
  rankMath?: { title?: string; description?: string; focusKeyword?: string }
}

export interface EdgePublishResult {
  postId: number
  postUrl: string
  status: 'draft' | 'publish'
  featuredMediaId?: number
}

/**
 * Create (or, with `postId`, update) a WordPress post through the `wp-publish` edge function.
 * The function resolves the project's credentials with service_role, uploads the featured
 * image, ensures the category and writes the Rank Math meta — the browser never sees the
 * application password. Error mapping mirrors `publishStandaloneArticle`.
 */
export async function publishViaEdge(
  projectId: string,
  article: EdgePublishArticle,
  status: 'publish' | 'draft' = 'draft',
  postId?: number
): Promise<EdgePublishResult> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean
    postId?: number
    postUrl?: string
    status?: 'draft' | 'publish'
    featuredMediaId?: number
    error?: string
  }>('wp-publish', {
    body: {
      projectId,
      status,
      ...(postId ? { postId } : {}),
      article,
    },
  })

  if (error) {
    // FunctionsHttpError carries the response; surface the server's error code when present.
    let code = ''
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const body = (await ctx.json()) as { error?: unknown } | null
        code = String(body?.error ?? '')
      }
    } catch {
      /* ignore */
    }
    if (code === 'no_connection') throw new Error('Nessun sito WordPress collegato a questo progetto.')
    if (code === 'redirect_not_allowed') throw new Error('Il sito WordPress risponde con un redirect: controlla l’URL del sito (http/https, www).')
    throw new Error(code ? `Pubblicazione WordPress fallita (${code})` : 'Pubblicazione WordPress fallita')
  }
  if (!data?.ok || typeof data.postId !== 'number') {
    throw new Error(data?.error ? `Pubblicazione WordPress fallita (${data.error})` : 'Pubblicazione WordPress fallita')
  }

  return {
    postId: data.postId,
    postUrl: data.postUrl ?? '',
    status: data.status ?? status,
    featuredMediaId: data.featuredMediaId,
  }
}

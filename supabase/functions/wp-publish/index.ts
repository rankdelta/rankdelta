/**
 * wp-publish — server-side WordPress publishing.
 *
 * HIGH severity fix (wave-4): the browser previously read wp_connections.app_password via
 * PostgREST and did Basic auth against the customer's WP REST API from the client. This
 * function moves that server-side: the client sends { projectId, article, status } and the
 * function resolves the credentials with service_role — the password never reaches the browser.
 *
 * Auth: caller JWT required; the connection row AND the project must belong to the caller.
 *
 * Request (POST, JSON) — backward compatible with the original { projectId, article, status }:
 *   {
 *     projectId: string,
 *     article: {
 *       title: string,
 *       slug?: string,
 *       contentHtml: string,
 *       excerpt?: string,
 *       featuredImageUrl?: string,   // http(s) URL; downloaded server-side (SSRF-guarded, ≤ 8 MB,
 *                                    // 20 s) and uploaded to /wp-json/wp/v2/media → featured_media.
 *                                    // Best-effort: a failure is logged and does not fail the publish.
 *       categoryName?: string,       // find-or-create the category by name → `categories`. Best-effort.
 *       rankMath?: { title?: string, description?: string, focusKeyword?: string },
 *                                    // Rank Math SEO post meta (rank_math_title / _description /
 *                                    // _focus_keyword). Best-effort second request after the publish.
 *     },
 *     status?: 'draft' | 'publish',  // default 'draft'
 *     postId?: number,               // when given, PUT /wp-json/wp/v2/posts/{postId} (update) instead
 *                                    // of POST /wp-json/wp/v2/posts (create)
 *   }
 * Response 200: { ok: true, postId: number, postUrl: string, status: 'draft'|'publish', featuredMediaId?: number }
 * Errors: 400 invalid_request | 400 redirect_not_allowed (the WP site answered with a 3xx — we never
 *         follow redirects while carrying Basic auth) | 401 unauthorized | 404 no_connection |
 *         500 internal error.
 *
 * CORS origin-echo allowlist replaces '*'. The old TODO
 * ("tighten to allowlist when wiring into the app router") is now resolved. Consistent
 * with seo-proxy (#65), create-checkout-session, cancel-subscription, create-portal-session,
 * update-subscription, api-keys. JWT auth already required, so this is defense-in-depth.
 *
 * Fix 2026-09 (security wave): WP requests use `redirect: 'manual'` — with the default `follow`
 * a compromised/misconfigured site could 3xx the Basic-auth request to an attacker host.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertSafeOutboundUrl, cachedLookup, resolveSafeRedirectTarget } from '../_shared/ssrf.ts';
import { publishableKey, secretKey } from '../_shared/supabaseKeys.ts';
import { allowedBrowserOrigins } from '../_shared/appOrigin.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = publishableKey();
const SERVICE_KEY = secretKey();

const allowedOrigins = allowedBrowserOrigins([]);

const corsHeaders = (req: Request) => {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  const origin = req.headers.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Vary'] = 'Origin';
  }
  return h;
};

const json = (b: unknown, s = 200, cors?: Record<string, string>) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...(cors ?? {}), 'Content-Type': 'application/json' } });

interface ArticlePayload {
  title: string;
  slug?: string;
  contentHtml: string;
  excerpt?: string;
  rankMath?: { title?: string; description?: string; focusKeyword?: string };
  featuredImageUrl?: string;
  categoryName?: string;
}

const WP_TIMEOUT_MS = 30_000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 20_000;

/** Thrown when the customer's WP site answers a credentialed request with a 3xx (never followed). */
class RedirectNotAllowedError extends Error {
  constructor() {
    super('redirect_not_allowed');
  }
}

/**
 * Credentialed request to the customer's WP REST API. Redirects are NEVER followed: with Basic auth
 * on the request, a 3xx to another host would leak the application password. Any 3xx → 400.
 */
async function wpFetch(url: string, authHeader: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: authHeader },
    });
    if (res.status >= 300 && res.status < 400) throw new RedirectNotAllowedError();
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download a public image with the SSRF guard (http/https only, every redirect hop re-validated,
 * ≤ 8 MB, 20 s). Returns null on any problem — the caller treats the featured image as best-effort.
 */
async function downloadImage(rawUrl: string): Promise<{ bytes: Uint8Array; contentType: string; filename: string } | null> {
  const lookup = cachedLookup();
  const start = await assertSafeOutboundUrl(rawUrl, { lookup });
  if (!start) return null;
  let url = start;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMAGE_TIMEOUT_MS);
  try {
    let res: Response;
    for (let hop = 0; ; hop++) {
      res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'Rankdelta/1.0 (+wp-publish)', Accept: 'image/*' },
        redirect: 'manual',
        signal: ctrl.signal,
      });
      if (res.status < 300 || res.status >= 400) break;
      const loc = res.headers.get('location');
      if (!loc || hop >= 5) return null;
      const next = await resolveSafeRedirectTarget(url, loc, { lookup });
      if (!next) return null;
      url = next;
    }
    if (!res.ok || !res.body) return null;
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) return null;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > IMAGE_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.byteLength;
    }
    const ext = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'img';
    const base = (url.pathname.split('/').pop() || '').replace(/[^a-zA-Z0-9._-]/g, '').replace(/\.[^.]*$/, '') || 'featured';
    return { bytes, contentType, filename: `${base.slice(0, 60)}.${ext}` };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Upload bytes to /wp-json/wp/v2/media. Returns the attachment id, or null (best-effort). */
async function wpUploadMedia(
  base: string,
  authHeader: string,
  img: { bytes: Uint8Array; contentType: string; filename: string },
  title: string,
): Promise<number | null> {
  try {
    const res = await wpFetch(`${base}/wp-json/wp/v2/media`, authHeader, {
      method: 'POST',
      headers: {
        'Content-Type': img.contentType,
        'Content-Disposition': `attachment; filename="${img.filename}"`,
      },
      body: img.bytes,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !Number.isFinite(Number(j?.id))) {
      console.error('wp-publish media upload failed:', res.status, String(j?.message ?? '').slice(0, 200));
      return null;
    }
    const id = Number(j.id);
    // Alt text / title are cosmetic — ignore failures.
    await wpFetch(`${base}/wp-json/wp/v2/media/${id}`, authHeader, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alt_text: title.slice(0, 200), title: title.slice(0, 200) }),
    }).catch(() => null);
    return id;
  } catch (e) {
    if (e instanceof RedirectNotAllowedError) throw e;
    console.error('wp-publish media upload threw:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** Find a category by exact (case-insensitive) name, creating it if missing. Returns id or null (best-effort). */
async function wpFindOrCreateCategory(base: string, authHeader: string, name: string): Promise<number | null> {
  const wanted = name.trim().slice(0, 100);
  if (!wanted) return null;
  try {
    const found = await wpFetch(
      `${base}/wp-json/wp/v2/categories?search=${encodeURIComponent(wanted)}&per_page=50&_fields=id,name`,
      authHeader,
      { method: 'GET' },
    );
    const list = (await found.json().catch(() => [])) as Array<{ id?: number; name?: string }>;
    if (found.ok && Array.isArray(list)) {
      const hit = list.find((c) => String(c?.name ?? '').trim().toLowerCase() === wanted.toLowerCase());
      if (hit && Number.isFinite(Number(hit.id))) return Number(hit.id);
    }
    const created = await wpFetch(`${base}/wp-json/wp/v2/categories`, authHeader, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: wanted }),
    });
    const j = await created.json().catch(() => ({}));
    if (created.ok && Number.isFinite(Number(j?.id))) return Number(j.id);
    // WP answers 400 term_exists (with the existing id) when the search missed, e.g. on slug collisions.
    const existing = Number(j?.data?.term_id);
    if (j?.code === 'term_exists' && Number.isFinite(existing)) return existing;
    console.error('wp-publish category failed:', created.status, String(j?.message ?? '').slice(0, 200));
    return null;
  } catch (e) {
    if (e instanceof RedirectNotAllowedError) throw e;
    console.error('wp-publish category threw:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function wpPublishPost(
  siteUrl: string,
  username: string,
  appPassword: string,
  article: ArticlePayload,
  status: 'draft' | 'publish',
  postId: number | null,
): Promise<{ id: number; link: string; featuredMediaId?: number }> {
  const safe = await assertSafeOutboundUrl(siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`, {
    httpsOnly: true,
  });
  if (!safe) {
    throw new Error('WordPress site URL not allowed');
  }
  const baseUrl = safe;
  const base = baseUrl.origin.replace(/\/$/, '');
  const authHeader = `Basic ${btoa(`${username}:${appPassword}`)}`;

  // Best-effort extras: featured image + category. Failures are logged and never block the publish.
  let featuredMediaId: number | null = null;
  if (article.featuredImageUrl) {
    const img = await downloadImage(article.featuredImageUrl);
    if (img) featuredMediaId = await wpUploadMedia(base, authHeader, img, article.title);
    else console.error('wp-publish featured image skipped (download failed / not allowed)');
  }
  let categoryId: number | null = null;
  if (article.categoryName) categoryId = await wpFindOrCreateCategory(base, authHeader, article.categoryName);

  const payload: Record<string, unknown> = {
    title: article.title,
    content: article.contentHtml,
    excerpt: article.excerpt || undefined,
    slug: article.slug || undefined,
    status,
  };
  if (featuredMediaId) payload.featured_media = featuredMediaId;
  if (categoryId) payload.categories = [categoryId];

  const target = postId ? `${base}/wp-json/wp/v2/posts/${postId}` : `${base}/wp-json/wp/v2/posts`;
  const res = await wpFetch(target, authHeader, {
    method: postId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`WP publish failed (${res.status}): ${String(j?.message ?? '').slice(0, 200)}`);
  }
  const id = Number(j.id);

  // Best-effort Rank Math SEO meta (same keys the legacy browser client wrote).
  const rm = article.rankMath;
  if (rm && (rm.title || rm.description || rm.focusKeyword)) {
    try {
      const metaRes = await wpFetch(`${base}/wp-json/wp/v2/posts/${id}`, authHeader, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meta: {
            ...(rm.title ? { rank_math_title: rm.title } : {}),
            ...(rm.description ? { rank_math_description: rm.description } : {}),
            ...(rm.focusKeyword ? { rank_math_focus_keyword: rm.focusKeyword } : {}),
          },
        }),
      });
      if (!metaRes.ok) console.error('wp-publish rank math meta failed:', metaRes.status);
    } catch (e) {
      console.error('wp-publish rank math meta threw:', e instanceof Error ? e.message : String(e));
    }
  }

  return { id, link: String(j.link ?? ''), ...(featuredMediaId ? { featuredMediaId } : {}) };
}

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'unauthorized' }, 401, cors);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401, cors);
  const userId = userData.user.id;

  try {
    const body = await req.json();
    const projectId = typeof body?.projectId === 'string' ? body.projectId : '';
    const rawArticle = body?.article as Partial<ArticlePayload> | undefined;
    const status = body?.status === 'publish' ? 'publish' : 'draft';
    const postId = Number.isInteger(body?.postId) && body.postId > 0 ? Number(body.postId) : null;

    if (!projectId || typeof rawArticle?.title !== 'string' || !rawArticle.title || typeof rawArticle?.contentHtml !== 'string' || !rawArticle.contentHtml) {
      return json({ error: 'invalid_request' }, 400, cors);
    }
    const article: ArticlePayload = {
      title: rawArticle.title,
      contentHtml: rawArticle.contentHtml,
      slug: typeof rawArticle.slug === 'string' ? rawArticle.slug : undefined,
      excerpt: typeof rawArticle.excerpt === 'string' ? rawArticle.excerpt : undefined,
      featuredImageUrl: typeof rawArticle.featuredImageUrl === 'string' ? rawArticle.featuredImageUrl.trim() : undefined,
      categoryName: typeof rawArticle.categoryName === 'string' ? rawArticle.categoryName.trim() : undefined,
      rankMath:
        rawArticle.rankMath && typeof rawArticle.rankMath === 'object'
          ? {
              title: typeof rawArticle.rankMath.title === 'string' ? rawArticle.rankMath.title.slice(0, 200) : undefined,
              description:
                typeof rawArticle.rankMath.description === 'string' ? rawArticle.rankMath.description.slice(0, 400) : undefined,
              focusKeyword:
                typeof rawArticle.rankMath.focusKeyword === 'string' ? rawArticle.rankMath.focusKeyword.slice(0, 200) : undefined,
            }
          : undefined,
    };

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Resolve credentials server-side; verify ownership of BOTH the connection row and the project.
    const { data: conn, error: connErr } = await admin
      .from('wp_connections')
      .select('id, user_id, site_url, username, app_password')
      .eq('project_id', projectId)
      .maybeSingle();
    if (connErr) throw connErr;
    if (!conn || conn.user_id !== userId) return json({ error: 'no_connection' }, 404, cors);
    const { data: project, error: projErr } = await admin
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .maybeSingle();
    if (projErr) throw projErr;
    if (!project || project.user_id !== userId) return json({ error: 'no_connection' }, 404, cors);

    const { id, link, featuredMediaId } = await wpPublishPost(
      String(conn.site_url),
      String(conn.username),
      String(conn.app_password),
      article,
      status,
      postId,
    );

    return json({ ok: true, postId: id, postUrl: link, status, ...(featuredMediaId ? { featuredMediaId } : {}) }, 200, cors);
  } catch (e) {
    if (e instanceof RedirectNotAllowedError) return json({ error: 'redirect_not_allowed' }, 400, cors);
    console.error('wp-publish error:', e instanceof Error ? e.message : String(e));
    return json({ error: 'internal error' }, 500, cors);
  }
});

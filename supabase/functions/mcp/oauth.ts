/**
 * Minimal OAuth 2.1 + PKCE for Claude Desktop / Cowork / claude.ai custom connectors.
 *
 * Flow: Claude discovers this AS → DCR → browser /authorize (user pastes sk_rankdelta_…)
 * → redirect with code → /token returns the same API key as access_token (Cursor/Codex
 * keep using Authorization: Bearer sk_rankdelta_… directly).
 *
 * Codes are AES-GCM sealed JSON (no DB). Secret: MCP_OAUTH_SECRET or derived from the Supabase
 * secret key (_shared/supabaseKeys.ts: SUPABASE_SECRET_KEYS, falling back to
 * SUPABASE_SERVICE_ROLE_KEY) — must be stable across isolates.
 */

import { matchApiKeyPrefix, hashApiKey, type Sb } from '../_shared/apiKeys.ts';
import { secretKey } from '../_shared/supabaseKeys.ts';
import { appOrigin, isSelfHostEnv } from '../_shared/appOrigin.ts';

// MCP_ISSUER (e.g. https://mcp.rankdelta.ai) switches the branded MCP host without a code change;
// RESOURCE derives from it unless MCP_RESOURCE overrides it. Defaults: cloud = the rankdelta host;
// self-host = this function on your own Supabase, which is also the URL the app shows agents.
const CONFIGURED_ISSUER = Deno.env.get('MCP_ISSUER')?.replace(/\/+$/, '');
const SELF_HOST_MCP_URL = `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')}/functions/v1/mcp`;
const ISSUER = CONFIGURED_ISSUER ?? (isSelfHostEnv() ? SELF_HOST_MCP_URL : 'https://mcp.rankdelta.ai');
const RESOURCE =
  Deno.env.get('MCP_RESOURCE')?.replace(/\/+$/, '') ??
  (!CONFIGURED_ISSUER && isSelfHostEnv() ? ISSUER : `${ISSUER}/mcp`);
const CODE_TTL_MS = 5 * 60 * 1000;

export const MCP_RESOURCE = RESOURCE;
export const MCP_ISSUER = ISSUER;

const ALLOWED_REDIRECT_PREFIXES = [
  // Claude (Desktop / Cowork / claude.ai)
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
];

// ChatGPT connector callbacks are HTTPS on these EXACT hosts but the PATH varies (it carries a
// per-connection callback_id), so a path prefix can't match reliably — trust the exact host.
// No wildcard: `*.openai.com` covered help/community/status subdomains that host third-party
// content, and PKCE does NOT protect against an attacker who is himself the "client" (client_id,
// redirect_uri and code_challenge are all attacker-chosen in a crafted authorize link).
// ChatGPT and Cursor (exact hosts, https only).
const ALLOWED_REDIRECT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com', 'www.cursor.com', 'cursor.com']);

export function isAllowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.username || u.password) return false;
    // Local dev
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) {
      return true;
    }
    if (u.protocol !== 'https:') return false;
    // ChatGPT, Cursor (exact hosts)
    if (ALLOWED_REDIRECT_HOSTS.has(u.hostname)) return true;
    // Claude (exact prefixes)
    return ALLOWED_REDIRECT_PREFIXES.some((p) => uri.startsWith(p));
  } catch {
    return false;
  }
}

/**
 * Client binding. DCR stores nothing server-side, so the registered redirect_uris are sealed
 * INTO the client_id (`astroseo_dyn2_<sealed>`): /authorize and /token then require the presented
 * redirect_uri to be one the client registered — an attacker can no longer pair an arbitrary
 * client_id with an allow-listed redirect. Legacy `astroseo_dyn_<random>` ids (issued before this
 * change) keep working with the allow-list check only so existing connectors need no re-auth.
 */
const SEALED_CLIENT_PREFIX = 'astroseo_dyn2_';
const LEGACY_CLIENT_PREFIX = 'astroseo_dyn_';

interface SealedClient {
  v: 1;
  redirect_uris: string[];
  iat: number;
}

async function mintClientId(redirectUris: string[]): Promise<string> {
  return `${SEALED_CLIENT_PREFIX}${await seal({ v: 1, redirect_uris: redirectUris, iat: Math.floor(Date.now() / 1000) } satisfies SealedClient)}`;
}

/**
 * True when `redirectUri` is acceptable for `clientId`: allow-listed AND (for sealed ids)
 * registered by that client.
 */
export async function isRedirectAllowedForClient(clientId: string, redirectUri: string): Promise<boolean> {
  if (!isAllowedRedirect(redirectUri)) return false;
  if (clientId.startsWith(SEALED_CLIENT_PREFIX)) {
    const reg = await openSeal<SealedClient>(clientId.slice(SEALED_CLIENT_PREFIX.length));
    if (!reg || reg.v !== 1 || !Array.isArray(reg.redirect_uris)) return false;
    return reg.redirect_uris.includes(redirectUri);
  }
  // Legacy random ids and any other public client: allow-list only.
  return clientId.startsWith(LEGACY_CLIENT_PREFIX) || clientId.length > 0;
}

async function oauthSecretKey(): Promise<CryptoKey> {
  const raw = Deno.env.get('MCP_OAUTH_SECRET') || secretKey();
  if (!raw || raw.length < 16) {
    throw new Error('MCP OAuth secret not configured');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function seal(payload: unknown): Promise<string> {
  const key = await oauthSecretKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(payload));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt);
  return `${b64url(iv)}.${b64url(ct)}`;
}

async function openSeal<T>(token: string): Promise<T | null> {
  try {
    const [ivPart, ctPart] = token.split('.');
    if (!ivPart || !ctPart) return null;
    const key = await oauthSecretKey();
    const iv = b64urlToBytes(ivPart);
    const ct = b64urlToBytes(ctPart);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    return null;
  }
}

export function protectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: RESOURCE,
    authorization_servers: [ISSUER],
    scopes_supported: ['mcp:tools'],
    bearer_methods_supported: ['header'],
    resource_documentation: `${appOrigin()}/docs/mcp`,
  };
}

export function authorizationServerMetadata(): Record<string, unknown> {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    registration_endpoint: `${ISSUER}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp:tools'],
    // Force Dynamic Client Registration — we don't host CIMD documents yet.
    client_id_metadata_document_supported: false,
  };
}

/** RFC 7591 Dynamic Client Registration — public clients, no secret stored. */
export async function handleRegister(body: Record<string, unknown>): Promise<Response> {
  const redirectUris = Array.isArray(body.redirect_uris)
    ? (body.redirect_uris as unknown[]).filter((u): u is string => typeof u === 'string')
    : [];
  if (redirectUris.length === 0 || redirectUris.length > 10 || !redirectUris.every(isAllowedRedirect)) {
    // Hostnames only (never full URLs — they can carry callback ids) so prod logs show which clients are refused.
    console.warn('[mcp-oauth] register rejected: invalid_redirect_uri', redirectUris.map((u) => { try { return new URL(u).hostname; } catch { return 'unparsable'; } }));
    return Response.json(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be a supported Claude, ChatGPT, Cursor, or localhost callback' },
      { status: 400 },
    );
  }
  const clientId = await mintClientId(redirectUris);
  return Response.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      client_name: typeof body.client_name === 'string' ? body.client_name : 'Claude',
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  );
}

interface AuthCodePayload {
  v: 1;
  apiKey: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  exp: number;
  jti: string;
}

async function sha256B64Url(plain: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
  return b64url(digest);
}

export async function mintAuthCode(opts: {
  apiKey: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
}): Promise<string> {
  return seal({
    v: 1,
    apiKey: opts.apiKey,
    userId: opts.userId,
    clientId: opts.clientId,
    redirectUri: opts.redirectUri,
    codeChallenge: opts.codeChallenge,
    exp: Date.now() + CODE_TTL_MS,
    jti: b64url(crypto.getRandomValues(new Uint8Array(12))),
  } satisfies AuthCodePayload);
}

const usedJti = new Map<string, number>();

function rememberJti(jti: string): boolean {
  const now = Date.now();
  for (const [k, exp] of usedJti) {
    if (exp < now) usedJti.delete(k);
  }
  if (usedJti.has(jti)) return false;
  usedJti.set(jti, now + CODE_TTL_MS);
  return true;
}

export async function exchangeToken(params: URLSearchParams): Promise<Response> {
  const grant = params.get('grant_type');
  if (grant !== 'authorization_code') {
    return Response.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }
  const code = params.get('code') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const clientId = params.get('client_id') ?? '';
  const verifier = params.get('code_verifier') ?? '';
  if (!code || !redirectUri || !clientId || !verifier) {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }

  const payload = await openSeal<AuthCodePayload>(code);
  if (!payload || payload.v !== 1 || payload.exp < Date.now()) {
    return Response.json({ error: 'invalid_grant', error_description: 'code expired or invalid' }, { status: 400 });
  }
  if (payload.clientId !== clientId || payload.redirectUri !== redirectUri) {
    return Response.json({ error: 'invalid_grant', error_description: 'client/redirect mismatch' }, { status: 400 });
  }
  if (!(await isRedirectAllowedForClient(clientId, redirectUri))) {
    return Response.json({ error: 'invalid_grant', error_description: 'redirect_uri not registered for client' }, { status: 400 });
  }
  if (!rememberJti(payload.jti)) {
    return Response.json({ error: 'invalid_grant', error_description: 'code already used' }, { status: 400 });
  }
  const challenge = await sha256B64Url(verifier);
  if (challenge !== payload.codeChallenge) {
    return Response.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, { status: 400 });
  }

  // Access token = the user's personal API key — same Bearer Cursor/Codex already use.
  return Response.json(
    {
      access_token: payload.apiKey,
      token_type: 'bearer',
      expires_in: 365 * 24 * 60 * 60,
      scope: 'mcp:tools',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function validateApiKeyForAuthorize(
  db: Sb,
  rawKey: string,
): Promise<{ userId: string } | null> {
  const key = rawKey.trim();
  const prefix = matchApiKeyPrefix(key);
  if (!prefix || key.length < prefix.length + 16) return null;
  const keyHash = await hashApiKey(key);
  const { data, error } = await db
    .from('api_keys')
    .select('user_id, revoked_at')
    .eq('key_hash', keyHash)
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  return { userId: data.user_id as string };
}

export function authorizeHtml(opts: {
  error?: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
}): string {
  const err = opts.error
    ? `<p style="color:#fca5a5;background:#7f1d1d55;padding:10px 12px;border-radius:10px;font-size:14px">${escapeHtml(opts.error)}</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect Rankdelta MCP</title>
  <style>
    body{font-family:Inter,system-ui,sans-serif;background:#080808;color:#fff;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{max-width:420px;width:100%;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);border-radius:20px;padding:28px}
    h1{font-size:22px;margin:0 0 8px} p{color:rgba(255,255,255,.55);font-size:14px;line-height:1.5}
    label{display:block;font-size:12px;color:rgba(255,255,255,.45);margin:16px 0 6px}
    input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.35);color:#fff;font-family:ui-monospace,monospace;font-size:13px}
    button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:999px;background:#7c3aed;color:#fff;font-weight:600;font-size:14px;cursor:pointer}
    button:hover{background:#8b5cf6}
    a{color:#c4b5fd}
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect Rankdelta</h1>
    <p>Claude is requesting access to your AI-visibility tools. Paste a personal API key from
      <a href="${appOrigin()}/settings" target="_blank" rel="noopener">Settings → API &amp; MCP</a>.</p>
    ${err}
    <form method="POST" action="${ISSUER}/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(opts.clientId)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(opts.redirectUri)}" />
      <input type="hidden" name="state" value="${escapeHtml(opts.state)}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(opts.codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="S256" />
      <input type="hidden" name="response_type" value="code" />
      <input type="hidden" name="scope" value="${escapeHtml(opts.scope || 'mcp:tools')}" />
      <label for="api_key">API key (sk_rankdelta_…)</label>
      <input id="api_key" name="api_key" type="password" autocomplete="off" required placeholder="sk_rankdelta_…" />
      <button type="submit">Authorize Claude</button>
    </form>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function wwwAuthenticateHeader(): string {
  // Path-aware PRM (RFC 9728) for resource https://mcp.rankdelta.ai/mcp
  return `Bearer realm="mcp", resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp"`;
}

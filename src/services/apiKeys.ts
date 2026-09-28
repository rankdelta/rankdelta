/**
 * Personal API keys (sk_rankdelta_…) — Settings → API.
 * Create/list/revoke go through the api-keys Edge Function (service role writes).
 */

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabaseClient';
import { isSelfHost } from '../config/deployment';

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CreatedApiKey extends ApiKeyRow {
  /** Plaintext secret — only present on create, show once. */
  key: string;
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${token}`,
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
}

type ErrBody = { error?: string; message?: string; keys?: ApiKeyRow[] };

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/api-keys`, {
    headers: await authHeaders(),
  });
  const body = (await res.json().catch(() => ({}))) as ErrBody;
  if (!res.ok) throw new Error(body.error || `Failed to list keys (${res.status})`);
  return (body.keys ?? []) as ApiKeyRow[];
}

export async function createApiKey(name?: string): Promise<CreatedApiKey> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/api-keys`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(name ? { name } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as ErrBody & CreatedApiKey;
  if (!res.ok) throw new Error(body.message || body.error || `Failed to create key (${res.status})`);
  return body;
}

export async function revokeApiKey(id: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/api-keys?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  const body = (await res.json().catch(() => ({}))) as ErrBody;
  if (!res.ok) throw new Error(body.error || `Failed to revoke key (${res.status})`);
}

/** Branded MCP host (Vercel rewrite → Supabase `mcp` Edge Function). */
export function hostedMcpPrettyUrl(): string {
  // A self-hosted install must point agents at its own MCP function, never at our cloud.
  if (isSelfHost()) {
    const fromEnv = (import.meta.env['VITE_MCP_URL'] as string | undefined)?.trim();
    return fromEnv ? fromEnv.replace(/\/$/, '') : hostedMcpFallbackUrl();
  }
  return 'https://mcp.rankdelta.ai/mcp';
}

/**
 * Canonical MCP URL to hand users — always the branded host.
 * Override with VITE_MCP_URL if needed. Supabase function URL is the fallback.
 */
export function hostedMcpUrl(): string {
  const fromEnv = (import.meta.env['VITE_MCP_URL'] as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return hostedMcpPrettyUrl();
}

/** Direct Supabase function URL of this deployment (VITE_SUPABASE_URL + /functions/v1/mcp). */
/**
 * OAuth issuer of the MCP server the app hands agents: the authorize page posts the API key here.
 * Taken from the build config only (never from the page URL), so a crafted link cannot redirect
 * the key. Matches the server defaults in supabase/functions/mcp/oauth.ts: a `/functions/v1/mcp`
 * URL is its own issuer; a branded `…/mcp` URL has the issuer one level up.
 */
export function mcpOAuthIssuerUrl(): string {
  const url = hostedMcpPrettyUrl();
  if (url.endsWith('/functions/v1/mcp')) return url;
  return url.replace(/\/mcp$/, '');
}

export function hostedMcpFallbackUrl(): string {
  const base = (SUPABASE_URL ?? '').replace(/\/$/, '');
  return base ? `${base}/functions/v1/mcp` : '';
}

/** Tools currently available on the hosted remote MCP. Keep in sync with supabase/functions/mcp. */
export const HOSTED_MCP_TOOLS = [
  { name: 'list_sites', desc: 'List your tracked sites' },
  { name: 'add_site', desc: 'Register a new client site (name + URL), within your plan limit' },
  { name: 'get_ai_visibility', desc: 'AI Share of Voice (last 30 days)' },
  { name: 'list_ai_recommendations', desc: 'Competitors AI recommends instead of you' },
  { name: 'list_engines', desc: 'Supported AI engines' },
  { name: 'run_visibility_scan', desc: 'Capped AI-visibility scan (costs credits)' },
  { name: 'setup_ai_visibility', desc: 'One-shot AI-visibility activation for a new site (costs credits)' },
  { name: 'list_ranks', desc: 'Tracked keywords + latest stored Google position' },
  { name: 'track_rank', desc: 'Add a keyword to Rank Tracker' },
  { name: 'check_ranks', desc: 'Fresh Google SERP check for tracked keywords (costs credits)' },
  { name: 'keyword_research', desc: 'Keyword ideas — volume, difficulty, CPC, intent' },
  { name: 'audit_page', desc: 'On-page / technical snapshot for a URL' },
  { name: 'backlink_summary', desc: 'Backlinks + referring domains summary' },
  { name: 'domain_overview', desc: 'Organic traffic / keywords overview' },
  { name: 'generate_article', desc: 'GEO-oriented article draft (costs credits)' },
] as const;

export function cursorMcpConfigSnippet(url: string, keyPlaceholder = 'sk_rankdelta_…'): string {
  return JSON.stringify(
    {
      mcpServers: {
        rankdelta: {
          url,
          headers: { Authorization: `Bearer ${keyPlaceholder}` },
        },
      },
    },
    null,
    2,
  );
}

/**
 * OpenCode / self-hosted agents (Hermes, OpenClaw) config snippet.
 * OpenCode uses a different shape than Cursor: a top-level `mcp` key with
 * `type: "remote"` — NOT `mcpServers`. Pasting the Cursor snippet is the most
 * common reason an OpenCode install silently does nothing. Goes in
 * ~/.config/opencode/opencode.json (or a project-level opencode.json).
 */
export function openCodeMcpConfigSnippet(
  url: string = hostedMcpPrettyUrl(),
  keyPlaceholder = 'sk_rankdelta_…',
): string {
  return JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        rankdelta: {
          type: 'remote',
          url,
          enabled: true,
          headers: { Authorization: `Bearer ${keyPlaceholder}` },
        },
      },
    },
    null,
    2,
  );
}

/** Claude Code CLI one-liner — also works for OpenClaw / any Claude Code-based agent. */
export function claudeCodeMcpAddCommand(
  url: string = hostedMcpPrettyUrl(),
  keyPlaceholder = 'sk_rankdelta_PASTE_KEY_FROM_SETTINGS',
): string {
  return `claude mcp add rankdelta --transport http ${url} --header "Authorization: Bearer ${keyPlaceholder}"`;
}

/** One-click Cursor install deeplink (flat config shape Cursor expects). */
export function cursorInstallDeeplink(
  url: string = hostedMcpPrettyUrl(),
  keyPlaceholder = 'sk_rankdelta_PASTE_KEY_FROM_SETTINGS',
): string {
  const config = btoa(
    JSON.stringify({
      url,
      headers: { Authorization: `Bearer ${keyPlaceholder}` },
    }),
  );
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=rankdelta&config=${config}`;
}

export type McpConnectionTestResult =
  | { ok: true; toolCount: number }
  | { ok: false; status?: number; message: string };

/** URLs to probe for hosted MCP (primary → pretty → fallback, deduped). */
export function hostedMcpTestUrls(): string[] {
  const urls = [hostedMcpUrl(), hostedMcpPrettyUrl(), hostedMcpFallbackUrl()];
  return [...new Set(urls.map((u) => u.replace(/\/$/, '')))];
}

type ToolsListRpcBody = {
  result?: { tools?: unknown[] };
  error?: { message?: string; code?: number } | string;
  message?: string;
};

/** Parse tools/list HTTP + JSON-RPC response (exported for unit tests). */
export function parseMcpToolsListResponse(status: number, body: unknown): McpConnectionTestResult {
  if (status === 401 || status === 403) {
    const err = body as ToolsListRpcBody;
    const message =
      (typeof err?.message === 'string' && err.message) ||
      (typeof err?.error === 'string' && err.error) ||
      `HTTP ${status}`;
    return { ok: false, status, message };
  }

  if (status < 200 || status >= 300) {
    const err = body as ToolsListRpcBody;
    const message =
      (typeof err?.message === 'string' && err.message) ||
      (typeof err?.error === 'string' && err.error) ||
      `HTTP ${status}`;
    return { ok: false, status, message };
  }

  const data = body as ToolsListRpcBody;
  if (data.error && typeof data.error === 'object' && data.error.message) {
    return { ok: false, message: data.error.message };
  }
  if (typeof data.error === 'string' && data.error) {
    return { ok: false, message: data.error };
  }

  const tools = data.result?.tools;
  if (!Array.isArray(tools)) {
    return { ok: false, message: 'Invalid tools/list response' };
  }

  return { ok: true, toolCount: tools.length };
}

/**
 * Zero-cost MCP connectivity check via JSON-RPC tools/list (no paid tools).
 * Tries hosted URLs in order; does not persist or log the API key.
 */
export async function testMcpConnection(apiKey: string): Promise<McpConnectionTestResult> {
  const key = apiKey.trim();
  if (!key.startsWith('sk_rankdelta_') && !key.startsWith('sk_astroseo_')) {
    return { ok: false, message: 'Invalid API key format' };
  }

  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  });

  let lastError: McpConnectionTestResult = { ok: false, message: 'Connection failed' };

  for (const url of hostedMcpTestUrls()) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: payload,
      });

      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      const parsed = parseMcpToolsListResponse(res.status, body);
      if (parsed.ok) return parsed;

      lastError = parsed;
      // Auth errors won't succeed on another host — stop early.
      if (parsed.status === 401 || parsed.status === 403) return parsed;
    } catch (e) {
      lastError = {
        ok: false,
        message: e instanceof Error ? e.message : 'Network error',
      };
    }
  }

  return lastError;
}

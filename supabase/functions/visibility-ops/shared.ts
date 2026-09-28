import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { allowedBrowserOrigins } from '../_shared/appOrigin.ts';

/**
 * CORS origin-echo allowlist (same pattern as seo-proxy #65 and billing #81).
 * visibility-ops spends real money (DataForSEO / OpenRouter) with resolveCaller auth
 * (personal API key or JWT) verified in-function; pinning origins stops any other web
 * origin from driving authenticated calls if a token ever leaks. Set ALLOWED_ORIGINS
 * as a comma-separated Edge secret to extend; falls back to the known first-party frontends.
 */
const allowedOrigins = allowedBrowserOrigins([]);

/**
 * Build CORS headers for a request. Accepts an optional Request so the Origin can be
 * echoed only when allowlisted; when called WITHOUT a request (cron/internal paths that
 * pass the constant around) it returns headers with no ACAO — safe for non-browser callers.
 */
export function corsHeaders(req?: Request): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-visibility-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  const origin = req?.headers.get('origin');
  if (origin && allowedOrigins.has(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Vary'] = 'Origin';
  }
  return h;
}

export type Json = Record<string, unknown>;
export type Sb = ReturnType<typeof createClient>;

/** Active visibility engines (excludes deprecated grok). */
export const KNOWN_VISIBILITY_PROVIDERS = ['chatgpt', 'perplexity', 'gemini', 'google_aio'] as const;

export const DEFAULT_VISIBILITY_PROVIDERS: string[] = [...KNOWN_VISIBILITY_PROVIDERS];

export function filterKnownVisibilityProviders(raw: unknown): string[] {
  const list = Array.isArray(raw) ? (raw as unknown[]) : [];
  return [
    ...new Set(
      list.filter(
        (p): p is string =>
          typeof p === 'string' && (KNOWN_VISIBILITY_PROVIDERS as readonly string[]).includes(p),
      ),
    ),
  ];
}

/**
 * Engines the user picked on the Visibility settings page (projects.metadata.engines_to_run).
 * Returns the known subset when non-empty, else the default provider list.
 */
export function projectDefaultVisibilityProviders(project: Json | null | undefined): string[] {
  const meta = project?.['metadata'];
  const raw = meta && typeof meta === 'object' ? (meta as Json)['engines_to_run'] : undefined;
  const chosen = filterKnownVisibilityProviders(raw);
  return chosen.length > 0 ? chosen : [...DEFAULT_VISIBILITY_PROVIDERS];
}

export { mapLangToCode, mapMarketToLocation } from '../_shared/marketLocale.ts';

export function clampDfsLimit(raw: unknown, fallback: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1000, Math.max(1, n));
}

export function normalizeDomainForTarget(raw: string | null | undefined): string | null {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim();
  try {
    const u = s.includes('://') ? new URL(s) : new URL(`https://${s}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return s.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0]?.toLowerCase() ?? null;
  }
}

export function extractLlmItemRows(task0: Json | undefined): Json[] {
  if (!task0) return [];
  const resultArr = (task0['result'] as Json[]) || [];
  let items: Json[] = [];
  if (resultArr.length > 0) {
    const block = resultArr[0] as Json;
    items = (block?.['items'] as Json[]) || [];
  }
  if (items.length === 0) {
    items = (task0['items'] as Json[]) || [];
  }
  return items;
}

export function mergeLlmMentionRows(items: Json[]): { answerText: string; cited: Json[] } {
  const seen = new Set<string>();
  const cited: Json[] = [];
  const push = (url: unknown, domain: unknown, title: unknown, snippet: unknown) => {
    const u = typeof url === 'string' ? url : '';
    if (u && seen.has(u)) return;
    if (u) seen.add(u);
    cited.push({
      url,
      domain,
      title,
      snippet: snippet ?? null,
    });
  };
  const answers: string[] = [];
  for (const it of items) {
    const row = it as Json;
    const ans = row['answer'];
    if (typeof ans === 'string' && ans.trim()) answers.push(ans.trim());
    const sources = (row['sources'] as Json[]) || [];
    for (const s of sources) {
      const jo = s as Json;
      push(jo['url'], jo['domain'], jo['title'], jo['snippet'] ?? jo['description']);
    }
    const serp = (row['search_results'] as Json[]) || [];
    for (const s of serp) {
      const jo = s as Json;
      push(jo['url'], jo['domain'], jo['title'], jo['description'] ?? jo['snippet']);
    }
  }
  const maxLen = 120000;
  let answerText = answers.join('\n\n---\n\n');
  if (answerText.length > maxLen) answerText = `${answerText.slice(0, maxLen)}\n…`;
  return { answerText, cited };
}

export function siteHost(url: string | null | undefined): string | null {
  if (!url || !String(url).trim()) return null;
  const s = String(url).trim();
  try {
    const u = s.includes('://') ? new URL(s) : new URL(`https://${s}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

export function urlMatchesSite(resultUrl: string, siteUrl: string): boolean {
  const need = siteHost(siteUrl);
  const got = siteHost(resultUrl);
  if (!need || !got) return false;
  return got === need || got.endsWith('.' + need);
}

export function mapProviderToDataForSeo(
  p: string,
): { platform: string; ok: boolean } {
  if (p === 'chatgpt') return { platform: 'chat_gpt', ok: true };
  if (p === 'google_aio') return { platform: 'google', ok: true };
  return { platform: '', ok: false };
}

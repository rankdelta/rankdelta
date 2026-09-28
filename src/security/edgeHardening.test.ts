/**
 * Contract tests for the ox-alpha edge-function hardening.
 *
 * The Supabase Edge Functions run on Deno and cannot be imported into vitest,
 * so these tests guard the EXACT logic shipped in:
 *   - PR #63 (mcp-api): timing-safe token compare (SHA-256 hash-then-compare)
 *   - PR #65 (seo-proxy): CORS origin allowlist (no wildcard)
 *
 * If either function's logic changes without updating here, these tests are
 * the reminder to keep them in sync (or move the logic into src/lib and share it).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ── replica of mcp-api tokenMatches (PR #63) ─────────────────────────────────
async function tokenMatches(presented: string, MCP_TOKEN: string): Promise<boolean> {
  if (!presented) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(presented)),
    crypto.subtle.digest('SHA-256', enc.encode(MCP_TOKEN)),
  ]);
  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < av.length; i++) {
    const aByte = av[i];
    const bByte = bv[i];
    if (aByte === undefined || bByte === undefined) return false;
    diff |= aByte ^ bByte;
  }
  return diff === 0;
}

describe('mcp-api timing-safe token check (#63)', () => {
  const TOKEN = 'test-token-at-least-16-chars';
  it('accepts the correct token', async () => {
    expect(await tokenMatches(TOKEN, TOKEN)).toBe(true);
  });
  it('rejects a wrong token', async () => {
    expect(await tokenMatches('wrong-token-at-least-16ch', TOKEN)).toBe(false);
  });
  it('rejects an empty presented token (fail closed)', async () => {
    expect(await tokenMatches('', TOKEN)).toBe(false);
  });
  it('rejects when the configured token is empty', async () => {
    expect(await tokenMatches('', '')).toBe(false);
    expect(await tokenMatches('x', '')).toBe(false);
  });
  it('digest comparison never throws on unicode tokens', async () => {
    expect(await tokenMatches('tok\u00e9n-with-unicode!!', 'tok\u00e9n-with-unicode!!')).toBe(true);
  });
});

// ── replica of seo-proxy corsHeaders (PR #65) ────────────────────────────────
const DEFAULT_ALLOWED_ORIGINS = [
  'https://astroseo.ai',
  'https://www.astroseo.ai',
  'https://rankdelta.ai',
  'https://www.rankdelta.ai',
  'http://localhost:5173',
  'http://localhost:4173',
];
function makeCors(allowedOriginsEnv = '') {
  const allowedOrigins = new Set(
    allowedOriginsEnv.split(',').map((s) => s.trim()).filter(Boolean).concat(DEFAULT_ALLOWED_ORIGINS),
  );
  return function corsHeaders(req: { headers: { get(k: string): string | null } }): Record<string, string> {
    const headers: Record<string, string> = {
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    const origin = req.headers.get('origin');
    if (origin && allowedOrigins.has(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Vary'] = 'Origin';
    }
    return headers;
  };
}

describe('seo-proxy CORS origin allowlist (#65)', () => {
  const reqWith = (origin: string | null) => ({ headers: { get: (k: string) => (k === 'origin' ? origin : null) } });

  it('echoes an allowlisted origin back', () => {
    const corsHeaders = makeCors();
    const h = corsHeaders(reqWith('https://rankdelta.ai'));
    expect(h['Access-Control-Allow-Origin']).toBe('https://rankdelta.ai');
    expect(h['Vary']).toBe('Origin');
  });

  it('allows localhost dev origins', () => {
    const h = makeCors()(reqWith('http://localhost:5173'));
    expect(h['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
  });

  it('omits the header entirely for a disallowed origin (never a wildcard)', () => {
    const h = makeCors()(reqWith('https://evil.example'));
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
    expect(JSON.stringify(h)).not.toContain('*');
  });

  it('omits the header for requests without an Origin (non-browser clients)', () => {
    const h = makeCors()(reqWith(null));
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('honours ALLOWED_ORIGINS overrides from the environment', () => {
    const h = makeCors('https://staging.example.com')(reqWith('https://staging.example.com'));
    expect(h['Access-Control-Allow-Origin']).toBe('https://staging.example.com');
  });

  it('ignores whitespace and empty entries in ALLOWED_ORIGINS', () => {
    const corsHeaders = makeCors('  https://a.example , , ');
    expect(corsHeaders(reqWith('https://a.example'))['Access-Control-Allow-Origin']).toBe('https://a.example');
    expect(makeCors()(reqWith('https://a.example'))['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('preflight response always carries the standard headers', () => {
    const h = makeCors()(reqWith('https://evil.example'));
    expect(h['Access-Control-Allow-Headers']).toContain('authorization');
    expect(h['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
  });
});

/** Replica of seo-proxy enforceLookupQuota fail-closed on RPC errors (2026-09-12). */
function quotaFromRpc(res: { ok: boolean } | 'throw'): 'ok' | 'exhausted' | 'unavailable' {
  try {
    if (res === 'throw') return 'unavailable';
    if (!res.ok) return 'unavailable';
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

describe('seo-proxy research quota fail-closed', () => {
  it('treats RPC HTTP errors as unavailable (503), not as unlimited', () => {
    expect(quotaFromRpc({ ok: false })).toBe('unavailable');
    expect(quotaFromRpc('throw')).toBe('unavailable');
  });

  it('allows the call when the RPC succeeds', () => {
    expect(quotaFromRpc({ ok: true })).toBe('ok');
  });
});

/** Replica of seo-proxy researchLookupCap infra / missing-sub behaviour. */
type LookupCap = number | null | 'unavailable';
function researchLookupCapReplica(opts: {
  selfHost?: boolean;
  internal?: boolean;
  url?: string;
  key?: string;
  subOk?: boolean;
  subPlan?: string | null;
  planOk?: boolean;
  planRow?: { research_lookups_monthly?: number | null } | null;
  threw?: boolean;
}): LookupCap {
  if (opts.selfHost || opts.internal) return null;
  if (opts.threw) return 'unavailable';
  if (!opts.url || !opts.key) return 'unavailable';
  if (opts.subOk === false) return 'unavailable';
  if (!opts.subPlan) return 0;
  if (opts.planOk === false) return 'unavailable';
  if (!opts.planRow) return 'unavailable';
  return typeof opts.planRow.research_lookups_monthly === 'number'
    ? opts.planRow.research_lookups_monthly
    : null;
}

describe('seo-proxy researchLookupCap fail-closed', () => {
  it('returns unavailable when URL/key are missing or plan fetch fails', () => {
    expect(researchLookupCapReplica({})).toBe('unavailable');
    expect(researchLookupCapReplica({ url: 'https://x', key: 'k', subOk: false })).toBe(
      'unavailable',
    );
    expect(researchLookupCapReplica({ url: 'https://x', key: 'k', subPlan: 'starter', planOk: false })).toBe(
      'unavailable',
    );
    expect(researchLookupCapReplica({ threw: true, url: 'https://x', key: 'k' })).toBe('unavailable');
  });

  it('returns 0 when the user has no subscription plan', () => {
    expect(researchLookupCapReplica({ url: 'https://x', key: 'k', subOk: true, subPlan: null })).toBe(0);
  });

  it('treats a numeric monthly cap and agency-null as unlimited', () => {
    expect(
      researchLookupCapReplica({
        url: 'https://x',
        key: 'k',
        subPlan: 'starter',
        planOk: true,
        planRow: { research_lookups_monthly: 100 },
      }),
    ).toBe(100);
    expect(
      researchLookupCapReplica({
        url: 'https://x',
        key: 'k',
        subPlan: 'agency',
        planOk: true,
        planRow: { research_lookups_monthly: null },
      }),
    ).toBeNull();
  });
});

describe('seo-proxy source contracts (SSRF DNS, token clamp, generic 502)', () => {
  const source = readFileSync(
    path.resolve(process.cwd(), 'supabase/functions/seo-proxy/index.ts'),
    'utf8',
  );

  it('uses shared SSRF helpers with DNS on every fetch hop', () => {
    expect(source).toContain('assertSafeOutboundUrl');
    expect(source).toContain('resolveSafeRedirectTarget');
    expect(source).not.toContain('function isBlockedHost');
    expect(source).not.toContain("h.startsWith('fc')");
  });

  it('clamps LLM max_tokens', () => {
    expect(source).toContain('MAX_LLM_TOKENS = 8192');
    expect(source).toContain('clampLlmMaxTokens');
  });

  it('does not echo exception messages to clients on 502', () => {
    expect(source).toContain("return json({ error: 'proxy error' }, 502, cors)");
    expect(source).not.toContain('e instanceof Error ? e.message : \'proxy error\'');
  });

  it('never writes the shared keyword cache from client-supplied rows', () => {
    // The cache is written from the DataForSEO response (persistKeywordMetrics); the old client
    // action is a no-op, so no account can overwrite volume / difficulty for every tenant.
    expect(source).toContain('persistKeywordMetrics(admin, body.endpoint, body.payload, data)');
    expect(source).toMatch(/action === 'keyword-metrics-upsert'\) \{[\s\S]{0,400}return json\(\{ ok: true, upserted: 0 \}/);
    expect(source).not.toContain('body.rows');
  });

  it('fails closed when quota infra is missing', () => {
    expect(source).toContain("if (!url || !key) return 'unavailable'");
    expect(source).toContain("if (cap === 'unavailable')");
  });
});

/**
 * Contract: paid MCP tools (domain_overview, backlink_summary, keyword_research, …)
 * must accept a valid personal API key (sk_astroseo_…) and scope spend to that key's user.
 *
 * Root cause this file guards: hosted MCP authenticated the key, then forwarded the same
 * Bearer to seo-proxy / visibility-ops, which only called supabase.auth.getUser(). A
 * personal key is not a JWT, so getUser() failed and paid tools returned unauthorized
 * even though Settings → API & MCP showed the connector as connected.
 *
 * Edge functions run on Deno and cannot be imported here. We (1) pin the resolution
 * algorithm shipped in supabase/functions/_shared/apiKeys.ts and (2) assert the paid
 * proxies actually call resolveCaller instead of JWT-only userIdFromRequest.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const API_KEY_PREFIX = 'sk_astroseo_';

async function hashApiKey(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type KeyRow = { id: string; user_id: string; key_hash: string; revoked_at: string | null };

/** Replica of resolvePersonalApiKey + resolveCaller routing (apiKeys.ts). */
async function resolveCaller(opts: {
  token: string;
  keys: KeyRow[];
  jwtUserId: string | null;
}): Promise<{ userId: string; via: 'api_key' | 'jwt' } | null> {
  const token = opts.token;
  if (!token) return null;
  if (token.startsWith(API_KEY_PREFIX)) {
    if (token.length < API_KEY_PREFIX.length + 16) return null;
    const keyHash = await hashApiKey(token);
    const row = opts.keys.find((k) => k.key_hash === keyHash);
    if (!row || row.revoked_at) return null;
    return { userId: row.user_id, via: 'api_key' };
  }
  if (!opts.jwtUserId) return null;
  return { userId: opts.jwtUserId, via: 'jwt' };
}

/**
 * Replica of the OLD seo-proxy gate: userIdFromRequest → auth.getUser().
 * Personal keys are not JWTs, so getUser() always fails.
 */
async function userIdFromJwtOnly(token: string, jwtUserId: string | null): Promise<string | null> {
  if (!token) return null;
  if (token.startsWith(API_KEY_PREFIX)) return null;
  return jwtUserId;
}

function repoFile(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('personal API key resolution (paid MCP / seo-proxy)', () => {
  const keyOwner = `${API_KEY_PREFIX}${'A'.repeat(32)}`;
  const keyOther = `${API_KEY_PREFIX}${'B'.repeat(32)}`;
  const keyRevoked = `${API_KEY_PREFIX}${'C'.repeat(32)}`;

  async function seedKeys(): Promise<KeyRow[]> {
    return [
      { id: 'key-owner', user_id: 'user-owner', key_hash: await hashApiKey(keyOwner), revoked_at: null },
      { id: 'key-other', user_id: 'user-other', key_hash: await hashApiKey(keyOther), revoked_at: null },
      { id: 'key-revoked', user_id: 'user-owner', key_hash: await hashApiKey(keyRevoked), revoked_at: '2026-01-01T00:00:00Z' },
    ];
  }

  it('JWT-only getUser() (old seo-proxy) rejects a valid personal API key — this is the product bug', async () => {
    const userId = await userIdFromJwtOnly(keyOwner, 'user-from-jwt');
    expect(userId).toBeNull();
  });

  it('resolveCaller accepts the same personal API key and returns ONLY the key owner', async () => {
    const keys = await seedKeys();
    const caller = await resolveCaller({ token: keyOwner, keys, jwtUserId: 'user-from-jwt' });
    expect(caller).toEqual({ userId: 'user-owner', via: 'api_key' });
    expect(caller?.userId).not.toBe('user-other');
    expect(caller?.userId).not.toBe('user-from-jwt');
  });

  it('another account’s key cannot resolve to this user', async () => {
    const keys = await seedKeys();
    const caller = await resolveCaller({ token: keyOther, keys, jwtUserId: 'user-owner' });
    expect(caller).toEqual({ userId: 'user-other', via: 'api_key' });
  });

  it('unknown, revoked, and too-short keys are unauthorized', async () => {
    const keys = await seedKeys();
    expect(await resolveCaller({ token: `${API_KEY_PREFIX}${'Z'.repeat(32)}`, keys, jwtUserId: null })).toBeNull();
    expect(await resolveCaller({ token: keyRevoked, keys, jwtUserId: null })).toBeNull();
    expect(await resolveCaller({ token: `${API_KEY_PREFIX}short`, keys, jwtUserId: null })).toBeNull();
    expect(await resolveCaller({ token: '', keys, jwtUserId: null })).toBeNull();
  });

  it('browser JWTs still authenticate (web Site Explorer must keep working)', async () => {
    const keys = await seedKeys();
    const caller = await resolveCaller({ token: 'eyJhbGciOiJIUzI1NiJ9.fake', keys, jwtUserId: 'user-browser' });
    expect(caller).toEqual({ userId: 'user-browser', via: 'jwt' });
  });

  it('hashes are deterministic and unique per secret (isolation depends on this)', async () => {
    expect(await hashApiKey(keyOwner)).toBe(await hashApiKey(keyOwner));
    expect(await hashApiKey(keyOwner)).not.toBe(await hashApiKey(keyOther));
  });
});

describe('paid proxy source must use resolveCaller (would have caught this bug)', () => {
  it('seo-proxy authenticates via resolveCaller, not JWT-only userIdFromRequest', () => {
    const src = repoFile('supabase/functions/seo-proxy/index.ts');
    expect(src).toContain("from '../_shared/apiKeys.ts'");
    expect(src).toMatch(/await resolveCaller\(req\)/);
    expect(src).toMatch(/resolveInternalReportCaller\(req\)/);
    expect(src).toMatch(/const userId = caller\.userId/);
    expect(src).not.toMatch(/const userId = await userIdFromRequest\(req\)/);
  });

  it('visibility-ops authenticates via resolveCaller (MCP scan / rank check)', () => {
    const src = repoFile('supabase/functions/visibility-ops/index.ts');
    expect(src).toMatch(/const caller = await resolveCaller\(req\)/);
    expect(src).not.toMatch(/supabaseUser\.auth\.getUser/);
    expect(src).toMatch(/action === 'scan_project'/);
  });

  it('hosted MCP still forwards the same Bearer key to seo-proxy', () => {
    const src = repoFile('supabase/functions/mcp/index.ts');
    expect(src).toContain("invokeFn('seo-proxy', token");
    expect(src).toMatch(/Authorization: `Bearer \$\{token\}`/);
    expect(src).toMatch(/resolvePersonalApiKey/);
  });

  it('shared resolveCaller still routes sk_astroseo_… through resolvePersonalApiKey', () => {
    const src = repoFile('supabase/functions/_shared/apiKeys.ts');
    expect(src).toMatch(/if \(matchApiKeyPrefix\(token\)\)/);
    // Rankdelta rebrand invariant: both prefixes stay accepted; never drop the legacy one.
    expect(src).toContain("'sk_rankdelta_'");
    expect(src).toContain("'sk_astroseo_'");
    expect(src).toMatch(/return \{ userId: resolved\.userId, via: 'api_key', token \}/);
    expect(src).toMatch(/\.eq\('key_hash', keyHash\)/);
    expect(src).toMatch(/if \(error \|\| !data \|\| data\.revoked_at\) return null/);
  });

  it('visibility-ops gateway JWT stays off so personal keys reach resolveCaller', () => {
    const src = repoFile('supabase/config.toml');
    expect(src).toMatch(/\[functions\.visibility-ops\][\s\S]*verify_jwt = false/);
    expect(src).toMatch(/\[functions\.seo-proxy\][\s\S]*verify_jwt = false/);
  });
});

/** Replica of isPayingSubscription in apiKeys.ts — no user-id allowlist. */
const PAID_PLANS = ['starter', 'growth', 'pro', 'agency'] as const;
const PAYING_STATUSES = ['active', 'trialing'] as const;
function isPayingSubscription(plan: string | null | undefined, status: string | null | undefined): boolean {
  const p = String(plan ?? '').toLowerCase();
  const s = String(status ?? '').toLowerCase();
  return (PAID_PLANS as readonly string[]).includes(p) && (PAYING_STATUSES as readonly string[]).includes(s);
}

describe('paying-plan gate after resolveCaller (all paying customers, not one account)', () => {
  it('allows every billed cloud plan while live (active or trialing)', () => {
    for (const plan of ['starter', 'growth', 'pro', 'agency']) {
      expect(isPayingSubscription(plan, 'active')).toBe(true);
      expect(isPayingSubscription(plan, 'trialing')).toBe(true);
    }
  });

  it('refuses free / no-plan / incomplete / canceled — even with a valid API key', () => {
    expect(isPayingSubscription('free', 'canceled')).toBe(false);
    expect(isPayingSubscription('free', 'active')).toBe(false);
    expect(isPayingSubscription('starter', 'incomplete')).toBe(false);
    expect(isPayingSubscription('starter', 'canceled')).toBe(false);
    expect(isPayingSubscription(null, 'active')).toBe(false);
    expect(isPayingSubscription('starter', null)).toBe(false);
    expect(isPayingSubscription('pro', 'past_due')).toBe(false);
  });

  it('does not special-case any user_id or email', () => {
    const src = repoFile('supabase/functions/_shared/apiKeys.ts');
    // No hardcoded UUID literal and no email-address literal.
    expect(src).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(src).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(src).toMatch(/\.eq\('user_id', userId\)/);
    expect(src).toMatch(/isPayingSubscription/);
  });

  it('seo-proxy and visibility-ops call assertPayingPlan after resolveCaller', () => {
    const proxy = repoFile('supabase/functions/seo-proxy/index.ts');
    const vis = repoFile('supabase/functions/visibility-ops/index.ts');
    expect(proxy).toMatch(/assertPayingPlan\(userId\)/);
    expect(proxy).toMatch(/planRequiredResponse/);
    expect(vis).toMatch(/assertPayingPlan\(caller\.userId\)/);
    expect(vis).toMatch(/planRequiredResponse/);
  });
});

describe('hosted MCP AI-visibility activation (setup_ai_visibility)', () => {
  it('registers setup_ai_visibility and honest not_configured empty states', () => {
    const src = repoFile('supabase/functions/mcp/index.ts');
    expect(src).toMatch(/name: 'setup_ai_visibility'/);
    expect(src).toMatch(/status: 'not_configured'/);
    expect(src).toMatch(/AI-visibility non configurata per questo sito: usa setup_ai_visibility/);
    expect(src).toMatch(/assertPayingPlan\(userId\)/);
    expect(src).toMatch(/action: 'generate_queries'/);
    expect(src).toMatch(/action: 'scan_project'/);
    expect(src).toMatch(/from\('tracked_brands'\)\.insert/);
  });

  it('lists setup_ai_visibility in hosted MCP tool catalog', () => {
    const src = repoFile('src/services/apiKeys.ts');
    expect(src).toMatch(/name: 'setup_ai_visibility'/);
  });
});

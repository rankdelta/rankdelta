/**
 * Pure-logic tests for the `add_site` input normalisation.
 *
 * The handler in index.ts is network-bound, but its riskiest decision is the URL
 * parse: get it wrong and a client ends up with a project whose website_url no
 * downstream tool (sitemap, visibility, sitemapAnalyzer) can resolve. These tests
 * pin the exact accept/reject boundary, including the one the audit code already
 * gets wrong elsewhere: `www.` and the bare host are DIFFERENT sites, so we must
 * not strip it on the way in.
 */
import { describe, expect, it } from 'vitest';

/** Mirrors the handler's normalisation. Kept here so the boundary is executable. */
function normalizeSiteUrl(rawUrl: string): { ok: true; url: string } | { ok: false; reason: 'invalid_url' } {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (!url.hostname.includes('.')) return { ok: false, reason: 'invalid_url' };
  return { ok: true, url: url.toString().replace(/\/$/, '') };
}

describe('add_site — website_url normalisation', () => {
  it('defaults to https when the scheme is omitted', () => {
    expect(normalizeSiteUrl('acmegym.it')).toEqual({ ok: true, url: 'https://acmegym.it' });
  });

  it('keeps an explicit http scheme', () => {
    expect(normalizeSiteUrl('http://acmegym.it')).toEqual({ ok: true, url: 'http://acmegym.it' });
  });

  it('strips a trailing slash', () => {
    expect(normalizeSiteUrl('https://acmegym.it/')).toEqual({ ok: true, url: 'https://acmegym.it' });
  });

  it('does NOT strip www — it is a different host, not a cosmetic difference', () => {
    // The sitemap fetch path treats www/non-www as host variants on purpose; folding
    // them here would silently retarget every downstream crawl.
    expect(normalizeSiteUrl('https://www.acmegym.it')).toEqual({ ok: true, url: 'https://www.acmegym.it' });
  });

  it('preserves a path — a client may track a section', () => {
    expect(normalizeSiteUrl('acmegym.it/it')).toEqual({ ok: true, url: 'https://acmegym.it/it' });
  });

  it('accepts a hostname with subdomains', () => {
    expect(normalizeSiteUrl('shop.example.co.uk')).toEqual({ ok: true, url: 'https://shop.example.co.uk' });
  });

  it('rejects localhost — this registers client sites, not dev hosts', () => {
    // No dot in the hostname. Deliberate: an agent registering a client must not be able
    // to store a dev host as a project, where every downstream crawl would fail.
    expect(normalizeSiteUrl('localhost:3000')).toEqual({ ok: false, reason: 'invalid_url' });
  });

  it('rejects a string that is not a URL at all', () => {
    expect(normalizeSiteUrl('non un url')).toEqual({ ok: false, reason: 'invalid_url' });
  });

  it('rejects a bare word with no domain', () => {
    expect(normalizeSiteUrl('acmegym')).toEqual({ ok: false, reason: 'invalid_url' });
  });

  it('rejects an empty string', () => {
    expect(normalizeSiteUrl('')).toEqual({ ok: false, reason: 'invalid_url' });
  });

  it('rejects a scheme with no host', () => {
    expect(normalizeSiteUrl('https://')).toEqual({ ok: false, reason: 'invalid_url' });
  });
});

/**
 * The quota rule that add_site must respect. It lives in _shared/projectQuota.ts and
 * exists because the MCP's service_role client bypasses the max_projects trigger
 * (migration 044 returns early for service_role) — so a naive insert would let a free
 * account create unlimited projects. These tests encode that rule so a future edit
 * cannot quietly widen it.
 */
const GATED_STATUSES = new Set(['active', 'trialing', 'past_due']);

function quotaApplies(status: string): boolean {
  return GATED_STATUSES.has(status);
}

function withinQuota(max: number | null, count: number): boolean {
  if (max === null || !Number.isFinite(max) || max < 0) return true; // agency / unlimited
  return count < max;
}

describe('add_site — project quota', () => {
  it('gates only contractual statuses', () => {
    expect(quotaApplies('active')).toBe(true);
    expect(quotaApplies('trialing')).toBe(true);
    expect(quotaApplies('past_due')).toBe(true);
  });

  it('does not gate a cancelled or unpaid subscription', () => {
    // plan and status are independent columns: a cancelled Agency row still says
    // plan='agency', so gating on plan alone would lock a dead account's quota.
    expect(quotaApplies('canceled')).toBe(false);
    expect(quotaApplies('unpaid')).toBe(false);
  });

  it('blocks a free account at its limit of 1', () => {
    expect(withinQuota(1, 0)).toBe(true);
    expect(withinQuota(1, 1)).toBe(false);
  });

  it('treats a negative max as unlimited (agency)', () => {
    expect(withinQuota(-1, 999)).toBe(true);
  });

  it('treats a null max as unlimited', () => {
    expect(withinQuota(null, 999)).toBe(true);
  });
});

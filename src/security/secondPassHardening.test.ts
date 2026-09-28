import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { clampFinalCostCents } from '../../supabase/functions/_shared/spendClamp';
import { parseHttpUrl } from '../../supabase/functions/_shared/ssrf';

describe('clampFinalCostCents', () => {
  it('allows a cheaper actual cost than the reservation', () => {
    expect(clampFinalCostCents(5, 100, 5000)).toBe(5);
  });

  it('does not let a 10-cent precheck finalize into a cap-busting provider cost', () => {
    // reserved 10 already counted in spent; other events = 4990, cap 5000 → room 10
    expect(clampFinalCostCents(500, 4990, 5000)).toBe(10);
  });

  it('returns 0 when the account is already at or over cap', () => {
    expect(clampFinalCostCents(50, 5000, 5000)).toBe(0);
    expect(clampFinalCostCents(50, 6000, 5000)).toBe(0);
  });
});

describe('WordPress site URL (https + no private hosts) before Basic auth', () => {
  it('requires https and rejects private hosts and userinfo', () => {
    expect(parseHttpUrl('https://example.com', { httpsOnly: true })?.hostname).toBe('example.com');
    expect(parseHttpUrl('http://example.com', { httpsOnly: true })).toBeNull();
    expect(parseHttpUrl('https://127.0.0.1', { httpsOnly: true })).toBeNull();
    expect(parseHttpUrl('https://169.254.169.254', { httpsOnly: true })).toBeNull();
    expect(parseHttpUrl('https://user:pass@example.com', { httpsOnly: true })).toBeNull();
  });

  it('wordpress.ts and WPConnectionSetup call isAllowedWpSiteUrl / normalizeWpSiteUrl', () => {
    const wp = readFileSync(path.resolve(process.cwd(), 'src/services/wordpress.ts'), 'utf8');
    const setup = readFileSync(
      path.resolve(process.cwd(), 'src/components/agent-dashboard/WPConnectionSetup.tsx'),
      'utf8',
    );
    expect(wp).toContain('export function isAllowedWpSiteUrl');
    expect(wp).toContain('normalizeWpSiteUrl(connection.siteUrl, this.hasCredentials)');
    expect(setup).toContain('isAllowedWpSiteUrl(form.siteUrl.trim(), true)');
  });
});

describe('useSubscription fail-closed engine gate', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/hooks/useSubscription.ts'), 'utf8');

  it('does not treat an unknown subscription as entitled', () => {
    expect(source).not.toMatch(/\|\|\s*subscriptionUnknown\s*\n\s*\|\|\s*subscription\?\.status/);
    expect(source).toContain("|| subscription?.status === 'active' || subscription?.status === 'trialing'");
  });
});

describe('public widgets use shared SSRF DNS', () => {
  it('ai-visibility-check calls assertSafePublicDomain', () => {
    const vis = readFileSync(
      path.resolve(process.cwd(), 'supabase/functions/ai-visibility-check/index.ts'),
      'utf8',
    );
    expect(vis).toContain('assertSafePublicDomain');
    expect(vis).toContain('resolveSafeRedirectTarget');
  });
});

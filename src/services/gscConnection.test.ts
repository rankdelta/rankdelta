import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const invokeMock = vi.fn();
const fromMock = vi.fn();

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import {
  connectGscProject,
  disconnectGscProject,
  getCachedGscOverview,
  syncGscProject,
  getGscConnectionStatus,
  dataAgeInDays,
  isDataStale,
  gscErrorMessage,
} from './gscConnection';

/** Minimal PostgREST-ish chain returning a fixed row. */
function mockChain(row: unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return chain;
}

beforeEach(() => {
  invokeMock.mockReset();
  fromMock.mockReset();
});

describe('the customer-reported bug: connection does not survive a reload', () => {
  /**
   * "Il cliente dice che ha collegato la Search Console ma dopo si scollega
   * o non la rivede collegata."
   *
   * Root cause in the legacy path (src/services/googleSearchConsole.ts):
   * the access token lives in a module-level variable and is never persisted,
   * so `hasValidToken()` is false after any reload — and the token expires in
   * an hour regardless. Connection state must come from the database instead.
   */
  it('reports connected from stored state, with no in-memory token involved', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'gsc_properties') {
        return mockChain({
          site_url: 'https://example.com/',
          permission_level: 'siteOwner',
          connected_at: '2026-09-01T10:00:00Z',
        });
      }
      return mockChain({ fetched_at: '2026-09-20T10:00:00Z' });
    });

    const status = await getGscConnectionStatus('project-1');
    expect(status.connected).toBe(true);
    expect(status.property).toBe('https://example.com/');
    expect(status.dataAsOf).toBe('2026-09-20T10:00:00Z');
  });

  it('is a pure database read — a fresh module instance still sees the connection', async () => {
    // Simulates the reload: no prior connect() call in this process.
    fromMock.mockImplementation((table: string) =>
      table === 'gsc_properties'
        ? mockChain({ site_url: 'https://a.test/', permission_level: 'siteOwner', connected_at: 'x' })
        : mockChain(null),
    );
    const status = await getGscConnectionStatus('project-1');
    expect(status.connected).toBe(true);
  });

  it('reports disconnected when no property row exists', async () => {
    fromMock.mockImplementation(() => mockChain(null));
    const status = await getGscConnectionStatus('project-1');
    expect(status).toEqual({
      connected: false,
      property: null,
      permissionLevel: null,
      connectedAt: null,
      dataAsOf: null,
      revokedAt: null,
    });
  });

  it('stays connected when the property exists but analytics were never cached', async () => {
    fromMock.mockImplementation((table: string) =>
      table === 'gsc_properties'
        ? mockChain({ site_url: 'https://b.test/', permission_level: null, connected_at: 'x' })
        : mockChain(null),
    );
    const status = await getGscConnectionStatus('project-1');
    expect(status.connected).toBe(true);
    expect(status.dataAsOf).toBeNull();
  });

  it('returns disconnected for an empty project id without querying', async () => {
    const status = await getGscConnectionStatus('');
    expect(status.connected).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe('sync uses the stored refresh token — no popup, no user', () => {
  it('invokes gsc-connect with action=sync and no authorization code', async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, property: 'https://example.com/', properties: [], overview: null },
      error: null,
    });

    const result = await syncGscProject('project-1', { periodDays: 28 });

    expect(invokeMock).toHaveBeenCalledWith('gsc-connect', {
      body: { action: 'sync', projectId: 'project-1', periodDays: 28 },
    });
    // The browser must never handle a code or token on the sync path.
    // `calls[0]` is `T | undefined` under noUncheckedIndexedAccess; the
    // toHaveBeenCalledWith above already proves the call happened.
    const [, syncOpts] = invokeMock.mock.calls[0] as [string, { body: Record<string, unknown> }];
    const body = syncOpts.body;
    expect(body).not.toHaveProperty('code');
    expect(result.property).toBe('https://example.com/');
  });

  it('surfaces not_connected as an actionable message', async () => {
    invokeMock.mockResolvedValue({ data: { error: 'not_connected' }, error: null });
    await expect(syncGscProject('project-1')).rejects.toThrow('not_connected');
    expect(gscErrorMessage('not_connected')).toBe('This project is not connected to Search Console.');
  });

  it('rejects without a project id', async () => {
    await expect(syncGscProject('')).rejects.toThrow('missing_project');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('connect exchanges a one-time code server-side', () => {
  it('sends the authorization code to gsc-connect and never stores it', async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        property: 'https://example.com/',
        properties: [{ siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' }],
        overview: null,
      },
      error: null,
    });

    // Stub the Google SDK so the test covers our code, not Google's.
    // `loadGis()` short-circuits when window.google.accounts.oauth2 already
    // exists, so assigning it here avoids any network fetch.
    const googleStub = {
      accounts: {
        oauth2: {
          initCodeClient: (cfg: { callback: (r: { code?: string }) => void }) => ({
            requestCode: () => cfg.callback({ code: 'one-time-code' }),
          }),
        },
      },
    };
    const w = globalThis.window as unknown as { google?: unknown };
    const previous = w.google;
    w.google = googleStub;
    // VITE_GOOGLE_CLIENT_ID is not set in the test env; without it
    // requestAuthCode() correctly refuses before reaching Google.
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id.apps.googleusercontent.com');

    const result = await connectGscProject('project-1', { periodDays: 28 });

    const [fnName, opts] = invokeMock.mock.calls[0] as [
      string,
      { body: { action?: string; code?: string; projectId?: string } },
    ];
    expect(fnName).toBe('gsc-connect');
    expect(opts.body.action).toBe('connect');
    expect(opts.body.code).toBe('one-time-code');
    expect(result.properties).toHaveLength(1);

    w.google = previous;
    vi.unstubAllEnvs();
  });

  it('refuses to open the popup when no client id is configured', async () => {
    // Fails closed rather than calling Google with an empty client_id.
    await expect(connectGscProject('project-1')).rejects.toThrow('not_configured');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('rejects without a project id before touching Google', async () => {
    await expect(connectGscProject('')).rejects.toThrow('missing_project');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('a deployment missing GOOGLE_CLIENT_SECRET must say so', () => {
  it('surfaces the 503 not_configured code instead of looking disconnected', async () => {
    // gsc-connect answers 503 {error:'not_configured'} when GOOGLE_CLIENT_ID or
    // GOOGLE_CLIENT_SECRET is missing from the function's env. supabase-js
    // reports a non-2xx as `error` with the body still in `data`.
    invokeMock.mockResolvedValue({
      data: { error: 'not_configured' },
      error: new Error('Edge Function returned a non-2xx status code'),
    });

    await expect(syncGscProject('project-1')).rejects.toThrow('not_configured');
    expect(gscErrorMessage('not_configured')).toBe(
      'Google Search Console is not configured on this deployment.',
    );
  });

  it('does not mistake a transport failure for a specific server answer', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('network down') });
    await expect(syncGscProject('project-1')).rejects.toThrow('gsc_request_failed');
  });
});

describe('Google withholding the refresh token must not become a loop', () => {
  /**
   * Google issues a refresh token only on the FIRST authorization of a given
   * client + user + scope ("The refresh_token is only returned on the first
   * authorization" — developers.google.com/identity/protocols/oauth2/web-server).
   * Everyone who already used the old in-browser token flow granted
   * webmasters.readonly to this same client id, so their code exchange comes
   * back without a refresh token and gsc-connect answers 400 no_refresh_token.
   *
   * `initCodeClient` cannot force re-consent: CodeClientConfig has no `prompt`
   * and no `access_type` field (GIS reference, developers.google.com/identity/
   * oauth2/web/reference/js-reference). The only exit is the user removing the
   * app's access, so the message has to say where.
   */
  it('tells the user where to remove the grant instead of "try again"', () => {
    const message = gscErrorMessage('no_refresh_token');
    expect(message).toMatch(/https:\/\/myaccount\.google\.com\/permissions/);
    // "Reconnect" on its own would send the user straight back into the same
    // failure, because nothing about the grant has changed.
    expect(message).not.toMatch(/^Reconnect/i);
  });

  it('is reachable from a real connect attempt', async () => {
    invokeMock.mockResolvedValue({
      data: { error: 'no_refresh_token' },
      error: new Error('Edge Function returned a non-2xx status code'),
    });
    const googleStub = {
      accounts: {
        oauth2: {
          initCodeClient: (cfg: { callback: (r: { code?: string }) => void }) => ({
            requestCode: () => cfg.callback({ code: 'one-time-code' }),
          }),
        },
      },
    };
    const w = globalThis.window as unknown as { google?: unknown };
    const previous = w.google;
    w.google = googleStub;
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id.apps.googleusercontent.com');

    await expect(connectGscProject('project-1')).rejects.toThrow('no_refresh_token');

    w.google = previous;
    vi.unstubAllEnvs();
  });

  it('asks Google for the account chooser, the one lever the code flow gives us', async () => {
    // A different Google account is a first authorization, so it does yield a
    // refresh token — `select_account` is what lets the user get there.
    let seen: Record<string, unknown> = {};
    const w = globalThis.window as unknown as { google?: unknown };
    const previous = w.google;
    w.google = {
      accounts: {
        oauth2: {
          initCodeClient: (cfg: Record<string, unknown>) => {
            seen = cfg;
            return {
              requestCode: () => (cfg['callback'] as (r: { code: string }) => void)({ code: 'c' }),
            };
          },
        },
      },
    };
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id.apps.googleusercontent.com');
    invokeMock.mockResolvedValue({
      data: { ok: true, property: 'https://example.com/', properties: [], overview: null },
      error: null,
    });

    await connectGscProject('project-1');

    expect(seen['select_account']).toBe(true);
    // Documented CodeClientConfig has no way to force consent; asserting their
    // absence keeps a future "just add prompt: consent" from looking supported.
    expect(seen).not.toHaveProperty('prompt');
    expect(seen).not.toHaveProperty('access_type');

    w.google = previous;
    vi.unstubAllEnvs();
  });
});

describe('cached analytics feed the reload', () => {
  const cacheRow = {
    clicks: 120,
    impressions: 3400,
    ctr: 0.035,
    avg_position: 12.4,
    top_queries: [{ key: 'rankdelta', clicks: 12, impressions: 300, ctr: 0.04, position: 8.1 }],
    top_pages: [{ key: 'https://example.com/blog', clicks: 8, impressions: 90, ctr: 0.08, position: 5 }],
    daily_data: [{ date: '2026-09-20', clicks: 5, impressions: 100 }],
  };

  it('returns the stored numbers without calling Google', async () => {
    fromMock.mockImplementation(() => mockChain(cacheRow));

    const overview = await getCachedGscOverview('project-1', 28);

    expect(overview?.totals).toEqual({
      clicks: 120,
      impressions: 3400,
      ctr: 0.035,
      position: 12.4,
    });
    expect(overview?.topQueries[0]?.key).toBe('rankdelta');
    expect(overview?.byDate).toHaveLength(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('returns null when nothing has been cached yet, so the caller syncs', async () => {
    fromMock.mockImplementation(() => mockChain(null));
    expect(await getCachedGscOverview('project-1', 28)).toBeNull();
  });

  it('survives jsonb columns that are not the shape we expect', async () => {
    fromMock.mockImplementation(() =>
      mockChain({ ...cacheRow, top_queries: 'not-an-array', daily_data: [null], clicks: null }),
    );

    const overview = await getCachedGscOverview('project-1', 28);

    expect(overview?.topQueries).toEqual([]);
    expect(overview?.totals.clicks).toBe(0);
    expect(overview?.byDate[0]).toEqual({ date: '', clicks: 0, impressions: 0 });
  });

  it('never queries an unsupported window — the cache has a CHECK constraint', async () => {
    const eq = vi.fn();
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        eq(column, value);
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
    });
    fromMock.mockImplementation(() => chain);

    await getCachedGscOverview('project-1', 365);

    expect(eq).toHaveBeenCalledWith('period_days', 28);
  });

  it('reads nothing for an empty project id', async () => {
    expect(await getCachedGscOverview('', 28)).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe('disconnect is a server operation, not a forgotten variable', () => {
  it('asks the edge function to delete the token, the property and the cache', async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });

    await disconnectGscProject('project-1');

    expect(invokeMock).toHaveBeenCalledWith('gsc-connect', {
      body: { action: 'disconnect', projectId: 'project-1' },
    });
  });

  it('reports a failure instead of pretending the project is disconnected', async () => {
    invokeMock.mockResolvedValue({ data: { error: 'forbidden' }, error: null });
    await expect(disconnectGscProject('project-1')).rejects.toThrow('forbidden');
  });

  it('rejects without a project id', async () => {
    await expect(disconnectGscProject('')).rejects.toThrow('missing_project');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('connect error handling', () => {
  it('maps edge error codes to messages a user can act on', () => {
    expect(gscErrorMessage('no_refresh_token')).toMatch(/myaccount\.google\.com\/permissions/);
    expect(gscErrorMessage('property_not_accessible')).toMatch(/not readable/i);
    expect(gscErrorMessage('not_configured')).toMatch(/not configured/i);
  });

  it('never leaks raw server text for unknown codes', () => {
    expect(gscErrorMessage('some_internal_detail_xyz')).toBe('Search Console request failed.');
    expect(gscErrorMessage(null)).toBe('Search Console request failed.');
  });
});

describe('data freshness', () => {
  const now = new Date('2026-09-22T00:00:00Z');

  it('computes age in whole days', () => {
    expect(dataAgeInDays('2026-09-22T00:00:00Z', now)).toBe(0);
    expect(dataAgeInDays('2026-09-21T00:00:00Z', now)).toBe(1);
    // The real production case: a connected project frozen at 24 Aug.
    expect(dataAgeInDays('2026-08-24T00:00:00Z', now)).toBe(29);
  });

  it('returns null when data was never fetched', () => {
    expect(dataAgeInDays(null, now)).toBeNull();
    expect(isDataStale(null, now)).toBe(false);
  });

  it('does not flag data inside the GSC reporting lag', () => {
    // GSC itself lags ~2 days; under a week is normal, not stale.
    expect(isDataStale('2026-09-20T00:00:00Z', now)).toBe(false);
    expect(isDataStale('2026-09-15T00:00:00Z', now)).toBe(false);
  });

  it('flags month-old data', () => {
    expect(isDataStale('2026-08-24T00:00:00Z', now)).toBe(true);
  });

  it('tolerates clock skew and malformed timestamps', () => {
    expect(dataAgeInDays('2026-09-23T00:00:00Z', now)).toBe(0);
    expect(dataAgeInDays('not-a-date', now)).toBeNull();
  });
});

describe('the new path must not repeat the legacy mistakes', () => {
  /**
   * Strip comments before asserting: this file's own explanatory prose names the
   * legacy APIs (`initTokenClient`, `localStorage`) it exists to keep out, and a
   * comment must never be what satisfies — or breaks — the assertion.
   */
  function readCodeOnly(file: string): string {
    const src = readFileSync(resolve(process.cwd(), file), 'utf8');
    let out = src.replace(/\/\*[\s\S]*?\*\//g, ''); // block comments
    out = out
      .split('\n')
      .map((line) => {
        const idx = line.indexOf('//');
        return idx === -1 ? line : line.slice(0, idx);
      })
      .join('\n');
    return out;
  }

  it('never persists Google credentials in the browser', () => {
    const code = readCodeOnly('src/services/gscConnection.ts');
    expect(code).not.toMatch(/localStorage/);
    expect(code).not.toMatch(/sessionStorage/);
    expect(code).not.toMatch(/document\.cookie/);
  });

  it('uses the authorization-code flow, not the implicit token flow', () => {
    const code = readCodeOnly('src/services/gscConnection.ts');
    // initTokenClient yields no refresh token, so the connection could not persist.
    expect(code).toMatch(/initCodeClient/);
    expect(code).not.toMatch(/initTokenClient/);
  });

  it('derives connection state from the database, not a module variable', () => {
    const code = readCodeOnly('src/services/gscConnection.ts');
    expect(code).toMatch(/from\('gsc_properties'\)/);
    // No module-level mutable token cache like the legacy path's `let accessToken`.
    expect(code).not.toMatch(/^let\s+accessToken/m);
  });

  it('confirms the legacy path really does hold the token in memory', () => {
    // Guards the premise of this whole PR: if this ever stops being true, the
    // customer-facing bug was fixed elsewhere and this test should be revisited.
    const legacy = readCodeOnly('src/services/googleSearchConsole.ts');
    expect(legacy).toMatch(/let\s+accessToken/);
  });
});

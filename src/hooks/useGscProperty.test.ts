/**
 * The customer bug, at the hook level:
 * "I connect Search Console but it disconnects / won't stay connected."
 *
 * Every test here holds the same line: `connected` is whatever the SERVER says
 * and nothing else — never a token in memory, never a leftover in localStorage —
 * and until the server has answered the UI must say "loading", not "connect".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installMemoryLocalStorage } from '../test-utils/memoryStorage';
import type { GscConnectionStatus, GscOverview } from '../services/gscConnection';

const statusMock = vi.fn();
const cachedMock = vi.fn();
const syncMock = vi.fn();
const connectMock = vi.fn();
const disconnectMock = vi.fn();
const configuredMock = vi.fn();

vi.mock('../lib/supabaseClient', () => ({
	supabase: { functions: { invoke: vi.fn() }, from: vi.fn() },
}));

/**
 * The hook localises edge error codes through `gsc.errors.<code>`, falling back
 * to the English `gscErrorMessage`. Returning the fallback here keeps the
 * assertions on the message the user actually gets, without booting i18next.
 */
vi.mock('react-i18next', () => ({
	useTranslation: () => ({
		t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
	}),
}));

vi.mock('../services/gscConnection', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../services/gscConnection')>();
	return {
		...actual,
		isGscConfigured: () => configuredMock() as boolean,
		getGscConnectionStatus: (...args: unknown[]) => statusMock(...args) as Promise<unknown>,
		getCachedGscOverview: (...args: unknown[]) => cachedMock(...args) as Promise<unknown>,
		syncGscProject: (...args: unknown[]) => syncMock(...args) as Promise<unknown>,
		connectGscProject: (...args: unknown[]) => connectMock(...args) as Promise<unknown>,
		disconnectGscProject: (...args: unknown[]) => disconnectMock(...args) as Promise<unknown>,
	};
});

import { useGscProperty } from './useGscProperty';

const PROJECT = 'project-1';
const SITE = 'https://example.com/';

function status(overrides: Partial<GscConnectionStatus> = {}): GscConnectionStatus {
	return {
		connected: true,
		property: SITE,
		permissionLevel: 'siteOwner',
		connectedAt: '2026-09-01T10:00:00Z',
		dataAsOf: new Date().toISOString(),
		revokedAt: null,
		...overrides,
	};
}

const DISCONNECTED: GscConnectionStatus = {
	connected: false,
	property: null,
	permissionLevel: null,
	connectedAt: null,
	dataAsOf: null,
	revokedAt: null,
};

const OVERVIEW: GscOverview = {
	totals: { clicks: 10, impressions: 100, ctr: 0.1, position: 4.2 },
	topQueries: [{ key: 'rankdelta', clicks: 10, impressions: 100, ctr: 0.1, position: 4.2 }],
	topPages: [],
	byDate: [{ date: '2026-09-20', clicks: 10, impressions: 100 }],
};

beforeEach(() => {
	statusMock.mockReset();
	cachedMock.mockReset();
	syncMock.mockReset();
	connectMock.mockReset();
	disconnectMock.mockReset();
	configuredMock.mockReset();
	configuredMock.mockReturnValue(true);
	cachedMock.mockResolvedValue(null);
	// Node 22 ships an `undefined` localStorage global that shadows jsdom's, so
	// the suite installs its own — same helper the other storage tests use.
	installMemoryLocalStorage();
});

describe('connected comes from the server, not from an in-memory token', () => {
	it('is connected after a reload, with nothing in this process but the stored row', async () => {
		statusMock.mockResolvedValue(status());
		cachedMock.mockResolvedValue(OVERVIEW);

		const { result } = renderHook(() => useGscProperty(PROJECT, 'https://example.com'));

		await waitFor(() => expect(result.current.connected).toBe(true));
		expect(result.current.property).toBe(SITE);
		expect(result.current.overview?.totals.clicks).toBe(10);
		// Fresh cached data: no need to call Google on every page load.
		expect(syncMock).not.toHaveBeenCalled();
		await waitFor(() => expect(result.current.loading).toBe(false));
	});

	it('seeds the property dropdown from the stored connection so it is never blank', async () => {
		statusMock.mockResolvedValue(status());
		cachedMock.mockResolvedValue(OVERVIEW);

		const { result } = renderHook(() => useGscProperty(PROJECT, null));

		await waitFor(() => expect(result.current.properties).toHaveLength(1));
		expect(result.current.properties[0]?.siteUrl).toBe(SITE);
	});

	it('a remembered property never makes a disconnected project look connected', async () => {
		localStorage.setItem(`gsc_property_${PROJECT}`, SITE);
		statusMock.mockResolvedValue(DISCONNECTED);

		const { result } = renderHook(() => useGscProperty(PROJECT, null));

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.connected).toBe(false);
	});

	it('stays disconnected when the status read itself fails', async () => {
		statusMock.mockRejectedValue(new Error('network'));

		const { result } = renderHook(() => useGscProperty(PROJECT, null));

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.connected).toBe(false);
	});
});

describe('no flash of "not connected"', () => {
	it('reports loading, not disconnected, while the status is in flight', async () => {
		let resolveStatus: (s: GscConnectionStatus) => void = () => undefined;
		statusMock.mockReturnValue(
			new Promise<GscConnectionStatus>((res) => {
				resolveStatus = res;
			}),
		);

		const { result } = renderHook(() => useGscProperty(PROJECT, null));

		// This is the exact moment the customer saw "not connected": connected is
		// false because nothing is known yet, so loading MUST be true and the
		// caller MUST render the loading state instead of the connect CTA.
		expect(result.current.connected).toBe(false);
		expect(result.current.loading).toBe(true);

		await act(async () => {
			resolveStatus(status());
		});
		await waitFor(() => expect(result.current.connected).toBe(true));
	});

	it('both rankings tabs gate the connect CTA behind that loading state', () => {
		// A regression here is invisible to the hook tests but visible to the user,
		// so it is asserted on the source: the disconnected branch must come after
		// a loading branch, never before it.
		for (const file of [
			'src/components/rankings/RankingsOverviewTab.tsx',
			'src/components/rankings/RankingsOpportunitiesTab.tsx',
		]) {
			const code = readFileSync(resolve(process.cwd(), file), 'utf8');
			const loadingGuard = code.indexOf('!gsc.connected && gsc.loading');
			const ctaGuard = code.indexOf('if (!gsc.connected) {');
			expect(loadingGuard, `${file} has no loading guard`).toBeGreaterThan(-1);
			expect(ctaGuard, `${file} has no disconnected branch`).toBeGreaterThan(-1);
			expect(loadingGuard, `${file} shows the CTA before the status is known`).toBeLessThan(
				ctaGuard,
			);
		}
	});
});

describe('stale data is refreshed without a popup', () => {
	it('shows cached numbers immediately and syncs when they are weeks old', async () => {
		statusMock.mockResolvedValue(status({ dataAsOf: '2026-08-24T10:00:00Z' }));
		cachedMock.mockResolvedValue(OVERVIEW);
		syncMock.mockResolvedValue({
			property: SITE,
			properties: [{ siteUrl: SITE, permissionLevel: 'siteOwner' }],
			overview: { ...OVERVIEW, totals: { ...OVERVIEW.totals, clicks: 42 } },
		});

		const { result } = renderHook(() => useGscProperty(PROJECT, null));

		await waitFor(() => expect(result.current.overview?.totals.clicks).toBe(42));
		expect(syncMock).toHaveBeenCalledWith(PROJECT, { siteUrl: SITE, periodDays: 28 });
		expect(result.current.connected).toBe(true);
	});

	it('syncs when nothing was ever cached', async () => {
		statusMock.mockResolvedValue(status({ dataAsOf: null }));
		cachedMock.mockResolvedValue(null);
		syncMock.mockResolvedValue({ property: SITE, properties: [], overview: OVERVIEW });

		const { result } = renderHook(() => useGscProperty(PROJECT, null));

		await waitFor(() => expect(result.current.overview).not.toBeNull());
		expect(syncMock).toHaveBeenCalledTimes(1);
	});

	it('keeps cached data on screen when the background refresh fails', async () => {
		statusMock.mockResolvedValue(status({ dataAsOf: '2026-08-24T10:00:00Z' }));
		cachedMock.mockResolvedValue(OVERVIEW);
		syncMock.mockRejectedValue(new Error('gsc_request_failed'));

		const { result } = renderHook(() => useGscProperty(PROJECT, null));

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.connected).toBe(true);
		expect(result.current.overview?.totals.clicks).toBe(10);
		expect(result.current.error).toBeNull();
	});

	it('only the server saying not_connected may flip the UI to disconnected', async () => {
		statusMock.mockResolvedValue(status({ dataAsOf: null }));
		syncMock.mockRejectedValue(new Error('not_connected'));

		const { result } = renderHook(() => useGscProperty(PROJECT, null));

		// Anchor on the error: `connected` is false on the first render too, before
		// the status has come back, so waiting on it would prove nothing.
		await waitFor(() => expect(result.current.error).toMatch(/not connected/i));
		expect(result.current.connected).toBe(false);
		expect(result.current.loading).toBe(false);
	});
});

describe('a deployment without GOOGLE_CLIENT_SECRET says so', () => {
	it('surfaces not_configured from a sync instead of silently disconnecting', async () => {
		statusMock.mockResolvedValue(status({ dataAsOf: null }));
		syncMock.mockRejectedValue(new Error('not_configured'));

		const { result } = renderHook(() => useGscProperty(PROJECT, null));

		await waitFor(() => expect(result.current.error).not.toBeNull());
		expect(result.current.error).toMatch(/not configured/i);
		// The project IS connected; the server just cannot talk to Google.
		expect(result.current.connected).toBe(true);
	});

	it('surfaces not_configured from a connect attempt', async () => {
		statusMock.mockResolvedValue(DISCONNECTED);
		connectMock.mockRejectedValue(new Error('not_configured'));

		const { result } = renderHook(() => useGscProperty(PROJECT, null));
		await waitFor(() => expect(result.current.loading).toBe(false));

		await act(async () => {
			await result.current.handleConnect();
		});

		expect(result.current.error).toMatch(/not configured/i);
		expect(result.current.connected).toBe(false);
		expect(result.current.connecting).toBe(false);
	});

	it('turns no_refresh_token into a way out, not a retry loop', async () => {
		// Users of the old in-browser flow already granted this client the scope,
		// so Google hands back a code with no refresh token and gsc-connect
		// answers 400 no_refresh_token. Retrying changes nothing; the grant has to
		// be removed at Google first.
		statusMock.mockResolvedValue(DISCONNECTED);
		connectMock.mockRejectedValue(new Error('no_refresh_token'));

		const { result } = renderHook(() => useGscProperty(PROJECT, null));
		await waitFor(() => expect(result.current.loading).toBe(false));

		await act(async () => {
			await result.current.handleConnect();
		});

		expect(result.current.error).toMatch(/https:\/\/myaccount\.google\.com\/permissions/);
		// Nothing was stored server-side, so the project is still disconnected —
		// and the user is looking at the connect button, not a spinner.
		expect(result.current.connected).toBe(false);
		expect(result.current.connecting).toBe(false);
		expect(result.current.loading).toBe(false);
	});

	it('explains a closed popup rather than failing generically', async () => {
		statusMock.mockResolvedValue(DISCONNECTED);
		connectMock.mockRejectedValue(new Error('popup_closed'));

		const { result } = renderHook(() => useGscProperty(PROJECT, null));
		await waitFor(() => expect(result.current.loading).toBe(false));

		await act(async () => {
			await result.current.handleConnect();
		});

		expect(result.current.error).toMatch(/closed/i);
	});
});

describe('the selected property is remembered, the connection is not', () => {
	it('restores the remembered property before the server answers', () => {
		localStorage.setItem(`gsc_property_${PROJECT}`, SITE);
		statusMock.mockReturnValue(new Promise(() => undefined));

		const { result } = renderHook(() => useGscProperty(PROJECT, null));

		expect(result.current.property).toBe(SITE);
		expect(result.current.connected).toBe(false);
	});

	it('persists the property a successful connect settled on', async () => {
		statusMock.mockResolvedValue(DISCONNECTED);
		connectMock.mockResolvedValue({
			property: SITE,
			properties: [{ siteUrl: SITE, permissionLevel: 'siteOwner' }],
			overview: OVERVIEW,
		});

		const { result } = renderHook(() => useGscProperty(PROJECT, 'https://example.com'));
		await waitFor(() => expect(result.current.loading).toBe(false));

		await act(async () => {
			await result.current.handleConnect();
		});

		expect(result.current.connected).toBe(true);
		expect(localStorage.getItem(`gsc_property_${PROJECT}`)).toBe(SITE);
		expect(connectMock).toHaveBeenCalledWith(PROJECT, { periodDays: 28 });
	});

	it('switching property persists it and fetches that property’s data', async () => {
		statusMock.mockResolvedValue(status());
		cachedMock.mockResolvedValue(OVERVIEW);
		syncMock.mockResolvedValue({
			property: 'https://other.test/',
			properties: [{ siteUrl: 'https://other.test/', permissionLevel: 'siteOwner' }],
			overview: OVERVIEW,
		});

		const { result } = renderHook(() => useGscProperty(PROJECT, null));
		await waitFor(() => expect(result.current.connected).toBe(true));

		await act(async () => {
			result.current.selectProperty('https://other.test/');
		});

		await waitFor(() =>
			expect(syncMock).toHaveBeenCalledWith(PROJECT, {
				siteUrl: 'https://other.test/',
				periodDays: 28,
			}),
		);
		expect(localStorage.getItem(`gsc_property_${PROJECT}`)).toBe('https://other.test/');
	});

	it('disconnect goes to the server and forgets the remembered property', async () => {
		statusMock.mockResolvedValue(status());
		cachedMock.mockResolvedValue(OVERVIEW);
		disconnectMock.mockResolvedValue(undefined);

		const { result } = renderHook(() => useGscProperty(PROJECT, null));
		await waitFor(() => expect(result.current.connected).toBe(true));

		await act(async () => {
			await result.current.disconnect();
		});

		expect(disconnectMock).toHaveBeenCalledWith(PROJECT);
		expect(result.current.connected).toBe(false);
		expect(result.current.overview).toBeNull();
		expect(localStorage.getItem(`gsc_property_${PROJECT}`)).toBeNull();
	});

	it('a failed disconnect leaves the connection alone and explains why', async () => {
		statusMock.mockResolvedValue(status());
		cachedMock.mockResolvedValue(OVERVIEW);
		disconnectMock.mockRejectedValue(new Error('gsc_request_failed'));

		const { result } = renderHook(() => useGscProperty(PROJECT, null));
		await waitFor(() => expect(result.current.connected).toBe(true));

		await act(async () => {
			await result.current.disconnect();
		});

		// The server still holds the token, so the UI must not pretend otherwise.
		expect(result.current.connected).toBe(true);
		expect(result.current.error).toMatch(/failed/i);
	});
});

describe('deployments without VITE_GOOGLE_CLIENT_ID', () => {
	it('never queries the server and settles immediately', async () => {
		configuredMock.mockReturnValue(false);

		const { result } = renderHook(() => useGscProperty(PROJECT, null));

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.configured).toBe(false);
		expect(statusMock).not.toHaveBeenCalled();
	});
});

describe('the hook keeps the contract its callers depend on', () => {
	it('a grant Google revoked: shows cached data, flags revoked, never calls Google', async () => {
		statusMock.mockResolvedValue(status({ revokedAt: '2026-09-24T05:00:02Z', dataAsOf: '2026-08-24T10:00:00Z' }));
		cachedMock.mockResolvedValue({ clicks: 10, impressions: 100, ctr: 0.1, position: 5, queries: [], pages: [], daily: [] });
		const { result } = renderHook(() => useGscProperty(PROJECT, SITE));
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.connected).toBe(true);
		expect(result.current.revoked).toBe(true);
		expect(result.current.overview).not.toBeNull();
		expect(syncMock).not.toHaveBeenCalled();
	});

	it('returns every field the rankings tabs read', async () => {
		statusMock.mockResolvedValue(DISCONNECTED);
		const { result } = renderHook(() => useGscProperty(PROJECT, null));
		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(Object.keys(result.current).sort()).toEqual(
			[
				'configured',
				'connected',
				'connecting',
				'revoked',
				'disconnect',
				'error',
				'handleConnect',
				'loading',
				'overview',
				'properties',
				'property',
				'selectProperty',
				'setError',
			].sort(),
		);
	});
});

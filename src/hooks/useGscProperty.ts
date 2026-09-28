/**
 * useGscProperty — Search Console state for the rankings tabs.
 *
 * The connection is read from the SERVER (`gsc_properties`), never from an
 * in-memory access token. That is the whole point of this hook: the previous
 * version seeded `connected` from `hasValidToken()`, a module-level variable in
 * `googleSearchConsole.ts` that is empty after every reload and expires after an
 * hour anyway — so a customer who connected Search Console found it
 * "disconnected" moments later, while the *selected property* survived in
 * localStorage and made the whole thing look intermittent.
 *
 * Two rules follow from that, and the tests pin both:
 *  1. `connected` comes from `getGscConnectionStatus()` and nothing else. The
 *     remembered property is a convenience; it can never imply a connection.
 *  2. Until that answer arrives, `loading` is true and `connected` is false —
 *     callers must render the loading state, not the "connect" call to action,
 *     or the user sees the very flash of "not connected" they complained about.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
	DEFAULT_PERIOD_DAYS,
	connectGscProject,
	disconnectGscProject,
	getCachedGscOverview,
	getGscConnectionStatus,
	gscErrorMessage,
	isDataStale,
	isGscConfigured,
	syncGscProject,
	type GscConnectResult,
	type GscOverview,
	type GscProperty,
} from '../services/gscConnection';

const propKey = (projectId: string) => `gsc_property_${projectId}`;

/**
 * The selected property is remembered per project so the dropdown comes back on
 * the property the user last looked at. Wrapped because storage throws in
 * private browsing, and a failed convenience must never break the page.
 */
function readStoredProperty(projectId: string): string | null {
	try {
		return localStorage.getItem(propKey(projectId));
	} catch {
		return null;
	}
}

function rememberProperty(projectId: string, siteUrl: string): void {
	try {
		localStorage.setItem(propKey(projectId), siteUrl);
	} catch {
		/* non-fatal: the property is still in React state for this session */
	}
}

function forgetProperty(projectId: string): void {
	try {
		localStorage.removeItem(propKey(projectId));
	} catch {
		/* non-fatal */
	}
}

/** Errors from the service layer carry an edge error code as their message. */
function errorCode(failure: unknown): string | null {
	return failure instanceof Error ? failure.message : null;
}

/**
 * Which property to show once Google has told us what the account can read:
 * the one the user last picked, else the one matching the project's website,
 * else whatever the server chose.
 */
function preferredProperty(
	properties: GscProperty[],
	stored: string | null,
	websiteUrl: string | null | undefined,
): string | null {
	if (stored && properties.some((p) => p.siteUrl === stored)) return stored;
	if (!websiteUrl) return null;
	let host = websiteUrl;
	try {
		host = new URL(websiteUrl.includes('://') ? websiteUrl : `https://${websiteUrl}`).hostname.replace(
			/^www\./,
			'',
		);
	} catch {
		/* fall back to the raw string */
	}
	const match = properties.find((p) => {
		const normalized = p.siteUrl
			.replace(/^sc-domain:/, '')
			.replace(/^https?:\/\//, '')
			.replace(/^www\./, '')
			.replace(/\/$/, '');
		return normalized === host;
	});
	return match?.siteUrl ?? null;
}

export function useGscProperty(projectId: string, websiteUrl?: string | null) {
	const { t } = useTranslation();
	const configured = isGscConfigured();
	const [connected, setConnected] = useState(false);
	/** Google rejected the stored grant: cached data only, until the owner reconnects. */
	const [revoked, setRevoked] = useState(false);
	/** False until the server has answered — see rule 2 above. */
	const [statusChecked, setStatusChecked] = useState(false);
	const [connecting, setConnecting] = useState(false);
	const [properties, setProperties] = useState<GscProperty[]>([]);
	const [property, setProperty] = useState<string | null>(() => readStoredProperty(projectId));
	const [overview, setOverview] = useState<GscOverview | null>(null);
	const [dataLoading, setDataLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	/**
	 * Edge error codes become user-facing text here, in the reader's language.
	 * `gscErrorMessage` stays the English source of truth and the fallback, so a
	 * code that has no translation yet still says something useful.
	 */
	const messageFor = useCallback(
		(code: string | null) =>
			t(`gsc.errors.${code ?? 'unknown'}`, { defaultValue: gscErrorMessage(code) }),
		[t],
	);

	// The bootstrap effect must not re-run when the UI language changes — it would
	// re-query the server and possibly re-hit Google — so it reads the translator
	// through a ref instead of taking it as a dependency.
	const messageRef = useRef(messageFor);
	useEffect(() => {
		messageRef.current = messageFor;
	}, [messageFor]);

	const applyResult = useCallback(
		(result: GscConnectResult) => {
			setConnected(true);
			setRevoked(false);
			setProperties(result.properties);
			setProperty(result.property);
			rememberProperty(projectId, result.property);
			// A sync that returned no data must not erase what is already on screen.
			if (result.overview) setOverview(result.overview);
		},
		[projectId],
	);

	/** Refresh through the stored refresh token — no popup, no user interaction. */
	const syncProperty = useCallback(
		async (siteUrl?: string) => {
			setDataLoading(true);
			setError(null);
			try {
				applyResult(
					await syncGscProject(projectId, {
						...(siteUrl ? { siteUrl } : {}),
						periodDays: DEFAULT_PERIOD_DAYS,
					}),
				);
			} catch (failure) {
				const code = errorCode(failure);
				setError(messageFor(code));
				// Only the server saying "not_connected" may flip the UI back to
				// disconnected. A misconfigured deployment (not_configured) or a
				// transient failure keeps the connection and shows the reason.
				if (code === 'not_connected') setConnected(false);
			} finally {
				setDataLoading(false);
			}
		},
		[applyResult, messageFor, projectId],
	);

	const selectProperty = useCallback(
		(url: string) => {
			setProperty(url);
			rememberProperty(projectId, url);
			// The cache is keyed by project and period, not by site, so a different
			// property needs a fetch before its numbers can be shown.
			void syncProperty(url);
		},
		[projectId, syncProperty],
	);

	const handleConnect = useCallback(async () => {
		setError(null);
		setConnecting(true);
		try {
			// No siteUrl: the edge function picks the stored one, or matches the
			// project's website against what the Google account can actually read.
			const result = await connectGscProject(projectId, { periodDays: DEFAULT_PERIOD_DAYS });
			applyResult(result);
			setStatusChecked(true);
			const preferred = preferredProperty(
				result.properties,
				readStoredProperty(projectId),
				websiteUrl,
			);
			if (preferred && preferred !== result.property) selectProperty(preferred);
		} catch (failure) {
			setError(messageFor(errorCode(failure)));
			setConnected(false);
		} finally {
			setConnecting(false);
		}
	}, [applyResult, messageFor, projectId, selectProperty, websiteUrl]);

	const disconnect = useCallback(async () => {
		setError(null);
		try {
			// Server-side: deletes the refresh token, the property and the cache, and
			// revokes the grant at Google. Forgetting a local variable is not enough.
			await disconnectGscProject(projectId);
		} catch (failure) {
			setError(messageFor(errorCode(failure)));
			return;
		}
		forgetProperty(projectId);
		setConnected(false);
		setProperties([]);
		setOverview(null);
		setProperty(null);
	}, [messageFor, projectId]);

	useEffect(() => {
		if (!configured) {
			setStatusChecked(true);
			return;
		}

		let cancelled = false;
		setStatusChecked(false);
		setConnected(false);
		setRevoked(false);
		setProperties([]);
		setOverview(null);
		setError(null);
		setProperty(readStoredProperty(projectId));

		void (async (): Promise<void> => {
			let status;
			try {
				status = await getGscConnectionStatus(projectId);
			} catch {
				// Unreachable status is not proof of a disconnection, but there is
				// nothing to show either; the connect button is the only way forward.
				if (!cancelled) setStatusChecked(true);
				return;
			}
			if (cancelled) return;

			setStatusChecked(true);
			if (!status.connected) return;

			setConnected(true);
			setRevoked(Boolean(status.revokedAt));
			if (status.property) {
				setProperty(status.property);
				rememberProperty(projectId, status.property);
				// Seed the dropdown so it is never blank before a sync returns the
				// full list of properties.
				setProperties([{ siteUrl: status.property, permissionLevel: status.permissionLevel }]);
			}

			setDataLoading(true);
			let cached: GscOverview | null = null;
			try {
				cached = await getCachedGscOverview(projectId, DEFAULT_PERIOD_DAYS);
			} catch {
				cached = null;
			}
			if (cancelled) return;
			if (cached) setOverview(cached);

			// Nothing refreshes Search Console on a schedule today, so cached numbers
			// can be weeks old. Show them instantly, then refresh when they are stale.
			// A revoked grant cannot refresh; show what is cached and let the banner ask to reconnect.
			if (status.revokedAt || (cached && !isDataStale(status.dataAsOf))) {
				setDataLoading(false);
				return;
			}
			try {
				const result = await syncGscProject(projectId, {
					...(status.property ? { siteUrl: status.property } : {}),
					periodDays: DEFAULT_PERIOD_DAYS,
				});
				if (!cancelled) applyResult(result);
			} catch (failure) {
				if (cancelled) return;
				const code = errorCode(failure);
				// A background refresh that fails behind usable data is not worth an
				// alarm; with nothing on screen the user needs to know why.
				if (!cached) setError(messageRef.current(code));
				if (code === 'not_connected') setConnected(false);
			} finally {
				if (!cancelled) setDataLoading(false);
			}
		})();

		return (): void => {
			cancelled = true;
		};
	}, [applyResult, configured, projectId]);

	return {
		configured,
		connected,
		revoked,
		connecting,
		properties,
		property,
		overview,
		/** True until the connection status is known, and while data is loading. */
		loading: !statusChecked || dataLoading,
		error,
		selectProperty,
		handleConnect,
		disconnect,
		setError,
	};
}

import { useCallback, useEffect, useState } from 'react';
import {
	clearGa4Token,
	connectGa4,
	getGa4Overview,
	hasValidGa4Token,
	isGa4Configured,
	listGa4Properties,
	matchGa4Property,
	type Ga4Overview,
	type Ga4Property,
} from '../services/googleAnalytics4';

const propKey = (projectId: string) => `ga4_property_${projectId}`;

export function useGa4Property(projectId: string, websiteUrl?: string | null) {
	const configured = isGa4Configured();
	const [connected, setConnected] = useState(hasValidGa4Token());
	const [connecting, setConnecting] = useState(false);
	const [properties, setProperties] = useState<Ga4Property[]>([]);
	const [property, setProperty] = useState<string | null>(() =>
		typeof localStorage !== 'undefined' ? localStorage.getItem(propKey(projectId)) : null,
	);
	const [overview, setOverview] = useState<Ga4Overview | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const selectProperty = useCallback(
		(id: string) => {
			setProperty(id);
			localStorage.setItem(propKey(projectId), id);
		},
		[projectId],
	);

	const handleConnect = useCallback(async () => {
		setError(null);
		setConnecting(true);
		try {
			await connectGa4();
			setConnected(true);
			const props = await listGa4Properties();
			setProperties(props);
			const picked =
				localStorage.getItem(propKey(projectId)) || matchGa4Property(props, websiteUrl ?? undefined);
			if (picked) selectProperty(picked);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Connection failed');
			setConnected(false);
		} finally {
			setConnecting(false);
		}
	}, [projectId, selectProperty, websiteUrl]);

	const disconnect = useCallback(() => {
		clearGa4Token();
		setConnected(false);
		setProperties([]);
		setOverview(null);
	}, []);

	useEffect(() => {
		setProperty(localStorage.getItem(propKey(projectId)));
	}, [projectId]);

	useEffect(() => {
		if (!connected || !property) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		getGa4Overview(property, 28)
			.then((data) => !cancelled && setOverview(data))
			.catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load data'))
			.finally(() => !cancelled && setLoading(false));
		return () => {
			cancelled = true;
		};
	}, [connected, property]);

	return {
		configured,
		connected,
		connecting,
		properties,
		property,
		overview,
		loading,
		error,
		selectProperty,
		handleConnect,
		disconnect,
		setError,
	};
}

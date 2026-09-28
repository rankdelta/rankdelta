import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// A paying agency user saw "upgrade to Pro" for a moment on every report page: while the session
// is being restored the subscription query is disabled, and a disabled query isn't "loading".
const auth = { user: null as { id: string } | null, isLoading: true };
vi.mock('./useAuth', () => ({ useAuth: () => auth }));
vi.mock('../lib/supabaseClient', () => ({
	supabase: {
		from: () => ({ select: () => ({ eq: () => ({ single: () => new Promise(() => undefined), order: () => new Promise(() => undefined) }), order: () => new Promise(() => undefined) }) }),
		rpc: () => new Promise(() => undefined),
	},
}));

import { useSubscription } from './useSubscription';

const wrapper = ({ children }: { children: ReactNode }) => (
	<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('useSubscription loading state', () => {
	it('is loading while the session is still being restored', () => {
		auth.user = null;
		auth.isLoading = true;
		const { result } = renderHook(() => useSubscription(), { wrapper });
		expect(result.current.isLoading).toBe(true);
		expect(result.current.subscription).toBeNull();
	});

	it('is not loading for a signed-out visitor once the session is known', () => {
		auth.user = null;
		auth.isLoading = false;
		const { result } = renderHook(() => useSubscription(), { wrapper });
		expect(result.current.isLoading).toBe(false);
	});
});

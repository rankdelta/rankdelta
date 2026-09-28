import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { getSessionSafe } from '../lib/requireAuth';

/**
 * Layout for /visibility/* — hub lives at /visibility/ (visibility.index.tsx).
 */
export const Route = createFileRoute('/visibility')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });
	},
	component: () => <Outlet />,
});

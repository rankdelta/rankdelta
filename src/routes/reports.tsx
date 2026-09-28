import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { getSessionSafe } from '../lib/requireAuth';

/**
 * Layout for /reports/* — agency reporting (portal, portfolio). Legacy content-agent
 * ReportsPage is not mounted here; bare /reports redirects to /reports/portal.
 */
export const Route = createFileRoute('/reports')({
	beforeLoad: async ({ location }) => {
		const {
			data: { session },
		} = await getSessionSafe();

		if (!session) {
			throw redirect({ to: '/login' as any });
		}

		if (location.pathname === '/reports' || location.pathname === '/reports/') {
			throw redirect({ to: '/reports/portal' as any });
		}
	},
	component: () => <Outlet />,
});

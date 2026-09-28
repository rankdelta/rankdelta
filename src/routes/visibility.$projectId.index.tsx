import { createFileRoute, redirect } from '@tanstack/react-router';
import { VisibilityDashboardPage } from '../pages/visibility/VisibilityDashboardPage';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/visibility/$projectId/')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });
	},
	component: VisibilityDashboardPage,
});

import { createFileRoute, redirect } from '@tanstack/react-router';
import { VisibilityQueriesPage } from '../pages/visibility/VisibilityQueriesPage';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/visibility/$projectId/queries')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });
	},
	component: VisibilityQueriesPage,
});

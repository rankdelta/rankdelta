import { createFileRoute, redirect } from '@tanstack/react-router';
import { VisibilityCompetitorsPage } from '../pages/visibility/VisibilityCompetitorsPage';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/visibility/$projectId/competitors')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });
	},
	component: VisibilityCompetitorsPage,
});

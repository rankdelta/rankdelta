import { createFileRoute, redirect } from '@tanstack/react-router';
import { VisibilityCitationsPage } from '../pages/visibility/VisibilityCitationsPage';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/visibility/$projectId/citations')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });
	},
	component: VisibilityCitationsPage,
});

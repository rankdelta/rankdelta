import { createFileRoute, redirect } from '@tanstack/react-router';
import { VisibilityPlaybookPage } from '../pages/visibility/VisibilityPlaybookPage';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/visibility/$projectId/playbook')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });
	},
	component: VisibilityPlaybookPage,
});

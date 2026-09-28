import { createFileRoute, redirect } from '@tanstack/react-router';
import { VisibilityHubPage } from '../pages/visibility/VisibilityHubPage';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/visibility/')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });
	},
	validateSearch: (search: Record<string, unknown>) => {
		const notice = search['notice'];
		return {
			notice:
				notice === 'project_not_found' || notice === 'invalid_project'
					? (notice as 'project_not_found' | 'invalid_project')
					: undefined,
		};
	},
	component: VisibilityHubPage,
});

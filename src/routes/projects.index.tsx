import { createFileRoute, redirect } from '@tanstack/react-router';
import { ProjectsListPage } from '../pages/ProjectsListPage';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/projects/')({
	beforeLoad: async () => {
		// Check if user is authenticated
		const {
			data: { session },
		} = await getSessionSafe();
		
		if (!session) {
			throw redirect({ to: '/login' as any });
		}
	},
	component: ProjectsListPage,
});


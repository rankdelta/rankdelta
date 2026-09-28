import { createFileRoute, redirect } from '@tanstack/react-router';
import { ProjectsPage } from '../pages/ProjectsPage';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/projects/$projectId')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });
	},
	component: ProjectsPage,
});

import { createFileRoute, redirect } from '@tanstack/react-router';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/visibility/$projectId/insights')({
	beforeLoad: async ({ params }) => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });
		throw redirect({
			to: '/visibility/$projectId',
			params: { projectId: params.projectId },
			replace: true,
		});
	},
});

import { createFileRoute, redirect } from '@tanstack/react-router';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/visibility/$projectId/rankings')({
	beforeLoad: async ({ params }) => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });
		throw redirect({
			to: '/rankings/$projectId',
			params: { projectId: params.projectId },
			search: { tab: 'keywords' },
		});
	},
});

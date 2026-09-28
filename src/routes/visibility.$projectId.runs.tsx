import { createFileRoute, redirect } from '@tanstack/react-router';
import { getSessionSafe } from '../lib/requireAuth';

/** Legacy path — run history retired in favor of answer receipts on Prompts + Overview. */
export const Route = createFileRoute('/visibility/$projectId/runs')({
	beforeLoad: async ({ params }) => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });
		throw redirect({
			to: '/visibility/$projectId/queries',
			params: { projectId: params.projectId },
			replace: true,
		});
	},
});

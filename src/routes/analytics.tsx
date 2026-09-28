import { createFileRoute, redirect } from '@tanstack/react-router';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/analytics')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();

		if (!session) {
			throw redirect({ to: '/login' as any });
		}

		// Redirect legacy /analytics URLs to the new rankings route.
		// Active project id is resolved client-side on /rankings/ index if not in URL.
		throw redirect({ to: '/rankings/' as any });
	},
});

import { createFileRoute, redirect } from '@tanstack/react-router';
import { VisibilitySettingsPage } from '../pages/visibility/VisibilitySettingsPage';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/visibility/$projectId/settings')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });
	},
	component: VisibilitySettingsPage,
});

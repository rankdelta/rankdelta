import { createFileRoute, redirect } from '@tanstack/react-router';
import { SettingsPage } from '../pages/SettingsPage';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/settings')({
	beforeLoad: async () => {
		// Check if user is authenticated
		const {
			data: { session },
		} = await getSessionSafe();
		
		if (!session) {
			throw redirect({ to: '/login' as any });
		}
	},
	component: SettingsPage,
});

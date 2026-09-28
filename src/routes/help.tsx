import { createFileRoute, redirect } from '@tanstack/react-router';
import { HelpPage } from '../pages/HelpPage';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/help')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) {
			throw redirect({ to: '/login' as any });
		}
	},
	component: HelpPage,
});



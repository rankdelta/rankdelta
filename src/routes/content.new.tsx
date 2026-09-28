import { createFileRoute, redirect } from '@tanstack/react-router';
import { NewContentPage } from '../pages/NewContentPage';
import { redirectIfLegacyAgentDisabled } from '../lib/legacyAgentRoutes';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/content/new')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();

		if (!session) {
			throw redirect({ to: '/login' as any });
		}
		redirectIfLegacyAgentDisabled();
	},
	component: NewContentPage,
});


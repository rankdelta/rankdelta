import { createFileRoute, redirect } from '@tanstack/react-router';
import { ContentUpdatesPage } from '../pages/ContentUpdatesPage';
import { redirectIfLegacyAgentDisabled } from '../lib/legacyAgentRoutes';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/content-updates')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();

		if (!session) {
			throw redirect({ to: '/login' as any });
		}
		redirectIfLegacyAgentDisabled();
	},
	component: ContentUpdatesPage,
});

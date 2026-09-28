import { createFileRoute, redirect } from '@tanstack/react-router';
import { KeywordsDashboard } from '../pages/KeywordsDashboard';
import { redirectIfLegacyAgentDisabled } from '../lib/legacyAgentRoutes';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/keywords')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();

		if (!session) {
			throw redirect({ to: '/login' as any });
		}
		redirectIfLegacyAgentDisabled();
	},
	component: KeywordsDashboard,
});


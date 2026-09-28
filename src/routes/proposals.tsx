import { createFileRoute, redirect } from '@tanstack/react-router';
import { ProposalsAndKeywordsPage } from '../pages/ProposalsAndKeywordsPage';
import { redirectIfLegacyAgentDisabled } from '../lib/legacyAgentRoutes';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/proposals')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();

		if (!session) {
			throw redirect({ to: '/login' as any });
		}
		redirectIfLegacyAgentDisabled();
	},
	component: ProposalsAndKeywordsPage,
});


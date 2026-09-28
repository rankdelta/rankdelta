import { createFileRoute, redirect } from '@tanstack/react-router';
import { Dashboard } from '../pages/Dashboard';
import { getDefaultAuthenticatedHomePath, isLegacyAgentUiAvailable } from '../config/productMode';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/dashboard')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();

		if (!session) {
			throw redirect({ to: '/login' as any });
		}

		// Visibility-first product: calendar hub is legacy; land on workspaces instead
		if (!isLegacyAgentUiAvailable()) {
			throw redirect({ to: getDefaultAuthenticatedHomePath() });
		}
	},
	component: Dashboard,
});


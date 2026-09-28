import { createFileRoute, redirect } from '@tanstack/react-router';
import { OnboardingFlow } from '../pages/OnboardingFlow';
import { getSessionSafe } from '../lib/requireAuth';
import { canCreateProject } from '../services/credits';
import { requiresSubscription } from '../config/deployment';

export const Route = createFileRoute('/projects/new')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });

		// Self-host has no plans/billing — never bounce a self-hoster to /pricing for a project cap.
		if (!requiresSubscription()) return;

		const gate = await canCreateProject(session.user.id);
		if (!gate.canCreate) {
			throw redirect({ to: '/pricing' as any, search: { reason: 'project_limit' } as any });
		}
	},
	component: OnboardingFlow,
});

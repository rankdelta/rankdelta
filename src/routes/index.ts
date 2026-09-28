import { createFileRoute, redirect } from '@tanstack/react-router';
import { getSessionSafe } from '../lib/requireAuth';
import { getDefaultAuthenticatedHomePath } from '../config/productMode';

// Open edition: no marketing landing — the operator already installed the app.
export const Route = createFileRoute('/')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();
		throw redirect({ to: (session ? getDefaultAuthenticatedHomePath() : '/login') as any });
	},
	component: () => null,
});

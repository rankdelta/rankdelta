import { createFileRoute, redirect } from '@tanstack/react-router';
import { ContentView } from '../pages/ContentView';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/content/$contentId')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();

		if (!session) {
			throw redirect({ to: '/login' as any });
		}
		// No legacy-agent guard here: a plain content view is valid in every product mode
		// (Piano/calendar link to /content/$id even when the legacy agent UI is disabled).
	},
	component: ContentView,
});


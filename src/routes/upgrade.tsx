import { createFileRoute, redirect } from '@tanstack/react-router';

// Open edition: no plans or billing.
export const Route = createFileRoute('/upgrade')({
	beforeLoad: () => {
		throw redirect({ to: '/settings' as any });
	},
	component: () => null,
});

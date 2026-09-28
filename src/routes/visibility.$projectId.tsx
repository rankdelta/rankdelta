import { createFileRoute, redirect } from '@tanstack/react-router';
import { isUuid } from '../lib/ids';
import { VisibilityProjectShell } from '../pages/visibility/VisibilityProjectLayout';
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/visibility/$projectId')({
	beforeLoad: async ({ params }) => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });
		if (!isUuid(params.projectId)) {
			throw redirect({
				to: '/visibility',
				search: { notice: 'invalid_project' },
			});
		}
		// NOTE: do NOT redirect `/visibility/$projectId` → `/visibility/$projectId/`.
		// The router uses trailingSlash:'never', so it immediately strips the slash back off; the
		// pathname is unchanged, beforeLoad re-fires the redirect forever → "Maximum call stack" crash.
		// The `.index.tsx` route already renders the dashboard at the exact parent path via <Outlet/>.
	},
	component: VisibilityProjectShell,
});

import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { RankingsPage, type RankingsTab } from '../pages/RankingsPage';
import { getSessionSafe } from '../lib/requireAuth';

function RankingsProjectRoute() {
	const { projectId } = Route.useParams();
	const { tab } = Route.useSearch();
	const navigate = useNavigate();
	const activeTab: RankingsTab = tab ?? 'overview';

	const onTabChange = (next: RankingsTab) => {
		navigate({
			to: '/rankings/$projectId',
			params: { projectId },
			search: { tab: next },
			replace: true,
		});
	};

	return <RankingsPage projectId={projectId} activeTab={activeTab} onTabChange={onTabChange} />;
}

export const Route = createFileRoute('/rankings/$projectId')({
	validateSearch: (s: Record<string, unknown>): { tab?: RankingsTab } => ({
		tab:
			s['tab'] === 'keywords' || s['tab'] === 'opportunities' || s['tab'] === 'overview'
				? s['tab']
				: undefined,
	}),
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });
	},
	component: RankingsProjectRoute,
});

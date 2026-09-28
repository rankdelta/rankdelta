import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/layout/AppShell';
import { useProjects } from '../hooks/useProjects';
import { useActiveProject } from '../hooks/useActiveProject';
import { getSessionSafe } from '../lib/requireAuth';

function RankingsIndexPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { data: projects, isLoading } = useProjects();
	const { activeProjectId } = useActiveProject();

	useEffect(() => {
		if (isLoading) return;
		const target = activeProjectId ?? projects?.[0]?.id;
		if (target) {
			navigate({ to: '/rankings/$projectId', params: { projectId: target }, replace: true });
		}
	}, [projects, isLoading, activeProjectId, navigate]);

	if (!isLoading && (!projects || projects.length === 0)) {
		return (
			<AppShell>
				<div className="max-w-md mx-auto text-center py-32">
					<h2 className="text-2xl font-bold text-white mb-4">{t('rankings.emptyTitle')}</h2>
					<p className="text-white/50 mb-8">{t('rankings.emptyBody')}</p>
					<button
						onClick={() => navigate({ to: '/projects/new' as any })}
						className="px-6 py-3 rounded-full bg-white text-black font-semibold hover:bg-white/90 transition-all"
					>
						{t('rankings.emptyCta')}
					</button>
				</div>
			</AppShell>
		);
	}

	return (
		<AppShell>
			<div className="flex items-center justify-center py-40">
				<div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
			</div>
		</AppShell>
	);
}

export const Route = createFileRoute('/rankings/')({
	beforeLoad: async () => {
		const {
			data: { session },
		} = await getSessionSafe();
		if (!session) throw redirect({ to: '/login' as any });
	},
	component: RankingsIndexPage,
});

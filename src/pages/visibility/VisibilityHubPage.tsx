/**
 * Lists workspaces with entry into the AI visibility tracker.
 */
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../../components/layout/AppShell';
import { useProjects } from '../../hooks/useProjects';
import { motion } from 'framer-motion';
import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { VisibilityHubGettingStarted } from '../../components/visibility/VisibilityHubGettingStarted';
import { VisibilityHubResume } from '../../components/visibility/VisibilityHubResume';
import { SignalIcon, PlusIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

const hubRouteApi = getRouteApi('/visibility/');

export const VisibilityHubPage = () => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { notice } = hubRouteApi.useSearch();
	const { data: projects, isLoading } = useProjects();
	const supabaseOk = isSupabaseConfigured();
	const firstProjectId = projects?.[0]?.id;
	const hasWorkspaces = !!projects && projects.length > 0;

	return (
		<AppShell>
			{!supabaseOk && (
				<div
					className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"
					role="alert"
				>
					{t('visibility.hubConfigMissing')}
				</div>
			)}
			{notice && (
				<div
					className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
					role="status"
				>
					<p className="text-sm text-amber-300">
						{notice === 'invalid_project'
							? t('visibility.hubNoticeInvalidProject')
							: t('visibility.hubNoticeProjectNotFound')}
					</p>
					<button
						type="button"
						className="text-sm font-semibold text-amber-400 hover:text-amber-200 transition-colors shrink-0"
						onClick={() =>
							void navigate({
								to: '/visibility',
								search: { notice: undefined },
								replace: true,
							})
						}
					>
						{t('visibility.hubNoticeDismiss')}
					</button>
				</div>
			)}

			<div className="mb-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
				<div>
					<p className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('visibility.aiVisibilityEyebrow')}</p>
					<h1 className="text-3xl font-bold text-white mt-1.5">{t('visibility.hubTitle')}</h1>
					<p className="text-white/50 mt-2 max-w-2xl">{t('visibility.hubSubtitle')}</p>
					<p className="text-sm text-violet-300 mt-3 max-w-2xl font-medium">{t('visibility.hubEcomTagline')}</p>
				</div>
				{supabaseOk && hasWorkspaces && (
					<button
						className="shrink-0 px-5 py-2.5 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 transition-all"
						onClick={() => navigate({ to: '/projects/new' as any })}
					>
						{t('visibility.hubAddStore')}
					</button>
				)}
			</div>

			{supabaseOk && !isLoading && projects && projects.length > 0 && (
				<VisibilityHubResume projects={projects} />
			)}

			{supabaseOk && !isLoading && (
				<VisibilityHubGettingStarted firstProjectId={firstProjectId} hasStores={hasWorkspaces} />
			)}

			{isLoading ? (
				<div className="flex items-center justify-center py-20">
					<div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
				</div>
			) : projects && projects.length > 0 ? (
				<div className="grid sm:grid-cols-2 gap-5">
					{projects.map((p, i) => (
						<motion.div
							key={p.id}
							initial={{ opacity: 0, y: 12 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: i * 0.05 }}
						>
							<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:border-violet-500/30 hover:bg-white/[0.04] transition-all cursor-pointer">
								<button
									type="button"
									className="w-full text-left p-6"
									onClick={() =>
										navigate({ to: `/visibility/${p.id}/` } as Parameters<typeof navigate>[0])
									}
								>
									<h2 className="text-lg font-semibold text-white">{p.name}</h2>
									{p.website_url && (
										<p className="text-sm text-white/40 mt-1 truncate">{p.website_url}</p>
									)}
									<div className="flex flex-wrap gap-2 mt-4">
										<span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/20 font-medium">
											{(p.language || p.primary_language || 'en').toUpperCase()}
										</span>
										<span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.06] text-white/50 font-medium">
											{p.market || 'IT'}
										</span>
									</div>
									<p className="inline-flex items-center gap-1 text-xs font-medium text-violet-400 mt-4">
						{t('visibility.hubOpenStore')}
						<ChevronRightIcon className="w-3.5 h-3.5" strokeWidth={2} />
					</p>
								</button>
							</div>
						</motion.div>
					))}
				</div>
			) : (
				<div className="flex flex-col items-center justify-center py-24 text-center">
					<div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-5">
						<SignalIcon className="w-7 h-7 text-violet-400" strokeWidth={1.6} />
					</div>
					<h2 className="text-2xl font-bold text-white">{t('visibility.noWorkspaces')}</h2>
					<p className="text-white/40 mt-2 mb-8 max-w-sm">
						{t('visibility.noWorkspacesHint')} {t('visibility.noWorkspacesSteps')}
					</p>
					<button
						className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-black font-semibold hover:bg-white/90 transition-all"
						onClick={() => navigate({ to: '/projects/new' as any })}
					>
						<PlusIcon className="w-4 h-4" strokeWidth={2} />
						{t('visibility.createWorkspace')}
					</button>
				</div>
			)}

			{hasWorkspaces && (
				<div className="mt-10">
					<button
						className="px-5 py-2.5 rounded-full border border-white/20 text-white/70 hover:text-white text-sm font-medium transition-colors"
						onClick={() => navigate({ to: '/projects/new' as any })}
					>
						{t('visibility.newStore')}
					</button>
				</div>
			)}
		</AppShell>
	);
};

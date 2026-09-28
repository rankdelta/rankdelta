import { useEffect, useMemo } from 'react';
import { Link, Outlet, useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { AppShell } from '../../components/layout/AppShell';
import { useProject } from '../../hooks/useProjects';
import { useActiveProject } from '../../hooks/useActiveProject';
import { setLastVisibilityStoreId } from '../../lib/lastVisibilityStore';
import { ChevronLeftIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';

type FlatNavTab = {
	to:
		| '/visibility/$projectId'
		| '/visibility/$projectId/queries'
		| '/visibility/$projectId/competitors'
		| '/visibility/$projectId/citations';
	href: string;
	labelKey: string;
	exact?: boolean;
};

const FLAT_TABS: Array<Omit<FlatNavTab, 'href'>> = [
	{ to: '/visibility/$projectId', labelKey: 'visibility.navOverview', exact: true },
	{ to: '/visibility/$projectId/queries', labelKey: 'visibility.navPrompts' },
	{ to: '/visibility/$projectId/competitors', labelKey: 'visibility.navCompetitors' },
	{ to: '/visibility/$projectId/citations', labelKey: 'visibility.navSources' },
];

export function VisibilityProjectShell() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { projectId } = useParams({ strict: false }) as { projectId: string };
	const { data: project, isLoading, isError } = useProject(projectId);
	const { setActive } = useActiveProject();
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	const accessDenied = !isLoading && (isError || !project);

	useEffect(() => {
		if (!projectId || isLoading) return;
		if (isError || !project) {
			void navigate({
				to: '/visibility',
				search: { notice: 'project_not_found' },
				replace: true,
			});
		}
	}, [projectId, isLoading, isError, project, navigate]);

	useEffect(() => {
		if (projectId && project) {
			setLastVisibilityStoreId(projectId);
			setActive(projectId);
		}
	}, [projectId, project, setActive]);

	const flatTabs: FlatNavTab[] = FLAT_TABS.map((tab) => ({
		...tab,
		href:
			tab.to === '/visibility/$projectId'
				? `/visibility/${projectId}`
				: `/visibility/${projectId}${tab.to.replace('/visibility/$projectId', '')}`,
	}));

	const tabActive = (href: string, exact?: boolean) => {
		if (exact) {
			return pathname === href || pathname === `${href}/`;
		}
		return pathname === href || pathname.startsWith(`${href}/`);
	};

	const autoscanPill = useMemo(() => {
		if (!project) return null;
		if (project.visibility_schedule_enabled) {
			const cadence = project.refresh_cadence || 'weekly';
			const cadenceLabel =
				cadence === 'daily'
					? t('visibility.refreshCadenceDaily')
					: cadence === 'every_3_days'
						? t('visibility.refreshCadenceEvery3Days')
						: t('visibility.refreshCadenceWeekly');
			return { label: t('visibility.shellAutoscanOn', { cadence: cadenceLabel }), tone: 'on' as const };
		}
		return { label: t('visibility.shellAutoscanOff'), tone: 'off' as const };
	}, [project, t]);

	const spendPill = useMemo(() => {
		if (!project) return null;
		const spent = project.api_spend_cents_period ?? 0;
		const cap = project.monthly_api_spend_cap_cents;
		if (cap == null || cap <= 0) {
			return { label: t('visibility.shellSpendNoCap'), tone: 'neutral' as const };
		}
		const spentEur = (spent / 100).toFixed(0);
		const capEur = (cap / 100).toFixed(0);
		const nearCap = spent >= cap * 0.85;
		return {
			label: t('visibility.shellSpendPill', { spent: spentEur, cap: capEur }),
			tone: nearCap ? ('warn' as const) : ('neutral' as const),
		};
	}, [project, t]);

	if (isLoading) {
		return (
			<AppShell>
				<div className="flex items-center justify-center py-40">
					<div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
				</div>
			</AppShell>
		);
	}

	if (accessDenied) {
		return (
			<AppShell>
				<div className="flex flex-col items-center justify-center gap-4 py-32 text-center px-6">
					<div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
					<p className="text-sm text-white/50 max-w-sm">{t('visibility.projectAccessRedirect')}</p>
					<Link
						to="/visibility"
						search={{ notice: undefined }}
						className="text-sm font-semibold text-violet-400 hover:text-violet-300 transition-colors inline-flex items-center gap-1"
					>
						<ChevronLeftIcon className="w-3.5 h-3.5" strokeWidth={2} />
						{t('visibility.backToHub')}
					</Link>
				</div>
			</AppShell>
		);
	}

	return (
		<AppShell maxWidth="full">
			<div className="flex flex-col min-h-0">
				<header className="sticky top-0 z-30 bg-[#080808]/90 backdrop-blur border-b border-white/[0.06] -mx-6 sm:-mx-10 -mt-10 mb-6">
					<div className="max-w-6xl mx-auto px-6 sm:px-10 py-3.5">
						<div className="flex items-center gap-2 min-w-0 text-sm">
							<Link
								to="/visibility"
								search={{ notice: undefined }}
								className="text-violet-400 hover:text-violet-300 font-medium inline-flex items-center gap-1 transition-colors shrink-0"
							>
								<ChevronLeftIcon className="w-3.5 h-3.5" strokeWidth={2} />
								{t('visibility.backToHub')}
							</Link>
							<span className="text-white/20" aria-hidden>
								·
							</span>
							<span className="font-semibold text-white/90 truncate">{project?.name || '…'}</span>
							<div className="hidden sm:flex items-center gap-2 ml-auto shrink-0">
								{autoscanPill ? (
									<span
										className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium border ${
											autoscanPill.tone === 'on'
												? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
												: 'bg-white/[0.03] text-white/45 border-white/[0.08]'
										}`}
									>
										{autoscanPill.label}
									</span>
								) : null}
								{spendPill ? (
									<span
										className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium border tabular-nums ${
											spendPill.tone === 'warn'
												? 'bg-amber-500/10 text-amber-300 border-amber-500/25'
												: 'bg-white/[0.03] text-white/45 border-white/[0.08]'
										}`}
									>
										{spendPill.label}
									</span>
								) : null}
							</div>
						</div>

						<div className="flex items-center gap-2 mt-3">
							<nav
								className="flex flex-wrap gap-2 flex-1 min-w-0"
								aria-label={t('visibility.storeNavPrimary')}
							>
								{flatTabs.map((tab) => {
									const active = tabActive(tab.href, tab.exact);
									return (
										<Link
											key={tab.href}
											to={tab.to}
											params={{ projectId }}
											className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors min-h-10 inline-flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 ${
												active
													? 'bg-violet-500/15 text-violet-300 border border-violet-500/30'
													: 'text-white/60 hover:text-white hover:bg-white/[0.06]'
											}`}
										>
											{t(tab.labelKey as never)}
										</Link>
									);
								})}
							</nav>
							<Link
								to="/visibility/$projectId/settings"
								params={{ projectId }}
								className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-lg text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
								aria-label={t('visibility.navSettings')}
							>
								<Cog6ToothIcon className="w-5 h-5" strokeWidth={1.8} />
							</Link>
						</div>
					</div>
				</header>

				<main className="max-w-6xl w-full mx-auto">
					<ErrorBoundary>
						<Outlet />
					</ErrorBoundary>
				</main>
			</div>
		</AppShell>
	);
}

/**
 * RankingsPage — unified Posizionamento hub (Fable IA STEP 3).
 *
 * Three tabs: Overview (GSC + rank summary + AI correlation), Keywords (unified rank tracker),
 * Opportunities (strike distance + cannibalization with actions).
 */

import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import type { ComponentType, SVGProps } from 'react';
import {
	Squares2X2Icon,
	KeyIcon,
	LightBulbIcon,
	ArrowTrendingUpIcon,
} from '@heroicons/react/24/outline';
import { AppShell } from '../components/layout/AppShell';
import { useProjects } from '../hooks/useProjects';
import { useActiveProject } from '../hooks/useActiveProject';
import { RankingsOverviewTab } from '../components/rankings/RankingsOverviewTab';
import { RankingsKeywordsTab } from '../components/rankings/RankingsKeywordsTab';
import { RankingsOpportunitiesTab } from '../components/rankings/RankingsOpportunitiesTab';

export type RankingsTab = 'overview' | 'keywords' | 'opportunities';
type TabIcon = ComponentType<SVGProps<SVGSVGElement>>;

interface RankingsPageProps {
	projectId: string;
	activeTab: RankingsTab;
	onTabChange: (tab: RankingsTab) => void;
}

export function RankingsPage({ projectId, activeTab, onTabChange }: RankingsPageProps) {
	const { t } = useTranslation();
	const { data: projects, isLoading } = useProjects();
	const { setActive } = useActiveProject();
	const navigate = useNavigate();

	const project = projects?.find((p) => p.id === projectId);

	useEffect(() => {
		if (projectId) setActive(projectId);
	}, [projectId, setActive]);

	const tabs: Array<{ id: RankingsTab; label: string; icon: TabIcon; description: string }> = [
		{ id: 'overview', label: t('rankings.tabOverview'), icon: Squares2X2Icon, description: t('rankings.tabOverviewDesc') },
		{ id: 'keywords', label: t('rankings.tabKeywords'), icon: KeyIcon, description: t('rankings.tabKeywordsDesc') },
		{ id: 'opportunities', label: t('rankings.tabOpportunities'), icon: LightBulbIcon, description: t('rankings.tabOpportunitiesDesc') },
	];

	if (isLoading) {
		return (
			<AppShell>
				<div className="flex items-center justify-center py-40">
					<div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
				</div>
			</AppShell>
		);
	}

	if (!projects || projects.length === 0) {
		return (
			<AppShell>
				<div className="max-w-md mx-auto text-center py-32">
					<ArrowTrendingUpIcon className="w-12 h-12 text-violet-400/70 mx-auto mb-4" strokeWidth={1.4} />
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

	if (!project) {
		return (
			<AppShell>
				<div className="max-w-md mx-auto text-center py-32">
					<p className="text-white/50 mb-4">{t('rankings.projectNotFound')}</p>
					<button
						onClick={() => navigate({ to: '/rankings/' as any })}
						className="px-6 py-3 rounded-full bg-white text-black font-semibold"
					>
						{t('rankings.pickProject')}
					</button>
				</div>
			</AppShell>
		);
	}

	return (
		<AppShell maxWidth="7xl">
			<div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
				<div>
					<p className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('rankings.eyebrow')}</p>
					<h1 className="text-3xl font-bold text-white mt-1.5">{project.name}</h1>
					{project.primary_keyword && (
						<p className="text-white/40 mt-1">
							{t('rankings.keyword')}: <span className="text-violet-300 font-medium">{project.primary_keyword}</span>
						</p>
					)}
				</div>
				{projects.length > 1 && (
					<select
						value={projectId}
						onChange={(e) =>
							navigate({
								to: '/rankings/$projectId',
								params: { projectId: e.target.value },
								search: { tab: activeTab },
							})
						}
						className="px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.1] text-white/70 focus:outline-none focus:border-violet-500/50 text-sm"
					>
						{projects.map((p) => (
							<option key={p.id} value={p.id} className="bg-[#111] text-white">
								{p.name}
							</option>
						))}
					</select>
				)}
			</div>

			<div className="border-b border-white/[0.06] mb-8">
				<div className="flex space-x-1 overflow-x-auto scrollbar-hide">
					{tabs.map((tab) => (
						<button
							key={tab.id}
							onClick={() => onTabChange(tab.id)}
							className={`relative px-4 md:px-5 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
								activeTab === tab.id
									? 'border-violet-500 text-white'
									: 'border-transparent text-white/40 hover:text-white/70'
							}`}
						>
							<tab.icon className="w-4 h-4 inline-block mr-1.5 -mt-0.5" strokeWidth={1.8} />
							<span className="hidden sm:inline">{tab.label}</span>
							{activeTab === tab.id && (
								<motion.div layoutId="rankingsActiveTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-500" />
							)}
						</button>
					))}
				</div>
			</div>

			<div>
				{activeTab === 'overview' && <RankingsOverviewTab project={project} />}
				{activeTab === 'keywords' && <RankingsKeywordsTab project={project} />}
				{activeTab === 'opportunities' && <RankingsOpportunitiesTab project={project} />}
			</div>
		</AppShell>
	);
}

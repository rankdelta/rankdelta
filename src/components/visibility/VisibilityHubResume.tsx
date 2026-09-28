import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { Project } from '../../types/database';
import { getLastVisibilityStoreId } from '../../lib/lastVisibilityStore';
import { useVisibilityQueries, useVisibilityQueryRuns } from '../../hooks/useVisibilityTracker';
import { ChevronRightIcon } from '@heroicons/react/24/outline';

type Props = { projects: Project[] };

export function VisibilityHubResume({ projects }: Props) {
	const { t } = useTranslation();
	const lastId = getLastVisibilityStoreId();

	const resumeProjectId = useMemo(() => {
		if (!projects.length) return undefined;
		const match = lastId ? projects.find((p) => p.id === lastId) : undefined;
		return match?.id ?? projects[0]?.id;
	}, [projects, lastId]);

	const resumeProject = useMemo(
		() => (resumeProjectId ? projects.find((p) => p.id === resumeProjectId) : undefined),
		[projects, resumeProjectId],
	);

	const { data: runs = [] } = useVisibilityQueryRuns(resumeProjectId);
	const { data: queries = [] } = useVisibilityQueries(resumeProjectId);

	if (!resumeProjectId || !resumeProject) return null;

	const noRuns = runs.length === 0;
	const noQueries = queries.length === 0;

	return (
		<div className="mb-8 rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
			<div className="px-5 py-4 border-b border-white/[0.06] bg-white/[0.02] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
				<div>
					<p className="text-xs font-semibold text-violet-300 uppercase tracking-wide">{t('visibility.hubResumeEyebrow')}</p>
					<h2 className="text-base font-semibold text-white mt-0.5">{resumeProject.name}</h2>
					{resumeProject.website_url && (
						<p className="text-sm text-white/40 truncate max-w-xl">{resumeProject.website_url}</p>
					)}
				</div>
				<Link
					to="/visibility/$projectId"
					params={{ projectId: resumeProjectId }}
					className="inline-flex shrink-0 items-center justify-center px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 focus-visible:ring-offset-2"
				>
					{t('visibility.hubResumeOpenPulse')}
				</Link>
			</div>
			<div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
				<p className="text-sm text-white/70 leading-relaxed">
					{noQueries
						? t('visibility.hubResumeNoQueries')
						: noRuns
							? t('visibility.hubResumeNoRuns')
							: t('visibility.hubResumeHasRuns')}
				</p>
				{(noQueries || noRuns) && (
					<Link
						to="/visibility/$projectId/queries"
						params={{ projectId: resumeProjectId }}
						className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-violet-400 hover:text-violet-300 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2"
					>
						{t('visibility.hubResumeRunChecks')}
						<ChevronRightIcon className="w-3.5 h-3.5" strokeWidth={2} />
					</Link>
				)}
			</div>
		</div>
	);
}

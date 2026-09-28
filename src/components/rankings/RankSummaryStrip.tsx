import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowTrendingUpIcon, ChartBarIcon, ClockIcon, TrophyIcon } from '@heroicons/react/24/outline';
import { useSerpRankLatestMap } from '../../hooks/useSerpRankTracker';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const WEEK_IN_MS = 7 * DAY_IN_MS;

export function RankSummaryStrip({ projectId }: { projectId: string }) {
	const { t } = useTranslation();
	const { keywords, latestByKeyword, historyByKeyword } = useSerpRankLatestMap(projectId);

	const stats = useMemo(() => {
		const active = keywords.filter((k) => k.is_active);
		let top10 = 0;
		let top30 = 0;
		let notRanked = 0;
		let failed = 0;
		let lastCheck: Date | null = null;

		for (const k of active) {
			// Latest snapshot of any status → "last check" time + failed count; latest COMPLETED
			// snapshot → position buckets (a failed API check is not "not ranked").
			const snap = latestByKeyword.get(k.id);
			const hist = historyByKeyword.get(k.id) ?? [];
			let completed: (typeof hist)[number] | undefined;
			for (let i = hist.length - 1; i >= 0; i--) {
				if (hist[i]!.status === 'completed') {
					completed = hist[i];
					break;
				}
			}
			const pos = completed?.rank_absolute ?? null;
			if (pos != null && pos <= 10) top10++;
			if (pos != null && pos <= 30) top30++;
			if (pos == null && completed) notRanked++;
			if (snap && snap.status !== 'completed') failed++;
			if (snap?.checked_at) {
				const d = new Date(snap.checked_at);
				if (!lastCheck || d > lastCheck) lastCheck = d;
			}
		}

		const daysOld = lastCheck
			? Math.floor((Date.now() - lastCheck.getTime()) / DAY_IN_MS)
			: null;
		const needsRefresh = lastCheck ? Date.now() - lastCheck.getTime() > WEEK_IN_MS : false;

		return {
			total: active.length,
			top10,
			top30: top30 - top10,
			notRanked,
			failed,
			lastCheck,
			daysOld,
			needsRefresh,
		};
	}, [keywords, latestByKeyword, historyByKeyword]);

	if (stats.total === 0) {
		return (
			<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-center">
				<ChartBarIcon className="w-8 h-8 text-violet-400/60 mx-auto mb-2" strokeWidth={1.5} />
				<p className="text-sm text-white/50">{t('rankings.summaryEmpty')}</p>
			</div>
		);
	}

	const items = [
		{ label: t('rankings.summaryTotal'), value: String(stats.total), accent: 'text-white', Icon: ChartBarIcon },
		{ label: t('rankings.summaryTop10'), value: String(stats.top10), accent: 'text-emerald-300', Icon: TrophyIcon },
		{ label: t('rankings.summaryTop11to30'), value: String(stats.top30), accent: 'text-amber-300', Icon: ArrowTrendingUpIcon },
		{
			label: t('rankings.summaryLastCheck'),
			value: stats.lastCheck
				? stats.daysOld === 0
					? t('rankings.summaryToday')
					: t('rankings.summaryDaysAgo', { count: stats.daysOld ?? 0 })
				: '—',
			accent: stats.needsRefresh ? 'text-amber-300' : 'text-white/70',
			Icon: ClockIcon,
		},
	];

	return (
		<div className="space-y-2">
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
				{items.map(({ label, value, accent, Icon }) => (
					<div key={label} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
						<div className="flex items-center justify-between mb-1.5">
							<span className="text-xs text-white/40">{label}</span>
							<Icon className={`w-4 h-4 ${accent}`} strokeWidth={1.8} />
						</div>
						<div className={`text-xl font-bold tabular-nums ${accent}`}>{value}</div>
					</div>
				))}
			</div>
			{stats.failed > 0 && (
				<p className="text-xs text-amber-300/90">
					{t('rankings.summaryFailedChecks', {
						count: stats.failed,
						defaultValue: '{{count}} keyword checks failed on the last run — not counted as "not ranked".',
					})}
				</p>
			)}
		</div>
	);
}

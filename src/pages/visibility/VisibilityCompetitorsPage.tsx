import { useMemo } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
	useCompetitorBrands,
	useCompetitorHeadToHead,
	useTargetCompetitorPromptGaps,
	useVisibilityCitations,
	useLinkIntersect,
	useContentGap,
} from '../../hooks/useVisibilityTracker';
import { useProject } from '../../hooks/useProjects';
import { patchProjectMetadata, readTargetCompetitorId } from '../../lib/projectMetadata';
import { providerLabel } from '../../components/visibility/insightBlocks';
import { SovTrendChart } from '../../components/visibility/insightBlocks';
import { normalizeDomain, isSameOrSubdomain } from '../../lib/domains';
import { SparklesIcon, TrophyIcon, LinkIcon, DocumentMagnifyingGlassIcon } from '@heroicons/react/24/outline';

function gapItemLabel(item: unknown): string {
	if (!item || typeof item !== 'object') return String(item ?? '');
	const o = item as Record<string, unknown>;
	return String(o['url'] ?? o['keyword'] ?? o['domain'] ?? o['title'] ?? JSON.stringify(item));
}

export const VisibilityCompetitorsPage = () => {
	const { t } = useTranslation();
	const qc = useQueryClient();
	const { projectId } = useParams({ strict: false }) as { projectId: string };
	const { data: project } = useProject(projectId);
	const { data: competitors = [] } = useCompetitorBrands(projectId);
	const { data: citations = [] } = useVisibilityCitations(projectId);

	const targetId = readTargetCompetitorId(project) ?? competitors[0]?.id;
	const target = competitors.find((c) => c.id === targetId) ?? competitors[0];
	const targetDomain = target?.domain?.trim() || '';

	const { data: headToHead, isLoading: h2hLoading } = useCompetitorHeadToHead(projectId, target?.id, 30);
	const { data: promptGaps = [] } = useTargetCompetitorPromptGaps(projectId, target?.id);
	const { data: linkIntersect, isLoading: linkLoading } = useLinkIntersect(projectId, targetDomain, !!targetDomain);
	const { data: contentGap, isLoading: gapLoading } = useContentGap(projectId, targetDomain, !!targetDomain);

	const pinTarget = async (competitorId: string) => {
		await patchProjectMetadata(projectId, { target_competitor_id: competitorId });
		void qc.invalidateQueries({ queryKey: ['projects', projectId] });
	};

	const sourceGaps = useMemo(() => {
		if (!target?.domain) return [];
		const targetNorm = normalizeDomain(target.domain);
		const compDomains = competitors
			.filter((c) => c.id !== target.id && c.domain)
			.map((c) => normalizeDomain(c.domain!))
			.filter(Boolean);
		const byDomain = new Map<string, number>();
		for (const c of citations) {
			const d = normalizeDomain(c.source_domain || c.source_url || '');
			if (!d) continue;
			byDomain.set(d, (byDomain.get(d) || 0) + 1);
		}
		return [...byDomain.entries()]
			.filter(([d, count]) => {
				if (isSameOrSubdomain(d, targetNorm)) return false;
				if (compDomains.some((cd) => isSameOrSubdomain(d, cd))) return true;
				return count >= 2;
			})
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8);
	}, [citations, competitors, target]);

	const providerRows = useMemo(() => {
		if (!headToHead) return [];
		return Object.entries(headToHead.byProvider).sort((a, b) => {
			const ta = (a[1]?.yours ?? 0) + (a[1]?.theirs ?? 0);
			const tb = (b[1]?.yours ?? 0) + (b[1]?.theirs ?? 0);
			return tb - ta;
		});
	}, [headToHead]);

	const trendForChart = useMemo(
		() =>
			(headToHead?.trend ?? []).map((d) => ({
				date: d.date,
				yours: d.yours,
				competitors: d.theirs,
				sovPercent: d.yourSovPercent,
			})),
		[headToHead],
	);

	const linkItems = Array.isArray(linkIntersect?.items) ? linkIntersect.items : [];
	const gapItems = Array.isArray(contentGap?.items) ? contentGap.items : [];

	return (
		<div className="space-y-8">
			<header className="space-y-1">
				<p className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('visibility.beatCompetitorEyebrow')}</p>
				<h2 className="text-2xl font-bold text-white">{t('visibility.beatCompetitorTitle')}</h2>
				<p className="text-white/50 text-sm max-w-2xl leading-relaxed">{t('visibility.beatCompetitorSubtitle')}</p>
			</header>

			{competitors.length === 0 ? (
				<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 text-center space-y-3">
					<p className="text-sm text-white/60">{t('visibility.beatCompetitorNoComps')}</p>
					<Link
						to="/visibility/$projectId/settings"
						params={{ projectId }}
						className="inline-flex items-center justify-center px-4 py-2.5 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90"
					>
						{t('visibility.beatCompetitorAddInSettings')}
					</Link>
				</div>
			) : (
				<>
					<div className="flex flex-wrap gap-2">
						{competitors.map((c) => {
							const pinned = c.id === target?.id;
							return (
								<button
									key={c.id}
									type="button"
									onClick={() => void pinTarget(c.id)}
									className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
										pinned
											? 'bg-amber-500/15 text-amber-200 border-amber-500/30'
											: 'text-white/60 border-white/[0.08] hover:text-white hover:bg-white/[0.04]'
									}`}
								>
									{pinned ? <TrophyIcon className="w-4 h-4" strokeWidth={1.8} /> : null}
									{c.name}
								</button>
							);
						})}
					</div>

					{target && (
						<div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.08] to-transparent p-6">
							<p className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('visibility.targetCompetitorLabel')}</p>
							<h3 className="text-xl font-bold text-white mt-2">{target.name}</h3>
							{target.domain ? <p className="text-sm text-white/40 mt-0.5">{target.domain}</p> : null}
							<div className="mt-6 flex flex-col sm:flex-row sm:items-end gap-6">
								<div>
									<p className="text-xs text-white/40 uppercase tracking-wide">{t('visibility.youLabel')}</p>
									<p className="text-4xl font-bold text-white tabular-nums">
										{h2hLoading ? '—' : headToHead?.yourSovPercent != null ? `${headToHead.yourSovPercent.toFixed(1)}%` : '0%'}
									</p>
								</div>
								<p className="text-white/30 text-2xl font-light hidden sm:block">vs</p>
								<div>
									<p className="text-xs text-white/40 uppercase tracking-wide">{target.name}</p>
									<p className="text-4xl font-bold text-amber-200 tabular-nums">
										{h2hLoading ? '—' : headToHead?.competitorSovPercent != null ? `${headToHead.competitorSovPercent.toFixed(1)}%` : '0%'}
									</p>
								</div>
							</div>
							<p className="text-xs text-white/40 mt-3">{t('visibility.headToHeadHint')}</p>
						</div>
					)}

					{providerRows.length > 0 && (
						<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
							<h3 className="text-sm font-semibold text-white mb-3">{t('visibility.beatCompetitorByEngine')}</h3>
							<div className="flex flex-wrap gap-2">
								{providerRows.map(([prov, v]) => {
									const yours = v?.yours ?? 0;
									const theirs = v?.theirs ?? 0;
									const total = yours + theirs;
									const sovPct = total > 0 ? (100 * yours) / total : null;
									return (
										<div
											key={prov}
											className="inline-flex flex-col items-start gap-0.5 rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-2.5"
										>
											<span className="text-xs font-medium text-white/70">{providerLabel(t, prov)}</span>
											<span className="text-lg font-bold text-white tabular-nums">
												{sovPct != null ? `${sovPct.toFixed(0)}%` : '—'}
											</span>
											<span className="text-[10px] text-white/40 tabular-nums">
												{yours} / {total} {t('visibility.engineChipMentions')}
											</span>
										</div>
									);
								})}
							</div>
						</div>
					)}

					{trendForChart.length >= 2 && (
						<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
							<h3 className="text-sm font-semibold text-white mb-1">{t('visibility.beatCompetitorTrend')}</h3>
							<p className="text-xs text-white/40 mb-4">{t('visibility.beatCompetitorTrendHint')}</p>
							<SovTrendChart trend={trendForChart} t={t} />
						</div>
					)}

					{promptGaps.length > 0 && (
						<div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.05] p-6">
							<div className="flex items-center gap-2">
								<SparklesIcon className="w-5 h-5 text-rose-300" strokeWidth={1.8} />
								<p className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('visibility.beatCompetitorPromptGaps')}</p>
							</div>
							<p className="text-sm text-white/55 mt-2">{t('visibility.beatCompetitorPromptGapsBody')}</p>
							<div className="mt-4 space-y-2">
								{promptGaps.slice(0, 8).map((g) => (
									<div key={g.queryId} className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
										<div className="flex-1 min-w-0">
											<p className="text-sm text-white/85 truncate">{g.text}</p>
											<p className="text-xs text-white/40">
												{t('visibility.competitorsCitedYouZero', { count: g.competitorMentions })}
											</p>
										</div>
										<Link
											to="/content/generate"
											search={{ topic: g.text } as Record<string, string>}
											className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white text-black px-3.5 py-1.5 text-xs font-semibold hover:bg-white/90"
										>
											<SparklesIcon className="w-3.5 h-3.5" strokeWidth={2} /> {t('visibility.generateArticle')}
										</Link>
									</div>
								))}
							</div>
						</div>
					)}

					{sourceGaps.length > 0 && (
						<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
							<h3 className="text-sm font-semibold text-white mb-1">{t('visibility.beatCompetitorSourceGaps')}</h3>
							<p className="text-xs text-white/40 mb-4">{t('visibility.beatCompetitorSourceGapsBody')}</p>
							<ul className="space-y-2">
								{sourceGaps.map(([domain, count]) => (
									<li key={domain} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.06]">
										<span className="text-white/80 truncate">{domain}</span>
										<span className="text-white/40 tabular-nums shrink-0 ml-2">{count}×</span>
									</li>
								))}
							</ul>
						</div>
					)}

					{targetDomain && (
						<div className="grid md:grid-cols-2 gap-4">
							<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-3">
								<div className="flex items-center gap-2">
									<LinkIcon className="w-5 h-5 text-violet-300" strokeWidth={1.8} />
									<h3 className="text-sm font-semibold text-white">{t('visibility.beatCompetitorLinkIntersect')}</h3>
								</div>
								<p className="text-xs text-white/40">{t('visibility.beatCompetitorLinkIntersectBody')}</p>
								{linkLoading ? (
									<p className="text-sm text-white/40">{t('common.loading')}</p>
								) : linkItems.length === 0 ? (
									<p className="text-sm text-white/40">{t('visibility.beatCompetitorNoData')}</p>
								) : (
									<ul className="space-y-1.5 text-sm text-white/70 max-h-48 overflow-y-auto">
										{linkItems.slice(0, 10).map((item, i) => (
											<li key={i} className="truncate">{gapItemLabel(item)}</li>
										))}
									</ul>
								)}
							</div>
							<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-3">
								<div className="flex items-center gap-2">
									<DocumentMagnifyingGlassIcon className="w-5 h-5 text-emerald-300" strokeWidth={1.8} />
									<h3 className="text-sm font-semibold text-white">{t('visibility.beatCompetitorContentGap')}</h3>
								</div>
								<p className="text-xs text-white/40">{t('visibility.beatCompetitorContentGapBody')}</p>
								{gapLoading ? (
									<p className="text-sm text-white/40">{t('common.loading')}</p>
								) : gapItems.length === 0 ? (
									<p className="text-sm text-white/40">{t('visibility.beatCompetitorNoData')}</p>
								) : (
									<ul className="space-y-1.5 text-sm text-white/70 max-h-48 overflow-y-auto">
										{gapItems.slice(0, 10).map((item, i) => (
											<li key={i} className="truncate">{gapItemLabel(item)}</li>
										))}
									</ul>
								)}
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
};

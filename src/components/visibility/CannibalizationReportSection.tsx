import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { buildCannibalizationReport, type CannibalizationRow } from '../../lib/cannibalizationReport';
import { hrefOf } from '../../lib/seoUrls';
import { getMoneyPages } from '../../services/moneyPages';
import type { Project } from '../../types/database';
import type { SerpRankKeywordRow, SerpRankSnapshotRow } from '../../types/database';

function IssueBadge({ kind }: { kind: CannibalizationRow['kind'] }) {
	const { t } = useTranslation();
	const label =
		kind === 'multi_url'
			? t('visibility.cannibalizationKindMulti')
			: t('visibility.cannibalizationKindWrong');
	const cls =
		kind === 'multi_url'
			? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
			: 'bg-rose-500/15 text-rose-300 border-rose-500/30';
	return (
		<span className={`inline-flex text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${cls}`}>
			{label}
		</span>
	);
}

export function CannibalizationReportSection({
	project,
	keywords,
	latestByKeyword,
	renderActions,
}: {
	project: Project | null | undefined;
	keywords: SerpRankKeywordRow[];
	latestByKeyword: Map<string, SerpRankSnapshotRow>;
	renderActions?: (phrase: string) => ReactNode;
}) {
	const { t } = useTranslation();
	const siteUrl = project?.website_url?.trim() ?? '';

	const rows = useMemo(() => {
		if (!siteUrl) return [];
		return buildCannibalizationReport({
			siteUrl,
			keywords,
			latestByKeyword,
			moneyPages: getMoneyPages(project),
		});
	}, [siteUrl, keywords, latestByKeyword, project]);

	if (!siteUrl) return null;

	return (
		<section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6 space-y-4 shadow-none">
			<div className="space-y-1">
				<p className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('visibility.cannibalizationEyebrow')}</p>
				<h3 className="text-lg font-bold text-white">{t('visibility.cannibalizationTitle')}</h3>
				<p className="text-sm text-white/50 max-w-3xl leading-relaxed">{t('visibility.cannibalizationSubtitle')}</p>
			</div>

			{rows.length === 0 ? (
				<p className="text-sm text-white/40 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-6 text-center">
					{t('visibility.cannibalizationEmpty')}
				</p>
			) : (
				<div className="overflow-x-auto rounded-xl border border-white/[0.06]">
					<table className="w-full text-sm">
						<caption className="sr-only">{t('visibility.cannibalizationTableCaption')}</caption>
						<thead className="bg-white/[0.02] border-b border-white/[0.08] text-left text-white/60">
							<tr>
								<th className="px-4 py-3 font-semibold text-xs uppercase tracking-wide">{t('visibility.cannibalizationColQuery')}</th>
								<th className="px-4 py-3 font-semibold text-xs uppercase tracking-wide">{t('visibility.cannibalizationColRisk')}</th>
								<th className="px-4 py-3 font-semibold text-xs uppercase tracking-wide">{t('visibility.cannibalizationColRanking')}</th>
								<th className="px-4 py-3 font-semibold text-xs uppercase tracking-wide">{t('visibility.cannibalizationColSuggested')}</th>
								<th className="px-4 py-3 font-semibold text-xs uppercase tracking-wide">{t('visibility.cannibalizationColAction')}</th>
								{renderActions && (
									<th className="px-4 py-3 font-semibold text-xs uppercase tracking-wide text-right">{t('visibility.colActions')}</th>
								)}
							</tr>
						</thead>
						<tbody>
							{rows.map((row) => (
								<tr key={`${row.keywordId}-${row.kind}`} className="border-t border-white/[0.06] align-top hover:bg-white/[0.03]">
									<td className="px-4 py-3 text-white font-medium max-w-[12rem]">{row.phrase}</td>
									<td className="px-4 py-3">
										<IssueBadge kind={row.kind} />
										{row.kind === 'multi_url' && row.siteUrls.length > 1 && (
											<p className="text-xs text-white/40 mt-1.5">
												{t('visibility.cannibalizationMultiCount', { count: row.siteUrls.length })}
											</p>
										)}
									</td>
									<td className="px-4 py-3 text-white/70 max-w-xs">
										{row.primaryUrl ? (
											<a href={hrefOf(row.primaryUrl) ?? undefined} target="_blank" rel="noopener noreferrer" className="text-violet-300 hover:text-violet-200 break-all text-xs">
												{row.primaryUrl}
											</a>
										) : (
											'—'
										)}
										{row.kind === 'multi_url' && row.siteUrls.length > 1 && (
											<ul className="mt-2 space-y-1 text-xs text-white/40">
												{row.siteUrls.slice(1, 4).map((u) => (
													<li key={u.url} className="break-all">
														#{u.position}{' '}
														<a href={hrefOf(u.url) ?? undefined} target="_blank" rel="noopener noreferrer" className="hover:text-white/60">
															{u.url}
														</a>
													</li>
												))}
											</ul>
										)}
									</td>
									<td className="px-4 py-3 text-white/70 max-w-xs">
										{row.suggestedUrl ? (
											<a href={hrefOf(row.suggestedUrl) ?? undefined} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:text-emerald-200 break-all text-xs">
												{row.suggestedUrl}
											</a>
										) : (
											'—'
										)}
									</td>
									<td className="px-4 py-3 text-white/60 text-xs max-w-[14rem] leading-relaxed">
										{row.suggestedAnchor ? (
											<p>
												{t('visibility.cannibalizationAnchorHint', { anchor: row.suggestedAnchor })}
											</p>
										) : (
											<p>{t('visibility.cannibalizationRetargetHint')}</p>
										)}
									</td>
									{renderActions && (
										<td className="px-4 py-3 text-right">{renderActions(row.phrase)}</td>
									)}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{getMoneyPages(project).length === 0 && (
				<p className="text-xs text-amber-400/90 inline-flex items-start gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 max-w-3xl">
					<ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.8} />
					<span>
						{t('visibility.cannibalizationMoneyPagesHint')}{' '}
						<Link to="/settings" className="underline hover:text-amber-300">
							{t('visibility.cannibalizationMoneyPagesCta')}
						</Link>
					</span>
				</p>
			)}
		</section>
	);
}

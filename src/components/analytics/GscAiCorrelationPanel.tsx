import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SignalIcon } from '@heroicons/react/24/outline';
import {
	correlateGscPagesWithAiCitations,
	correlateGscQueriesWithAi,
} from '../../lib/gscAiCorrelation';
import { getGscOverview, getGscQueryRows, hasValidToken } from '../../services/googleSearchConsole';
import { useVisibilityCitations } from '../../hooks/useVisibilityTracker';
import { useVisibilityQueryAiFlags } from '../../hooks/useVisibilityQueryAiFlags';

export function GscAiCorrelationPanel({
	projectId,
	property,
}: {
	projectId: string;
	property: string;
}) {
	const { t } = useTranslation();
	const { data: citations = [] } = useVisibilityCitations(projectId);
	const { data: visibilityFlags = [] } = useVisibilityQueryAiFlags(projectId);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pages, setPages] = useState<Array<{ key: string; clicks: number; impressions: number; position: number }>>([]);
	const [queries, setQueries] = useState<Array<{ key: string; clicks: number; impressions: number; position: number }>>([]);

	useEffect(() => {
		let cancelled = false;
		// Live Google read: it needs the in-memory access token, which no longer
		// follows from "connected" now that the connection is read from the server.
		// Without a token this would open a consent popup on mount — browsers block
		// popups with no user gesture, so render nothing rather than an error.
		if (!hasValidToken()) {
			setPages([]);
			setQueries([]);
			setLoading(false);
			setError(null);
			return;
		}
		setLoading(true);
		setError(null);
		Promise.all([getGscOverview(property, 28), getGscQueryRows(property, 28, 250)])
			.then(([overview, qrows]) => {
				if (cancelled) return;
				setPages(overview.topPages);
				setQueries(qrows);
			})
			.catch((e) => {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [property]);

	const pageRows = useMemo(
		() =>
			correlateGscPagesWithAiCitations(
				pages,
				citations.map((c) => c.source_url).filter((u): u is string => !!u),
			),
		[pages, citations],
	);

	const queryRows = useMemo(
		() => correlateGscQueriesWithAi(queries, visibilityFlags),
		[queries, visibilityFlags],
	);

	const citedWithTraffic = pageRows.filter((r) => r.aiCited && r.gscClicks > 0);
	const queryWins = queryRows.filter((r) => r.aiCited && r.gscClicks >= 2).slice(0, 12);

	return (
		<section className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.06] to-transparent p-5 sm:p-6 space-y-6">
			<div className="flex items-start gap-2">
				<SignalIcon className="w-5 h-5 text-violet-300 shrink-0 mt-0.5" strokeWidth={1.8} />
				<div>
					<h3 className="text-white font-semibold">{t('gsc.gscAiTitle')}</h3>
					<p className="text-white/45 text-xs mt-1 max-w-3xl leading-relaxed">{t('gsc.gscAiSubtitle')}</p>
				</div>
			</div>

			{loading && <div className="h-20 rounded-xl bg-white/[0.04] animate-pulse" />}
			{error && <p className="text-sm text-rose-300">{error}</p>}

			{!loading && queryWins.length > 0 && (
				<div className="space-y-2">
					<h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">{t('gsc.gscAiQuerySection')}</h4>
					<div className="overflow-x-auto rounded-xl border border-white/[0.06]">
						<table className="w-full text-sm">
							<caption className="sr-only">{t('gsc.gscAiQueryTableCaption')}</caption>
							<thead className="bg-white/[0.02] border-b border-white/[0.08] text-left text-white/60">
								<tr>
									<th className="px-4 py-3 text-xs uppercase font-semibold">{t('gsc.gscAiColQuery')}</th>
									<th className="px-4 py-3 text-xs uppercase font-semibold">{t('gsc.gscAiColClicks')}</th>
									<th className="px-4 py-3 text-xs uppercase font-semibold">{t('gsc.gscAiColAi')}</th>
								</tr>
							</thead>
							<tbody>
								{queryWins.map((r) => (
									<tr key={r.query} className="border-t border-white/[0.06]">
										<td className="px-4 py-3 text-white font-medium max-w-xs">{r.query}</td>
										<td className="px-4 py-3 text-emerald-300 tabular-nums">{r.gscClicks}</td>
										<td className="px-4 py-3 text-violet-300 text-xs">
											{r.aiCited ? t('gsc.gscAiCitedInAio') : r.aiMentioned ? t('gsc.gscAiMentioned') : '—'}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{!loading && pageRows.length > 0 && (
				<div className="space-y-2">
					<h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">{t('gsc.gscAiPageSection')}</h4>
					<div className="overflow-x-auto rounded-xl border border-white/[0.06]">
						<table className="w-full text-sm">
							<caption className="sr-only">{t('gsc.gscAiTableCaption')}</caption>
							<thead className="bg-white/[0.02] border-b border-white/[0.08] text-left text-white/60">
								<tr>
									<th className="px-4 py-3 text-xs uppercase font-semibold">{t('gsc.gscAiColPage')}</th>
									<th className="px-4 py-3 text-xs uppercase font-semibold">{t('gsc.gscAiColClicks')}</th>
									<th className="px-4 py-3 text-xs uppercase font-semibold">{t('gsc.gscAiColImpr')}</th>
									<th className="px-4 py-3 text-xs uppercase font-semibold">{t('gsc.gscAiColAi')}</th>
								</tr>
							</thead>
							<tbody>
								{pageRows.slice(0, 15).map((r) => (
									<tr key={r.pageUrl} className="border-t border-white/[0.06] hover:bg-white/[0.03]">
										<td className="px-4 py-3 text-white/80 text-xs max-w-xs break-all">{r.pageUrl.replace(/^https?:\/\/[^/]+/, '') || '/'}</td>
										<td className="px-4 py-3 text-emerald-300 tabular-nums">{r.gscClicks}</td>
										<td className="px-4 py-3 text-white/60 tabular-nums">{r.gscImpressions}</td>
										<td className="px-4 py-3">
											{r.aiCited ? (
												<span className="text-violet-300 font-medium">{t('gsc.gscAiCited', { count: r.aiCitationCount })}</span>
											) : (
												<span className="text-white/35">{t('gsc.gscAiNotCited')}</span>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{!loading && pageRows.length === 0 && queryWins.length === 0 && (
				<p className="text-sm text-white/40 text-center py-4">{t('gsc.gscAiEmpty')}</p>
			)}

			{citedWithTraffic.length > 0 && (
				<p className="text-xs text-emerald-300/90">{t('gsc.gscAiInsight', { count: citedWithTraffic.length })}</p>
			)}
		</section>
	);
}

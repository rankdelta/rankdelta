import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BoltIcon } from '@heroicons/react/24/outline';
import {
	buildSerpRankLookup,
	filterStrikeDistanceQueries,
	mergeStrikeDistanceWithSerpRank,
	type StrikeDistanceQuery,
} from '../../lib/strikeDistance';
import { getGscQueryRows, hasValidToken } from '../../services/googleSearchConsole';
import { useSerpRankLatestMap } from '../../hooks/useSerpRankTracker';

export function StrikeDistancePanel({
	projectId,
	property,
	days = 28,
	renderActions,
}: {
	projectId: string;
	property: string;
	days?: number;
	renderActions?: (query: string) => ReactNode;
}) {
	const { t } = useTranslation();
	const { keywords, latestByKeyword } = useSerpRankLatestMap(projectId);
	const [gscRows, setGscRows] = useState<StrikeDistanceQuery[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const serpLookup = useMemo(() => {
		const byPhrase = new Map<string, { rank_absolute: number | null; ranking_url: string | null }>();
		for (const k of keywords) {
			const snap = latestByKeyword.get(k.id);
			if (snap) {
				byPhrase.set(k.phrase.trim().toLowerCase(), {
					rank_absolute: snap.rank_absolute,
					ranking_url: snap.ranking_url,
				});
			}
		}
		return buildSerpRankLookup(keywords, byPhrase);
	}, [keywords, latestByKeyword]);

	const rows = useMemo(
		() => mergeStrikeDistanceWithSerpRank(gscRows, serpLookup),
		[gscRows, serpLookup],
	);

	useEffect(() => {
		let cancelled = false;
		// This panel needs more query rows than the server-side cache holds, so it
		// still reads Google live — which needs the in-memory access token. Since
		// the connection itself is now read from the server, "connected" no longer
		// implies a token: without one, `getGscQueryRows` would try to open a
		// Google consent popup on mount, which browsers block. Stay quiet instead.
		if (!hasValidToken()) {
			setGscRows([]);
			setLoading(false);
			setError(null);
			return;
		}
		setLoading(true);
		setError(null);
		getGscQueryRows(property, days, 500)
			.then((q) => {
				if (cancelled) return;
				setGscRows(filterStrikeDistanceQueries(q));
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
	}, [property, days]);

	return (
		<section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6 space-y-4">
			<div className="flex items-start gap-2">
				<BoltIcon className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" strokeWidth={1.8} />
				<div>
					<h3 className="text-white font-semibold">{t('gsc.strikeDistanceTitle')}</h3>
					<p className="text-white/45 text-xs mt-1 max-w-3xl leading-relaxed">{t('gsc.strikeDistanceSubtitle')}</p>
				</div>
			</div>

			{loading && <div className="h-24 rounded-xl bg-white/[0.04] animate-pulse" />}
			{error && <p className="text-sm text-rose-300">{error}</p>}
			{!loading && !error && rows.length === 0 && (
				<p className="text-sm text-white/40 text-center py-6">{t('gsc.strikeDistanceEmpty')}</p>
			)}
			{!loading && rows.length > 0 && (
				<div className="overflow-x-auto rounded-xl border border-white/[0.06]">
					<table className="w-full text-sm">
						<caption className="sr-only">{t('gsc.strikeDistanceTableCaption')}</caption>
						<thead className="bg-white/[0.02] border-b border-white/[0.08] text-left text-white/60">
							<tr>
								<th className="px-4 py-3 text-xs uppercase tracking-wide font-semibold">{t('gsc.strikeDistanceColQuery')}</th>
								<th className="px-4 py-3 text-xs uppercase tracking-wide font-semibold">{t('gsc.strikeDistanceColGscPos')}</th>
								<th className="px-4 py-3 text-xs uppercase tracking-wide font-semibold">{t('gsc.strikeDistanceColSerpRank')}</th>
								<th className="px-4 py-3 text-xs uppercase tracking-wide font-semibold">{t('gsc.strikeDistanceColImpr')}</th>
								<th className="px-4 py-3 text-xs uppercase tracking-wide font-semibold">{t('gsc.strikeDistanceColCtr')}</th>
								<th className="px-4 py-3 text-xs uppercase tracking-wide font-semibold">{t('gsc.strikeDistanceColClicks')}</th>
								{renderActions && (
									<th className="px-4 py-3 text-xs uppercase tracking-wide font-semibold text-right">{t('visibility.colActions')}</th>
								)}
							</tr>
						</thead>
						<tbody>
							{rows.slice(0, 25).map((r) => (
								<tr key={r.query} className="border-t border-white/[0.06] hover:bg-white/[0.03]">
									<td className="px-4 py-3 text-white font-medium max-w-xs">
										{r.query}
										{r.rankingUrl && (
											<p className="text-[11px] text-white/35 mt-0.5 truncate max-w-[14rem]" title={r.rankingUrl}>
												{r.rankingUrl.replace(/^https?:\/\/[^/]+/, '')}
											</p>
										)}
									</td>
									<td className="px-4 py-3 text-white/80 tabular-nums">{r.position.toFixed(1)}</td>
									<td className="px-4 py-3 text-violet-300 tabular-nums font-medium">
										{r.serpRank != null ? `#${r.serpRank}` : '—'}
									</td>
									<td className="px-4 py-3 text-white/70 tabular-nums">{r.impressions.toLocaleString()}</td>
									<td className="px-4 py-3 text-white/70 tabular-nums">{(r.ctr * 100).toFixed(1)}%</td>
									<td className="px-4 py-3 text-emerald-300 tabular-nums font-medium">{r.clicks}</td>
									{renderActions && (
										<td className="px-4 py-3 text-right">{renderActions(r.query)}</td>
									)}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}

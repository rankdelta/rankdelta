import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useRankingHistory } from '../../hooks/useRankTracking';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import type { SerpRankSnapshotRow } from '../../types/database';

interface HistoryPoint {
	checked_at: string;
	position: number | null;
}

function normalizeHistory(
	inline?: SerpRankSnapshotRow[],
	fetched?: Array<{ checked_at: string; position: number | null }>,
): HistoryPoint[] {
	if (inline?.length) {
		return inline.map((h) => ({ checked_at: h.checked_at, position: h.rank_absolute }));
	}
	return fetched ?? [];
}

interface KeywordHistoryDrawerProps {
	keywordId: string;
	phrase: string;
	history?: SerpRankSnapshotRow[];
	onClose: () => void;
}

export function KeywordHistoryDrawer({ keywordId, phrase, history: inlineHistory, onClose }: KeywordHistoryDrawerProps) {
	const { t } = useTranslation();
	const { data: fetchedHistory, isLoading } = useRankingHistory(inlineHistory ? undefined : keywordId);
	const history = normalizeHistory(inlineHistory, fetchedHistory);

	const chartData = history
		.filter((h) => h.position != null)
		.map((h) => ({ date: new Date(h.checked_at), position: h.position as number }));

	const maxPosition = Math.max(...chartData.map((d) => d.position), 10);
	const minPosition = Math.min(...chartData.map((d) => d.position), 1);
	const chartHeight = 160;
	const chartWidth = 480;
	const padding = 32;

	return (
		<>
			<button
				type="button"
				className="fixed inset-0 z-[300] bg-black/60"
				aria-label={t('rankings.historyClose')}
				onClick={onClose}
			/>
			<aside
				className="fixed right-0 top-0 bottom-0 z-[310] w-full max-w-md bg-[#111] border-l border-white/[0.08] shadow-2xl flex flex-col"
				role="dialog"
				aria-labelledby="keyword-history-title"
			>
				<div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
					<div>
						<p className="text-white/40 text-xs uppercase tracking-wide">{t('rankings.historyEyebrow')}</p>
						<h2 id="keyword-history-title" className="text-lg font-bold text-white mt-0.5 truncate max-w-[18rem]">
							{phrase}
						</h2>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.06]"
						aria-label={t('rankings.historyClose')}
					>
						<XMarkIcon className="w-5 h-5" />
					</button>
				</div>

				<div className="flex-1 overflow-y-auto p-5 space-y-6">
					{isLoading && !inlineHistory ? (
						<LoadingSpinner text={t('rankings.historyLoading')} />
					) : chartData.length === 0 ? (
						<p className="text-sm text-white/40 text-center py-10">{t('rankings.historyEmpty')}</p>
					) : (
						<>
							<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
								<svg
									className="w-full"
									viewBox={`0 0 ${chartWidth} ${chartHeight}`}
									preserveAspectRatio="xMidYMid meet"
									aria-hidden
								>
									{chartData.length > 1 && (
										<polyline
											fill="none"
											stroke="#a78bfa"
											strokeWidth="2"
											points={chartData
												.map((d, i) => {
													const x = (i / (chartData.length - 1)) * (chartWidth - padding * 2) + padding;
													const y =
														padding +
														((d.position - minPosition) / (maxPosition - minPosition || 1)) *
															(chartHeight - padding * 2);
													return `${x},${y}`;
												})
												.join(' ')}
										/>
									)}
									{chartData.map((d, i) => {
										const x =
											chartData.length === 1
												? chartWidth / 2
												: (i / (chartData.length - 1)) * (chartWidth - padding * 2) + padding;
										const y =
											padding +
											((d.position - minPosition) / (maxPosition - minPosition || 1)) *
												(chartHeight - padding * 2);
										return <circle key={i} cx={x} cy={y} r="4" fill="#a78bfa" />;
									})}
								</svg>
							</div>

							<div className="grid grid-cols-3 gap-3">
								<div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
									<p className="text-xs text-white/40">{t('rankings.historyCurrent')}</p>
									<p className="text-lg font-bold text-white tabular-nums">
										#{chartData[chartData.length - 1]?.position}
									</p>
								</div>
								<div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
									<p className="text-xs text-white/40">{t('rankings.historyBest')}</p>
									<p className="text-lg font-bold text-emerald-300 tabular-nums">
										#{Math.min(...chartData.map((d) => d.position))}
									</p>
								</div>
								<div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
									<p className="text-xs text-white/40">{t('rankings.historyChecks')}</p>
									<p className="text-lg font-bold text-white tabular-nums">{chartData.length}</p>
								</div>
							</div>

							<div className="rounded-xl border border-white/[0.08] overflow-hidden">
								<table className="w-full text-sm">
									<thead className="bg-white/[0.02] text-white/50 text-xs uppercase">
										<tr>
											<th className="px-3 py-2 text-left">{t('rankings.historyColDate')}</th>
											<th className="px-3 py-2 text-right">{t('rankings.historyColPosition')}</th>
										</tr>
									</thead>
									<tbody>
										{[...history].reverse().map((row, i) => (
											<tr key={i} className="border-t border-white/[0.06]">
												<td className="px-3 py-2 text-white/70">
													{new Date(row.checked_at).toLocaleString(undefined, {
														dateStyle: 'short',
														timeStyle: 'short',
													})}
												</td>
												<td className="px-3 py-2 text-right text-white tabular-nums font-medium">
													{row.position != null ? `#${row.position}` : '—'}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</>
					)}
				</div>

				<div className="p-4 border-t border-white/[0.08]">
					<Button variant="secondary" fullWidth onClick={onClose}>
						{t('common.close')}
					</Button>
				</div>
			</aside>
		</>
	);
}

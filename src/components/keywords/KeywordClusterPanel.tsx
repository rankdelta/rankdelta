import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { toCsv, downloadText, slug } from '../../lib/csv';
import { clusterIdeasBySerp } from '../../services/serpClustering';
import { AccountBudgetError } from '../../services/edgeProxy';
import type { ClusterMethod, SerpCluster } from '../../lib/serpClusters';
import type { KeywordIdea } from '../../services/siteExplorer';

const MAX_KEYWORDS = 200;

interface Props {
	ideas: KeywordIdea[];
	loc: { locationCode: number; languageCode: string };
	marketName: string;
	onClose: () => void;
}

/**
 * "Cluster by SERP" — groups the current keyword ideas by shared top-10 ranking URLs (one SERP
 * lookup per keyword, via the gated seo-proxy). Isolated modal so it never disturbs the table.
 */
export function KeywordClusterPanel({ ideas, loc, marketName, onClose }: Props) {
	const { t } = useTranslation();
	const [minShared, setMinShared] = useState(3);
	const [method, setMethod] = useState<ClusterMethod>('centroid');
	const [running, setRunning] = useState(false);
	const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
	const [clusters, setClusters] = useState<SerpCluster[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	const count = useMemo(() => Math.min(ideas.length, MAX_KEYWORDS), [ideas.length]);

	async function run() {
		setRunning(true);
		setError(null);
		setClusters(null);
		setProgress({ done: 0, total: count });
		try {
			const result = await clusterIdeasBySerp(
				ideas.map((k) => ({ keyword: k.keyword, volume: k.volume, difficulty: k.difficulty })),
				{
					locationCode: loc.locationCode,
					languageCode: loc.languageCode,
					minShared,
					method,
					maxKeywords: MAX_KEYWORDS,
					onProgress: (done, total) => setProgress({ done, total }),
				},
			);
			setClusters(result);
		} catch (e) {
			setError(e instanceof AccountBudgetError ? t('seoTools.clusterBudgetError') : t('seoTools.clusterError'));
		} finally {
			setRunning(false);
		}
	}

	function exportCsv() {
		if (!clusters) return;
		const rows = clusters.flatMap((c, i) =>
			c.keywords.map((k) => ({
				cluster: i + 1,
				pivot: c.pivot,
				keyword: k.keyword,
				isPivot: k.keyword === c.pivot ? 'yes' : '',
				volume: k.volume ?? '',
				difficulty: k.difficulty ?? '',
			})),
		);
		const csv = toCsv(rows, [
			{ header: 'Cluster', value: (r) => r.cluster },
			{ header: 'Pivot keyword', value: (r) => r.pivot },
			{ header: 'Keyword', value: (r) => r.keyword },
			{ header: 'Is pivot', value: (r) => r.isPivot },
			{ header: 'Volume', value: (r) => r.volume },
			{ header: 'Difficulty', value: (r) => r.difficulty },
		]);
		downloadText(`clusters-${slug(marketName)}.csv`, csv);
	}

	const pct = progress && progress.total > 0 ? Math.round((100 * progress.done) / progress.total) : 0;

	return (
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
			role="dialog"
			aria-modal="true"
			onClick={() => { if (!running) onClose(); }}
		>
			<div
				className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#161320] p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-start justify-between gap-4">
					<div>
						<h2 className="text-lg font-semibold text-white">{t('seoTools.clusterModalTitle')}</h2>
						<p className="mt-1 text-sm text-white/60">{t('seoTools.clusterModalSubtitle')}</p>
					</div>
					<button onClick={onClose} disabled={running} className="text-white/40 hover:text-white text-xl leading-none disabled:opacity-40">×</button>
				</div>

				{/* Options + run (hidden once we have results) */}
				{!clusters && (
					<div className="mt-5 space-y-4">
						<div className="flex flex-wrap gap-4">
							<label className="flex flex-col gap-1 text-xs text-white/50">
								{t('seoTools.clusterThreshold')}
								<select
									value={minShared}
									onChange={(e) => setMinShared(Number(e.target.value))}
									disabled={running}
									className="bg-white/[0.04] border border-white/[0.1] rounded-md px-2 py-1.5 text-white/80 outline-none"
								>
									{[2, 3, 4, 5].map((n) => <option key={n} value={n}>{t('seoTools.clusterThresholdN', { n })}</option>)}
								</select>
							</label>
							<label className="flex flex-col gap-1 text-xs text-white/50">
								{t('seoTools.clusterMethod')}
								<select
									value={method}
									onChange={(e) => setMethod(e.target.value as ClusterMethod)}
									disabled={running}
									className="bg-white/[0.04] border border-white/[0.1] rounded-md px-2 py-1.5 text-white/80 outline-none"
								>
									<option value="centroid">{t('seoTools.clusterMethodCentroid')}</option>
									<option value="connected">{t('seoTools.clusterMethodConnected')}</option>
									<option value="complete">{t('seoTools.clusterMethodComplete')}</option>
								</select>
							</label>
						</div>

						<p className="text-xs text-amber-400/90 inline-flex items-start gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
							{t('seoTools.clusterModalWarn', { count })}
						</p>

						{running && progress && (
							<div>
								<div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
									<div className="h-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
								</div>
								<p className="mt-1.5 text-xs text-white/50">{t('seoTools.clusterRunning', { done: progress.done, total: progress.total })}</p>
							</div>
						)}
						{error && <p className="text-sm text-rose-400">{error}</p>}

						<div className="flex justify-end gap-2">
							<Button type="button" variant="ghost" size="sm" disabled={running} onClick={onClose}>{t('common.cancel')}</Button>
							<Button type="button" variant="primary" size="sm" loading={running} disabled={running || count === 0} onClick={run}>
								{t('seoTools.clusterRun', { count })}
							</Button>
						</div>
					</div>
				)}

				{/* Results */}
				{clusters && (
					<div className="mt-5">
						<div className="flex items-center justify-between gap-2 mb-3">
							<p className="text-sm text-white/70">{t('seoTools.clusterResults', { count: clusters.length })}</p>
							<div className="flex gap-2">
								<button onClick={exportCsv} className="text-xs text-white/50 hover:text-white border border-white/[0.12] rounded-full px-3 py-1.5">{t('seoTools.exportCsv')}</button>
								<button onClick={() => { setClusters(null); setProgress(null); }} className="text-xs text-white/50 hover:text-white border border-white/[0.12] rounded-full px-3 py-1.5">{t('seoTools.clusterAgain')}</button>
							</div>
						</div>
						<div className="space-y-3">
							{clusters.map((c, i) => (
								<div key={i} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
									<div className="flex items-center gap-2 mb-1.5">
										<span className="text-sm font-semibold text-white/90">{c.pivot}</span>
										<span className="text-xs text-white/35">{t('seoTools.clusterCardMeta', { count: c.size, vol: c.totalVolume })}</span>
									</div>
									<div className="flex flex-wrap gap-1.5">
										{c.keywords.map((k) => (
											<span
												key={k.keyword}
												className={`text-xs rounded-full px-2 py-0.5 ${k.keyword === c.pivot ? 'bg-violet-500/20 text-violet-200' : 'bg-white/[0.05] text-white/60'}`}
											>
												{k.keyword}
											</span>
										))}
									</div>
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

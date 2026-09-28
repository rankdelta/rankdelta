import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
	ArrowPathIcon,
	ArrowTrendingDownIcon,
	ArrowTrendingUpIcon,
	CalendarDaysIcon,
	ChartBarIcon,
} from '@heroicons/react/24/outline';
import { motion } from 'framer-motion';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { Project } from '../../types/database';
import type { SerpRankSnapshotRow } from '../../types/database';
import {
	useSerpRankLatestMap,
	useInsertSerpKeyword,
	useBulkInsertSerpKeywords,
	useDeleteSerpKeyword,
	useUpdateSerpKeyword,
	useToggleSerpKeywordActive,
	useEnqueueSerpRankJobMutation,
	useSerpRankActiveJobs,
	activeJobProgress,
} from '../../hooks/useSerpRankTracker';
import { useVisibilityQueries } from '../../hooks/useVisibilityTracker';
import { parseKeywordPhrases } from '../../lib/serpRankPersist';
import { exportRankingsToCSV } from '../../utils/export';
import type { RankData } from '../../services/rankTracking';
import { KeywordHistoryDrawer } from './KeywordHistoryDrawer';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const WEEK_IN_MS = 7 * DAY_IN_MS;
/** Max phrases accepted per bulk paste — each is saved with its own request. */
const MAX_BULK_PHRASES = 500;

function RankTrend({ history }: { history: SerpRankSnapshotRow[] }) {
	const pts = history.map((s) => s.rank_absolute).filter((r): r is number => r != null);
	if (pts.length < 2) return null;
	const W = 60,
		H = 18,
		min = Math.min(...pts),
		max = Math.max(...pts),
		range = max - min || 1;
	const d = pts
		.map(
			(p, i) =>
				`${i === 0 ? 'M' : 'L'}${((i / (pts.length - 1)) * W).toFixed(1)},${(((p - min) / range) * (H - 2) + 1).toFixed(1)}`,
		)
		.join(' ');
	return (
		<svg width={W} height={H} className="inline-block align-middle opacity-80" aria-hidden>
			<path d={d} fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
		</svg>
	);
}

function ChangeBadge({ history }: { history: SerpRankSnapshotRow[] }) {
	const ranked = history.filter((s) => s.rank_absolute != null);
	if (ranked.length < 2) return null;
	const cur = ranked[ranked.length - 1]!.rank_absolute!;
	const prev = ranked[ranked.length - 2]!.rank_absolute!;
	const delta = prev - cur;
	if (delta === 0) return <span className="text-white/30 text-xs">–</span>;
	return (
		<span className={`text-xs font-medium ${delta > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
			{delta > 0 ? '▲' : '▼'}
			{Math.abs(delta)}
		</span>
	);
}

export function RankingsKeywordsTab({ project }: { project: Project }) {
	const { t } = useTranslation();
	const projectId = project.id;
	const { keywords, latestByKeyword, historyByKeyword } = useSerpRankLatestMap(projectId);
	const { data: aiQueries = [] } = useVisibilityQueries(projectId);
	const insertK = useInsertSerpKeyword(projectId);
	const bulkInsertK = useBulkInsertSerpKeywords(projectId);
	const delK = useDeleteSerpKeyword(projectId);
	const updateK = useUpdateSerpKeyword(projectId);
	const toggleK = useToggleSerpKeywordActive(projectId);
	const enqueueJob = useEnqueueSerpRankJobMutation(projectId);
	const { data: activeJobs = [] } = useSerpRankActiveJobs(projectId);
	const jobProgress = activeJobProgress(activeJobs);

	const [phrase, setPhrase] = useState('');
	const [bulkText, setBulkText] = useState('');
	const [saveProgress, setSaveProgress] = useState<{ done: number; total: number } | null>(null);
	const [saveNote, setSaveNote] = useState<{ ok: number; total: number } | null>(null);
	const [checkQueued, setCheckQueued] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editText, setEditText] = useState('');
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const [historyDrawer, setHistoryDrawer] = useState<{ id: string; phrase: string } | null>(null);

	const aiPhraseSet = useMemo(
		() => new Set(aiQueries.map((q) => q.text.trim().toLowerCase())),
		[aiQueries],
	);

	useEffect(() => {
		insertK.reset();
		bulkInsertK.reset();
		delK.reset();
		toggleK.reset();
		enqueueJob.reset();
		setSelected(new Set());
		setEditingId(null);
		setBulkText('');
		setSaveProgress(null);
		setSaveNote(null);
		setCheckQueued(false);
	}, [projectId]);

	const { bulkPhrases, bulkCapped } = useMemo(() => {
		const parsed = parseKeywordPhrases(bulkText);
		return { bulkPhrases: parsed.slice(0, MAX_BULK_PHRASES), bulkCapped: parsed.length > MAX_BULK_PHRASES };
	}, [bulkText]);
	const siteMissing = !project.website_url?.trim();

	const updateStatus = useMemo(() => {
		const active = keywords.filter((k) => k.is_active);
		if (active.length === 0) return { lastUpdate: null as Date | null, needsRefresh: false, daysOld: 0 };
		let lastChecked = new Date(0);
		for (const k of active) {
			const snap = latestByKeyword.get(k.id);
			if (snap?.checked_at) {
				const d = new Date(snap.checked_at);
				if (d > lastChecked) lastChecked = d;
			}
		}
		if (lastChecked.getTime() === 0) return { lastUpdate: null, needsRefresh: false, daysOld: 0 };
		const ageMs = Date.now() - lastChecked.getTime();
		return {
			lastUpdate: lastChecked,
			needsRefresh: ageMs > WEEK_IN_MS,
			daysOld: Math.floor(ageMs / DAY_IN_MS),
		};
	}, [keywords, latestByKeyword]);

	const formatRelativeTime = (date: Date) => {
		const diffMs = Date.now() - date.getTime();
		const diffDays = Math.floor(diffMs / DAY_IN_MS);
		const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
		if (diffDays > 0)
			return `${diffDays} ${diffDays === 1 ? t('rankTrack.day') : t('rankTrack.days')} ${t('rankTrack.ago')}`;
		if (diffHours > 0)
			return `${diffHours} ${diffHours === 1 ? t('rankTrack.hour') : t('rankTrack.hours')} ${t('rankTrack.ago')}`;
		return t('rankTrack.lessThanHourAgo');
	};

	const rows = useMemo(
		() =>
			keywords.map((k) => ({
				keyword: k,
				latest: latestByKeyword.get(k.id) ?? null,
				history: historyByKeyword.get(k.id) ?? [],
			})),
		[keywords, latestByKeyword, historyByKeyword],
	);

	const selectedActive = useMemo(
		() => keywords.filter((k) => selected.has(k.id) && k.is_active).map((k) => k.id),
		[keywords, selected],
	);

	const exportRows: RankData[] = useMemo(() => {
		return rows
			.filter((r) => r.keyword.is_active)
			.map(({ keyword: k, latest, history }) => {
				const ranked = history.filter((s) => s.rank_absolute != null);
				const prev = ranked.length >= 2 ? ranked[ranked.length - 2]!.rank_absolute : null;
				const pos = latest?.rank_absolute ?? null;
				const change = pos != null && prev != null ? prev - pos : 0;
				return {
					keyword: k.phrase,
					position: pos,
					url: latest?.ranking_url ?? null,
					title: latest?.result_title ?? null,
					previousPosition: prev,
					change,
					searchVolume: null,
					difficulty: null,
					lastChecked: latest?.checked_at ?? k.created_at,
					rankingId: k.id,
				};
			});
	}, [rows]);

	const handleBulkSave = () => {
		if (bulkPhrases.length === 0) return;
		setSaveNote(null);
		setSaveProgress({ done: 0, total: bulkPhrases.length });
		void bulkInsertK
			.mutateAsync({
				phrases: bulkPhrases,
				onProgress: (done, total) => setSaveProgress({ done, total }),
			})
			.then((results) => {
				const ok = results.filter((r) => r.ok).length;
				const savedIds = results.filter((r) => r.ok && r.id).map((r) => r.id as string);
				setSaveNote({ ok, total: results.length });
				if (ok > 0) setBulkText('');
				if (savedIds.length > 0 && !siteMissing) {
					setCheckQueued(true);
					enqueueJob.mutate(savedIds);
				}
			})
			// Rejections are surfaced by the global mutation error toast; just settle the promise.
			.catch(() => {})
			.finally(() => setSaveProgress(null));
	};

	const handleRefreshAll = () => {
		const ids = keywords.filter((k) => k.is_active).map((k) => k.id);
		if (ids.length === 0 || siteMissing) return;
		enqueueJob.mutate(ids);
	};

	const startEdit = (id: string, current: string) => {
		setEditingId(id);
		setEditText(current);
	};
	const saveEdit = () => {
		if (!editingId || !editText.trim()) return;
		void updateK.mutateAsync({ id: editingId, phrase: editText }).then(() => setEditingId(null));
	};

	return (
		<div className="space-y-6">
			{updateStatus.needsRefresh && rows.length > 0 && (
				<motion.div
					initial={{ opacity: 0, y: -10 }}
					animate={{ opacity: 1, y: 0 }}
					className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4"
				>
					<div className="flex items-center justify-between flex-wrap gap-4">
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center">
								<CalendarDaysIcon className="w-5 h-5 text-amber-300" strokeWidth={1.8} />
							</div>
							<div>
								<h4 className="font-semibold text-white">{t('rankTrack.weeklyUpdateAvailable')}</h4>
								<p className="text-sm text-white/50">
									{t('rankTrack.lastUpdate')}:{' '}
									{updateStatus.lastUpdate ? formatRelativeTime(updateStatus.lastUpdate) : t('rankTrack.never')}{' '}
									({t('rankTrack.daysAgo', { count: updateStatus.daysOld })})
								</p>
							</div>
						</div>
						<Button onClick={handleRefreshAll} variant="primary" size="sm" disabled={siteMissing}>
							<ArrowPathIcon className="w-4 h-4 mr-1.5" strokeWidth={2} />
							{t('rankTrack.refreshRankings', { count: rows.filter((r) => r.keyword.is_active).length })}
						</Button>
					</div>
				</motion.div>
			)}

			{!updateStatus.needsRefresh && rows.length > 0 && updateStatus.lastUpdate && (
				<div className="flex items-center justify-between rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3">
					<div className="flex items-center gap-2 text-sm text-emerald-300">
						<span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
						<span>
							{t('rankTrack.rankingsUpToDate')} • {t('rankTrack.lastCheck')}:{' '}
							{formatRelativeTime(updateStatus.lastUpdate)}
						</span>
					</div>
					<Button onClick={handleRefreshAll} variant="ghost" size="sm" disabled={siteMissing}>
						<ArrowPathIcon className="w-4 h-4 mr-1" strokeWidth={2} />
						{t('rankTrack.refreshNow')}
					</Button>
				</div>
			)}

			{siteMissing && (
				<p className="text-sm text-amber-400 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 max-w-2xl">
					{t('visibility.rankingsNoSiteUrl')}
				</p>
			)}

			{jobProgress && !jobProgress.finished && (
				<p
					className="text-sm text-violet-300 rounded-lg bg-violet-500/10 border border-violet-500/30 px-3 py-2 max-w-2xl"
					role="status"
				>
					{t('visibility.rankingsJobProgress', {
						done: jobProgress.completed + jobProgress.failed,
						total: jobProgress.total,
					})}{' '}
					<span className="text-white/50">{t('visibility.rankingsJobBackground')}</span>
				</p>
			)}

			<div className="rounded-2xl p-5 bg-white/[0.02] border border-white/[0.08] space-y-4">
				<h3 className="font-medium text-white">{t('visibility.rankingsAddKeyword')}</h3>
				<div className="flex flex-col sm:flex-row gap-3">
					<Input
						value={phrase}
						onChange={(e) => setPhrase(e.target.value)}
						placeholder={t('visibility.rankingsKeywordPlaceholder')}
						className="flex-1 min-h-11"
						disabled={insertK.isPending}
					/>
					<Button
						onClick={() => void insertK.mutateAsync(phrase).then(() => setPhrase(''))}
						loading={insertK.isPending}
						disabled={!phrase.trim()}
					>
						{t('common.save')}
					</Button>
				</div>
			</div>

			<div className="rounded-2xl p-5 bg-white/[0.02] border border-white/[0.08] space-y-4">
				<h3 className="font-medium text-white">{t('visibility.rankingsBulkAddTitle')}</h3>
				<textarea
					value={bulkText}
					onChange={(e) => setBulkText(e.target.value)}
					placeholder={t('visibility.rankingsBulkPlaceholder')}
					rows={5}
					className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.1] text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 font-mono text-sm resize-y min-h-[6rem]"
				/>
				<Button
					onClick={handleBulkSave}
					loading={!!saveProgress}
					loadingLabel={saveProgress ? t('visibility.rankingsBulkProgress', saveProgress) : undefined}
					disabled={bulkPhrases.length === 0 || !!saveProgress}
				>
					{t('visibility.rankingsBulkSave', { count: bulkPhrases.length })}
				</Button>
				{bulkCapped && (
					<p className="text-sm text-amber-300">{t('visibility.rankingsBulkCapped', { max: MAX_BULK_PHRASES })}</p>
				)}
				{saveNote && (
					<p className={`text-sm ${saveNote.ok < saveNote.total ? 'text-amber-300' : 'text-emerald-300'}`}>
						{t('visibility.rankingsBulkSummary', { ok: saveNote.ok, total: saveNote.total })}
					</p>
				)}
				{checkQueued && !siteMissing && (
					<p className="text-sm text-violet-300">{t('visibility.rankingsCheckQueued')}</p>
				)}
			</div>

			<div className="flex flex-col sm:flex-row sm:items-center gap-3">
				<Button
					variant="primary"
					size="sm"
					disabled={selectedActive.length === 0 || siteMissing}
					onClick={() => {
						setCheckQueued(true);
						enqueueJob.mutate(selectedActive);
					}}
				>
					{/* Every selected keyword is checked (batched in groups of VISIBILITY_SERP_BATCH_MAX_KEYWORDS
					    server-side), so the label shows the real count instead of a "/ 12 max" cap. */}
					{t('visibility.rankingsRunSelectedCount', {
						count: selectedActive.length,
						defaultValue: 'Check selected ({{count}})',
					})}
				</Button>
				{exportRows.length > 0 && (
					<Button
						variant="secondary"
						size="sm"
						onClick={() =>
							exportRankingsToCSV(
								exportRows,
								`rankings-${project.name}-${new Date().toISOString().split('T')[0]}.csv`,
							)
						}
					>
						{t('rankTrack.exportCsv')}
					</Button>
				)}
			</div>

			<div className="rounded-2xl overflow-hidden border border-white/[0.08]">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<caption className="sr-only">{t('visibility.rankingsTableCaption')}</caption>
						<thead className="bg-white/[0.02] border-b border-white/[0.08] text-left text-white/60">
							<tr>
								<th className="px-3 py-3.5 w-12">
									<input
										type="checkbox"
										className="h-4 w-4 rounded border-white/20 text-violet-400 focus:ring-violet-500/30"
										aria-label={t('visibility.rankingsSelectAll')}
										checked={
											rows.length > 0 &&
											rows.filter((r) => r.keyword.is_active).every((r) => selected.has(r.keyword.id))
										}
										onChange={(e) => {
											if (e.target.checked) {
												setSelected(new Set(keywords.filter((k) => k.is_active).map((k) => k.id)));
											} else {
												setSelected(new Set());
											}
										}}
									/>
								</th>
								<th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">
									{t('visibility.rankingsColKeyword')}
								</th>
								<th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">
									{t('visibility.rankingsColPosition')}
								</th>
								<th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">
									{t('rankTrack.colVolume')}
								</th>
								<th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">
									{t('rankings.colAiPrompt')}
								</th>
								<th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">
									{t('visibility.rankingsColUrl')}
								</th>
								<th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">
									{t('visibility.rankingsColLastCheck')}
								</th>
								<th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide text-right">
									{t('visibility.colActions')}
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.length === 0 ? (
								<tr>
									<td colSpan={8} className="px-4 py-10 text-center text-white/40">
										<div className="flex flex-col items-center gap-2">
											<ChartBarIcon className="w-8 h-8 text-violet-400/50" strokeWidth={1.4} />
											{t('visibility.rankingsEmpty')}
										</div>
									</td>
								</tr>
							) : (
								rows.map(({ keyword: k, latest, history }) => {
									const isAiPrompt = aiPhraseSet.has(k.phrase.trim().toLowerCase());
									const ranked = history.filter((s) => s.rank_absolute != null);
									const prev = ranked.length >= 2 ? ranked[ranked.length - 2]!.rank_absolute : null;
									const pos = latest?.rank_absolute ?? null;
									const change = pos != null && prev != null ? prev - pos : 0;

									return (
										<tr key={k.id} className="border-t border-white/[0.06] hover:bg-white/[0.04]">
											<td className="px-3 py-3 align-top">
												<input
													type="checkbox"
													className="h-4 w-4 rounded border-white/20 text-violet-400 focus:ring-violet-500/30"
													disabled={!k.is_active}
													checked={selected.has(k.id)}
													onChange={() => {
														setSelected((prev) => {
															const n = new Set(prev);
															if (n.has(k.id)) n.delete(k.id);
															else n.add(k.id);
															return n;
														});
													}}
												/>
											</td>
											<td className="px-4 py-3 text-white align-top max-w-xs">
												{editingId === k.id ? (
													<Input
														value={editText}
														onChange={(e) => setEditText(e.target.value)}
														onKeyDown={(e) => {
															if (e.key === 'Enter') saveEdit();
															if (e.key === 'Escape') setEditingId(null);
														}}
														autoFocus
														className="min-h-9 py-1"
														disabled={updateK.isPending}
													/>
												) : (
													<div className="flex items-center gap-2">
														<span>{k.phrase}</span>
														{!k.is_active && (
															<Badge variant="default">{t('rankings.inactive')}</Badge>
														)}
													</div>
												)}
											</td>
											<td className="px-4 py-3 text-white/80 align-top font-medium">
												<div className="flex items-center gap-2">
													{latest?.status === 'failed' ? (
														t('visibility.rankingsFailed')
													) : pos != null ? (
														<Badge variant={pos <= 10 ? 'success' : pos <= 30 ? 'warning' : 'default'}>
															#{pos}
														</Badge>
													) : latest ? (
														t('visibility.rankingsNotRanked')
													) : (
														'—'
													)}
													{change !== 0 && (
														<span
															className={`flex items-center gap-0.5 text-xs font-medium ${change > 0 ? 'text-emerald-400' : 'text-rose-400'}`}
														>
															{change > 0 ? (
																<ArrowTrendingUpIcon className="w-3 h-3" />
															) : (
																<ArrowTrendingDownIcon className="w-3 h-3" />
															)}
															{Math.abs(change)}
														</span>
													)}
													<ChangeBadge history={history} />
													<RankTrend history={history} />
												</div>
											</td>
											<td className="px-4 py-3 text-white/50 tabular-nums align-top">—</td>
											<td className="px-4 py-3 align-top">
												{isAiPrompt ? (
													<span className="text-violet-300 text-xs font-medium">{t('rankings.aiTracked')}</span>
												) : (
													<span className="text-white/30 text-xs">{t('rankings.aiNotTracked')}</span>
												)}
											</td>
											<td className="px-4 py-3 text-white/60 align-top text-xs max-w-[10rem]">
												{latest?.ranking_url ? (
													<a
														href={latest.ranking_url}
														target="_blank"
														rel="noopener noreferrer"
														className="text-violet-300 hover:text-violet-200 break-all line-clamp-2"
													>
														{latest.ranking_url.replace(/^https?:\/\/[^/]+/, '') || '/'}
													</a>
												) : (
													'—'
												)}
											</td>
											<td className="px-4 py-3 text-white/60 align-top text-xs">
												{latest
													? new Date(latest.checked_at).toLocaleString(undefined, {
															dateStyle: 'short',
															timeStyle: 'short',
														})
													: '—'}
											</td>
											<td className="px-4 py-3 text-right align-top">
												<div className="inline-flex flex-wrap items-center justify-end gap-1">
													<Button
														size="sm"
														variant="ghost"
														className="text-white/60"
														onClick={() => setHistoryDrawer({ id: k.id, phrase: k.phrase })}
													>
														{t('rankings.viewHistory')}
													</Button>
													{editingId === k.id ? (
														<>
															<Button size="sm" variant="primary" loading={updateK.isPending} onClick={saveEdit}>
																{t('common.save')}
															</Button>
															<Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
																{t('common.cancel')}
															</Button>
														</>
													) : (
														<>
															<Button
																size="sm"
																variant="ghost"
																className="text-white/60"
																onClick={() => startEdit(k.id, k.phrase)}
															>
																{t('common.edit')}
															</Button>
															<Button
																size="sm"
																variant="ghost"
																className="text-rose-400"
																onClick={() => setConfirmDeleteId(k.id)}
															>
																{t('common.delete')}
															</Button>
														</>
													)}
												</div>
											</td>
										</tr>
									);
								})
							)}
						</tbody>
					</table>
				</div>
			</div>

			{historyDrawer && (
				<KeywordHistoryDrawer
					keywordId={historyDrawer.id}
					phrase={historyDrawer.phrase}
					history={historyByKeyword.get(historyDrawer.id)}
					onClose={() => setHistoryDrawer(null)}
				/>
			)}

			<ConfirmDialog
				open={!!confirmDeleteId}
				title={t('visibility.rankingsConfirmDelete')}
				message={t('visibility.confirmDeleteBody')}
				confirmLabel={t('common.delete')}
				cancelLabel={t('common.cancel')}
				danger
				loading={delK.isPending}
				onConfirm={() => {
					const id = confirmDeleteId;
					if (!id) return;
					void delK.mutateAsync(id).then(
						() => setConfirmDeleteId(null),
						() => setConfirmDeleteId(null),
					);
				}}
				onCancel={() => setConfirmDeleteId(null)}
			/>
		</div>
	);
}

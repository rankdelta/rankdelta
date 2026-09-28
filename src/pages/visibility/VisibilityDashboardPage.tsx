import { useMemo, useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
	useVisibilityQueries,
	useVisibilityQueryRuns,
	useVisibilityMentionInsights,
	useVisibilityContentGaps,
	useCompetitorBrands,
	useCompetitorHeadToHead,
	type VisibilityMentionInsights,
} from '../../hooks/useVisibilityTracker';
import { useProject } from '../../hooks/useProjects';
import { readTargetCompetitorId } from '../../lib/projectMetadata';
import { VisibilityGuidedFlow } from '../../components/visibility/VisibilityGuidedFlow';
import { SovTrendChart, CompetitorSovTrend, providerLabel } from '../../components/visibility/insightBlocks';
import { AnswerReceiptsModal } from '../../components/visibility/AnswerReceiptsModal';
import { Button } from '../../components/ui/Button';
import { useAnswerReceipts } from '../../hooks/useAnswerReceipts';
import { aiAnswerReceiptsEnabled } from '../../lib/answerReceipts';
import {
	countCompletedRuns,
	resolveVisibilitySetupPhase,
} from '../../lib/visibilitySetupPhase';
import { SparklesIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

const RANGE_OPTIONS = [
	{ days: 7, key: 'visibility.insightsRange7' },
	{ days: 30, key: 'visibility.insightsRange30' },
	{ days: 90, key: 'visibility.insightsRange90' },
] as const;

function WowChip({
	value,
	positiveIsGood = true,
	unit = 'pp',
	digits = 1,
}: {
	value: number | null | undefined;
	positiveIsGood?: boolean;
	unit?: string;
	digits?: number;
}) {
	if (value == null) return null;
	const flat = Math.abs(value) < (digits === 0 ? 0.5 : 0.05);
	const good = positiveIsGood ? value > 0 : value < 0;
	const arrow = flat ? '■' : good ? '▲' : '▼';
	const cls = flat ? 'text-white/30' : good ? 'text-emerald-400' : 'text-rose-400';
	return (
		<span className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${cls}`}>
			{arrow} {Math.abs(value).toFixed(digits)}
			{unit ? ` ${unit}` : ''}
		</span>
	);
}

function downloadInsightsCsv(
	ins: VisibilityMentionInsights,
	projectId: string,
	competitorRows: Array<{ id: string; name: string; count: number }>,
	providerRows: Array<[string, { yours: number; competitors: number } | undefined]>,
) {
	const ts = ins.trackedSentiment;
	const lines = [
		'metric,value',
		`share_of_voice_percent,${ins.shareOfVoicePercent ?? ''}`,
		`sov_last_7d_utc,${ins.sovLast7d ?? ''}`,
		`sov_prior_7d_utc,${ins.sovPrior7d ?? ''}`,
		`sov_week_over_week_delta_pp,${ins.sovWeekOverWeekDelta ?? ''}`,
		`your_brand_mentions,${ins.yourBrandMentions}`,
		`competitor_mentions_total,${ins.totalCompetitorMentions}`,
		`citation_rate_percent,${ins.citationRatePercent ?? ''}`,
		`cited_answers,${ins.citedAnswers}`,
		`avg_position,${ins.avgPosition ?? ''}`,
		'',
		'sentiment,count',
		`positive,${ts.positive}`,
		`neutral,${ts.neutral}`,
		`negative,${ts.negative}`,
		`unknown,${ts.unknown}`,
		'',
		'competitor_id,competitor_name,mentions',
		...competitorRows.map((r) => `"${r.id.replace(/"/g, '""')}","${r.name.replace(/"/g, '""')}",${r.count}`),
		'',
		'engine,your_mentions,competitor_mentions',
		...providerRows.map(([k, v]) => `${k},${v?.yours ?? 0},${v?.competitors ?? 0}`),
		'',
		'date,your_mentions,competitor_mentions,share_of_voice_percent',
		...ins.trend.map((d) => `${d.date},${d.yours},${d.competitors},${d.sovPercent != null ? d.sovPercent.toFixed(1) : ''}`),
	];
	const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `rankdelta-insights-${projectId.slice(0, 8)}.csv`;
	a.click();
	URL.revokeObjectURL(url);
}

export const VisibilityDashboardPage = () => {
	const { t } = useTranslation();
	const { projectId } = useParams({ strict: false }) as { projectId: string };
	const [rangeDays, setRangeDays] = useState<number>(30);
	const [receiptProvider, setReceiptProvider] = useState<string | undefined>();
	const [showReceipts, setShowReceipts] = useState(false);
	const receiptsEnabled = aiAnswerReceiptsEnabled();

	const { data: queries = [] } = useVisibilityQueries(projectId);
	const { data: runs = [] } = useVisibilityQueryRuns(projectId);
	const { data: project } = useProject(projectId);
	const { data: mentionInsights, isLoading: insightsLoading } = useVisibilityMentionInsights(projectId, rangeDays);
	const { data: contentGaps = [] } = useVisibilityContentGaps(projectId);
	const { data: competitors = [] } = useCompetitorBrands(projectId);
	const targetCompetitorId = readTargetCompetitorId(project) ?? competitors[0]?.id;
	const targetCompetitor = competitors.find((c) => c.id === targetCompetitorId);
	const { data: targetH2h } = useCompetitorHeadToHead(projectId, targetCompetitor?.id, rangeDays);
	const { data: receipts = [] } = useAnswerReceipts(receiptsEnabled ? projectId : undefined, {
		provider: receiptProvider,
	});

	const setupPhase = useMemo(
		() => resolveVisibilitySetupPhase(queries.length, runs),
		[queries.length, runs],
	);
	const completedRuns = countCompletedRuns(runs);

	const compNameById = useMemo(() => {
		const m = new Map<string, string>();
		for (const c of competitors) m.set(c.id, c.name);
		return m;
	}, [competitors]);

	const competitorRows = useMemo(() => {
		if (!mentionInsights) return [];
		return Object.entries(mentionInsights.competitorMentionsById)
			.map(([id, count]) => ({
				id,
				count,
				name: compNameById.get(id) ?? `${id.slice(0, 8)}…`,
			}))
			.sort((a, b) => b.count - a.count);
	}, [mentionInsights, compNameById]);

	const providerRows = useMemo(() => {
		if (!mentionInsights) return [];
		return Object.entries(mentionInsights.byProvider).sort((a, b) => {
			const ta = (a[1]?.yours ?? 0) + (a[1]?.competitors ?? 0);
			const tb = (b[1]?.yours ?? 0) + (b[1]?.competitors ?? 0);
			return tb - ta;
		});
	}, [mentionInsights]);

	const lastCompletedRunLabel = useMemo(() => {
		const c = runs.find((r) => r.status === 'completed');
		if (!c) return null;
		return new Date(c.run_at).toLocaleString(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short',
		});
	}, [runs]);

	const hasEverScanned = mentionInsights?.hasEverScanned ?? completedRuns > 0;
	// Confidence now rests on how many SoV-eligible queries were actually scanned (the weighted
	// SoV's real basis), surfaced by the hook — not just the pooled headline mention count.
	const sovLowConfidence = hasEverScanned && mentionInsights ? mentionInsights.sovLowConfidence : false;
	const sovRaw = hasEverScanned ? (mentionInsights?.shareOfVoicePercent ?? null) : null;
	const sov = sovRaw != null && !sovLowConfidence ? sovRaw : setupPhase === 'measured' ? sovRaw : null;
	const sovDelta = mentionInsights?.sovWeekOverWeekDelta ?? null;
	const sovAsOfLabel = useMemo(() => {
		const at = mentionInsights?.sovAsOfAt;
		if (!at) return null;
		return new Date(at).toLocaleDateString(undefined, { dateStyle: 'medium' });
	}, [mentionInsights?.sovAsOfAt]);
	const headlineMentions = mentionInsights
		? mentionInsights.yourBrandMentionsHeadline + mentionInsights.totalCompetitorMentionsHeadline
		: 0;

	const openReceiptsForProvider = (provider: string) => {
		if (!receiptsEnabled) return;
		setReceiptProvider(provider);
		setShowReceipts(true);
	};

	const closeReceipts = () => {
		setShowReceipts(false);
		setReceiptProvider(undefined);
	};

	const guidedPrimaryAction =
		setupPhase === 'empty' ? (
			<Link
				to="/visibility/$projectId/queries"
				params={{ projectId }}
				className="inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 transition-all"
			>
				{t('visibility.guidedCtaGenerate')}
			</Link>
		) : setupPhase === 'configured' ? (
			<Link
				to="/visibility/$projectId/queries"
				params={{ projectId }}
				className="inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 transition-all"
			>
				{t('visibility.guidedCtaReview')}
			</Link>
		) : setupPhase === 'pending_data' ? (
			<Link
				to="/visibility/$projectId/queries"
				params={{ projectId }}
				className="inline-flex items-center justify-center px-5 py-2.5 rounded-full border border-white/20 text-white text-sm font-semibold hover:bg-white/[0.06] transition-all"
			>
				{t('visibility.guidedCtaCheckStatus')}
			</Link>
		) : null;

	return (
		<div className="space-y-8">
			<header className="space-y-1">
				<p className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('visibility.overviewTitle')}</p>
				<h2 className="text-2xl font-bold text-white">{t('visibility.overviewTitle')}</h2>
				<p className="text-white/50 text-sm max-w-2xl leading-relaxed">{t('visibility.overviewSubtitleEcom')}</p>
			</header>

			<VisibilityGuidedFlow projectId={projectId} phase={setupPhase} primaryAction={guidedPrimaryAction} />

			<div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.08] to-transparent p-6">
				<p className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('visibility.northStarEyebrow')}</p>
				<h3 className="text-xl sm:text-2xl font-bold text-white mt-2">{t('visibility.northStarTitle')}</h3>
				<p className="text-sm text-white/50 mt-1 max-w-2xl leading-relaxed">{t('visibility.northStarSubtitle')}</p>
				{targetCompetitor && targetH2h && setupPhase === 'measured' && (
					<p className="text-sm text-amber-200/90 mt-2 font-medium">
						{t('visibility.northStarVsTarget', {
							you: targetH2h.yourSovPercent != null ? targetH2h.yourSovPercent.toFixed(1) : '0',
							target: targetCompetitor.name,
							theirs: targetH2h.competitorSovPercent != null ? targetH2h.competitorSovPercent.toFixed(1) : '0',
						})}
					</p>
				)}
				{lastCompletedRunLabel ? (
					<p className="text-xs text-white/30 mt-2 max-w-2xl leading-relaxed">
						{t('visibility.scoresThrough', { when: lastCompletedRunLabel })}
					</p>
				) : setupPhase === 'pending_data' ? (
					<p className="text-xs text-amber-400/80 mt-2 max-w-2xl leading-relaxed">
						{t('visibility.scoresNoCompletedYet')}
					</p>
				) : null}
				<div className="mt-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
					<div aria-live="polite">
						{insightsLoading ? (
							<span className="inline-block h-16 w-40 rounded-xl bg-white/[0.06] animate-pulse" aria-hidden />
						) : setupPhase !== 'measured' ? (
							<div className="space-y-3 max-w-xl">
								<p className="text-sm text-white/60 leading-relaxed">
									{setupPhase === 'empty'
										? t('visibility.sovNoScanYet')
										: setupPhase === 'configured'
											? t('visibility.sovConfiguredNoData')
											: t('visibility.sovPendingData')}
								</p>
								{setupPhase !== 'pending_data' && (
									<Link
										to="/visibility/$projectId/queries"
										params={{ projectId }}
										className="inline-flex items-center justify-center px-4 py-2.5 rounded-full bg-white text-black text-sm font-semibold hover:bg-white/90 transition-all"
									>
										{setupPhase === 'empty'
											? t('visibility.guidedCtaGenerate')
											: t('visibility.guidedCtaRunFirstCheck')}
									</Link>
								)}
							</div>
						) : (
							<>
								<p className="text-5xl sm:text-6xl font-bold text-white tabular-nums leading-none">
									{sov != null ? `${sov.toFixed(1)}%` : '0%'}
								</p>
								{sovAsOfLabel && (
									<p className="text-xs text-white/40 mt-2">{t('visibility.sovAsOf', { date: sovAsOfLabel })}</p>
								)}
							</>
						)}
						{!insightsLoading &&
							setupPhase === 'measured' &&
							mentionInsights?.sovComparisonAvailable &&
							sovDelta != null && (
								<p
									className={`text-sm font-semibold mt-3 tabular-nums ${
										sovDelta > 0 ? 'text-emerald-400' : sovDelta < 0 ? 'text-rose-400' : 'text-white/50'
									}`}
								>
									{t('visibility.insightsSovWow', {
										delta: sovDelta > 0 ? `+${sovDelta.toFixed(1)}` : sovDelta.toFixed(1),
									})}
								</p>
							)}
					</div>
				</div>
				{!insightsLoading && setupPhase === 'measured' && sovLowConfidence && mentionInsights && (
					<p className="text-xs text-amber-400/90 mt-4 inline-flex items-start gap-1.5 max-w-2xl leading-relaxed rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
						<ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={1.8} />
						<span>
							{t('visibility.sovLowConfidence', {
								mentions: headlineMentions,
								runs: completedRuns,
							})}
						</span>
					</p>
				)}
				{!insightsLoading && setupPhase === 'measured' && sov == null && headlineMentions === 0 && (
					<p className="text-sm text-white/40 mt-4 max-w-2xl leading-relaxed">
						{t('visibility.sovNoMentionsInSnapshot')}
					</p>
				)}
			</div>

			{setupPhase === 'measured' && !insightsLoading && mentionInsights?.hasData && (
				<div className="grid sm:grid-cols-2 gap-3">
					<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
						<p className="text-[11px] font-medium text-white/40 uppercase tracking-wide">
							{t('visibility.insightsCitationRate')}
						</p>
						<p className="mt-1 flex items-baseline gap-2">
							<span className="text-3xl font-bold text-white tabular-nums">
								{mentionInsights.citationRatePercent != null
									? `${mentionInsights.citationRatePercent.toFixed(0)}%`
									: '—'}
							</span>
							<WowChip value={mentionInsights.citationRateWeekOverWeekDelta} positiveIsGood unit="pp" />
						</p>
						<p className="text-[11px] text-white/30 mt-1">{t('visibility.insightsCitationRateHint')}</p>
					</div>
					<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
						<p className="text-[11px] font-medium text-white/40 uppercase tracking-wide">
							{t('visibility.insightsPosition')}
						</p>
						<p className="mt-1 flex items-baseline gap-2">
							<span className="text-3xl font-bold text-white tabular-nums">
								{mentionInsights.avgPosition != null ? `#${mentionInsights.avgPosition.toFixed(1)}` : '—'}
							</span>
							<WowChip value={mentionInsights.positionWeekOverWeekDelta} positiveIsGood={false} unit="" />
						</p>
						<p className="text-[11px] text-white/30 mt-1">{t('visibility.insightsPositionHint')}</p>
					</div>
				</div>
			)}

			{setupPhase === 'measured' && contentGaps.length > 0 && (
				<div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-6">
					<div className="flex items-center gap-2">
						<SparklesIcon className="w-5 h-5 text-emerald-300" strokeWidth={1.8} />
						<p className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('visibility.contentOppsEyebrow')}</p>
					</div>
					<p className="text-sm text-white/55 mt-2 max-w-2xl leading-relaxed">{t('visibility.contentOppsBody')}</p>
					<div className="mt-4 space-y-2">
						{contentGaps.slice(0, 6).map((g) => (
							<div
								key={g.queryId}
								className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]"
							>
								<div className="flex-1 min-w-0">
									<p className="text-sm text-white/85 truncate">{g.text}</p>
									<p className="text-xs text-white/40">
										{g.competitorMentions > 0
											? t('visibility.competitorsCitedYouZero', { count: g.competitorMentions })
											: t('visibility.noBrandCitation')}
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

			{setupPhase === 'measured' && !insightsLoading && mentionInsights?.hasData && (
				<section className="space-y-4">
					<div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
						<div className="space-y-1">
							<h3 className="text-lg font-semibold text-white tracking-tight">{t('visibility.insightsTitle')}</h3>
							<p className="text-sm text-white/60 max-w-2xl leading-relaxed">{t('visibility.insightsSubtitle')}</p>
						</div>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={() => downloadInsightsCsv(mentionInsights, projectId, competitorRows, providerRows)}
							className="shrink-0"
						>
							{t('visibility.insightsExportCsv')}
						</Button>
					</div>

					{providerRows.length > 0 && (
						<div className="rounded-2xl p-5 border border-white/[0.08] bg-white/[0.02]">
							<h3 className="text-sm font-semibold text-white mb-3">{t('visibility.insightsByEngine')}</h3>
							<div className="flex flex-wrap gap-2">
								{providerRows.map(([prov, v]) => {
									const yours = v?.yours ?? 0;
									const theirs = v?.competitors ?? 0;
									const total = yours + theirs;
									const sovPct = total > 0 ? (100 * yours) / total : null;
									return (
										<button
											key={prov}
											type="button"
											disabled={!receiptsEnabled}
											onClick={() => openReceiptsForProvider(prov)}
											className={`inline-flex flex-col items-start gap-0.5 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
												receiptsEnabled
													? 'border-white/[0.1] bg-white/[0.03] hover:border-violet-500/40 hover:bg-violet-500/[0.06] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40'
													: 'border-white/[0.08] bg-white/[0.02] cursor-default'
											}`}
										>
											<span className="text-xs font-medium text-white/70">{providerLabel(t, prov)}</span>
											<span className="text-lg font-bold text-white tabular-nums">
												{sovPct != null ? `${sovPct.toFixed(0)}%` : '—'}
											</span>
											<span className="text-[10px] text-white/40 tabular-nums">
												{yours} / {total} {t('visibility.engineChipMentions')}
											</span>
										</button>
									);
								})}
							</div>
						</div>
					)}

					<div className="rounded-2xl p-5 border border-white/[0.08] bg-white/[0.02]">
						<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
							<div>
								<h3 className="text-sm font-semibold text-white">{t('visibility.insightsSovTrendTitle')}</h3>
								<p className="text-xs text-white/40 mt-0.5">{t('visibility.insightsSovTrendHint')}</p>
							</div>
							<div
								className="inline-flex rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5 self-start"
								role="group"
								aria-label={t('visibility.insightsRangeLabel')}
							>
								{RANGE_OPTIONS.map((opt) => (
									<button
										key={opt.days}
										type="button"
										onClick={() => setRangeDays(opt.days)}
										aria-pressed={rangeDays === opt.days}
										className={`px-3 py-1 text-xs font-medium rounded-md transition-colors tabular-nums ${
											rangeDays === opt.days
												? 'bg-violet-500/90 text-white'
												: 'text-white/50 hover:text-white/80'
										}`}
									>
										{t(opt.key)}
									</button>
								))}
							</div>
						</div>
						<SovTrendChart trend={mentionInsights.trend} t={t} />
					</div>

					{mentionInsights.topCompetitorIds.length > 0 && (
						<div className="rounded-2xl p-5 border border-white/[0.08] bg-white/[0.02]">
							<h3 className="text-sm font-semibold text-white">{t('visibility.insightsCompetitorTrendTitle')}</h3>
							<p className="text-xs text-white/40 mt-0.5 mb-4">{t('visibility.insightsCompetitorTrendHint')}</p>
							<CompetitorSovTrend
								competitorTrend={mentionInsights.competitorTrend}
								topCompetitorIds={mentionInsights.topCompetitorIds}
								competitorNames={Object.fromEntries(compNameById)}
								t={t}
							/>
						</div>
					)}
				</section>
			)}

			{showReceipts && receiptsEnabled && (
				<AnswerReceiptsModal receipts={receipts} onClose={closeReceipts} />
			)}
		</div>
	);
};

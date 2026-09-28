import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { toCsv, downloadText } from '../../lib/csv';
import {
	useVisibilityQueries,
	useVisibilityQueryRuns,
	useGenerateQueriesMutation,
	useRunQueryMutation,
	useRunBatchMutation,
	useInsertVisibilityQuery,
	useDeleteVisibilityQuery,
	useUpdateVisibilityQuery,
	useInsertVisibilityQueryBatch,
	useUpdateVisibilityQueryActive,
	useBulkUpdateVisibilityQueriesActive,
	useBulkDeleteVisibilityQueries,
	useDuplicateVisibilityQuery,
	useTrackedBrands,
	useCompetitorBrands,
	useVisibilityRunOutcomes,
} from '../../hooks/useVisibilityTracker';
import { useProject } from '../../hooks/useProjects';
import { readEnginesToRun } from '../../lib/projectMetadata';
import { useSubscription } from '../../hooks/useSubscription';
import { useStartTrialModal } from '../../components/subscription/StartTrialModal';
import type { QueryIntentType } from '../../types/database';
import { buildStarterPromptsForVertical } from '../../lib/ecommercePromptStarters';
import { normalizeContentLanguage, prefersEnglishUi, CONTENT_LANGUAGES, langName } from '../../lib/contentLanguages';
import {
	buildVisibilityBatchSizeOptions,
	clampVisibilityBatchSize,
	defaultVisibilityBatchSize,
	DEFAULT_VISIBILITY_BATCH_SIZE,
	resolveVisibilityPromptsCap,
} from '../../lib/visibilityBatchCap';
import {
	isVisibilityBudgetBlocked,
	isVisibilityPlanRequired,
	visibilityGenerateErrorMessage,
} from '../../lib/visibilityErrorMessage';
import {
	DFS_LLM_MENTIONS_LIMIT_DEFAULT,
	DFS_LLM_MENTIONS_LIMIT_OPTIONS,
	VISIBILITY_BATCH_MAX_QUERIES,
} from '../../config/dataforseoVisibility';
import { VisibilityGuidedFlow } from '../../components/visibility/VisibilityGuidedFlow';
import { AnswerReceiptsModal } from '../../components/visibility/AnswerReceiptsModal';
import { useAnswerReceipts } from '../../hooks/useAnswerReceipts';
import { aiAnswerReceiptsEnabled } from '../../lib/answerReceipts';
import { aggregateQueryStanding } from '../../lib/resultsMath';
import { resolveVisibilitySetupPhase } from '../../lib/visibilitySetupPhase';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

/** Stable empty set so the memo dep doesn't churn while outcomes are loading. */
const EMPTY_ID_SET: ReadonlySet<string> = new Set();

const NATIVE_CONTROL =
	'min-h-11 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3 py-2 text-sm text-white shadow-sm transition-colors focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50 disabled:cursor-not-allowed [&>option]:bg-[#1a1a1a] [&>option]:text-white';

export const VisibilityQueriesPage = () => {
	const { t } = useTranslation();
	const { projectId } = useParams({ strict: false }) as { projectId: string };
	const { data: project } = useProject(projectId);
	const { data: queries = [], isLoading } = useVisibilityQueries(projectId);
	const { data: runs = [] } = useVisibilityQueryRuns(projectId);
	const { data: outcomes } = useVisibilityRunOutcomes(projectId);
	const { data: brands = [] } = useTrackedBrands(projectId);
	const receiptsEnabled = aiAnswerReceiptsEnabled();
	const [expandedQueryId, setExpandedQueryId] = useState<string | null>(null);
	const [receiptsQueryId, setReceiptsQueryId] = useState<string | null>(null);
	const { data: receipts = [] } = useAnswerReceipts(receiptsEnabled && receiptsQueryId ? projectId : undefined, {
		queryId: receiptsQueryId ?? undefined,
	});

	// Per-prompt standing: across each prompt's completed runs, did AI cite (link) you, merely mention
	// you, or neither (a content gap)? Lets users see at a glance which prompts they're winning/losing.
	// Decision logic is the pure, unit-tested aggregateQueryStanding.
	const queryStatus = useMemo(
		() => aggregateQueryStanding(runs, outcomes?.citedRunIds ?? EMPTY_ID_SET, outcomes?.mentionedRunIds ?? EMPTY_ID_SET),
		[runs, outcomes],
	);

	// DataForSEO LLM Mentions is a separate, subscription-gated API ($100/mo min). If runs come back
	// "failed" with an access/subscription error, the whole feature is blocked until it's activated —
	// surface that clearly instead of letting runs fail silently.
	const needsApiActivation = useMemo(
		() =>
			runs.some(
				(r) =>
					r.status === 'failed' &&
					/access denied|activate|subscription|plans and subscriptions/i.test(r.error_message || ''),
			),
		[runs],
	);
	const { data: comps = [] } = useCompetitorBrands(projectId);
	const { currentPlan, canUseEngine } = useSubscription();
	const trialModal = useStartTrialModal();
	const gen = useGenerateQueriesMutation(projectId);
	const runQ = useRunQueryMutation(projectId);
	const runBatch = useRunBatchMutation(projectId);
	const insertQ = useInsertVisibilityQuery(projectId);
	const batchQ = useInsertVisibilityQueryBatch(projectId);
	const delQ = useDeleteVisibilityQuery(projectId);
	const toggleActive = useUpdateVisibilityQueryActive(projectId);
	const bulkActive = useBulkUpdateVisibilityQueriesActive(projectId);
	const bulkDelete = useBulkDeleteVisibilityQueries(projectId);
	const duplicateQ = useDuplicateVisibilityQuery(projectId);
	const updateQ = useUpdateVisibilityQuery(projectId);
	// Pending delete confirmation (replaces the tab-blocking native confirm()). `bulk` distinguishes
	// a per-row delete from a "Delete selected" action so the dialog copy + handler branch correctly.
	const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; bulk: boolean } | null>(null);
	const runDelete = () => {
		if (!confirmDelete) return;
		const { ids, bulk } = confirmDelete;
		const done = () => {
			setConfirmDelete(null);
			if (bulk) setSelectedIds(new Set());
		};
		if (bulk) void bulkDelete.mutateAsync(ids).then(done, done);
		else if (ids[0]) void delQ.mutateAsync(ids[0]).then(done, done);
		else done();
	};

	useEffect(() => {
		gen.reset();
		runQ.reset();
		runBatch.reset();
		insertQ.reset();
		batchQ.reset();
		delQ.reset();
		toggleActive.reset();
		bulkActive.reset();
		duplicateQ.reset();
		updateQ.reset();
		setEditingId(null);
	}, [projectId]);

	const [text, setText] = useState('');
	const [intent, setIntent] = useState<QueryIntentType>('category');
	const visibilityPromptsCap = useMemo(
		() => (canUseEngine ? resolveVisibilityPromptsCap(currentPlan) : 0),
		[canUseEngine, currentPlan],
	);
	const batchSizeOptions = useMemo(
		() => buildVisibilityBatchSizeOptions(visibilityPromptsCap),
		[visibilityPromptsCap],
	);
	const [batchCount, setBatchCount] = useState(DEFAULT_VISIBILITY_BATCH_SIZE);
	const [dfsLimit, setDfsLimit] = useState<number>(DFS_LLM_MENTIONS_LIMIT_DEFAULT);
	const [llmMatchType, setLlmMatchType] = useState<'word_match' | 'partial_match'>('word_match');
	const [preferBrandSources, setPreferBrandSources] = useState(false);
	const [activeOnly, setActiveOnly] = useState(false);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
	const [batchSummary, setBatchSummary] = useState<{ ok: number; total: number } | null>(null);
	const [pendingQueryId, setPendingQueryId] = useState<string | null>(null);
	const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
	// Inline edit of a prompt's text + intent (previously you could only duplicate or delete).
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editText, setEditText] = useState('');
	const [editIntent, setEditIntent] = useState<QueryIntentType>('category');
	const [editLanguage, setEditLanguage] = useState<string>('en');
	const startEdit = (id: string, text: string, intentType: QueryIntentType, language?: string | null) => {
		setEditingId(id);
		setEditText(text);
		setEditIntent(intentType);
		setEditLanguage(normalizeContentLanguage(language));
	};
	const saveEdit = () => {
		if (!editingId || !editText.trim()) return;
		void updateQ.mutateAsync({ id: editingId, text: editText, intent_type: editIntent, language: editLanguage }).then(() => setEditingId(null));
	};
	const [promptSearch, setPromptSearch] = useState('');
	const [starterPackError, setStarterPackError] = useState<string | null>(null);
	const [addNotice, setAddNotice] = useState<string | null>(null);
	const [bulkOp, setBulkOp] = useState<null | 'activate' | 'deactivate'>(null);
	const headerSelectAllRef = useRef<HTMLInputElement>(null);

	// Same precedence as the query generator: the content language wins; primary_language is a UI
	// default ('en' in the DB) and used to tag Italian questions as English.
	const lang = normalizeContentLanguage(project?.language || project?.primary_language || 'en');
	const brandName = brands[0]?.name || project?.name || (prefersEnglishUi(lang) ? 'your brand' : 'il tuo brand');
	const compNames = comps.map((c) => c.name).filter(Boolean);
	const seeds = Array.isArray(project?.seed_keywords) ? (project.seed_keywords as string[]) : [];

	useEffect(() => {
		setBatchCount((prev) => {
			const nextDefault = defaultVisibilityBatchSize(visibilityPromptsCap);
			if (visibilityPromptsCap <= 0) return 0;
			if (batchSizeOptions.length === 0) return 0;
			if (batchSizeOptions.includes(prev)) return prev;
			if (prev > 0) return clampVisibilityBatchSize(prev, visibilityPromptsCap);
			return nextDefault;
		});
	}, [visibilityPromptsCap, batchSizeOptions]);

	const queriesAfterActiveFilter = useMemo(
		() => (activeOnly ? queries.filter((q) => q.is_active) : queries),
		[queries, activeOnly],
	);
	const visibleQueries = useMemo(() => {
		const q = promptSearch.trim().toLowerCase();
		if (!q) return queriesAfterActiveFilter;
		return queriesAfterActiveFilter.filter((row) => row.text.toLowerCase().includes(q));
	}, [queriesAfterActiveFilter, promptSearch]);

	const openQueryReceipts = (queryId: string) => {
		setReceiptsQueryId(queryId);
		setExpandedQueryId(queryId);
	};

	// Existing prompt texts (normalized) — dedup manual + starter-pack inserts so the same
	// question isn't stored and run (and billed) twice. Backend generation already dedups.
	const existingNormalized = useMemo(
		() => new Set(queries.map((q) => q.text.trim().toLowerCase())),
		[queries],
	);

	const handleAdd = async () => {
		const value = text.trim();
		if (!value) return;
		if (existingNormalized.has(value.toLowerCase())) {
			setAddNotice(t('visibility.promptAlreadyExists'));
			return;
		}
		setAddNotice(null);
		await insertQ.mutateAsync({
			text: value,
			language: lang,
			intent_type: intent,
			vertical: project?.vertical ?? null,
		});
		setText('');
	};

	const addStarterPack = async () => {
		setStarterPackError(null);
		const pack = buildStarterPromptsForVertical(
			project?.vertical ?? 'ecommerce',
			lang,
			brandName,
			compNames,
			seeds,
		);
		if (!pack.ok) {
			setStarterPackError(
				pack.reason === 'missing_category_seed'
					? t('visibility.starterPackNeedCategory')
					: t('visibility.starterPackWarnBrand'),
			);
			return;
		}
		const freshPrompts = pack.prompts.filter((s) => !existingNormalized.has(s.text.trim().toLowerCase()));
		if (freshPrompts.length === 0) {
			setStarterPackError(t('visibility.starterPackAllExist'));
			return;
		}
		await batchQ.mutateAsync({
			rows: freshPrompts.map((s) => ({ ...s, language: lang })),
			vertical: pack.vertical,
		});
	};

	const toggleSelect = (id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const selectAllVisible = () => {
		const ids = visibleQueries.map((q) => q.id);
		const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
		if (allSelected) {
			setSelectedIds((prev) => {
				const next = new Set(prev);
				for (const id of ids) next.delete(id);
				return next;
			});
		} else {
			setSelectedIds((prev) => {
				const next = new Set(prev);
				for (const id of ids) next.add(id);
				return next;
			});
		}
	};

	const selectedForRun = useMemo(() => {
		const ids = [...selectedIds].filter((id) => visibleQueries.some((q) => q.id === id && q.is_active));
		return ids.slice(0, VISIBILITY_BATCH_MAX_QUERIES);
	}, [selectedIds, visibleQueries]);

	const selectedActiveTotal = useMemo(
		() => [...selectedIds].filter((id) => visibleQueries.some((q) => q.id === id && q.is_active)).length,
		[selectedIds, visibleQueries],
	);

	const selectedInView = useMemo(
		() => [...selectedIds].filter((id) => visibleQueries.some((q) => q.id === id)),
		[selectedIds, visibleQueries],
	);

	const headerAllSelected =
		visibleQueries.length > 0 && visibleQueries.every((q) => selectedIds.has(q.id));

	useLayoutEffect(() => {
		const el = headerSelectAllRef.current;
		if (!el) return;
		const n = visibleQueries.length;
		const selectedOnPage = visibleQueries.filter((q) => selectedIds.has(q.id)).length;
		el.indeterminate = n > 0 && selectedOnPage > 0 && selectedOnPage < n;
	}, [visibleQueries, selectedIds]);

	const intentOptions: Array<{ value: QueryIntentType; label: string }> = [
		{ value: 'brand', label: t('visibility.intentBrand') },
		{ value: 'category', label: t('visibility.intentCategory') },
		{ value: 'comparison', label: t('visibility.intentComparison') },
		{ value: 'use_case', label: t('visibility.intentUseCase') },
		{ value: 'problem', label: t('visibility.intentProblem') },
	];

	const errorMessages = [
		runQ.isError && ((runQ.error as Error)?.message || String(runQ.error)),
		batchQ.isError && ((batchQ.error as Error)?.message || String(batchQ.error)),
		runBatch.isError && ((runBatch.error as Error)?.message || String(runBatch.error)),
		duplicateQ.isError && ((duplicateQ.error as Error)?.message || String(duplicateQ.error)),
		bulkActive.isError && ((bulkActive.error as Error)?.message || String(bulkActive.error)),
	].filter(Boolean) as string[];

	const generateError = gen.isError ? gen.error : null;
	const generatePlanRequired = generateError != null && isVisibilityPlanRequired(generateError);
	const generateBudgetBlocked = generateError != null && isVisibilityBudgetBlocked(generateError);
	const generateErrorMessage =
		generateError != null ? visibilityGenerateErrorMessage(t, generateError) : null;

	const setupPhase = useMemo(
		() => resolveVisibilitySetupPhase(queries.length, runs),
		[queries.length, runs],
	);

	const activeQueryIds = useMemo(
		() =>
			queries
				.filter((q) => q.is_active)
				.map((q) => q.id)
				.slice(0, VISIBILITY_BATCH_MAX_QUERIES),
		[queries],
	);

	const runChecks = (queryIds: string[]) => {
		if (queryIds.length === 0) return;
		setBatchSummary(null);
		runBatch.mutate(
			{
				queryIds,
				providers: readEnginesToRun(project),
				dfsLimit,
				matchType: llmMatchType,
				preferBrandSources,
			},
			{
				onSuccess: (data) => {
					setBatchSummary({
						ok: data.filter((r) => r.success).length,
						total: data.length,
					});
				},
			},
		);
	};

	const handleGenerateBatch = () => {
		if (!canUseEngine) {
			trialModal.openTrialModal({ headline: t('trial.headlineVisibilityGenerate') });
			return;
		}
		if (batchCount <= 0) return;
		gen.mutate(batchCount);
	};

	const guidedPrimaryAction =
		setupPhase === 'empty' ? (
			<Button variant="primary" loading={gen.isPending} disabled={batchCount <= 0 && canUseEngine} onClick={handleGenerateBatch}>
				{t('visibility.guidedCtaGenerate')}
			</Button>
		) : setupPhase === 'configured' ? (
			<Button
				variant="primary"
				disabled={activeQueryIds.length === 0 || runBatch.isPending}
				loading={runBatch.isPending}
				onClick={() => {
					setSelectedIds(new Set(activeQueryIds));
					runChecks(activeQueryIds);
				}}
			>
				{t('visibility.guidedCtaRunFirstCheck')}
			</Button>
		) : setupPhase === 'pending_data' ? (
			<Button
				variant="secondary"
				disabled={activeQueryIds.length === 0 || runBatch.isPending}
				loading={runBatch.isPending}
				onClick={() => runChecks(activeQueryIds)}
			>
				{t('visibility.guidedCtaRetryCheck')}
			</Button>
		) : null;

	const handleExportCsv = () => {
		const csv = toCsv(queries, [
			{ header: 'Prompt', value: (q) => q.text },
			{ header: 'Intent', value: (q) => q.intent_type ?? '' },
			{ header: 'Active', value: (q) => (q.is_active ? 'yes' : 'no') },
		]);
		downloadText(`rankdelta-visibility-prompts-${projectId.slice(0, 8)}.csv`, csv);
	};

	return (
		<div className="space-y-8">
			<header className="flex items-start justify-between gap-4">
				<div className="space-y-1">
					<p className="text-white/40 text-xs tracking-[0.18em] uppercase">{t('visibility.promptsTitle')}</p>
					<h2 className="text-2xl font-bold text-white">{t('visibility.promptsTitle')}</h2>
					<p className="text-sm text-white/50 max-w-2xl leading-relaxed">{t('visibility.promptsSubtitleEcom')}</p>
				</div>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					disabled={queries.length === 0}
					onClick={handleExportCsv}
					className="shrink-0"
				>
					{t('visibility.queriesExportCsv')}
				</Button>
			</header>

			<VisibilityGuidedFlow
				projectId={projectId}
				phase={setupPhase}
				primaryAction={guidedPrimaryAction}
				compact={setupPhase === 'measured'}
			/>

			{setupPhase === 'empty' && visibilityPromptsCap > 0 && (
				<p className="text-xs text-white/45 -mt-4">
					{t('visibility.batchSizePlanHint', { selected: batchCount, cap: visibilityPromptsCap })}
				</p>
			)}

			{needsApiActivation && (
				<div
					className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 space-y-1.5"
					role="alert"
				>
					<p className="font-semibold">{t('visibility.activationTitle')}</p>
					<p className="text-amber-200/80">
						{t('visibility.activationBody')}
					</p>
				</div>
			)}

			{errorMessages.length > 0 && (
				<div
					className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300 space-y-1"
					role="alert"
					aria-live="assertive"
				>
					{errorMessages.map((msg, i) => (
						<p key={i}>{msg}</p>
					))}
				</div>
			)}

			{generateErrorMessage && (
				<div
					className={`rounded-xl border px-4 py-3 text-sm space-y-2 ${
						generatePlanRequired
							? 'border-violet-500/30 bg-violet-500/10 text-violet-100'
							: generateBudgetBlocked
								? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
								: 'border-rose-500/30 bg-rose-500/10 text-rose-200'
					}`}
					role="alert"
				>
					<p>
						{generatePlanRequired
							? t('visibility.generatePlanRequired')
							: generateErrorMessage}
					</p>
					{generatePlanRequired && (
						<Button
							type="button"
							variant="primary"
							size="sm"
							onClick={() =>
								trialModal.openTrialModal({ headline: t('trial.headlineVisibilityGenerate') })
							}
						>
							{t('visibility.generatePlanRequiredCta')}
						</Button>
					)}
				</div>
			)}

			<details
				className="group rounded-2xl border border-white/[0.08] bg-white/[0.02]"
				open={setupPhase === 'measured'}
			>
				<summary className="flex items-center gap-2 cursor-pointer select-none list-none px-5 py-4 text-sm font-semibold text-white/70 hover:text-white transition-colors">
					<svg className="w-4 h-4 transition-transform group-open:rotate-90" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
					{t('visibility.advancedSettingsAll')}
				</summary>
				<div className="px-5 pb-5 space-y-6 border-t border-white/[0.06] pt-5">
			<section aria-labelledby="visibility-generate-heading" className="space-y-3">
				<h3 id="visibility-generate-heading" className="text-sm font-semibold text-white/70">
					{t('visibility.sectionGenerate')}
				</h3>
				<div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-5 space-y-4">
					<div className="space-y-4">
							<div className="flex flex-wrap items-end gap-4">
								<label className="flex flex-col gap-1.5 text-xs font-medium text-white/60">
									<span>{t('visibility.batchSize')}</span>
									<select
										className={NATIVE_CONTROL}
										value={batchSizeOptions.length > 0 ? batchCount : ''}
										disabled={batchSizeOptions.length === 0}
										onChange={(e) => setBatchCount(Number(e.target.value))}
									>
										{batchSizeOptions.length === 0 ? (
											<option value="">—</option>
										) : (
											batchSizeOptions.map((n) => (
												<option key={n} value={n}>
													{n}
												</option>
											))
										)}
									</select>
									<span className="text-[11px] text-white/40">
										{visibilityPromptsCap > 0
											? t('visibility.batchSizePlanHint', {
													selected: batchCount,
													cap: visibilityPromptsCap,
												})
											: t('visibility.batchSizeNoPlan')}
									</span>
								</label>
								<Button
									variant="secondary"
									loading={gen.isPending}
									disabled={batchCount <= 0 && canUseEngine}
									onClick={handleGenerateBatch}
								>
									{t('visibility.generateBatch')}
								</Button>
							</div>
							<details className="group rounded-xl border border-white/[0.06] bg-white/[0.015]">
								<summary className="flex items-center gap-2 cursor-pointer select-none list-none px-4 py-2.5 text-xs font-medium text-white/50 hover:text-white/80 transition-colors">
									<svg className="w-3.5 h-3.5 transition-transform group-open:rotate-90" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
									{t('visibility.advancedSettings')}
								</summary>
								<div className="px-4 pb-4 pt-1 space-y-4">
									<div className="flex flex-wrap items-end gap-4">
										<label className="flex flex-col gap-1.5 text-xs font-medium text-white/60">
											<span>{t('visibility.dfsLimitLabel')}</span>
											<select
												className={NATIVE_CONTROL}
												value={dfsLimit}
												onChange={(e) => setDfsLimit(Number(e.target.value))}
											>
												{DFS_LLM_MENTIONS_LIMIT_OPTIONS.map((n) => (
													<option key={n} value={n}>
														{n}
													</option>
												))}
											</select>
										</label>
										<label className="flex flex-col gap-1.5 text-xs font-medium text-white/60">
											<span>{t('visibility.llmMatchTypeLabel')}</span>
											<select
												className={NATIVE_CONTROL}
												value={llmMatchType}
												onChange={(e) =>
													setLlmMatchType(e.target.value as 'word_match' | 'partial_match')
												}
											>
												<option value="word_match">{t('visibility.llmMatchTypeWord')}</option>
												<option value="partial_match">{t('visibility.llmMatchTypePartial')}</option>
											</select>
										</label>
									</div>
									<label className="flex items-start gap-2 text-xs text-white/60 max-w-xl cursor-pointer">
										<input
											type="checkbox"
											className="mt-0.5 h-4 w-4 rounded border-white/20 text-violet-400 focus:ring-violet-500/30"
											checked={preferBrandSources}
											onChange={(e) => setPreferBrandSources(e.target.checked)}
										/>
										<span>{t('visibility.llmPreferBrandSources')}</span>
									</label>
									<p className="text-xs text-white/40 leading-relaxed border-t border-white/[0.06] pt-3">
										{t('visibility.dfsLimitHelp')}
									</p>
								</div>
							</details>
					</div>
				</div>
			</section>

			<div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.06] p-5 space-y-3">
				<h3 className="font-medium text-white">{t('visibility.starterPackTitle')}</h3>
				<p className="text-sm text-white/50">{t('visibility.starterPackBody')}</p>
				<Button variant="primary" loading={batchQ.isPending} onClick={() => void addStarterPack()}>
					{t('visibility.starterPackCta')}
				</Button>
				{brands.length === 0 && (
					<p className="text-xs text-amber-400">{t('visibility.starterPackWarnBrand')}</p>
				)}
				{starterPackError && (
					<p className="text-xs text-amber-400" role="alert">{starterPackError}</p>
				)}
			</div>

			<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
				<h3 className="font-medium text-white">{t('visibility.addManual')}</h3>
				<div className="flex flex-col md:flex-row gap-3">
					<Input
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder={t('visibility.promptPlaceholderEcom')}
						className="flex-1 min-h-11"
					/>
					<select
						value={intent}
						onChange={(e) => setIntent(e.target.value as QueryIntentType)}
						className={`${NATIVE_CONTROL} min-w-[180px]`}
					>
						{intentOptions.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</select>
					<Button onClick={() => void handleAdd()} loading={insertQ.isPending}>
						{t('common.save')}
					</Button>
				</div>
				{addNotice && (
					<p className="text-xs text-amber-400" role="alert">{addNotice}</p>
				)}
			</div>

			<section aria-labelledby="visibility-library-heading" className="space-y-3">
				<h3 id="visibility-library-heading" className="text-sm font-semibold text-white/70">
					{t('visibility.sectionPromptLibrary')}
				</h3>
				<div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 sm:p-5 space-y-3">
					<div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
						<label className="sr-only" htmlFor="visibility-prompt-search">
							{t('visibility.searchPromptsLabel')}
						</label>
						<Input
							id="visibility-prompt-search"
							value={promptSearch}
							onChange={(e) => setPromptSearch(e.target.value)}
							placeholder={t('visibility.searchPromptsPlaceholder')}
							className="flex-1"
							type="search"
							autoComplete="off"
						/>
						{promptSearch.trim() !== '' && (
							<Button type="button" variant="ghost" size="sm" onClick={() => setPromptSearch('')}>
								{t('visibility.clearSearch')}
							</Button>
						)}
					</div>
					<div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 sm:gap-4">
						<label className="inline-flex items-center gap-2.5 text-sm text-white/80 cursor-pointer select-none min-h-11">
							<input
								type="checkbox"
								checked={activeOnly}
								onChange={(e) => {
									setActiveOnly(e.target.checked);
									setSelectedIds(new Set());
								}}
								className="h-4 w-4 rounded border-white/20 text-violet-400 focus:ring-violet-500/30"
							/>
							{t('visibility.filterActiveOnly')}
						</label>
						<div className="hidden sm:block h-6 w-px bg-white/10 shrink-0" aria-hidden />
						<p className="text-sm text-white/60">
							{t('visibility.selectionSummarySimple', {
								selected: selectedIds.size,
								willRun: selectedForRun.length,
								max: VISIBILITY_BATCH_MAX_QUERIES,
							})}
						</p>
						{selectedActiveTotal > VISIBILITY_BATCH_MAX_QUERIES && (
							<p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 w-full sm:w-auto">
								{t('visibility.batchTruncationNote', { max: VISIBILITY_BATCH_MAX_QUERIES })}
							</p>
						)}
						{selectedInView.length > 0 && (
							<div className="flex flex-wrap gap-2 w-full sm:w-auto sm:ml-0">
								<Button
									type="button"
									variant="secondary"
									size="sm"
									disabled={bulkActive.isPending}
									loading={bulkActive.isPending && bulkOp === 'activate'}
									onClick={() => {
										setBulkOp('activate');
										bulkActive.mutate(
											{ ids: selectedInView, is_active: true },
											{ onSettled: () => setBulkOp(null) },
										);
									}}
								>
									{t('visibility.bulkActivate', { count: selectedInView.length })}
								</Button>
								<Button
									type="button"
									variant="secondary"
									size="sm"
									disabled={bulkActive.isPending}
									loading={bulkActive.isPending && bulkOp === 'deactivate'}
									onClick={() => {
										setBulkOp('deactivate');
										bulkActive.mutate(
											{ ids: selectedInView, is_active: false },
											{ onSettled: () => setBulkOp(null) },
										);
									}}
								>
									{t('visibility.bulkDeactivate', { count: selectedInView.length })}
								</Button>
								<Button
									type="button"
									variant="danger"
									size="sm"
									disabled={bulkDelete.isPending}
									loading={bulkDelete.isPending}
									onClick={() => setConfirmDelete({ ids: selectedInView, bulk: true })}
								>
									{t('visibility.deleteSelected', { count: selectedInView.length })}
								</Button>
							</div>
						)}
						<div className="flex flex-wrap gap-2 sm:ml-auto">
							<Button
								variant="primary"
								size="sm"
								disabled={selectedForRun.length === 0 || runBatch.isPending}
								loading={runBatch.isPending}
								onClick={() => runChecks(selectedForRun)}
							>
								{t('visibility.runSelected', {
									count: selectedForRun.length,
									max: VISIBILITY_BATCH_MAX_QUERIES,
								})}
							</Button>
						</div>
					</div>
					<p className="text-xs text-white/40 leading-relaxed">{t('visibility.batchRunHint', { max: VISIBILITY_BATCH_MAX_QUERIES })}</p>
				</div>
			</section>
				</div>
			</details>

			{queries.length > 0 && (
				<section aria-labelledby="visibility-questions-list" className="space-y-3">
					<div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
						<div>
							<h3 id="visibility-questions-list" className="text-sm font-semibold text-white/70">
								{t('visibility.yourTrackingQuestions')}
							</h3>
							<p className="text-xs text-white/40 mt-0.5">{t('visibility.yourTrackingQuestionsHint')}</p>
							{activeQueryIds.length > 0 && (
								<p className="text-xs text-white/55 mt-1.5">
									{t('visibility.trackingSummary', { count: activeQueryIds.length, language: langName(lang) })}
								</p>
							)}
						</div>
						{setupPhase === 'configured' && (
							<Button
								variant="primary"
								size="sm"
								disabled={activeQueryIds.length === 0 || runBatch.isPending}
								loading={runBatch.isPending}
								onClick={() => {
									setSelectedIds(new Set(activeQueryIds));
									runChecks(activeQueryIds);
								}}
							>
								{t('visibility.guidedCtaRunFirstCheck')}
							</Button>
						)}
					</div>

			{batchSummary && (
				<div
					className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
					role="status"
					aria-live="polite"
				>
					<span>{t('visibility.batchRunSummary', { ok: batchSummary.ok, total: batchSummary.total })}</span>
					<button
						type="button"
						className="text-left sm:text-right font-semibold text-emerald-400 underline decoration-emerald-400 underline-offset-2 hover:text-emerald-950 min-h-11 sm:min-h-0"
						onClick={() => setBatchSummary(null)}
					>
						{t('common.close')}
					</button>
				</div>
			)}

			<div className="rounded-2xl overflow-hidden border border-white/[0.08]">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<caption className="sr-only">{t('visibility.promptsTableCaption')}</caption>
						<thead className="bg-white/[0.04] border-b border-white/[0.08] text-left text-white/50">
							<tr>
								<th className="px-3 py-3.5 w-12">
									<input
										ref={headerSelectAllRef}
										type="checkbox"
										aria-label={t('visibility.selectAllVisible')}
										checked={headerAllSelected}
										onChange={() => selectAllVisible()}
										className="h-4 w-4 rounded border-white/20 text-violet-400 focus:ring-violet-500/30"
									/>
								</th>
								<th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">
									{t('visibility.colActive')}
								</th>
								<th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">
									{t('visibility.colPrompt')}
								</th>
								<th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">
									{t('visibility.colIntent')}
								</th>
								<th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">
									{t('visibility.colLang')}
								</th>
								<th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">
									{t('visibility.colVisibility')}
								</th>
								<th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide text-right">
									{t('visibility.colActions')}
								</th>
							</tr>
						</thead>
						<tbody>
							{isLoading ? (
								<tr>
									<td colSpan={7} className="px-4 py-8 text-center text-white/40">
										{t('common.loading')}
									</td>
								</tr>
							) : visibleQueries.length === 0 ? (
								<tr>
									<td colSpan={7} className="px-4 py-8 text-center text-white/40">
										{queries.length === 0
											? t('visibility.noPrompts')
											: queriesAfterActiveFilter.length === 0
												? t('visibility.noActivePrompts')
												: t('visibility.noSearchMatches')}
									</td>
								</tr>
							) : (
								visibleQueries.flatMap((q) => {
									const tracked = queryStatus.has(q.id);
									const expanded = expandedQueryId === q.id;
									const rows = [
										<tr
											key={q.id}
											className="border-t border-white/[0.06] hover:bg-white/[0.04] transition-colors"
										>
										<td className="px-3 py-3 align-top">
											<input
												type="checkbox"
												checked={selectedIds.has(q.id)}
												onChange={() => toggleSelect(q.id)}
												className="h-4 w-4 rounded border-white/20 text-violet-400 focus:ring-violet-500/30"
												aria-label={t('visibility.selectPromptRow', { text: q.text.slice(0, 80) })}
											/>
										</td>
										<td className="px-4 py-3 align-top">
											<label className="inline-flex items-center gap-2 cursor-pointer min-h-11">
												<input
													type="checkbox"
													checked={q.is_active}
													disabled={toggleActive.isPending}
													onChange={(e) =>
														void toggleActive.mutateAsync({ id: q.id, is_active: e.target.checked })
													}
													className="h-4 w-4 rounded border-white/20 text-violet-400 focus:ring-violet-500/30"
												/>
												<span className="sr-only">{t('visibility.toggleActive')}</span>
											</label>
										</td>
										<td className="px-4 py-3 text-white max-w-md align-top">
											{editingId === q.id ? (
												<div className="space-y-2">
													<textarea
														value={editText}
														onChange={(e) => setEditText(e.target.value)}
														onKeyDown={(e) => {
															if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit();
															if (e.key === 'Escape') setEditingId(null);
														}}
														rows={2}
														autoFocus
														disabled={updateQ.isPending}
														className="w-full rounded-lg bg-white/[0.04] border border-white/[0.15] px-2 py-1.5 text-sm text-white focus:outline-none focus:border-violet-500/50"
													/>
													<div className="flex items-center gap-2">
														<Button size="sm" variant="primary" loading={updateQ.isPending} disabled={!editText.trim() || updateQ.isPending} onClick={saveEdit}>
															{t('common.save')}
														</Button>
														<Button size="sm" variant="ghost" disabled={updateQ.isPending} onClick={() => setEditingId(null)}>
															{t('common.cancel')}
														</Button>
													</div>
												</div>
											) : (
												<div className="flex items-start gap-2 min-w-0">
													{tracked && receiptsEnabled && (
														<button
															type="button"
															onClick={() => setExpandedQueryId(expanded ? null : q.id)}
															className="mt-0.5 shrink-0 rounded-md p-1 text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
															aria-expanded={expanded}
															aria-label={t('visibility.queryExpandRow')}
														>
															{expanded ? (
																<ChevronDownIcon className="w-4 h-4" strokeWidth={2} />
															) : (
																<ChevronRightIcon className="w-4 h-4" strokeWidth={2} />
															)}
														</button>
													)}
													<span className="min-w-0">{q.text}</span>
												</div>
											)}
										</td>
										<td className="px-4 py-3 text-white/60 align-top">
											{editingId === q.id ? (
												<select
													value={editIntent}
													onChange={(e) => setEditIntent(e.target.value as QueryIntentType)}
													disabled={updateQ.isPending}
													className="rounded-lg bg-white/[0.04] border border-white/[0.15] px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500/50"
												>
													{intentOptions.map((o) => (
														<option key={o.value} value={o.value} className="bg-[#111]">
															{o.label}
														</option>
													))}
												</select>
											) : (
												intentOptions.find((o) => o.value === q.intent_type)?.label ?? q.intent_type
											)}
										</td>
										<td className="px-4 py-3 text-white/60 align-top">
											{editingId === q.id ? (
												<select
													value={editLanguage}
													onChange={(e) => setEditLanguage(e.target.value)}
													disabled={updateQ.isPending}
													className="rounded-lg bg-white/[0.04] border border-white/[0.15] px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500/50"
												>
													{CONTENT_LANGUAGES.map((code) => (
														<option key={code} value={code} className="bg-[#111]">
															{langName(code)}
														</option>
													))}
												</select>
											) : (
												q.language
											)}
										</td>
										<td className="px-4 py-3 align-top whitespace-nowrap">
											{(() => {
												const st = queryStatus.get(q.id);
												if (st === 'cited')
													return <span title={t('visibility.queryVisibilityCitedTitle')}><Badge variant="success" size="sm">{t('visibility.runOutcomeCited')}</Badge></span>;
												if (st === 'mentioned')
													return <span title={t('visibility.queryVisibilityMentionedTitle')}><Badge variant="primary" size="sm">{t('visibility.runOutcomeMentioned')}</Badge></span>;
												if (st === 'absent')
													return (
														<div className="flex flex-col items-start gap-1.5">
															<span title={t('visibility.queryVisibilityAbsentTitle')}><Badge variant="warning" size="sm">{t('visibility.queryVisibilityAbsent')}</Badge></span>
															<Link
																to="/content/generate"
																search={{ topic: q.text } as Record<string, string>}
																className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-300 hover:text-violet-200 transition-colors"
															>
																{t('visibility.queryVisibilityGenerateCta')}
															</Link>
														</div>
													);
												return <span className="text-white/30" title={t('visibility.queryVisibilityUntrackedTitle')}>{t('visibility.queryVisibilityUntracked')}</span>;
											})()}
										</td>
										<td className="px-4 py-3 text-right align-top">
											<div className="flex flex-wrap gap-2 justify-end">
											{receiptsEnabled && tracked && (
												<Button
													size="sm"
													variant="secondary"
													onClick={() => openQueryReceipts(q.id)}
												>
													{t('visibility.queryViewAnswer')}
												</Button>
											)}
											<Button
												size="sm"
												variant="primary"
												disabled={!q.is_active || runBatch.isPending}
												loading={runQ.isPending && pendingQueryId === q.id}
												onClick={() => {
													setPendingQueryId(q.id);
													runQ.mutate(
														{
															queryId: q.id,
															providers: readEnginesToRun(project),
															dfsLimit,
															matchType: llmMatchType,
															preferBrandSources,
														},
														{ onSettled: () => setPendingQueryId(null) },
													);
												}}
											>
												{t('visibility.run')}
											</Button>
											<Button
												size="sm"
												variant="ghost"
												className="text-white/60 hover:text-white"
												disabled={editingId === q.id}
												onClick={() => startEdit(q.id, q.text, q.intent_type, q.language)}
											>
												{t('common.edit')}
											</Button>
											<Button
												size="sm"
												variant="secondary"
												disabled={duplicateQ.isPending}
												loading={duplicateQ.isPending && duplicatingId === q.id}
												onClick={() => {
													setDuplicatingId(q.id);
													duplicateQ.mutate(
														{
															source: q,
															text: `${q.text}${t('visibility.duplicateSuffix')}`,
														},
														{ onSettled: () => setDuplicatingId(null) },
													);
												}}
											>
												{t('visibility.duplicate')}
											</Button>
											<Button
												size="sm"
												variant="danger"
												onClick={() => setConfirmDelete({ ids: [q.id], bulk: false })}
											>
												{t('common.delete')}
											</Button>
											</div>
										</td>
									</tr>,
									];
									if (expanded && tracked && receiptsEnabled) {
										rows.push(
											<tr key={`${q.id}-detail`} className="border-t border-white/[0.04] bg-white/[0.02]">
												<td colSpan={7} className="px-4 py-3">
													<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pl-8">
														<p className="text-sm text-white/55 max-w-2xl leading-relaxed">
															{t('visibility.queryExpandedHint')}
														</p>
														<Button size="sm" variant="primary" onClick={() => openQueryReceipts(q.id)}>
															{t('visibility.queryViewAnswer')}
														</Button>
													</div>
												</td>
											</tr>,
										);
									}
									return rows;
								})
							)}
						</tbody>
					</table>
				</div>
			</div>
				</section>
			)}

			<ConfirmDialog
				open={!!confirmDelete}
				title={confirmDelete?.bulk
					? t('visibility.confirmDeleteBulkTitle', { count: confirmDelete?.ids.length ?? 0 })
					: t('visibility.confirmDeleteTitle')}
				message={t('visibility.confirmDeleteBody')}
				confirmLabel={t('common.delete')}
				cancelLabel={t('common.cancel')}
				danger
				loading={bulkDelete.isPending || delQ.isPending}
				onConfirm={runDelete}
				onCancel={() => setConfirmDelete(null)}
			/>

			<trialModal.StartTrialModal />

			{receiptsEnabled && receiptsQueryId && (
				<AnswerReceiptsModal receipts={receipts} onClose={() => setReceiptsQueryId(null)} />
			)}
		</div>
	);
};

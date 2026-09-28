import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ArrowPathIcon, LinkIcon } from '@heroicons/react/24/outline';
import type { Project } from '../../types/database';
import { useGscProperty } from '../../hooks/useGscProperty';
import { useSerpRankLatestMap, useInsertSerpKeyword, useEnqueueSerpRankJobMutation } from '../../hooks/useSerpRankTracker';
import { StrikeDistancePanel } from '../analytics/StrikeDistancePanel';
import { CannibalizationReportSection } from '../visibility/CannibalizationReportSection';
import { CompareKeywordModal } from './CompareKeywordModal';
import { GscErrorLine } from './GscErrorLine';
import { Button } from '../ui/Button';

function OpportunityActions({
	phrase,
	projectId,
	siteMissing,
	onCompare,
	onGenerate,
}: {
	phrase: string;
	projectId: string;
	siteMissing: boolean;
	onCompare: () => void;
	onGenerate: () => void;
}) {
	const { t } = useTranslation();
	const insertK = useInsertSerpKeyword(projectId);
	const enqueueJob = useEnqueueSerpRankJobMutation(projectId);
	const { keywords } = useSerpRankLatestMap(projectId);

	const handleRefresh = () => {
		const existing = keywords.find((k) => k.phrase.trim().toLowerCase() === phrase.trim().toLowerCase());
		if (existing) {
			enqueueJob.mutate([existing.id]);
			return;
		}
		void insertK.mutateAsync(phrase).then((row) => {
			if (row?.id && !siteMissing) enqueueJob.mutate([row.id]);
		});
	};

	return (
		<div className="inline-flex flex-wrap items-center gap-1 justify-end">
			<Button size="sm" variant="ghost" className="text-white/60" disabled={siteMissing} onClick={handleRefresh}>
				<ArrowPathIcon className="w-3.5 h-3.5 mr-1" />
				{t('rankings.actionRefresh')}
			</Button>
			<Button size="sm" variant="ghost" className="text-violet-300" onClick={onCompare}>
				{t('rankings.actionCompare')}
			</Button>
			<Button size="sm" variant="ghost" className="text-emerald-300" onClick={onGenerate}>
				{t('rankings.actionGenerate')}
			</Button>
		</div>
	);
}

export function RankingsOpportunitiesTab({ project }: { project: Project }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const gsc = useGscProperty(project.id, project.website_url);
	const { keywords, latestByKeyword } = useSerpRankLatestMap(project.id);
	const [comparePhrase, setComparePhrase] = useState<string | null>(null);
	const siteMissing = !project.website_url?.trim();

	const goGenerate = (phrase: string) => {
		navigate({
			to: '/agent/$projectId',
			params: { projectId: project.id },
			search: { mode: 'generate', topic: phrase },
		});
	};

	if (!gsc.configured) {
		return (
			<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
				<h3 className="text-white font-semibold mb-2">{t('gsc.configRequiredTitle')}</h3>
				<p className="text-sm text-white/50">{t('rankings.opportunitiesGscRequired')}</p>
			</div>
		);
	}

	// Wait for the server's answer before offering to connect: the status is a
	// round trip away, and guessing "disconnected" is the reported bug.
	if (!gsc.connected && gsc.loading) {
		return (
			<div className="space-y-6" data-testid="gsc-status-loading">
				<div className="h-32 rounded-2xl bg-white/[0.04] animate-pulse" />
				<div className="h-64 rounded-2xl bg-white/[0.04] animate-pulse" />
			</div>
		);
	}

	if (!gsc.connected) {
		return (
			<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-4">
				<h3 className="text-white font-semibold">{t('rankings.opportunitiesConnectTitle')}</h3>
				<p className="text-sm text-white/50 max-w-xl">{t('rankings.opportunitiesConnectDesc')}</p>
				{/* Without this the reason a connect attempt failed — a closed popup, a
				    grant Google will not re-issue — was simply never shown here. */}
				{gsc.error && <GscErrorLine text={gsc.error} />}
				<Button variant="primary" loading={gsc.connecting} onClick={() => void gsc.handleConnect()}>
					{t('gsc.connectWithGoogle')}
				</Button>
				<CannibalizationReportSection
					project={project}
					keywords={keywords}
					latestByKeyword={latestByKeyword}
					renderActions={(phrase) => (
						<OpportunityActions
							phrase={phrase}
							projectId={project.id}
							siteMissing={siteMissing}
							onCompare={() => setComparePhrase(phrase)}
							onGenerate={() => goGenerate(phrase)}
						/>
					)}
				/>
			</div>
		);
	}

	return (
		<div className="space-y-8">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<span className="text-xs text-white/40">{t('gsc.property')}</span>
					<select
						value={gsc.property ?? ''}
						onChange={(e) => gsc.selectProperty(e.target.value)}
						className="rounded-lg bg-white/[0.04] border border-white/[0.1] px-3 py-1.5 text-sm text-white/80 focus:outline-none focus:border-violet-500/50"
					>
						{gsc.properties.map((p) => (
							<option key={p.siteUrl} value={p.siteUrl} className="bg-[#111]">
								{p.siteUrl}
							</option>
						))}
					</select>
				</div>
				<a
					href="https://search.google.com/search-console"
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white/70"
				>
					<LinkIcon className="w-3.5 h-3.5" />
					{t('rankings.openGsc')}
				</a>
			</div>

			{gsc.property && (
				<StrikeDistancePanel
					projectId={project.id}
					property={gsc.property}
					renderActions={(query) => (
						<OpportunityActions
							phrase={query}
							projectId={project.id}
							siteMissing={siteMissing}
							onCompare={() => setComparePhrase(query)}
							onGenerate={() => goGenerate(query)}
						/>
					)}
				/>
			)}

			<CannibalizationReportSection
				project={project}
				keywords={keywords}
				latestByKeyword={latestByKeyword}
				renderActions={(phrase) => (
					<OpportunityActions
						phrase={phrase}
						projectId={project.id}
						siteMissing={siteMissing}
						onCompare={() => setComparePhrase(phrase)}
						onGenerate={() => goGenerate(phrase)}
					/>
				)}
			/>

			{comparePhrase && (
				<CompareKeywordModal project={project} keyword={comparePhrase} onClose={() => setComparePhrase(null)} />
			)}
		</div>
	);
}

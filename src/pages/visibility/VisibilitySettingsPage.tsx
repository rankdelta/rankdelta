import { useState, useEffect } from 'react';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
	useTrackedBrands,
	useCompetitorBrands,
	useInsertTrackedBrand,
	useInsertCompetitor,
	useDeleteCompetitor,
	useDiscoverCompetitors,
	useUpdateTrackedBrand,
} from '../../hooks/useVisibilityTracker';
import { useProject, useUpdateProject } from '../../hooks/useProjects';
import type { DiscoveredCompetitor } from '../../services/competitorDiscovery';
import { SparklesIcon, PlusIcon } from '@heroicons/react/24/outline';
import { CONTENT_LANGUAGES, normalizeContentLanguage } from '../../lib/contentLanguages';
import type { WorkspaceMarket } from '../../types/database';
import { WorkspaceMarketSelectOptions } from '../../lib/workspaceMarkets';
import { DEFAULT_VISIBILITY_PROVIDERS, type VisibilityRunProvider } from '../../services/visibilityOps';
import { patchProjectMetadata, readEnginesToRun } from '../../lib/projectMetadata';
import { providerLabel } from '../../components/visibility/insightBlocks';

export const VisibilitySettingsPage = () => {
	const { t } = useTranslation();
	const qc = useQueryClient();
	const { projectId } = useParams({ strict: false }) as { projectId: string };
	const { data: project } = useProject(projectId);
	const { data: brands = [] } = useTrackedBrands(projectId);
	const { data: comps = [] } = useCompetitorBrands(projectId);
	const insertBrand = useInsertTrackedBrand(projectId);
	const updateBrand = useUpdateTrackedBrand(projectId);
	const insertComp = useInsertCompetitor(projectId);
	const delComp = useDeleteCompetitor(projectId);
	const updateProject = useUpdateProject();
	const discover = useDiscoverCompetitors();

	const proposals = ((discover.data as DiscoveredCompetitor[] | undefined) ?? []).filter(
		(p) => !comps.some((c) => (c.domain ?? '').toLowerCase().includes(p.domain) || c.name.toLowerCase() === p.name.toLowerCase()),
	);

	const runDiscover = () => {
		if (!project) return;
		const seeds = Array.isArray(project.seed_keywords) ? (project.seed_keywords as string[]) : [];
		const keyword = project.primary_keyword || seeds[0] || project.main_topic || undefined;
		discover.mutate({
			siteUrl: project.website_url ?? '',
			brandName: project.name,
			keyword,
			niche: project.main_topic || (project.vertical as string) || undefined,
			language: (project.language as string) || (project.primary_language as string) || 'it',
			market: project.market ?? undefined,
		});
	};

	const addProposal = (p: DiscoveredCompetitor) => insertComp.mutate({ name: p.name, domain: p.domain });
	const addAllProposals = () => proposals.forEach((p) => insertComp.mutate({ name: p.name, domain: p.domain }));

	const [bName, setBName] = useState('');
	const [bDomain, setBDomain] = useState('');
	const [bAliases, setBAliases] = useState('');
	const [cName, setCName] = useState('');
	const [cDomain, setCDomain] = useState('');
	const [seeds, setSeeds] = useState('');
	const [catalogNotes, setCatalogNotes] = useState('');
	const [engines, setEngines] = useState<VisibilityRunProvider[]>([...DEFAULT_VISIBILITY_PROVIDERS]);

	useEffect(() => {
		if (project?.seed_keywords && Array.isArray(project.seed_keywords)) {
			setSeeds((project.seed_keywords as string[]).join(', '));
		}
	}, [project?.seed_keywords]);

	useEffect(() => {
		setCatalogNotes(project?.catalog_notes ?? '');
	}, [project?.catalog_notes]);

	useEffect(() => {
		if (project) setEngines(readEnginesToRun(project));
	}, [project]);

	useEffect(() => {
		const brand = brands[0];
		if (brand) {
			setBAliases((brand.aliases || []).join(', '));
		}
	}, [brands]);

	const saveWorkspace = async () => {
		if (!project) return;
		const arr = seeds
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		await updateProject.mutateAsync({
			id: projectId,
			language: normalizeContentLanguage((project.language || project.primary_language) as string | undefined) || 'en',
			primary_language: normalizeContentLanguage((project.language || project.primary_language) as string | undefined) || 'en',
			market: project.market || 'IT',
			vertical: project.vertical || 'ecommerce',
			seed_keywords: arr,
			monthly_api_spend_cap_cents: project.monthly_api_spend_cap_cents ?? null,
			store_platform: project.store_platform ?? null,
			catalog_notes: catalogNotes.trim() || null,
		});
	};

	const saveEngines = async (next: VisibilityRunProvider[]) => {
		setEngines(next);
		await patchProjectMetadata(projectId, { engines_to_run: next });
		void qc.invalidateQueries({ queryKey: ['projects', projectId] });
	};

	const toggleEngine = (engine: VisibilityRunProvider) => {
		const next = engines.includes(engine)
			? engines.filter((e) => e !== engine)
			: [...engines, engine];
		if (next.length === 0) return;
		void saveEngines(next);
	};

	const setVertical = (vertical: 'saas' | 'ecommerce' | 'other') => {
		void updateProject.mutateAsync({ id: projectId, vertical });
	};

	const saveBrandAliases = () => {
		const brand = brands[0];
		if (!brand) return;
		const aliases = bAliases
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		void updateBrand.mutateAsync({ id: brand.id, aliases });
	};

	return (
		<div className="space-y-8 max-w-3xl">
			<div>
				<h2 className="text-lg font-semibold text-white">{t('visibility.settingsTitle')}</h2>
				<p className="text-sm text-white/60 mt-1">{t('visibility.settingsSubtitle')}</p>
			</div>

			<div className="rounded-2xl p-5 space-y-4 bg-white/[0.02] border border-white/[0.08]">
				<h3 className="font-medium text-white">{t('visibility.yourBrand')}</h3>
				{brands.length === 0 ? (
					<div className="flex flex-col sm:flex-row gap-2">
						<Input placeholder={t('visibility.brandName')} value={bName} onChange={(e) => setBName(e.target.value)} />
						<Input placeholder={t('visibility.domain')} value={bDomain} onChange={(e) => setBDomain(e.target.value)} />
						<Button
							onClick={() =>
								insertBrand.mutate({
									name: bName || project?.name || 'Brand',
									domain: bDomain || project?.website_url || null,
								})
							}
							loading={insertBrand.isPending}
						>
							{t('visibility.addBrand')}
						</Button>
					</div>
				) : (
					<div className="space-y-3">
						{brands.map((b) => (
							<div key={b.id} className="text-sm text-white/80 flex justify-between gap-2">
								<span className="font-medium">{b.name}</span>
								<span className="text-white/40 truncate">{b.domain}</span>
							</div>
						))}
						<label className="text-sm block">
							<span className="text-white/60 block mb-1">{t('visibility.brandAliases')}</span>
							<Input
								value={bAliases}
								onChange={(e) => setBAliases(e.target.value)}
								onBlur={() => saveBrandAliases()}
								placeholder={t('visibility.brandAliasesPlaceholder')}
							/>
						</label>
					</div>
				)}
			</div>

			<div className="rounded-2xl p-5 space-y-4 bg-white/[0.02] border border-white/[0.08]">
				<div className="flex items-center justify-between gap-3 flex-wrap">
					<h3 className="font-medium text-white">{t('visibility.competitors')}</h3>
					<button
						onClick={runDiscover}
						disabled={discover.isPending || !project?.website_url}
						className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-200 px-3.5 py-1.5 text-xs font-medium hover:bg-violet-500/25 transition-colors disabled:opacity-50"
						title={t('visibility.discoverCompetitorsTitle')}
					>
						<SparklesIcon className={`w-3.5 h-3.5 ${discover.isPending ? 'animate-pulse' : ''}`} strokeWidth={1.8} />
						{discover.isPending ? t('visibility.discoveringCompetitors') : t('visibility.discoverCompetitors')}
					</button>
				</div>

				{proposals.length > 0 && (
					<div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.05] p-3">
						<div className="flex items-center justify-between mb-2">
							<p className="text-xs text-white/60">{t('visibility.competitorsFoundReview')}</p>
							<button onClick={addAllProposals} className="text-xs font-medium text-violet-300 hover:text-violet-200">{t('visibility.addAll')}</button>
						</div>
						<ul className="space-y-1.5">
							{proposals.map((p) => (
								<li key={p.domain} className="flex items-center justify-between gap-2 text-sm">
									<span className="min-w-0"><span className="text-white/85">{p.name}</span><span className="text-white/35 ml-2 text-xs">{p.domain}</span></span>
									<button onClick={() => addProposal(p)} className="inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200 shrink-0"><PlusIcon className="w-3.5 h-3.5" /> {t('visibility.add')}</button>
								</li>
							))}
						</ul>
					</div>
				)}
				{discover.isSuccess && proposals.length === 0 && comps.length === 0 && (
					<p className="text-xs text-white/40">{t('visibility.noCompetitorsFound')}</p>
				)}
				<div className="flex flex-col sm:flex-row gap-2">
					<Input placeholder={t('visibility.competitorName')} value={cName} onChange={(e) => setCName(e.target.value)} />
					<Input placeholder={t('visibility.domain')} value={cDomain} onChange={(e) => setCDomain(e.target.value)} />
					<Button
						onClick={() => insertComp.mutate({ name: cName, domain: cDomain || null })}
						loading={insertComp.isPending}
						disabled={!cName.trim()}
					>
						{t('visibility.addCompetitor')}
					</Button>
				</div>
				<ul className="divide-y divide-white/[0.06] rounded-xl border-white/[0.06]">
					{comps.map((c) => (
						<li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
							<span>{c.name}</span>
							<button
								type="button"
								className="text-rose-400 hover:underline"
								onClick={() => void delComp.mutateAsync(c.id)}
							>
								{t('common.delete')}
							</button>
						</li>
					))}
				</ul>
			</div>

			<div className="rounded-2xl p-5 space-y-4 bg-white/[0.02] border border-white/[0.08]">
				<h3 className="font-medium text-white">{t('visibility.generationSettings')}</h3>
				<div className="grid sm:grid-cols-2 gap-4">
					<label className="text-sm">
						<span className="text-white/60 block mb-1">{t('visibility.primaryLanguage')}</span>
						<select
							className="w-full rounded-xl border-white/[0.08] px-3 py-2 bg-white/[0.04] text-white text-sm [&>option]:bg-[#1a1a1a] [&>option]:text-white"
							value={(project?.language as string) || (project?.primary_language as string) || 'en'}
							onChange={(e) =>
								void updateProject.mutateAsync({
									id: projectId,
									// Write both so the choice actually drives generation (language wins) and the
									// two columns never diverge — the root of the EN/IT prompt-duplication bug.
									language: normalizeContentLanguage(e.target.value),
									primary_language: normalizeContentLanguage(e.target.value),
								})
							}
						>
							{CONTENT_LANGUAGES.map((code) => (
								<option key={code} value={code}>{t(`contentLang.${code}`)}</option>
							))}
						</select>
					</label>
					<label className="text-sm">
						<span className="text-white/60 block mb-1">{t('visibility.market')}</span>
						<select
							className="w-full rounded-xl border-white/[0.08] px-3 py-2 bg-white/[0.04] text-white text-sm [&>option]:bg-[#1a1a1a] [&>option]:text-white"
							value={project?.market || 'IT'}
							onChange={(e) =>
								void updateProject.mutateAsync({
									id: projectId,
									market: e.target.value as WorkspaceMarket,
								})
							}
						>
							<WorkspaceMarketSelectOptions t={t} />
						</select>
					</label>
					<p className="text-xs text-white/40 sm:col-span-2">{t('visibility.usMarketHint')}</p>
					<label className="text-sm">
						<span className="text-white/60 block mb-1">{t('visibility.vertical')}</span>
						<select
							className="w-full rounded-xl border-white/[0.08] px-3 py-2 bg-white/[0.04] text-white text-sm [&>option]:bg-[#1a1a1a] [&>option]:text-white"
							value={project?.vertical || 'ecommerce'}
							onChange={(e) => setVertical(e.target.value as 'saas' | 'ecommerce' | 'other')}
						>
							<option value="ecommerce">{t('visibility.verticalEcommerce')}</option>
							<option value="saas">SaaS</option>
							<option value="other">{t('visibility.verticalOther')}</option>
						</select>
					</label>
					<label className="text-sm sm:col-span-2">
						<span className="text-white/60 block mb-1">{t('visibility.seedKeywords')}</span>
						<Input
							value={seeds || (Array.isArray(project?.seed_keywords) ? (project?.seed_keywords as string[]).join(', ') : '')}
							onChange={(e) => setSeeds(e.target.value)}
							onBlur={() => void saveWorkspace()}
							placeholder={t('visibility.seedPlaceholderEcom')}
						/>
					</label>
				</div>
			</div>

			<div className="rounded-2xl p-5 space-y-4 bg-white/[0.02] border border-white/[0.08]">
				<h3 className="font-medium text-white">{t('visibility.enginesToRunTitle')}</h3>
				<p className="text-sm text-white/50">{t('visibility.enginesToRunHint')}</p>
				<div className="flex flex-wrap gap-2">
					{DEFAULT_VISIBILITY_PROVIDERS.map((engine) => {
						const active = engines.includes(engine);
						return (
							<button
								key={engine}
								type="button"
								onClick={() => toggleEngine(engine)}
								className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors border ${
									active
										? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
										: 'text-white/50 border-white/[0.08] hover:text-white hover:bg-white/[0.04]'
								}`}
							>
								{providerLabel(t, engine)}
							</button>
						);
					})}
				</div>
			</div>

			<div className="rounded-2xl p-5 space-y-4 bg-white/[0.02] border border-white/[0.08]">
				<h3 className="font-medium text-white">{t('visibility.scheduleSectionTitle')}</h3>
				<label className="flex items-start gap-3 text-sm text-white/80 cursor-pointer">
					<input
						type="checkbox"
						className="mt-1 rounded border-white/20"
						checked={Boolean(project?.visibility_schedule_enabled)}
						onChange={(e) =>
							void updateProject.mutateAsync({
								id: projectId,
								visibility_schedule_enabled: e.target.checked,
							})
						}
					/>
					<span>{t('visibility.scheduleAutomatedRuns')}</span>
				</label>
				<label className="text-sm block">
					<span className="text-white/60 block mb-1">{t('visibility.refreshCadence')}</span>
					<select
						className="w-full max-w-md rounded-xl border-white/[0.08] px-3 py-2 bg-white/[0.04]"
						value={(project?.refresh_cadence as string) || 'weekly'}
						onChange={(e) =>
							void updateProject.mutateAsync({
								id: projectId,
								refresh_cadence: e.target.value as 'weekly' | 'every_3_days' | 'daily',
							})
						}
					>
						<option value="daily">{t('visibility.refreshCadenceDaily')}</option>
						<option value="every_3_days">{t('visibility.refreshCadenceEvery3Days')}</option>
						<option value="weekly">{t('visibility.refreshCadenceWeekly')}</option>
					</select>
				</label>
				{project?.visibility_scheduled_last_at ? (
					<p className="text-xs text-white/60">
						{t('visibility.lastAutomatedRun')}:{' '}
						{new Date(project.visibility_scheduled_last_at).toLocaleString()}
					</p>
				) : null}
				<p className="text-xs text-white/40">{t('visibility.scheduleCronNote')}</p>
				<label className="text-sm block">
					<span className="text-white/60 block mb-1">{t('visibility.spendCapEur')}</span>
					<Input
						type="number"
						value={project?.monthly_api_spend_cap_cents != null ? project.monthly_api_spend_cap_cents / 100 : ''}
						onChange={(e) => {
							const v = e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null;
							void updateProject.mutateAsync({ id: projectId, monthly_api_spend_cap_cents: v });
						}}
						placeholder="100"
					/>
				</label>
				<Button variant="secondary" onClick={() => void saveWorkspace()} loading={updateProject.isPending}>
					{t('visibility.saveWorkspace')}
				</Button>
			</div>
		</div>
	);
};

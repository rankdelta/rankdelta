/**
 * Onboarding Wizard Component
 * 
 * Guided onboarding that analyzes the user's website, generates a topical map,
 * and creates their first project automatically.
 * 
 * Inspired by mobile app onboarding best practices with progressive disclosure.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RocketLaunchIcon,
  MagnifyingGlassIcon,
  MapIcon,
  PencilSquareIcon,
  GlobeAltIcon,
  CheckCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { Button } from '../ui/Button';
import { AnalysisLoading } from './AnalysisLoading';
import { useCreateProject } from '../../hooks/useProjects';
import { analyzeWebsite, type SiteAnalysis } from '../../services/siteAnalysis';
import { isValidURL } from '../../utils/validation';
import { useCompleteOnboardingWizard } from '../../hooks/useOnboarding';
import { TopicalMap } from '../keywords/TopicalMap';
import { contentAgent, type AgentStatus } from '../../services/contentAgent';
import { useSaveContentProposal } from '../../hooks/useContentProposals';
import { useCreateClusters, useSaveKeywords } from '../../hooks/useClusters';
import {
  cursorInstallDeeplink,
  cursorMcpConfigSnippet,
  hostedMcpPrettyUrl,
} from '../../services/apiKeys';

interface OnboardingWizardProps {
	isOpen: boolean;
	onComplete: (projectId: string, options?: { openMcpSettings?: boolean }) => void;
	onSkip: () => void;
}

type Step = 'welcome' | 'website' | 'analyzing' | 'keyword' | 'topical-map' | 'review' | 'creating' | 'connect-ai';

export const OnboardingWizard = ({ isOpen, onComplete, onSkip }: OnboardingWizardProps) => {
	const { t, i18n } = useTranslation();
	const [currentStep, setCurrentStep] = useState<Step>('welcome');
	const [websiteUrl, setWebsiteUrl] = useState('');
	const [primaryKeyword, setPrimaryKeyword] = useState('');
	const [siteAnalysis, setSiteAnalysis] = useState<SiteAnalysis | null>(null);
	const [selectedClusters, setSelectedClusters] = useState<string[]>([]);
	const [_isAnalyzing, setIsAnalyzing] = useState(false);
	const [analysisError, setAnalysisError] = useState<string | null>(null);
	const [projectName, setProjectName] = useState('');
	
	const createProject = useCreateProject();
	const completeWizard = useCompleteOnboardingWizard();
	const saveProposal = useSaveContentProposal();
	const createClusters = useCreateClusters();
	const saveKeywords = useSaveKeywords();
	const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
	const [isSavingClusters, setIsSavingClusters] = useState(false);
	const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
	const prettyMcpUrl = hostedMcpPrettyUrl();
	const cursorSnippet = cursorMcpConfigSnippet(prettyMcpUrl);
	const cursorInstallHref = cursorInstallDeeplink(prettyMcpUrl);

	// Auto-generate project name from website URL
	useEffect(() => {
		if (websiteUrl && !projectName) {
			try {
				const domain = new URL(websiteUrl).hostname.replace('www.', '').split('.')[0] ?? '';
				setProjectName(domain.charAt(0).toUpperCase() + domain.slice(1));
			} catch {
				setProjectName(t('onboardingWizard.defaultProjectName'));
			}
		}
	}, [websiteUrl, projectName]);

	const handleWebsiteSubmit = async () => {
		if (!isValidURL(websiteUrl)) {
			setAnalysisError(t('onboardingWizard.errorInvalidUrl'));
			return;
		}

		setAnalysisError(null);
		setIsAnalyzing(true);
		setCurrentStep('analyzing');

		try {
			const analysis = await analyzeWebsite(websiteUrl, primaryKeyword || undefined);
			setSiteAnalysis(analysis);
			
			// Auto-set primary keyword if detected
			if (!primaryKeyword && analysis.primaryKeyword) {
				setPrimaryKeyword(analysis.primaryKeyword);
			}
			
			// Auto-select high priority clusters
			const highPriorityClusters = analysis.topicalMap
				.filter((c) => c.priority === 'high')
				.map((c) => c.name);
			setSelectedClusters(highPriorityClusters);
			
			setCurrentStep('topical-map');
		} catch (error) {
			console.error('Site analysis error:', error);
			setAnalysisError(t('onboardingWizard.errorAnalyzeFailed'));
			setCurrentStep('keyword');
		} finally {
			setIsAnalyzing(false);
		}
	};

	const handleCreateProject = async () => {
		if (!siteAnalysis || !projectName.trim()) {
			return;
		}

		setCurrentStep('creating');

		try {
			// Step 1: Create project
			const project = await createProject.mutateAsync({
				name: projectName,
				website_url: websiteUrl,
				primary_keyword: primaryKeyword || siteAnalysis.primaryKeyword,
				main_topic: siteAnalysis.topicalMap[0]?.name || primaryKeyword,
				tone: 'professional',
				content_length: 2000,
				language: i18n.language.toLowerCase().startsWith('it') ? 'it' : 'en',
			});

			// Step 2: Save selected clusters to database
			setIsSavingClusters(true);
			const selectedClustersData = siteAnalysis.topicalMap.filter((c) => 
				selectedClusters.includes(c.name)
			);

			if (selectedClustersData.length > 0) {
				// Save clusters to database
				const clustersToSave = selectedClustersData.map((cluster) => ({
					project_id: project.id,
					cluster_name: cluster.name,
					keywords_list: cluster.keywords,
					content_gaps: cluster.contentGaps ? { gaps: cluster.contentGaps } : undefined,
					visualization_data: undefined,
				}));

				const savedClusters = await createClusters.mutateAsync(clustersToSave);

				// Save keywords for each cluster
				for (let i = 0; i < selectedClustersData.length; i++) {
					const cluster = selectedClustersData[i];
					const savedCluster = savedClusters[i];
					if (savedCluster && cluster) {
						await saveKeywords.mutateAsync({
							projectId: project.id,
							clusterId: savedCluster.id,
							keywords: cluster.keywords.map((kw) => ({
								keyword: kw,
								search_volume: cluster.searchVolume,
								difficulty: cluster.difficulty,
							})),
						});
					}
				}
			}

			setIsSavingClusters(false);

			// Step 3: Complete onboarding
			await completeWizard.mutateAsync();

			// Step 4: Start automatic proposal generation (in background)
			// Use selected clusters if available, otherwise generate from primary keyword
			if (selectedClustersData.length > 0) {
				// Start agent with selected clusters
				contentAgent.startGeneration(
					project,
					selectedClustersData,
					async (proposal) => {
						// Save proposal to database
						try {
							await saveProposal.mutateAsync(proposal);
						} catch (error) {
							console.error('Error saving proposal:', error);
						}
					},
					(status) => {
						setAgentStatus(status);
					}
				).catch((error) => {
					console.error('Error in content generation:', error);
					// Continue even if agent fails
				});
			} else if (project.primary_keyword) {
				// No clusters selected, but we have primary keyword - generate proposals automatically
				// Use void to explicitly mark as fire-and-forget
				void import('../../services/proposalAutoGeneration').then(({ startAutomaticProposalGeneration }) => {
					// Start generation without blocking
					void startAutomaticProposalGeneration(project).catch((error) => {
						console.error('Error starting automatic proposal generation:', error);
						// Continue even if generation fails
					});
				});
			}

			// Step 5: Show MCP connect CTA before closing
			setCreatedProjectId(project.id);
			setCurrentStep('connect-ai');
		} catch (error) {
			console.error('Error creating project:', error);
			setAnalysisError(t('onboardingWizard.errorCreateFailed'));
			setCurrentStep('review');
		}
	};

	const handleConnectLater = () => {
		if (createdProjectId) {
			onComplete(createdProjectId);
		}
	};

	const handleConnectNow = () => {
		if (createdProjectId) {
			onComplete(createdProjectId, { openMcpSettings: true });
		}
	};

	const handleSkip = async () => {
		try {
			await completeWizard.mutateAsync();
		} catch (error) {
			// Still close the modal — the global mutation cache already surfaces the error toast.
			console.error('Error completing onboarding wizard:', error);
		}
		onSkip();
	};

	if (!isOpen) return null;

	// Convert TopicalMapCluster to Cluster format for TopicalMap component
	const clustersForMap: Array<{
		name: string;
		keywords: string[];
		search_volume?: number;
		difficulty?: number;
	}> = siteAnalysis?.topicalMap.map((c) => ({
		name: c.name,
		keywords: c.keywords,
		search_volume: c.searchVolume,
		difficulty: c.difficulty,
	})) || [];

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
			<motion.div
				initial={{ opacity: 0, scale: 0.95 }}
				animate={{ opacity: 1, scale: 1 }}
				exit={{ opacity: 0, scale: 0.95 }}
				className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/[0.1] bg-[#0f0f0f] shadow-2xl shadow-black/60"
			>
				<div className="relative rounded-2xl">
					{/* Progress Bar */}
					<div className="absolute top-0 left-0 right-0 h-0.5 bg-white/[0.06] rounded-t-2xl overflow-hidden">
						<motion.div
							className="h-full bg-gradient-to-r from-teal-500 to-cyan-500"
							initial={{ width: 0 }}
							animate={{
								width: `${(() => {
									const steps = ['welcome', 'website', 'analyzing', 'keyword', 'topical-map', 'review', 'creating', 'connect-ai'];
									return ((steps.indexOf(currentStep) + 1) / steps.length) * 100;
								})()}%`,
							}}
							transition={{ duration: 0.3 }}
						/>
					</div>

					<div className="p-8">
						{/* Header */}
						<div className="flex items-center justify-between mb-6">
							<h2 className="text-2xl font-bold text-white">{t('onboardingWizard.header')}</h2>
							<button
								onClick={handleSkip}
								className="text-white/30 hover:text-white/70 transition-colors p-1.5 rounded-lg hover:bg-white/[0.05]"
								aria-label={t('onboardingWizard.skipAria')}
							>
								<XMarkIcon className="w-5 h-5" strokeWidth={2} />
							</button>
						</div>

						<AnimatePresence mode="wait">
							{/* Step 1: Welcome */}
							{currentStep === 'welcome' && (
								<motion.div
									key="welcome"
									initial={{ opacity: 0, x: 20 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: -20 }}
									className="text-center space-y-6"
								>
									<div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center mx-auto mb-2">
										<RocketLaunchIcon className="w-8 h-8 text-white" strokeWidth={1.8} />
									</div>
									<h3 className="text-xl font-bold text-white">{t('onboardingWizard.welcomeTitle')}</h3>
									<p className="text-white/50 max-w-xl mx-auto text-sm">
										{t('onboardingWizard.welcomeBody')}
									</p>
									<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
										<div className="p-5 rounded-2xl border border-white/[0.08] bg-white/[0.02] text-left">
											<div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center mb-3">
												<MagnifyingGlassIcon className="w-5 h-5 text-violet-300" strokeWidth={1.8} />
											</div>
											<h4 className="font-semibold text-white text-sm mb-1">{t('onboardingWizard.featureAnalysisTitle')}</h4>
											<p className="text-xs text-white/40">{t('onboardingWizard.featureAnalysisBody')}</p>
										</div>
										<div className="p-5 rounded-2xl border border-white/[0.08] bg-white/[0.02] text-left">
											<div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-3">
												<MapIcon className="w-5 h-5 text-emerald-300" strokeWidth={1.8} />
											</div>
											<h4 className="font-semibold text-white text-sm mb-1">{t('onboardingWizard.featureMapTitle')}</h4>
											<p className="text-xs text-white/40">{t('onboardingWizard.featureMapBody')}</p>
										</div>
										<div className="p-5 rounded-2xl border border-white/[0.08] bg-white/[0.02] text-left">
											<div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center mb-3">
												<PencilSquareIcon className="w-5 h-5 text-indigo-300" strokeWidth={1.8} />
											</div>
											<h4 className="font-semibold text-white text-sm mb-1">{t('onboardingWizard.featureContentTitle')}</h4>
											<p className="text-xs text-white/40">{t('onboardingWizard.featureContentBody')}</p>
										</div>
									</div>
									<Button onClick={() => setCurrentStep('website')} variant="primary" size="lg" className="mt-8">
										{t('onboardingWizard.startNow')}
									</Button>
								</motion.div>
							)}

							{/* Step 2: Website URL */}
							{currentStep === 'website' && (
								<motion.div
									key="website"
									initial={{ opacity: 0, x: 20 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: -20 }}
									className="space-y-6"
								>
									<div className="text-center mb-6">
										<div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-4">
											<GlobeAltIcon className="w-6 h-6 text-violet-300" strokeWidth={1.8} />
										</div>
										<h3 className="text-xl font-bold text-white mb-2">{t('onboardingWizard.websiteTitle')}</h3>
										<p className="text-white/50 text-sm">
											{t('onboardingWizard.websiteBody')}
										</p>
									</div>
									<div className="space-y-4">
										<div>
											<label htmlFor="website-url" className="block text-sm font-medium text-white/60 mb-1.5">
												{t('onboardingWizard.urlLabel')} *
											</label>
											<input
												id="website-url"
												type="url"
												value={websiteUrl}
												onChange={(e) => setWebsiteUrl(e.target.value)}
												placeholder="https://example.com"
												className="w-full px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.1] text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 text-sm transition-colors"
												autoFocus
											/>
										</div>
										<div>
											<label htmlFor="primary-keyword" className="block text-sm font-medium text-white/60 mb-1.5">
												{t('onboardingWizard.keywordOptionalLabel')}
											</label>
											<input
												id="primary-keyword"
												type="text"
												value={primaryKeyword}
												onChange={(e) => setPrimaryKeyword(e.target.value)}
												placeholder={t('onboardingWizard.keywordPlaceholder')}
												className="w-full px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.1] text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 text-sm transition-colors"
											/>
											<p className="text-xs text-white/25 mt-1.5">
												{t('onboardingWizard.keywordHint')}
											</p>
										</div>
										{analysisError && (
											<div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">
												{analysisError}
											</div>
										)}
									</div>
									<div className="flex gap-3 justify-end">
										<Button variant="ghost" onClick={() => setCurrentStep('welcome')}>
											{t('common.back')}
										</Button>
										<Button
											variant="primary"
											onClick={handleWebsiteSubmit}
											disabled={!websiteUrl.trim()}
										>
											{t('onboardingWizard.analyzeSite')}
										</Button>
									</div>
								</motion.div>
							)}

							{/* Step 3: Analyzing */}
							{currentStep === 'analyzing' && (
								<motion.div
									key="analyzing"
									initial={{ opacity: 0, scale: 0.95 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, scale: 0.95 }}
									className="py-8"
								>
									<AnalysisLoading websiteUrl={websiteUrl} />
								</motion.div>
							)}

							{/* Step 4: Topical Map */}
							{currentStep === 'topical-map' && siteAnalysis && (
								<motion.div
									key="topical-map"
									initial={{ opacity: 0, x: 20 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: -20 }}
									className="space-y-6"
								>
									<div>
										<h3 className="text-xl font-bold text-white mb-2">{t('onboardingWizard.mapTitle')}</h3>
										<p className="text-white/50 text-sm mb-4">
											{t('onboardingWizard.mapBody')}
										</p>
										{siteAnalysis.topicalMap.length > 0 && (
											<div className="mb-4 p-4 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04]">
												<p className="text-sm text-violet-300">
													<strong>{t('onboardingWizard.mapTipLabel')}</strong> {t('onboardingWizard.mapTipBody')}
												</p>
											</div>
										)}
									</div>

									{clustersForMap.length > 0 && (
										<div className="bg-gradient-to-br from-slate-50 to-gray-100 rounded-xl p-4 border border-gray-200" style={{ height: '400px' }}>
											<TopicalMap
												clusters={clustersForMap}
												onNodeClick={(cluster) => {
													if (cluster) {
														const clusterName = cluster.name;
														setSelectedClusters((prev) =>
															prev.includes(clusterName)
																? prev.filter((c) => c !== clusterName)
																: [...prev, clusterName]
														);
													}
												}}
											/>
										</div>
									)}

									{/* Cluster List */}
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										{siteAnalysis.topicalMap.map((cluster) => {
											const isSelected = selectedClusters.includes(cluster.name);
											return (
												<div
													key={cluster.name}
													onClick={() => {
														setSelectedClusters((prev) =>
															prev.includes(cluster.name)
																? prev.filter((c) => c !== cluster.name)
																: [...prev, cluster.name]
														);
													}}
													className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
														isSelected
															? 'bg-teal-50 border-teal-400'
															: 'bg-white border-gray-200 hover:border-teal-300'
													}`}
												>
													<div className="flex items-start justify-between mb-2">
														<h4 className="font-semibold text-gray-900">{cluster.name}</h4>
														<div
															className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
																isSelected
																	? 'bg-teal-500 border-teal-500'
																	: 'border-gray-300'
															}`}
														>
															{isSelected && (
																<svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
																	<path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
																</svg>
															)}
														</div>
													</div>
													<div className="flex items-center gap-3 text-xs mb-2">
														<span className={`px-2 py-1 rounded-full font-medium ${
															cluster.priority === 'high'
																? 'bg-red-100 text-red-700'
																: cluster.priority === 'medium'
																? 'bg-amber-100 text-amber-700'
																: 'bg-gray-100 text-gray-600'
														}`}>
															{cluster.priority}
														</span>
														<span className="text-gray-500">Vol: {cluster.searchVolume.toLocaleString()}</span>
														<span className="text-gray-500">Diff: {Math.round(cluster.difficulty)}</span>
													</div>
													<p className="text-xs text-gray-500">
														{cluster.keywords.slice(0, 3).join(', ')}
														{cluster.keywords.length > 3 && '...'}
													</p>
												</div>
											);
										})}
									</div>

									<div className="flex gap-3 justify-end">
										<Button variant="ghost" onClick={() => setCurrentStep('website')}>
											{t('common.back')}
										</Button>
										<Button
											variant="primary"
											onClick={() => setCurrentStep('review')}
											disabled={selectedClusters.length === 0}
										>
											{t('onboardingWizard.continueSelected', { count: selectedClusters.length })}
										</Button>
									</div>
								</motion.div>
							)}

							{/* Step 5: Review */}
							{currentStep === 'review' && siteAnalysis && (
								<motion.div
									key="review"
									initial={{ opacity: 0, x: 20 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: -20 }}
									className="space-y-6"
								>
									<div>
										<h3 className="text-xl font-bold text-white mb-2">{t('onboardingWizard.reviewTitle')}</h3>
										<p className="text-white/50 text-sm">{t('onboardingWizard.reviewBody')}</p>
									</div>

									<div className="space-y-4">
										<div>
											<label className="block text-sm font-medium text-white/60 mb-1.5">
												{t('onboardingWizard.projectNameLabel')} *
											</label>
											<input
												type="text"
												value={projectName}
												onChange={(e) => setProjectName(e.target.value)}
												className="w-full px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.1] text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 text-sm transition-colors"
												placeholder={t('onboardingWizard.projectNamePlaceholder')}
											/>
										</div>

										<div className="bg-gradient-to-br from-slate-50 to-gray-100 rounded-xl p-5 border border-gray-200">
											<div className="space-y-4">
												<div className="flex items-center justify-between py-2 border-b border-gray-200">
													<span className="text-sm text-gray-500">{t('onboardingWizard.summaryWebsite')}</span>
													<p className="text-gray-900 font-semibold">{siteAnalysis.websiteUrl}</p>
												</div>
												<div className="flex items-center justify-between py-2 border-b border-gray-200">
													<span className="text-sm text-gray-500">{t('onboardingWizard.summaryKeyword')}</span>
													<p className="text-gray-900 font-semibold">{primaryKeyword || siteAnalysis.primaryKeyword}</p>
												</div>
												<div className="flex items-center justify-between py-2 border-b border-gray-200">
													<span className="text-sm text-gray-500">{t('onboardingWizard.summaryClusters')}</span>
													<span className="px-3 py-1 bg-teal-100 text-teal-700 rounded-full text-sm font-semibold">
														{t('onboardingWizard.clustersCount', { count: selectedClusters.length })}
													</span>
												</div>
												<div className="flex items-center justify-between py-2">
													<span className="text-sm text-gray-500">{t('onboardingWizard.summaryCompetitors')}</span>
													<span className="px-3 py-1 bg-violet-100 text-violet-700 rounded-full text-sm font-semibold">
														{t('onboardingWizard.competitorsCount', { count: siteAnalysis.competitors.length })}
													</span>
												</div>
											</div>
										</div>

										{analysisError && (
											<div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm">
												{analysisError}
											</div>
										)}
									</div>

									<div className="flex gap-3 justify-end">
										<Button variant="ghost" onClick={() => setCurrentStep('topical-map')}>
											{t('common.back')}
										</Button>
										<Button
											variant="primary"
											onClick={handleCreateProject}
											disabled={!projectName.trim() || createProject.isPending}
										>
											{createProject.isPending ? t('onboardingWizard.creating') : t('onboardingWizard.createProject')}
										</Button>
									</div>
								</motion.div>
							)}

							{/* Step 7: Connect AI CTA */}
							{currentStep === 'connect-ai' && (
								<motion.div
									key="connect-ai"
									initial={{ opacity: 0, x: 20 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: -20 }}
									className="space-y-6"
								>
									<div className="text-center mb-2">
										<div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center mx-auto mb-4 text-2xl">
											🔌
										</div>
										<h3 className="text-xl font-bold text-white mb-2">{t('onboardingWizard.mcpCtaHeadline')}</h3>
										<p className="text-white/50 text-sm max-w-xl mx-auto">
											{t('onboardingWizard.mcpCtaBody')}
										</p>
									</div>

									<div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-5">
										<p className="text-sm font-semibold text-emerald-100 mb-1">{t('onboardingWizard.mcpCtaToolsTitle')}</p>
										<p className="text-sm text-white/55 leading-relaxed">
											{t('onboardingWizard.mcpCtaToolsBody')}
										</p>
									</div>

									<div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-3 font-mono text-xs text-white/80 break-all">
										<div className="text-violet-300/70 mb-1">{t('onboardingWizard.mcpCtaUrlLabel')}</div>
										<span className="text-white font-medium">{prettyMcpUrl}</span>
									</div>

									<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
										<p className="text-sm text-white/55 mb-3">{t('onboardingWizard.mcpCtaCursorHint')}</p>
										<a
											href={cursorInstallHref}
											className="inline-flex items-center gap-2 rounded-xl bg-violet-500/90 hover:bg-violet-400 text-white text-sm font-semibold px-4 py-2.5"
										>
											{t('onboardingWizard.mcpCtaAddToCursor')}
										</a>
										<details className="mt-4">
											<summary className="cursor-pointer text-sm text-white/60 hover:text-white/80">
												{t('onboardingWizard.mcpCtaConfigSnippet')}
											</summary>
											<pre className="mt-3 text-[11px] font-mono text-white/55 whitespace-pre-wrap break-all">{cursorSnippet}</pre>
										</details>
									</div>

									<p className="text-xs text-white/35 text-center">
										{t('onboardingWizard.mcpCtaKeyHint')}{' '}
										<Link to="/docs/mcp" className="text-violet-300 hover:underline">
											{t('onboardingWizard.mcpCtaDocsLink')}
										</Link>
									</p>

									<div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
										<Button variant="primary" size="lg" onClick={handleConnectNow}>
											{t('onboardingWizard.mcpCtaConnectNow')}
										</Button>
										<Button variant="ghost" size="lg" onClick={handleConnectLater}>
											{t('onboardingWizard.mcpCtaMaybeLater')}
										</Button>
									</div>
								</motion.div>
							)}
							{/* Step 6: Creating */}
							{currentStep === 'creating' && (
								<motion.div
									key="creating"
									initial={{ opacity: 0, scale: 0.9 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, scale: 0.9 }}
									className="text-center space-y-6 py-12"
								>
									<div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mx-auto" />
									<div>
										<h3 className="text-xl font-bold text-white mb-4">{t('onboardingWizard.creatingTitle')}</h3>
										<div className="space-y-2 text-sm">
											{isSavingClusters ? (
												<>
													<div className="flex items-center justify-center gap-2 text-white/60">
														<CheckCircleIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" strokeWidth={1.8} />
														{t('onboardingWizard.stepProjectCreated')}
													</div>
													<div className="flex items-center justify-center gap-2 text-white/60">
														<span className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
														{t('onboardingWizard.stepSavingClusters')}
													</div>
												</>
											) : (
												<>
													<div className="flex items-center justify-center gap-2 text-white/60">
														<CheckCircleIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" strokeWidth={1.8} />
														{t('onboardingWizard.stepProjectCreated')}
													</div>
													<div className="flex items-center justify-center gap-2 text-white/60">
														<CheckCircleIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" strokeWidth={1.8} />
														{t('onboardingWizard.stepClustersSaved')}
													</div>
													<div className="flex items-center justify-center gap-2 text-violet-300">
														<RocketLaunchIcon className="w-4 h-4 flex-shrink-0" strokeWidth={1.8} />
														{t('onboardingWizard.stepStartingGen')}
													</div>
												</>
											)}
										</div>
										{agentStatus && agentStatus.isRunning && (
											<div className="mt-6 p-5 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] space-y-3">
												<p className="text-sm text-violet-300 font-semibold flex items-center gap-2">
													<span className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
													{t('onboardingWizard.agentRunning')}
												</p>
												{agentStatus.currentTask && (
													<p className="text-xs text-gray-600">{agentStatus.currentTask}</p>
												)}
												<div className="flex items-center gap-3">
													<div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
														<motion.div
															className="h-full bg-gradient-to-r from-violet-500 to-emerald-400"
															initial={{ width: 0 }}
															animate={{
																width: `${(agentStatus.completedTasks / agentStatus.totalTasks) * 100}%`,
															}}
															transition={{ duration: 0.3 }}
														/>
													</div>
													<span className="text-xs text-gray-600 font-medium">
														{agentStatus.completedTasks}/{agentStatus.totalTasks}
													</span>
												</div>
											</div>
										)}
									</div>
								</motion.div>
							)}
						</AnimatePresence>
					</div>
				</div>
			</motion.div>
		</div>
	);
};

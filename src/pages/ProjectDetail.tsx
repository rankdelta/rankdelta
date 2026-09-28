/**
 * Project Detail Page
 * 
 * Main page for a project with tabs: Overview, Research, Generate, Library
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useProject } from '../hooks/useProjects';
import { useAuth } from '../hooks/useAuth';
import { KeywordResearchForm } from '../components/keywords/KeywordResearchForm';
import { TopicalMap } from '../components/keywords/TopicalMap';
import { BlogPostGeneratorWithSERP } from '../components/content/BlogPostGeneratorWithSERP';
import { ContentLibrary } from '../components/content/ContentLibrary';
import { MetaContentGenerator } from '../components/content/MetaContentGenerator';
import { ContentIdeationEngine } from '../components/content/ContentIdeationEngine';
import { ContentRecommendations } from '../components/content/ContentRecommendations';
import { CompetitorAnalysis } from '../components/analytics/CompetitorAnalysis';
import { useCreateContent } from '../hooks/useContent';
import { generateSEOSlug } from '../utils/slug';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/ui/Toast';
import { AhaMoment } from '../components/onboarding/AhaMoment';
import { useOnboardingProgress } from '../hooks/useOnboarding';
import { Sidebar } from '../components/layout/Sidebar';
import { getDefaultAuthenticatedHomePath } from '../config/productMode';
import { useClusters } from '../hooks/useClusters';
import { motion } from 'framer-motion';
import type { Cluster } from '../services/clustering';

type Tab = 'overview' | 'research' | 'generate' | 'library' | 'meta' | 'competitors' | 'ideation' | 'recommendations';

export const ProjectDetail = () => {
	const params = useParams({ strict: false });
	const projectId = ('projectId' in params ? params.projectId : undefined) as string | undefined;
	const navigate = useNavigate();
	const { t } = useTranslation();
	const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
	const { data: project, isLoading: isLoadingProject } = useProject(projectId);
	const { data: savedClusters } = useClusters(projectId);
	const { data: progress } = useOnboardingProgress();
	const createContent = useCreateContent();
	const [activeTab, setActiveTab] = useState<Tab>('overview');
	const [clusters, setClusters] = useState<Cluster[]>([]);
	const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
	const [showAhaMoment, setShowAhaMoment] = useState(false);
	const { toast, showToast, hideToast } = useToast();

	// Load saved clusters from database
	useEffect(() => {
		if (savedClusters && savedClusters.length > 0) {
			const convertedClusters: Cluster[] = savedClusters.map((c) => ({
				name: c.cluster_name,
				keywords: Array.isArray(c.keywords_list) ? c.keywords_list : [],
				search_volume: undefined,
				difficulty: undefined,
			}));
			setClusters(convertedClusters);
		}
	}, [savedClusters]);

	if (!isAuthLoading && !isAuthenticated) {
		navigate({ to: '/login' as any });
		return null;
	}

	if (isLoadingProject) {
		return (
			<div className="min-h-screen bg-gray-50 flex items-center justify-center">
				<LoadingSpinner size="lg" text={t('contentTools.projectDetail.loading')} />
			</div>
		);
	}

	if (!project) {
		return (
			<div className="min-h-screen bg-gray-50 flex items-center justify-center">
				<div className="text-center">
					<p className="text-gray-600 mb-4">{t('contentTools.projectDetail.notFound')}</p>
					<button
						onClick={() => navigate({ to: getDefaultAuthenticatedHomePath() as any })}
						className="px-6 py-3 bg-gradient-to-r from-teal-500 to-cyan-500 text-white font-semibold rounded-xl hover:from-teal-600 hover:to-cyan-600 transition-all shadow-md shadow-teal-500/20"
					>
						{t('contentTools.projectDetail.backHome')}
					</button>
				</div>
			</div>
		);
	}

	const handleContentGenerated = async (content: string, seoScore: number, readability: number) => {
		if (!projectId || !project) return;

		try {
		// Extract title from content (first H1 or first line)
		const titleMatch = content.match(/^#\s+(.+)$/m) || content.match(/^(.+)$/m);
		const title = (titleMatch && titleMatch[1]) ? titleMatch[1].trim() : 'Nuovo Articolo';

		// Generate SEO-optimized slug (3-5 keywords, no stop words, max 60 chars)
		const slug = generateSEOSlug(title, project.primary_keyword ?? undefined);

			await createContent.mutateAsync({
				project_id: projectId,
				title,
				slug,
				body: content,
				topic: project.main_topic ?? undefined,
				keywords_used: project.primary_keyword ? [project.primary_keyword] : undefined,
				seo_score: seoScore,
				readability_score: readability,
				status: 'draft',
				metadata: {
					generated_at: new Date().toISOString(),
					tone: project.tone,
					length: project.content_length,
				},
			});

			// Check if this is the first content generated (aha moment)
			const wasFirstContent = progress && !progress.hasGeneratedContent;
			
			// Switch to library tab to see the new content
			setActiveTab('library');
			showToast(t('contentTools.projectDetail.toastSaved'), 'success');

			// Show aha moment celebration if this is the first content
			if (wasFirstContent) {
				setTimeout(() => {
					setShowAhaMoment(true);
				}, 500);
			}
		} catch (error) {
			console.error('Error saving content:', error);
			showToast(t('contentTools.projectDetail.toastSaveError'), 'error');
		}
	};

	const tabs: Array<{ id: Tab; label: string; icon: string }> = [
		{ id: 'overview', label: t('contentTools.projectDetail.tabs.overview'), icon: '📊' },
		{ id: 'research', label: t('contentTools.projectDetail.tabs.research'), icon: '🔍' },
		{ id: 'generate', label: t('contentTools.projectDetail.tabs.generate'), icon: '✍️' },
		{ id: 'library', label: t('contentTools.projectDetail.tabs.library'), icon: '📚' },
		{ id: 'meta', label: t('contentTools.projectDetail.tabs.meta'), icon: '🏷️' },
		{ id: 'competitors', label: t('contentTools.projectDetail.tabs.competitors'), icon: '⚔️' },
		{ id: 'ideation', label: t('contentTools.projectDetail.tabs.ideation'), icon: '💡' },
		{ id: 'recommendations', label: t('contentTools.projectDetail.tabs.recommendations'), icon: '✨' },
	];

	return (
		<div className="flex min-h-screen bg-gray-50">
			<Sidebar />
			<div className="flex-1 flex flex-col">
			{/* Header */}
			<header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
					<div className="flex items-center justify-between">
						<div>
							<button
								onClick={() => navigate({ to: getDefaultAuthenticatedHomePath() as any })}
								className="text-gray-500 hover:text-gray-700 mb-2 text-sm flex items-center gap-2"
							>
								<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
								</svg>
								Home
							</button>
							<h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
							{project.primary_keyword && (
								<p className="text-sm text-gray-500 mt-1">Keyword: {project.primary_keyword}</p>
							)}
						</div>
					</div>
				</div>
			</header>

			{/* Tabs */}
			<div className="bg-white border-b border-gray-200 sticky top-[73px] z-10">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
					<div className="flex space-x-1 overflow-x-auto scrollbar-hide">
						{tabs.map((tab) => (
							<button
								key={tab.id}
								onClick={() => setActiveTab(tab.id)}
								className={`px-4 md:px-6 py-4 text-sm font-medium border-b-2 transition-all whitespace-nowrap relative ${
									activeTab === tab.id
										? 'border-teal-500 text-teal-600'
										: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
								}`}
							>
								<span className="mr-2">{tab.icon}</span>
								<span className="hidden sm:inline">{tab.label}</span>
								{activeTab === tab.id && (
									<motion.div
										layoutId="activeTab"
										className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-teal-500 to-cyan-500"
									/>
								)}
							</button>
						))}
					</div>
				</div>
			</div>

			{/* Content */}
			<main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				{activeTab === 'overview' && (
					<div className="space-y-6">
						{/* Guidance Banner for New Users */}
						{progress && !progress.hasGeneratedContent && (
							<motion.div
								initial={{ opacity: 0, y: -20 }}
								animate={{ opacity: 1, y: 0 }}
								className="bg-gradient-to-r from-teal-50 to-cyan-50 border border-teal-200 rounded-2xl p-6"
							>
								<h3 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
									<span>🎯</span> {t('contentTools.projectDetail.journeyTitle')}
								</h3>
								<p className="text-gray-600 mb-4">
									{t('contentTools.projectDetail.journeyIntro')}
								</p>
								<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
									<div className={`p-4 rounded-xl border-2 ${
										!progress.hasDoneKeywordResearch 
											? 'bg-teal-50 border-teal-300' 
											: 'bg-emerald-50 border-emerald-200'
									}`}>
										<div className="flex items-center gap-2 mb-2">
											<span className="text-xl">{progress.hasDoneKeywordResearch ? '✅' : '1️⃣'}</span>
											<h4 className="font-semibold text-gray-900">Keyword Research</h4>
										</div>
										<p className="text-sm text-gray-600">
											{progress.hasDoneKeywordResearch 
												? t('contentTools.projectDetail.stepCompleted') 
												: t('contentTools.projectDetail.stepResearchDesc')}
										</p>
									</div>
									<div className={`p-4 rounded-xl border-2 ${
										progress.hasDoneKeywordResearch && !progress.hasGeneratedContent
											? 'bg-sky-50 border-sky-200' 
											: progress.hasGeneratedContent
											? 'bg-emerald-50 border-emerald-200'
											: 'bg-gray-50 border-gray-200'
									}`}>
										<div className="flex items-center gap-2 mb-2">
											<span className="text-xl">{progress.hasGeneratedContent ? '✅' : '2️⃣'}</span>
											<h4 className="font-semibold text-gray-900">{t('contentTools.projectDetail.stepGenerateTitle')}</h4>
										</div>
										<p className="text-sm text-gray-600">
											{progress.hasGeneratedContent 
												? t('contentTools.projectDetail.stepCompleted') 
												: progress.hasDoneKeywordResearch
												? t('contentTools.projectDetail.stepGenerateDescAfterResearch')
												: t('contentTools.projectDetail.stepGenerateDesc')}
										</p>
									</div>
									<div className={`p-4 rounded-xl border-2 ${
										progress.hasGeneratedContent
											? 'bg-sky-50 border-sky-200' 
											: 'bg-gray-50 border-gray-200'
									}`}>
										<div className="flex items-center gap-2 mb-2">
											<span className="text-xl">3️⃣</span>
											<h4 className="font-semibold text-gray-900">{t('contentTools.projectDetail.stepMonitorTitle')}</h4>
										</div>
										<p className="text-sm text-gray-600">
											{progress.hasGeneratedContent
												? t('contentTools.projectDetail.stepMonitorDescActive')
												: t('contentTools.projectDetail.stepMonitorDesc')}
										</p>
									</div>
								</div>
							</motion.div>
						)}

						<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
							<Card>
								<div className="text-sm text-gray-500 mb-1">{t('contentTools.projectDetail.tone')}</div>
								<div className="text-xl font-bold text-gray-900 capitalize">{project.tone}</div>
							</Card>
							<Card>
								<div className="text-sm text-gray-500 mb-1">{t('contentTools.projectDetail.contentLength')}</div>
								<div className="text-xl font-bold text-gray-900">{t('contentTools.projectDetail.words', { count: project.content_length })}</div>
							</Card>
							<Card>
								<div className="text-sm text-gray-500 mb-1">{t('contentTools.projectDetail.language')}</div>
								<div className="text-xl font-bold text-gray-900 uppercase">{project.language}</div>
							</Card>
						</div>

						{project.website_url && (
							<Card>
								<div className="text-sm text-gray-500 mb-1">Website URL</div>
								<a
									href={project.website_url}
									target="_blank"
									rel="noopener noreferrer"
									className="text-cosmic-cyan hover:text-cosmic-green transition-colors"
								>
									{project.website_url}
								</a>
							</Card>
						)}

						<div className="flex flex-wrap gap-4">
							{!progress?.hasDoneKeywordResearch ? (
								<Button onClick={() => setActiveTab('research')} variant="primary" className="glow-cyan">
									{t('contentTools.projectDetail.ctaStartResearch')}
								</Button>
							) : !progress?.hasGeneratedContent ? (
								<Button onClick={() => setActiveTab('generate')} variant="primary" className="glow-cyan">
									{t('contentTools.projectDetail.ctaFirstContent')}
								</Button>
							) : (
								<>
									<Button onClick={() => setActiveTab('library')} variant="primary">
										{t('contentTools.projectDetail.ctaViewLibrary')}
									</Button>
									<Button onClick={() => navigate({ to: '/rankings/$projectId', params: { projectId: projectId! } })} variant="secondary">
										📈 Track SEO Rankings
									</Button>
									<Button onClick={() => navigate({ to: '/visibility/$projectId', params: { projectId: projectId! } })} variant="secondary">
										🤖 Track GEO (AI)
									</Button>
								</>
							)}
						</div>
					</div>
				)}

				{activeTab === 'research' && (
					<div className="space-y-8">
						<Card>
							<h2 className="text-xl font-bold text-gray-900 mb-6">Keyword Research</h2>
							{projectId && (
								<KeywordResearchForm
									projectId={projectId}
									onClustersGenerated={(newClusters) => {
										setClusters(newClusters);
										if (newClusters.length > 0 && newClusters[0]) {
											setSelectedCluster(newClusters[0]);
											showToast(t('contentTools.projectDetail.toastClustersFound', { count: newClusters.length }), 'success');
										}
									}}
								/>
							)}
						</Card>

						{clusters.length > 0 && (
							<Card>
								<h2 className="text-xl font-bold text-gray-900 mb-6">Topical Map</h2>
								<p className="text-sm text-gray-400 mb-4">
									{t('contentTools.projectDetail.topicalMapHint')}
								</p>
								<TopicalMap
									clusters={clusters}
									onNodeClick={(cluster) => {
										if (cluster) {
											setSelectedCluster(cluster || null);
											setActiveTab('generate');
											showToast(t('contentTools.projectDetail.toastClusterSelected', { name: cluster.name }), 'info');
										}
									}}
								/>
							</Card>
						)}
					</div>
				)}

				{activeTab === 'generate' && (
					<Card>
						<h2 className="text-xl font-bold text-gray-900 mb-6">{t('contentTools.projectDetail.generateTitle')}</h2>
						{selectedCluster && (
							<div className="mb-6 p-4 bg-gradient-to-br from-teal-50 to-cyan-50 border border-teal-200 rounded-xl">
								<p className="text-sm text-gray-600 mb-2">{t('contentTools.projectDetail.selectedCluster')}</p>
								<p className="text-teal-700 font-semibold">{selectedCluster.name}</p>
								<p className="text-sm text-gray-600 mt-2">
									Keywords: {selectedCluster.keywords.join(', ')}
								</p>
								{selectedCluster.search_volume && (
									<p className="text-sm text-gray-500 mt-1">
										Volume: {selectedCluster.search_volume.toLocaleString()}
									</p>
								)}
							</div>
						)}
						<BlogPostGeneratorWithSERP project={project} onContentGenerated={handleContentGenerated} />
					</Card>
				)}

				{activeTab === 'library' && projectId && (
					<div>
						<h2 className="text-xl font-bold text-gray-900 mb-6">Content Library</h2>
						<ContentLibrary projectId={projectId} />
					</div>
				)}

				{activeTab === 'meta' && projectId && (
					<div>
						<h2 className="text-xl font-bold text-gray-900 mb-6">Meta Content Generator</h2>
						<p className="text-gray-600 mb-6">
							{t('contentTools.projectDetail.metaDesc')}
						</p>
						<MetaContentGenerator projectId={projectId} />
					</div>
				)}

				{activeTab === 'competitors' && (
					<div>
						<h2 className="text-xl font-bold text-gray-900 mb-6">{t('contentTools.projectDetail.competitorsTitle')}</h2>
						<p className="text-gray-600 mb-6">
							{t('contentTools.projectDetail.competitorsDesc')}
						</p>
						<CompetitorAnalysis project={project} />
					</div>
				)}

				{activeTab === 'ideation' && (
					<div>
						<h2 className="text-xl font-bold text-gray-900 mb-6">Content Ideation Engine</h2>
						<p className="text-gray-600 mb-6">
							{t('contentTools.projectDetail.ideationDesc')}
						</p>
						<ContentIdeationEngine project={project} />
					</div>
				)}

				{activeTab === 'recommendations' && (
					<div>
						<h2 className="text-xl font-bold text-gray-900 mb-6">Content Recommendations</h2>
						<p className="text-gray-600 mb-6">
							{t('contentTools.projectDetail.recommendationsDesc')}
						</p>
						<ContentRecommendations project={project} />
					</div>
				)}
			</main>

			{/* Toast Notification */}
			<Toast
				message={toast.message}
				type={toast.type}
				isVisible={toast.isVisible}
				onClose={hideToast}
			/>

			{/* Aha Moment Celebration */}
			<AhaMoment
				isVisible={showAhaMoment}
				onClose={() => setShowAhaMoment(false)}
				onNextAction={() => {
					setShowAhaMoment(false);
					// Already on library tab
				}}
				nextActionLabel={t('contentTools.projectDetail.viewContent')}
			/>
			</div>
		</div>
	);
};


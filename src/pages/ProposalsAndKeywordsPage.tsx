/**
 * Proposals and Keywords Unified Page
 * 
 * Shows content proposals with primary keywords and search volumes.
 * Users can approve (adds to calendar) or reject/archive proposals.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { getDefaultAuthenticatedHomePath } from '../config/productMode';
import { useTranslation } from 'react-i18next';
import { uiLocaleTag } from '../common/uiLocale';
import { Sidebar } from '../components/layout/Sidebar';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Tooltip } from '../components/ui/Tooltip';
import { TopicalMapProgress, type TopicalClusterStatus } from '../components/content/TopicalMapProgress';
import {
	useContentProposals,
	useSaveContentProposal,
	useApproveContentProposal,
	useRejectContentProposal,
} from '../hooks/useContentProposals';
import { useQueryClient } from '@tanstack/react-query';
import { useProjects } from '../hooks/useProjects';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/ui/Toast';
import { contentAgent } from '../services/contentAgent';
import { generateTopicalMap } from '../services/siteAnalysis';
import { projectResearchLocale } from '../lib/seoMarkets';
import { isProxyEnabled } from '../services/edgeProxy';
import { motion, AnimatePresence } from 'framer-motion';
import type { ContentProposal } from '../services/contentAgent';

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected' | 'archived';

interface ProposalGenerationState {
	id?: string;
	status?: 'running' | 'completed' | 'error';
	completed?: number;
	total?: number;
	error?: string;
	completedAt?: string;
}

const parseGenerationState = (raw: string | null): ProposalGenerationState => {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return (typeof parsed === 'object' && parsed !== null ? parsed : {}) as ProposalGenerationState;
	} catch {
		return {};
	}
};

export const ProposalsAndKeywordsPage = () => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: proposals, isLoading } = useContentProposals(undefined);
	const { data: projects } = useProjects();
	const approveProposal = useApproveContentProposal();
	const rejectProposal = useRejectContentProposal();
	const saveProposal = useSaveContentProposal();
	const { toast, showToast, hideToast } = useToast();
	const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending');
	const [filterProjectId, setFilterProjectId] = useState<string>('all'); // NEW: Project filter
	const [expandedProposal, setExpandedProposal] = useState<string | null>(null);
	const [showGenerateForm, setShowGenerateForm] = useState(false);
	const [showManualForm, setShowManualForm] = useState(false);
	const [selectedProjectId, setSelectedProjectId] = useState<string>('');
	const [manualKeyword, setManualKeyword] = useState('');
	const [isGenerating, setIsGenerating] = useState(false);
	const [generationStatus, setGenerationStatus] = useState<string>('');
	
	// State for topical map progress tracking
	const [topicalMapClusters, setTopicalMapClusters] = useState<TopicalClusterStatus[]>([]);
	const [currentClusterIndex, setCurrentClusterIndex] = useState(0);
	const [generationStartTime, setGenerationStartTime] = useState<Date | undefined>();
	const [showTopicalMapProgress, setShowTopicalMapProgress] = useState(false);
	
	// Get existing proposals for selected project (only when project is selected)
	const { data: projectProposals } = useContentProposals(selectedProjectId || undefined);

	// Check for ongoing generation on mount and resume if needed
	useEffect(() => {
		// First, check localStorage for ongoing generation
		const checkLocalStorageGeneration = () => {
			try {
				const storedState = localStorage.getItem('proposalGeneration');
				if (storedState) {
					const state = parseGenerationState(storedState);
					if (state.status === 'running') {
						setIsGenerating(true);
						const completed = state.completed || 0;
						const total = state.total || 0;
						if (total > 0) {
							setGenerationStatus(t('appPages.proposalsKeywords.status.inProgressCount', { completed, total }));
						} else {
							setGenerationStatus(t('appPages.proposalsKeywords.status.inProgress'));
						}
					} else if (state.status === 'completed') {
						// Clean up completed state
						localStorage.removeItem('proposalGeneration');
					} else if (state.status === 'error') {
						// Show error if there was one
						setGenerationStatus(t('appPages.proposalsKeywords.status.errorPrefix', { error: state.error || t('appPages.proposalsKeywords.errors.unknown') }));
						setTimeout(() => {
							setIsGenerating(false);
							setGenerationStatus('');
							localStorage.removeItem('proposalGeneration');
						}, 5000);
					}
				}
			} catch (error) {
				console.error('Error checking localStorage generation state:', error);
			}
		};

		checkLocalStorageGeneration();

		const checkAndResumeGenerations = async () => {
			try {
				// Check localStorage first (faster)
				const storedState = localStorage.getItem('proposalGeneration');
				if (storedState) {
					const state = parseGenerationState(storedState);
					if (state.status === 'running') {
						const completed = state.completed || 0;
						const total = state.total || 0;
						if (total > 0 && completed < total) {
							setIsGenerating(true);
							setGenerationStatus(t('appPages.proposalsKeywords.status.inProgressCount', { completed, total }));
						}
					} else if (state.status === 'completed') {
						setIsGenerating(false);
						setGenerationStatus('');
						localStorage.removeItem('proposalGeneration');
					}
				}

				// Also check agent status
				const agentStatus = contentAgent.getStatus();
				if (agentStatus.isRunning) {
					setIsGenerating(true);
					if (agentStatus.currentTask) {
						setGenerationStatus(agentStatus.currentTask);
					}
				}
			} catch (error) {
				console.error('Error checking generation status:', error);
			}
		};

		checkAndResumeGenerations();
		
		// Poll for updates if generation is in progress
		const pollForUpdates = () => {
			const storedState = localStorage.getItem('proposalGeneration');
			if (storedState) {
				const state = parseGenerationState(storedState);
				if (state.status === 'running') {
					// Refresh proposals list periodically during generation
					queryClient.invalidateQueries({ queryKey: ['content-proposals', 'all'] });
				}
			}
		};
		
		// Check periodically for updates
		const statusInterval = setInterval(() => {
			checkAndResumeGenerations();
		}, 3000); // Check every 3 seconds for faster updates

		// Poll for proposal updates during generation
		const pollingInterval = setInterval(() => {
			// Check if generation is in progress
			const storedState = localStorage.getItem('proposalGeneration');
			if (storedState) {
				const state = parseGenerationState(storedState);
				if (state.status === 'running') {
					pollForUpdates();
				}
			}
		}, 5000); // Poll every 5 seconds during generation

		// Listen for visibility changes to resume when page becomes visible
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				checkAndResumeGenerations();
				pollForUpdates();
			}
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			clearInterval(statusInterval);
			clearInterval(pollingInterval);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	}, [queryClient]);

	// Filter proposals by status AND project
	const filteredProposals = proposals?.filter((p) => {
		// Filter by status
		if (filterStatus !== 'all' && p.status !== filterStatus) return false;
		// Filter by project
		if (filterProjectId !== 'all' && p.projectId !== filterProjectId) return false;
		return true;
	}) || [];

	const pendingProposals = proposals?.filter((p) => p.status === 'pending') || [];
	
	// Get pending count per project for badges
	const pendingByProject = proposals?.reduce((acc, p) => {
		if (p.status === 'pending') {
			acc[p.projectId] = (acc[p.projectId] || 0) + 1;
		}
		return acc;
	}, {} as Record<string, number>) || {};

	const handleApprove = async (proposal: ContentProposal) => {
		try {
			const result = await approveProposal.mutateAsync({
				proposalId: proposal.id,
				projectId: proposal.projectId,
				autoSchedule: true, // Auto-add to calendar
			});

			if (result.scheduledDate) {
				showToast(
					t('appPages.proposalsKeywords.toast.approvedScheduled', { date: new Date(result.scheduledDate).toLocaleDateString(uiLocaleTag()) }),
					'success'
				);
			} else {
				showToast(t('appPages.proposalsKeywords.toast.approvedLibrary'), 'success');
			}
		} catch (error) {
			console.error('Error approving proposal:', error);
			showToast(t('appPages.proposalsKeywords.toast.approveError'), 'error');
		}
	};

	const handleReject = async (proposal: ContentProposal, archive: boolean = false) => {
		try {
			await rejectProposal.mutateAsync({
				proposalId: proposal.id,
				projectId: proposal.projectId,
				archive,
			});
			showToast(
				archive ? t('appPages.proposalsKeywords.toast.archived') : t('appPages.proposalsKeywords.toast.rejected'),
				'info'
			);
		} catch (error) {
			console.error('Error rejecting proposal:', error);
			showToast(t('appPages.proposalsKeywords.toast.rejectError'), 'error');
		}
	};

	const handleGenerateProposals = async () => {
		if (isGenerating) return;
		if (!selectedProjectId) {
			showToast(t('proposals.toastSelectProject'), 'warning');
			return;
		}

		const project = projects?.find((p) => p.id === selectedProjectId);
		if (!project) {
			showToast(t('appPages.proposalsKeywords.toast.projectNotFound'), 'error');
			return;
		}

		if (!project.primary_keyword) {
			showToast(t('appPages.proposalsKeywords.toast.noPrimaryKeyword'), 'warning');
			return;
		}

		// AI generation requires the seo-proxy Edge Function (key stays server-side, never bundled).
		if (!isProxyEnabled()) {
			showToast(t('appPages.proposalsKeywords.toast.aiUnavailable'), 'error');
			return;
		}

		setIsGenerating(true);
		setGenerationStatus(t('appPages.proposalsKeywords.status.semanticAnalysis'));
		setShowTopicalMapProgress(true);
		setGenerationStartTime(new Date());

		// Save generation state to localStorage for background continuation
		const generationId = `gen-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
		const generationState = {
			id: generationId,
			projectId: selectedProjectId,
			startedAt: new Date().toISOString(),
			status: 'running',
		};
		localStorage.setItem('proposalGeneration', JSON.stringify(generationState));

		try {
			// Get existing proposals to avoid duplicates
			const existingProposals = projectProposals || [];
			console.log(`📋 Found ${existingProposals.length} existing proposals. Will generate new, different ones.`);
			
			// Generate a topical map for the primary keyword (excluding similar to existing)
			setGenerationStatus(t('appPages.proposalsKeywords.status.creatingTopicalMap'));
			const topicalMap = await generateTopicalMap(
				project.primary_keyword,
				project.website_url || '',
				project.language,
				projectResearchLocale(project).locationCode,
				existingProposals.map(p => ({
					title: p.title,
					clusterName: p.clusterName,
				}))
			);

			if (topicalMap.length === 0) {
				// Fallback: create a simple cluster
				topicalMap.push({
					name: `${project.primary_keyword} - Guida Completa`,
					keywords: [project.primary_keyword],
					searchVolume: 1000,
					difficulty: 40,
					priority: 'high',
					contentGaps: [],
				});
			}

			// Generate proposals for ALL clusters in the topical map (for complete topical authority)
			// A complete topical map needs 6-10 clusters to build topical authority (SEO best practice)
			const clustersToGenerate = topicalMap;

			console.log(`📊 Generating proposals for all ${clustersToGenerate.length} clusters in the topical map`);
			
			// Calculate time estimate (30-60 seconds per cluster)
			const minMinutes = Math.ceil(clustersToGenerate.length * 0.5);
			const maxMinutes = clustersToGenerate.length;
			setGenerationStatus(t('appPages.proposalsKeywords.status.generatingCount', { count: clustersToGenerate.length, min: minMinutes, max: maxMinutes }));

			// Initialize cluster status for UI tracking
			const initialClusterStatus: TopicalClusterStatus[] = clustersToGenerate.map((cluster) => ({
				name: cluster.name,
				status: 'pending' as const,
				searchVolume: cluster.searchVolume,
				difficulty: cluster.difficulty,
			}));
			setTopicalMapClusters(initialClusterStatus);
			setCurrentClusterIndex(0);

			// Start content agent (runs in background, continues even if user navigates away)
			contentAgent.startGeneration(
				project,
				clustersToGenerate,
				async (proposal) => {
					try {
						// Save proposal to database
						await saveProposal.mutateAsync(proposal);
						
						// Invalidate queries to refresh list immediately
						queryClient.invalidateQueries({ queryKey: ['content-proposals', 'all'] });
						
						// Update localStorage with progress
						const currentState = parseGenerationState(localStorage.getItem('proposalGeneration'));
						if (currentState.id === generationId) {
							currentState.completed = (currentState.completed || 0) + 1;
							currentState.total = clustersToGenerate.length;
							localStorage.setItem('proposalGeneration', JSON.stringify(currentState));
						}
						
						// Update cluster status in UI - mark current as completed
						if (document.visibilityState === 'visible') {
							setTopicalMapClusters((prev) => {
								const updated = [...prev];
								// Find the cluster by name and mark as completed
								const clusterIndex = updated.findIndex((c) => c.name === proposal.clusterName);
								const existing = updated[clusterIndex];
								if (existing) {
									updated[clusterIndex] = {
										...existing,
										status: 'completed',
										proposalId: proposal.id,
										proposalTitle: proposal.title,
										searchVolume: proposal.searchVolume,
										difficulty: proposal.difficulty,
									};
								}
								return updated;
							});
							
							const completed = (currentState.completed || 0);
							setGenerationStatus(t('appPages.proposalsKeywords.status.proposalGenerated', { completed, total: clustersToGenerate.length, title: proposal.title }));
						}
					} catch (error) {
						console.error('Error saving proposal:', error);
						// Mark cluster as error
						setTopicalMapClusters((prev) => {
							const updated = [...prev];
							const clusterIndex = updated.findIndex((c) => c.name === proposal.clusterName);
							const existing = updated[clusterIndex];
							if (existing) {
								updated[clusterIndex] = {
									...existing,
									status: 'error',
									error: error instanceof Error ? error.message : t('appPages.proposalsKeywords.errors.unknown'),
								};
							}
							return updated;
						});
					}
				},
				(status) => {
					// Update status and current cluster indicator
					if (document.visibilityState === 'visible') {
						if (status.currentTask) {
							// Extract cluster name from task
							const match = status.currentTask.match(/per:\s*(.+)$/);
							if (match && match[1]) {
								const clusterName = match[1].trim();
								// Mark current cluster as generating
								setTopicalMapClusters((prev) => {
									const updated = [...prev];
									const clusterIndex = updated.findIndex((c) => c.name === clusterName);
									const existing = updated[clusterIndex];
									if (existing) {
										updated[clusterIndex] = {
											...existing,
											status: 'generating',
										};
										setCurrentClusterIndex(clusterIndex);
									}
									return updated;
								});
							}
							setGenerationStatus(status.currentTask);
						}
					}
				}
			).then(() => {
				// Generation completed
				const currentState = parseGenerationState(localStorage.getItem('proposalGeneration'));
				if (currentState.id === generationId) {
					currentState.status = 'completed';
					currentState.completedAt = new Date().toISOString();
					localStorage.setItem('proposalGeneration', JSON.stringify(currentState));
					
					// Invalidate queries to refresh list
					queryClient.invalidateQueries({ queryKey: ['content-proposals', 'all'] });
					
					// Show toast if page is visible
					if (document.visibilityState === 'visible') {
						showToast(t('appPages.proposalsKeywords.toast.topicalAuthorityReached', { count: clustersToGenerate.length }), 'success');
						setGenerationStatus(t('appPages.proposalsKeywords.status.topicalMapComplete'));
						setIsGenerating(false);
						
						// Keep progress visible for review, then hide after delay
						setTimeout(() => {
							setShowTopicalMapProgress(false);
							setShowGenerateForm(false);
							setSelectedProjectId('');
							setGenerationStatus('');
						}, 5000);
					}
					
					// Clean up after a delay
					setTimeout(() => {
						localStorage.removeItem('proposalGeneration');
					}, 10000);
				}
			}).catch((error) => {
				console.error('Error in background generation:', error);
				const currentState = parseGenerationState(localStorage.getItem('proposalGeneration'));
				if (currentState.id === generationId) {
					currentState.status = 'error';
					currentState.error = error instanceof Error ? error.message : t('appPages.proposalsKeywords.errors.unknown');
					localStorage.setItem('proposalGeneration', JSON.stringify(currentState));
				}
				
				if (document.visibilityState === 'visible') {
					showToast(t('appPages.proposalsKeywords.toast.generationError'), 'error');
					setIsGenerating(false);
					setGenerationStatus('');
				}
			});

			// Show immediate feedback - keep form open to show progress
			showToast(t('appPages.proposalsKeywords.toast.generationStarted'), 'info');
			
		} catch (error) {
			console.error('Error starting generation:', error);
			showToast(t('appPages.proposalsKeywords.toast.startError'), 'error');
			setIsGenerating(false);
			setGenerationStatus('');
			setShowTopicalMapProgress(false);
			localStorage.removeItem('proposalGeneration');
		}
	};

	const handleCreateManualProposal = async () => {
		if (!selectedProjectId || !manualKeyword.trim()) {
			showToast(t('appPages.proposalsKeywords.toast.fillAllFields'), 'warning');
			return;
		}

		const project = projects?.find((p) => p.id === selectedProjectId);
		if (!project) {
			showToast(t('appPages.proposalsKeywords.toast.projectNotFound'), 'error');
			return;
		}

		// AI generation requires the seo-proxy Edge Function (key stays server-side, never bundled).
		if (!isProxyEnabled()) {
			showToast(t('appPages.proposalsKeywords.toast.aiUnavailable'), 'error');
			return;
		}

		setIsGenerating(true);
		setGenerationStatus(t('appPages.proposalsKeywords.status.generatingManual'));
		let hasError = false;

		try {
			// Get keyword data for volume/difficulty
			setGenerationStatus(t('appPages.proposalsKeywords.status.fetchingKeywordData'));
			const { getKeywordData } = await import('../services/dataforseo');
			let searchVolume = 1000;
			let difficulty = 40;
			
			try {
				const keywordData = await getKeywordData([manualKeyword], projectResearchLocale(project).locationCode, project.language);
				if (keywordData && keywordData.length > 0 && keywordData[0]) {
					searchVolume = keywordData[0].search_volume || 1000;
					difficulty = keywordData[0].difficulty || 40;
				}
			} catch (error) {
				console.warn('Error fetching keyword data, using defaults:', error);
				// Continue with defaults
			}

			// Create a simple cluster for the manual keyword
			const manualCluster = {
				name: `${manualKeyword} - Articolo`,
				keywords: [manualKeyword],
				searchVolume,
				difficulty,
				priority: 'high' as const,
				contentGaps: [],
			};

			setGenerationStatus(t('appPages.proposalsKeywords.status.serpAnalysis'));

			// Generate proposal using content agent (single proposal)
			const proposal = await contentAgent.generateSingleProposal(
				project,
				manualCluster,
				async (p) => {
					setGenerationStatus(t('appPages.proposalsKeywords.status.savingProposal'));
					try {
						await saveProposal.mutateAsync(p);
						setGenerationStatus(t('appPages.proposalsKeywords.status.proposalSaved'));
					} catch (saveError) {
						console.error('Error saving proposal:', saveError);
						throw new Error(t('appPages.proposalsKeywords.errors.saveFailed', { error: saveError instanceof Error ? saveError.message : t('appPages.proposalsKeywords.errors.unknown') }));
					}
				}
			);

			if (!proposal) {
				throw new Error(t('appPages.proposalsKeywords.errors.noResult'));
			}

			showToast(t('appPages.proposalsKeywords.toast.proposalCreated'), 'success');
			setShowManualForm(false);
			setManualKeyword('');
			setSelectedProjectId('');
			
			// Refresh proposals list
			window.location.reload();
		} catch (error) {
			hasError = true;
			console.error('Error creating manual proposal:', error);
			const errorMessage = error instanceof Error ? error.message : t('appPages.proposalsKeywords.errors.unknown');
			showToast(t('appPages.proposalsKeywords.toast.errorPrefix', { error: errorMessage }), 'error');
			setGenerationStatus(t('appPages.proposalsKeywords.status.errorPrefix', { error: errorMessage }));
		} finally {
			setIsGenerating(false);
			// Keep status for a bit so user can see error
			// Only clear status if there was no error (check local variable, not closure-captured state)
			if (!hasError) {
				setTimeout(() => setGenerationStatus(''), 2000);
			}
		}
	};

	const getStatusBadge = (status: ContentProposal['status']) => {
		const badges = {
			pending: { variant: 'warning' as const, label: t('proposals.pending'), icon: '⏳' },
			approved: { variant: 'success' as const, label: t('appPages.proposalsKeywords.badge.approved'), icon: '✅' },
			rejected: { variant: 'error' as const, label: t('appPages.proposalsKeywords.badge.rejected'), icon: '❌' },
			archived: { variant: 'default' as const, label: t('appPages.proposalsKeywords.badge.archived'), icon: '📦' },
			modified: { variant: 'info' as const, label: t('appPages.proposalsKeywords.badge.modified'), icon: '✏️' },
		};
		const badge = badges[status] || badges.pending;
		return (
			<Badge variant={badge.variant} size="sm">
				{badge.icon} {badge.label}
			</Badge>
		);
	};

	if (isLoading) {
		return (
			<div className="flex min-h-screen bg-gray-50">
				<Sidebar />
				<div className="flex-1 flex items-center justify-center">
					<LoadingSpinner size="lg" text={t('appPages.proposalsKeywords.loadingProposals')} />
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen bg-gray-50">
			<Sidebar />
			<div className="flex-1">
				<div className="max-w-7xl mx-auto px-6 py-8">
					{/* Generation Status Banner */}
					{isGenerating && (
						<Card className="mb-6 border-teal-200 bg-gradient-to-r from-teal-50 to-blue-50">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-3">
									<LoadingSpinner size="sm" />
									<div>
										<div className="font-semibold text-teal-700">{t('appPages.proposalsKeywords.status.inProgress')}</div>
										{generationStatus && (
											<div className="text-sm text-gray-600 mt-1">{generationStatus}</div>
										)}
									</div>
								</div>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										contentAgent.stop();
										setIsGenerating(false);
										setGenerationStatus(t('appPages.proposalsKeywords.status.cancelled'));
										localStorage.removeItem('proposalGeneration');
										setTimeout(() => setGenerationStatus(''), 2000);
									}}
								>
									{t('common.cancel')}
								</Button>
							</div>
						</Card>
					)}

					{/* Header */}
					<div className="mb-8 flex items-center justify-between flex-wrap gap-4">
						<div>
							<h1 className="text-3xl font-bold text-gray-900 mb-2">{t('appPages.proposalsKeywords.title')}</h1>
							<p className="text-gray-500">
								{t('appPages.proposalsKeywords.subtitle')}
							</p>
						</div>
						<div className="flex gap-2">
							<Button
								variant="primary"
								size="sm"
								onClick={() => setShowGenerateForm(!showGenerateForm)}
								disabled={isGenerating}
							>
								🚀 {t('proposals.generateNew')}
							</Button>
							<Button
								variant="secondary"
								size="sm"
								onClick={() => setShowManualForm(!showManualForm)}
								disabled={isGenerating}
							>
								{t('appPages.proposalsKeywords.addManually')}
							</Button>
						</div>
					</div>

					{/* Generate Proposals Form */}
					{showGenerateForm && (
						<Card className="mb-6 border-teal-200 bg-gradient-to-br from-teal-50/50 to-white">
							<div className="flex items-center justify-between mb-4">
								<h3 className="text-lg font-bold text-gray-900">{t('proposals.generateNew')}</h3>
								<Button variant="ghost" size="sm" onClick={() => setShowGenerateForm(false)}>
									✕
								</Button>
							</div>
							<div className="space-y-4">
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										{t('appPages.proposalsKeywords.selectProject')}
									</label>
									<select
										value={selectedProjectId}
										onChange={(e) => setSelectedProjectId(e.target.value)}
										className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-900"
										disabled={isGenerating}
									>
										<option value="">{t('proposals.selectProjectOption')}</option>
										{projects?.map((p) => (
											<option key={p.id} value={p.id}>
												{p.name} {p.primary_keyword ? `(${p.primary_keyword})` : ''}
											</option>
										))}
									</select>
									{selectedProjectId && (() => {
										const selectedProject = projects?.find((p) => p.id === selectedProjectId);
										return selectedProject?.primary_keyword ? (
											<p className="text-xs text-gray-600 mt-2">
												{t('appPages.proposalsKeywords.primaryKeywordLabel')} <strong className="text-teal-700">{selectedProject.primary_keyword}</strong>
											</p>
										) : null;
									})()}
								</div>
								{generationStatus && (
									<div className={`p-3 rounded-lg border ${
										generationStatus.includes('❌') || generationStatus.includes('Errore')
											? 'bg-red-50 border-red-200'
											: generationStatus.includes('✅')
											? 'bg-green-50 border-green-200'
											: 'bg-teal-50 border-teal-200'
									}`}>
										<p className={`text-sm ${
											generationStatus.includes('❌') || generationStatus.includes('Errore')
												? 'text-red-700'
												: generationStatus.includes('✅')
												? 'text-green-700'
												: 'text-teal-700'
										}`}>
											{generationStatus}
										</p>
									</div>
								)}
								<div className="space-y-2">
									<Button
										onClick={handleGenerateProposals}
										variant="primary"
										fullWidth
										loading={isGenerating}
										disabled={!selectedProjectId || isGenerating}
									>
										{isGenerating ? t('appPages.proposalsKeywords.status.inProgress') : t('appPages.proposalsKeywords.generateForPrimaryKeyword')}
									</Button>
									{isGenerating && (
										<Button
											variant="ghost"
											size="sm"
											fullWidth
											onClick={() => {
												contentAgent.stop();
												setIsGenerating(false);
												setGenerationStatus(t('appPages.proposalsKeywords.status.cancelled'));
												setShowTopicalMapProgress(false);
												setTopicalMapClusters([]);
												localStorage.removeItem('proposalGeneration');
												setTimeout(() => setGenerationStatus(''), 2000);
											}}
										>
											{t('common.cancel')}
										</Button>
									)}
								</div>
								{/* SEO Info Box */}
								{!isGenerating && (
									<div className="p-3 rounded-lg bg-purple-50 border border-purple-200">
										<div className="text-sm text-purple-700 font-medium mb-1">
											{t('appPages.proposalsKeywords.strategyTitle')}
										</div>
										<p className="text-xs text-gray-600">
											{t('appPages.proposalsKeywords.strategyBodyPrefix')} <strong>{t('appPages.proposalsKeywords.strategyClusters')}</strong> {t('appPages.proposalsKeywords.strategyBodyMiddle')} <strong>{t('appPages.proposalsKeywords.strategyTime')}</strong>.
										</p>
									</div>
								)}
							</div>
							
							{/* Topical Map Progress Component */}
							{showTopicalMapProgress && topicalMapClusters.length > 0 && (
								<div className="mt-6">
									<TopicalMapProgress
										clusters={topicalMapClusters}
										currentClusterIndex={currentClusterIndex}
										totalClusters={topicalMapClusters.length}
										isGenerating={isGenerating}
										startTime={generationStartTime}
										onViewProposal={(proposalId) => {
											setExpandedProposal(proposalId);
											setFilterStatus('pending');
										}}
									/>
								</div>
							)}
						</Card>
					)}

					{/* Manual Proposal Form */}
					{showManualForm && (
						<Card className="mb-6 border-green-200 bg-gradient-to-br from-green-50/50 to-white">
							<div className="flex items-center justify-between mb-4">
								<h3 className="text-lg font-bold text-gray-900">{t('appPages.proposalsKeywords.manualTitle')}</h3>
								<Button variant="ghost" size="sm" onClick={() => setShowManualForm(false)}>
									✕
								</Button>
							</div>
							<div className="space-y-4">
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										{t('appPages.proposalsKeywords.selectProject')}
									</label>
									<select
										value={selectedProjectId}
										onChange={(e) => setSelectedProjectId(e.target.value)}
										className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-gray-900"
										disabled={isGenerating}
									>
										<option value="">{t('proposals.selectProjectOption')}</option>
										{projects?.map((p) => (
											<option key={p.id} value={p.id}>
												{p.name}
											</option>
										))}
									</select>
								</div>
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-2">
										{t('appPages.proposalsKeywords.keywordTopicLabel')}
									</label>
									<Input
										value={manualKeyword}
										onChange={(e) => setManualKeyword(e.target.value)}
										placeholder={t('proposals.keywordsPlaceholder')}
										disabled={isGenerating}
									/>
									<p className="text-xs text-gray-500 mt-1">
										{t('appPages.proposalsKeywords.keywordTopicHint')}
									</p>
								</div>
								{generationStatus && (
									<div className={`p-3 rounded-lg border ${
										generationStatus.includes('❌') || generationStatus.includes('Errore')
											? 'bg-red-50 border-red-200'
											: generationStatus.includes('✅')
											? 'bg-green-50 border-green-200'
											: 'bg-teal-50 border-teal-200'
									}`}>
										<p className={`text-sm ${
											generationStatus.includes('❌') || generationStatus.includes('Errore')
												? 'text-red-700'
												: generationStatus.includes('✅')
												? 'text-green-700'
												: 'text-teal-700'
										}`}>
											{generationStatus}
										</p>
									</div>
								)}
								<div className="space-y-2">
									<Button
										onClick={handleCreateManualProposal}
										variant="primary"
										fullWidth
										loading={isGenerating}
										disabled={!selectedProjectId || !manualKeyword.trim() || isGenerating}
									>
										{isGenerating ? t('appPages.proposalsKeywords.status.inProgress') : t('appPages.proposalsKeywords.generateForKeyword')}
									</Button>
									{isGenerating && (
										<Button
											variant="ghost"
											size="sm"
											fullWidth
											onClick={() => {
												contentAgent.stop();
												setIsGenerating(false);
												setGenerationStatus(t('appPages.proposalsKeywords.status.cancelled'));
												setShowTopicalMapProgress(false);
												setTopicalMapClusters([]);
												localStorage.removeItem('proposalGeneration');
												setTimeout(() => setGenerationStatus(''), 2000);
											}}
										>
											{t('common.cancel')}
										</Button>
									)}
								</div>
							</div>
						</Card>
					)}

					{/* Stats and Filters */}
					<div className="mb-6 space-y-4">
						{/* Stats Row */}
						<div className="flex items-center gap-4 flex-wrap">
							<Card className="px-4 py-2" padding="none">
								<div className="text-sm text-gray-500">{t('proposals.pending')}</div>
								<div className="text-2xl font-bold text-amber-600">{pendingProposals.length}</div>
							</Card>
							<Card className="px-4 py-2" padding="none">
								<div className="text-sm text-gray-500">{t('appPages.proposalsKeywords.total')}</div>
								<div className="text-2xl font-bold text-gray-900">{proposals?.length || 0}</div>
							</Card>
						</div>
						
						{/* Filters Row */}
						<div className="flex items-center justify-between flex-wrap gap-4 bg-white p-4 rounded-xl border border-gray-200">
							{/* Project Filter */}
							<div className="flex items-center gap-3">
								<span className="text-sm font-medium text-gray-600">{t('appPages.proposalsKeywords.projectFilterLabel')}</span>
								<select
									value={filterProjectId}
									onChange={(e) => setFilterProjectId(e.target.value)}
									className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
								>
									<option value="all">{t('appPages.proposalsKeywords.allProjects')}</option>
									{projects?.map((p) => (
										<option key={p.id} value={p.id}>
											{p.name} {pendingByProject[p.id] ? `(${pendingByProject[p.id]})` : ''}
										</option>
									))}
								</select>
							</div>
							
							{/* Status Filter */}
							<div className="flex gap-2">
								{(['all', 'pending', 'approved', 'rejected', 'archived'] as FilterStatus[]).map((status) => (
									<Button
										key={status}
										variant={filterStatus === status ? 'primary' : 'ghost'}
										size="sm"
										onClick={() => setFilterStatus(status)}
									>
										{status === 'all' ? t('appPages.proposalsKeywords.filter.all') : status === 'pending' ? t('proposals.pending') : status === 'approved' ? t('appPages.proposalsKeywords.filter.approved') : status === 'rejected' ? t('appPages.proposalsKeywords.filter.rejected') : t('appPages.proposalsKeywords.filter.archived')}
									</Button>
								))}
							</div>
						</div>
					</div>

					{/* Proposals List */}
					{filteredProposals.length === 0 ? (
						<EmptyState
							icon="✨"
							title={filterStatus === 'pending' ? t('proposals.emptyPendingTitle') : t('proposals.emptyFoundTitle')}
							description={
								filterStatus === 'pending'
									? [
											t('proposals.emptyPendingDesc1'),
											t('proposals.emptyPendingDesc2'),
										]
									: [t('proposals.emptyFilteredDesc')]
							}
							primaryAction={
								filterStatus === 'pending'
									? {
											label: `🚀 ${t('proposals.generateNew')}`,
											onClick: () => setShowGenerateForm(true),
											icon: '✨',
										}
									: undefined
							}
							secondaryAction={
								filterStatus === 'pending'
									? {
											label: t('appPages.proposalsKeywords.addManually'),
											onClick: () => setShowManualForm(true),
										}
									: undefined
							}
						/>
					) : (
						<div className="space-y-4">
							<AnimatePresence>
								{filteredProposals.map((proposal, index) => {
									const isExpanded = expandedProposal === proposal.id;
									return (
										<motion.div
											key={proposal.id}
											initial={{ opacity: 0, y: 20 }}
											animate={{ opacity: 1, y: 0 }}
											exit={{ opacity: 0, y: -20 }}
											transition={{ delay: index * 0.05 }}
										>
											<Card className="hover:border-teal-300 transition-all">
												<div className="flex items-start justify-between gap-6">
													<div className="flex-1">
														{/* Header */}
														<div className="flex items-start justify-between mb-3">
															<div className="flex-1">
																<div className="flex items-center gap-3 mb-2">
																	<h3 className="text-xl font-bold text-gray-900">{proposal.title}</h3>
																	{getStatusBadge(proposal.status)}
																</div>
																<div className="flex items-center gap-2 mb-2">
																	<span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full font-semibold">
																		{proposal.clusterName}
																	</span>
																</div>
															</div>
														</div>

														{/* Keyword Info */}
														<div className="bg-gradient-to-r from-teal-50 to-green-50 rounded-lg p-4 mb-4 border border-teal-200">
															<div className="flex items-center gap-6 flex-wrap">
																<div>
																	<div className="text-xs text-gray-500 mb-1">{t('appPages.proposalsKeywords.primaryKeyword')}</div>
																	<div className="text-lg font-bold text-teal-700">{proposal.primaryKeyword}</div>
																</div>
																	<div>
																	<div className="text-xs text-gray-500 mb-1">{t('appPages.proposalsKeywords.searchVolumePotential')}</div>
																	{proposal.searchVolume != null && typeof proposal.searchVolume === 'number' ? (
																		<div className="text-lg font-bold text-green-600">
																			{t('appPages.proposalsKeywords.perMonth', { volume: proposal.searchVolume.toLocaleString() })}
																		</div>
																	) : (proposal.metadata as any)?.keywordDataLoading === true ? (
																		<div className="flex items-center gap-2">
																			<LoadingSpinner size="sm" />
																			<span className="text-sm text-gray-400 italic">{t('appPages.proposalsKeywords.loading')}</span>
																		</div>
																	) : (
																		<div className="text-sm text-gray-400 italic">
																			{(proposal.metadata as any)?.keywordDataLoadFailed ? t('appPages.proposalsKeywords.notAvailable') : 'N/A'}
																	</div>
																)}
																</div>
																	<div>
																		<div className="text-xs text-gray-500 mb-1">Difficulty</div>
																	{proposal.difficulty != null && typeof proposal.difficulty === 'number' ? (
																		<div className="text-lg font-bold text-amber-600">
																			{Math.round(proposal.difficulty)}/100
																		</div>
																	) : (proposal.metadata as any)?.keywordDataLoading === true ? (
																		<div className="flex items-center gap-2">
																			<LoadingSpinner size="sm" />
																			<span className="text-sm text-gray-400 italic">{t('appPages.proposalsKeywords.loading')}</span>
																		</div>
																	) : (
																		<div className="text-sm text-gray-400 italic">
																			{(proposal.metadata as any)?.keywordDataLoadFailed ? t('appPages.proposalsKeywords.notAvailable') : 'N/A'}
																	</div>
																)}
																</div>
																<div className="flex items-center gap-2">
																	<Tooltip content={t('appPages.proposalsKeywords.clusterKeywordsTooltip')} position="top">
																		<div className="text-xs text-gray-500">
																			{t('appPages.proposalsKeywords.moreKeywords', { count: proposal.clusterKeywords.length - 1 })}
																		</div>
																	</Tooltip>
																</div>
															</div>
														</div>

														{/* Metrics */}
														<div className="flex items-center gap-6 text-sm mb-4">
															<div className="flex items-center gap-2">
																<span className="text-gray-500">SEO Score:</span>
																<span className="font-semibold text-teal-600">{proposal.seoScore}/100</span>
															</div>
															<div className="flex items-center gap-2">
																<span className="text-gray-500">Readability:</span>
																<span className="font-semibold text-green-600">{proposal.readabilityScore}/100</span>
															</div>
															{proposal.scheduledDate && (
																<div className="flex items-center gap-2">
																	<span className="text-gray-500">{t('appPages.proposalsKeywords.scheduled')}</span>
																	<span className="font-semibold text-purple-600">
																		{new Date(proposal.scheduledDate).toLocaleDateString(uiLocaleTag())}
																	</span>
																</div>
															)}
														</div>

														{/* Preview */}
														{isExpanded ? (
															<div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
																<div className="prose max-w-none text-sm text-gray-700 whitespace-pre-wrap">
																	{proposal.body}
																</div>
															</div>
														) : (
															<p className="text-sm text-gray-600 line-clamp-2">
																{proposal.body.substring(0, 200)}...
															</p>
														)}
													</div>

													{/* Actions */}
													<div className="flex flex-col gap-2 min-w-[140px]">
														{proposal.status === 'pending' && (
															<>
																<Button
																	onClick={() => setExpandedProposal(isExpanded ? null : proposal.id)}
																	variant="secondary"
																	size="sm"
																	fullWidth
																>
																	{isExpanded ? t('appPages.proposalsKeywords.hide') : t('appPages.proposalsKeywords.preview')}
																</Button>
																<Button
																	onClick={() => handleApprove(proposal)}
																	variant="primary"
																	size="sm"
																	fullWidth
																	loading={approveProposal.isPending}
																>
																	{t('appPages.proposalsKeywords.approveAndSchedule')}
																</Button>
																<div className="flex gap-2">
																	<Button
																		onClick={() => handleReject(proposal, true)}
																		variant="ghost"
																		size="sm"
																		className="flex-1"
																		disabled={rejectProposal.isPending}
																	>
																		{t('appPages.proposalsKeywords.archive')}
																	</Button>
																	<Button
																		onClick={() => handleReject(proposal, false)}
																		variant="danger"
																		size="sm"
																		className="flex-1"
																		disabled={rejectProposal.isPending}
																	>
																		{t('appPages.proposalsKeywords.reject')}
																	</Button>
																</div>
															</>
														)}
														{proposal.status === 'approved' && proposal.scheduledDate && (
															<Button
																onClick={() => navigate({ to: getDefaultAuthenticatedHomePath() as any })}
																variant="secondary"
																size="sm"
																fullWidth
															>
																{t('appPages.proposalsKeywords.viewInCalendar')}
															</Button>
														)}
													</div>
												</div>
											</Card>
										</motion.div>
									);
								})}
							</AnimatePresence>
						</div>
					)}
				</div>
			</div>
			<Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={hideToast} />
		</div>
	);
};


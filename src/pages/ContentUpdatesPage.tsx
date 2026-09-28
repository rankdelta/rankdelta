/**
 * Content Updates Page
 * 
 * Dedicated page for managing content updates and refresh
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { useProjects } from '../hooks/useProjects';
import { factCheckContent } from '../services/sitemapAnalyzer';
import { refreshContent, suggestedChangeLabel } from '../services/contentRefresh';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/ui/Toast';
import { EmptyState } from '../components/ui/EmptyState';
import { Sidebar } from '../components/layout/Sidebar';
import { formatCalendarDate } from '../utils/calendar';
import { supabase } from '../lib/supabaseClient';
import { hrefOf } from '../lib/seoUrls';
import { useBackgroundContentAnalysis } from '../hooks/useBackgroundContentAnalysis';
import type { ContentUpdateCandidate } from '../services/sitemapAnalyzer';
import { uiLocaleTag } from '../common/uiLocale';

export const ContentUpdatesPage = () => {
	const { t } = useTranslation();
	const { user } = useAuth();
	const { data: projects } = useProjects();
	const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
	const [isRefreshing, setIsRefreshing] = useState<string | null>(null);
	const [factChecking, setFactChecking] = useState<string | null>(null);
	const [approving, setApproving] = useState<string | null>(null);
	const [rejecting, setRejecting] = useState<string | null>(null);
	const { toast, showToast, hideToast } = useToast();
	const queryClient = useQueryClient();

	const selectedProject = projects?.find((p) => p.id === selectedProjectId);
	
	// Use background analysis hook
	const {
		state: analysisState,
		results: analysisResults,
		startAnalysis,
		stopAnalysis,
		isRunning: isAnalyzing,
		isCompleted: isAnalysisCompleted,
		hasError: hasAnalysisError,
	} = useBackgroundContentAnalysis(selectedProject ?? null);

	const [candidates, setCandidates] = useState<ContentUpdateCandidate[]>([]);
	const [isLoading] = useState(false);

	// Update candidates when analysis results change
	useEffect(() => {
		if (analysisResults.length > 0) {
			// Filter out already approved/rejected candidates
			const loadFilteredCandidates = async () => {
				if (!selectedProject) return;

				try {
					const { data: project } = await supabase
						.from('projects')
						.select('metadata')
						.eq('id', selectedProject.id)
						.single();

					const approvedUrls = ((project?.metadata as any)?.approved_content_updates as Array<any>) || [];
					const rejectedUrls = ((project?.metadata as any)?.rejected_content_updates as Array<string>) || [];
					const approvedSet = new Set(approvedUrls.map((a: any) => a.url));
					const rejectedSet = new Set(rejectedUrls);

					const filtered = analysisResults.filter(c => 
						!approvedSet.has(c.url) && !rejectedSet.has(c.url)
					);

					setCandidates(filtered);
				} catch (error) {
					console.error('Error filtering candidates:', error);
					setCandidates(analysisResults);
				}
			};

			loadFilteredCandidates();
		} else {
			setCandidates([]);
		}
	}, [analysisResults, selectedProject]);

	// Show toast notifications when analysis completes
	useEffect(() => {
		if (isAnalysisCompleted && analysisResults.length > 0) {
			showToast(t('contentUpdates.toastAnalysisDone', { count: analysisResults.length }), 'success');
		} else if (isAnalysisCompleted && analysisResults.length === 0) {
			showToast(t('contentUpdates.toastAnalysisNone'), 'success');
		} else if (hasAnalysisError) {
			showToast(t('contentUpdates.toastAnalysisError', { error: analysisState.error || t('contentUpdates.errorUnknown') }), 'error');
		}
	}, [isAnalysisCompleted, hasAnalysisError, analysisResults.length, analysisState.error, showToast]);

	const handleAnalyze = async () => {
		if (!selectedProjectId || !selectedProject) {
			showToast(t('contentUpdates.toastSelectProject'), 'warning');
			return;
		}

		if (isAnalyzing) {
			showToast(t('appPages.contentUpdates.toastAnalysisAlreadyRunning'), 'info');
			return;
		}

		showToast(t('appPages.contentUpdates.toastAnalysisStarted'), 'info');
		startAnalysis();
	};

	const handleRefresh = async (candidate: ContentUpdateCandidate) => {
		if (!selectedProject || !candidate.existingContent) {
			showToast(t('appPages.contentUpdates.toastContentNotFound'), 'error');
			return;
		}

		setIsRefreshing(candidate.url);

		try {
			await refreshContent(candidate.existingContent, selectedProject, candidate.suggestedChanges);
			showToast(t('appPages.contentUpdates.toastRefreshSuccess'), 'success');
			setCandidates(prev => prev.filter(c => c.url !== candidate.url));
		} catch (error) {
			console.error('Error refreshing content:', error);
			showToast(t('appPages.contentUpdates.toastRefreshError'), 'error');
		} finally {
			setIsRefreshing(null);
		}
	};

	const handleFactCheck = async (candidate: ContentUpdateCandidate) => {
		if (!candidate.existingContent) {
			showToast(t('appPages.contentUpdates.toastContentNotFound'), 'error');
			return;
		}

		setFactChecking(candidate.url);

		try {
			const factCheckResult = await factCheckContent(
				candidate.existingContent,
				selectedProject!
			);
			
			// Show fact-check results
			if (factCheckResult.isAccurate) {
				showToast(t('appPages.contentUpdates.toastFactCheckAccurate'), 'success');
			} else {
				const issuesCount = factCheckResult.issues.length;
				showToast(t('appPages.contentUpdates.toastFactCheckIssues', { count: issuesCount }), 'warning');
			}

			// Store fact-check results in metadata
			if (candidate.existingContent) {
				await supabase
					.from('content')
					.update({
						metadata: {
							...candidate.existingContent.metadata,
							fact_check: {
								checked_at: new Date().toISOString(),
								is_accurate: factCheckResult.isAccurate,
								issues: factCheckResult.issues,
								suggestions: factCheckResult.suggestions,
							},
						},
					})
					.eq('id', candidate.existingContent.id);
			}
		} catch (error) {
			console.error('Error fact-checking content:', error);
			showToast(t('appPages.contentUpdates.toastFactCheckError'), 'error');
		} finally {
			setFactChecking(null);
		}
	};

	const handleApprove = async (candidate: ContentUpdateCandidate) => {
		if (!selectedProject) {
			showToast(t('appPages.contentUpdates.toastProjectNotFound'), 'error');
			return;
		}

		setApproving(candidate.url);

		try {
			// Find next available date in calendar
			const { data: existingContent } = await supabase
				.from('content')
				.select('published_date')
				.eq('project_id', selectedProject.id)
				.not('published_date', 'is', null)
				.order('published_date', { ascending: true });

			// Also check existing approved proposals
			const { data: existingProposals } = await supabase
				.from('content_proposals')
				.select('scheduled_date')
				.eq('project_id', selectedProject.id)
				.eq('status', 'approved')
				.not('scheduled_date', 'is', null);

			// Combine all scheduled dates (normalize to YYYY-MM-DD format)
			const allScheduledDates = new Set([
				...(existingContent || []).map(c => c.published_date ? formatCalendarDate(new Date(c.published_date)) : null),
				...(existingProposals || []).map(p => p.scheduled_date ? formatCalendarDate(new Date(p.scheduled_date)) : null),
			].filter(Boolean) as string[]);

			// Find first available date starting from tomorrow (1 content per day)
			const tomorrow = new Date();
			tomorrow.setHours(0, 0, 0, 0);
			tomorrow.setDate(tomorrow.getDate() + 1);

			const scheduledDate = new Date(tomorrow);
			// Find first free date (max 90 days ahead)
			for (let i = 0; i < 90; i++) {
				const dateStr = formatCalendarDate(scheduledDate);
				if (!allScheduledDates.has(dateStr)) {
					break;
				}
				scheduledDate.setDate(scheduledDate.getDate() + 1);
			}

			const dateString = formatCalendarDate(scheduledDate);
			// Format date as ISO timestamp for Supabase TIMESTAMP WITH TIME ZONE
			const scheduledDateISO = new Date(dateString + 'T10:00:00.000Z').toISOString();

			// Create a content proposal for content refresh
			// This will appear in the Calendar and can be generated with AI
			const proposalId = `refresh-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
			
			// Extract title from URL or existing content
			let title = candidate.existingContent?.title || '';
			if (!title) {
				// Extract from URL path
				try {
					const urlPath = new URL(candidate.url).pathname;
					title = urlPath
						.split('/')
						.filter(Boolean)
						.pop()
						?.replace(/-/g, ' ')
						.replace(/\b\w/g, (c) => c.toUpperCase()) || 'Content Refresh';
				} catch {
					title = 'Content Refresh';
				}
			}

			// Ensure cluster_keywords is a valid JSON array
			const clusterKeywords = Array.isArray(candidate.existingContent?.keywords_used) 
				? candidate.existingContent.keywords_used.filter(k => k && typeof k === 'string')
				: [];
			const primaryKeyword = clusterKeywords[0] || title.toLowerCase().substring(0, 255);
				
			const proposalData = {
				id: proposalId,
				project_id: selectedProject.id,
				cluster_name: `Aggiornamento: ${title}`.substring(0, 255),
				cluster_keywords: clusterKeywords,
				primary_keyword: primaryKeyword.substring(0, 255),
				title: `🔄 ${title}`.substring(0, 500),
				slug: (candidate.existingContent?.slug || candidate.url.split('/').filter(Boolean).pop() || 'content-refresh').substring(0, 500),
				body: '',
				seo_score: candidate.existingContent?.seo_score || 0,
				readability_score: candidate.existingContent?.readability_score || 0,
				status: 'approved' as const,
				generated_at: new Date().toISOString(),
				scheduled_date: scheduledDateISO,
					metadata: {
					isContentRefresh: true,
					originalUrl: candidate.url,
					originalContentId: candidate.existingContent?.id,
					originalTitle: candidate.existingContent?.title,
					originalBody: candidate.existingContent?.body?.substring(0, 2000),
					refreshReason: candidate.reason,
					refreshPriority: candidate.priority,
					suggestedChanges: candidate.suggestedChanges,
					daysSinceUpdate: candidate.daysSinceUpdate,
					lastModified: candidate.lastModified?.toISOString(),
					needsContentGeneration: true,
							approved_at: new Date().toISOString(),
						},
			};

			// Create the content proposal for refresh
			const { error: proposalError } = await supabase
				.from('content_proposals')
				.insert(proposalData)
				.select()
					.single();
				
			if (proposalError) {
				console.error('Error creating content proposal:', proposalError);
				console.error('Error details:', {
					message: proposalError.message,
					code: proposalError.code,
					details: proposalError.details,
					hint: proposalError.hint,
				});
				
				// Fallback: save to project metadata so we don't lose the data
				console.log('Attempting fallback: saving to project metadata...');
				try {
				const { data: project } = await supabase
					.from('projects')
					.select('metadata')
					.eq('id', selectedProject.id)
					.single();

				const currentMetadata = project?.metadata && typeof project.metadata === 'object' 
					? project.metadata as Record<string, unknown>
					: {};

					const pendingRefreshes = ((currentMetadata['pending_refresh_proposals'] as Array<any>) || []);

					await supabase
					.from('projects')
					.update({
						metadata: {
							...currentMetadata,
								pending_refresh_proposals: [
									...pendingRefreshes,
								{
										id: proposalId,
									url: candidate.url,
										title: title,
									scheduled_date: dateString,
										created_at: new Date().toISOString(),
									reason: candidate.reason,
									priority: candidate.priority,
										suggestedChanges: candidate.suggestedChanges,
								},
							],
						},
					})
					.eq('id', selectedProject.id);
					
					showToast(t('appPages.contentUpdates.toastSavedPending', { error: proposalError.message }), 'warning');
				} catch (fallbackError) {
					console.error('Fallback save also failed:', fallbackError);
					showToast(t('appPages.contentUpdates.toastCriticalError', { error: proposalError.message }), 'error');
				}
				
				setApproving(null);
				return;
			}

			// If there's existing content, mark it as pending refresh
			if (candidate.existingContent) {
				await supabase
					.from('content')
					.update({
						metadata: {
							...(candidate.existingContent.metadata || {}),
							content_updates: {
								...((candidate.existingContent.metadata as any)?.content_updates || {}),
								approved: true,
								approved_at: new Date().toISOString(),
								refresh_proposal_id: proposalId,
								candidate_url: candidate.url,
							},
						},
					})
					.eq('id', candidate.existingContent.id);
				}

			showToast(t('appPages.contentUpdates.toastApproved', { date: scheduledDate.toLocaleDateString(uiLocaleTag()) }), 'success');
			
			// Remove candidate from local state and saved candidates
			setCandidates(prev => prev.filter(c => c.url !== candidate.url));
			
			// Remove from saved candidates in project metadata
			try {
				const { data: project } = await supabase
					.from('projects')
					.select('metadata')
					.eq('id', selectedProject.id)
					.single();

				const currentMetadata = project?.metadata && typeof project.metadata === 'object' 
					? project.metadata as Record<string, unknown>
					: {};

				const savedCandidates = ((currentMetadata['pending_content_updates'] as Array<any>) || []);
				const updatedCandidates = savedCandidates.filter((c: any) => c.url !== candidate.url);

				await supabase
					.from('projects')
					.update({
						metadata: {
							...currentMetadata,
							pending_content_updates: updatedCandidates,
						},
					})
					.eq('id', selectedProject.id);
			} catch (error) {
				console.error('Error updating saved candidates:', error);
			}
			
			// Invalidate queries to refresh calendar and content proposals
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['content', selectedProject.id] }),
				queryClient.invalidateQueries({ queryKey: ['content', 'all'] }),
				queryClient.invalidateQueries({ queryKey: ['projects'] }),
				queryClient.invalidateQueries({ queryKey: ['content-proposals', selectedProject.id] }),
				queryClient.invalidateQueries({ queryKey: ['content-proposals', 'all'] }),
				queryClient.invalidateQueries({ queryKey: ['projects', selectedProject.id] }),
			]);
			
			// Force immediate refetch
			await queryClient.refetchQueries({ queryKey: ['content-proposals', selectedProject.id] });
		} catch (error) {
			console.error('Error approving content:', error);
			showToast(t('appPages.contentUpdates.toastApproveError'), 'error');
		} finally {
			setApproving(null);
		}
	};

	const handleReject = async (candidate: ContentUpdateCandidate) => {
		if (!selectedProject) {
			showToast(t('appPages.contentUpdates.toastProjectNotFound'), 'error');
			return;
		}

		setRejecting(candidate.url);

		try {
			// If content exists, mark as rejected in metadata
			if (candidate.existingContent) {
				await supabase
					.from('content')
					.update({
						metadata: {
							...candidate.existingContent.metadata,
							content_updates: {
								...((candidate.existingContent.metadata as any)?.content_updates || {}),
								rejected: [
									...(((candidate.existingContent.metadata as any)?.content_updates?.rejected as string[]) || []),
									candidate.url,
								],
								rejected_at: new Date().toISOString(),
							},
						},
					})
					.eq('id', candidate.existingContent.id);
			} else {
				// Store rejected URL in project metadata if no content exists
				const { data: project } = await supabase
					.from('projects')
					.select('metadata')
					.eq('id', selectedProject.id)
					.single();

				const currentMetadata = project?.metadata && typeof project.metadata === 'object' 
					? project.metadata as Record<string, unknown>
					: {};

				const rejectedUrls = ((currentMetadata['rejected_content_updates'] as string[]) || []);

				const { error: updateError } = await supabase
					.from('projects')
					.update({
						metadata: {
							...currentMetadata,
							rejected_content_updates: [
								...rejectedUrls,
								candidate.url,
							],
						},
					})
					.eq('id', selectedProject.id);
					
				if (updateError) {
					console.error('Error saving rejected URL:', updateError);
				}
			}

			// Remove from saved candidates in project metadata
			try {
				const { data: project } = await supabase
					.from('projects')
					.select('metadata')
					.eq('id', selectedProject.id)
					.single();

				const currentMetadata = project?.metadata && typeof project.metadata === 'object' 
					? project.metadata as Record<string, unknown>
					: {};

				const savedCandidates = ((currentMetadata['pending_content_updates'] as Array<any>) || []);
				const updatedCandidates = savedCandidates.filter((c: any) => c.url !== candidate.url);

				await supabase
					.from('projects')
					.update({
						metadata: {
							...currentMetadata,
							pending_content_updates: updatedCandidates,
						},
					})
					.eq('id', selectedProject.id);
			} catch (error) {
				console.error('Error updating saved candidates:', error);
			}

			showToast(t('appPages.contentUpdates.toastRejected'), 'success');
			// Remove from candidates list
			setCandidates(prev => prev.filter(c => c.url !== candidate.url));
			
			// Invalidate queries
			queryClient.invalidateQueries({ queryKey: ['projects'] });
		} catch (error) {
			console.error('Error rejecting content:', error);
			showToast(t('appPages.contentUpdates.toastRejectError'), 'error');
		} finally {
			setRejecting(null);
		}
	};

	const getReasonLabel = (reason: ContentUpdateCandidate['reason']) => {
		const labels = {
			outdated: t('appPages.contentUpdates.reason.outdated'),
			missing: t('appPages.contentUpdates.reason.missing'),
			low_performance: t('appPages.contentUpdates.reason.low_performance'),
			competitor_improved: t('appPages.contentUpdates.reason.competitor_improved'),
		};
		return labels[reason];
	};

	const getReasonIcon = (reason: ContentUpdateCandidate['reason']) => {
		const icons = {
			outdated: '📅',
			missing: '➕',
			low_performance: '📉',
			competitor_improved: '⚔️',
		};
		return icons[reason];
	};

	const getPriorityColor = (priority: ContentUpdateCandidate['priority']) => {
		const colors = {
			high: 'error',
			medium: 'warning',
			low: 'default',
		};
		return colors[priority];
	};

	if (!user) {
		return (
			<div className="flex items-center justify-center h-screen">
				<LoadingSpinner text={t('common.loading')} />
			</div>
		);
	}

	return (
		<div className="flex min-h-screen bg-gray-50">
			<Sidebar />
			<div className="flex-1">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				{/* Header */}
				<div className="mb-8">
					<h1 className="text-3xl font-bold text-gray-900 mb-2">{t('appPages.contentUpdates.title')}</h1>
					<p className="text-gray-600">
						{t('appPages.contentUpdates.subtitle')}
					</p>
				</div>

				{/* Project Selector */}
				<Card className="mb-6">
					<div className="space-y-4">
						<label className="block text-sm font-medium text-gray-700">
							{t('appPages.contentUpdates.selectProjectLabel')}
						</label>
						<select
							value={selectedProjectId || ''}
							onChange={(e) => setSelectedProjectId(e.target.value || null)}
							className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cosmic-cyan"
							disabled={isAnalyzing}
						>
							<option value="">{t('contentUpdates.selectProjectOption')}</option>
							{projects?.map((project) => (
								<option key={project.id} value={project.id}>
									{project.name} {project.website_url ? `(${project.website_url})` : ''}
								</option>
							))}
						</select>
						{selectedProject && (
							<div className="flex flex-col gap-2">
								<div className="flex items-center gap-2">
									<Button
										onClick={handleAnalyze}
										variant="primary"
										loading={isAnalyzing}
										disabled={isAnalyzing}
									>
										{isAnalyzing ? t('appPages.contentUpdates.analyzing') : t('appPages.contentUpdates.analyze')}
									</Button>
									{isAnalyzing && (
										<Button
											onClick={stopAnalysis}
											variant="secondary"
											size="sm"
										>
											{t('appPages.contentUpdates.stop')}
										</Button>
									)}
								</div>
								{isAnalyzing && (
									<div className="flex items-center gap-2 text-sm text-blue-600">
										<LoadingSpinner size="sm" />
										<span>
											{analysisState.progress?.message || t('appPages.contentUpdates.analysisRunning')}
											{analysisState.progress && (
												<span className="text-gray-500 ml-1">
													({analysisState.progress.current}/{analysisState.progress.total})
												</span>
											)}
										</span>
									</div>
								)}
								{isAnalyzing && (
									<p className="text-xs text-gray-500 italic">
										{t('appPages.contentUpdates.backgroundHint')}
									</p>
								)}
								{isAnalysisCompleted && analysisState.completedAt && (
									<p className="text-xs text-green-600">
										{t('contentUpdates.analysisCompletedAt', { date: new Date(analysisState.completedAt).toLocaleString() })}
									</p>
								)}
								{hasAnalysisError && (
									<p className="text-xs text-red-600">
										{t('appPages.contentUpdates.errorLabel', { error: analysisState.error || t('contentUpdates.errorUnknown') })}
									</p>
								)}
								{!selectedProject.website_url && (
									<p className="text-sm text-gray-500">
										{t('appPages.contentUpdates.dbOnlyHint')}
									</p>
								)}
							</div>
						)}
					</div>
				</Card>

				{/* Candidates List */}
				{isLoading && <LoadingSpinner text={t('appPages.contentUpdates.loadingContent')} />}

				{candidates && candidates.length > 0 && (
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<h2 className="text-xl font-bold text-gray-900">
								{t('appPages.contentUpdates.toUpdateTitle', { total: candidates.length })}
							</h2>
							<Badge variant="info" size="sm">
								{t('appPages.contentUpdates.highPriorityCount', { total: candidates.filter((c) => c.priority === 'high').length })}
							</Badge>
						</div>

						{candidates.map((candidate, index) => (
							<Card key={index} className="border-l-4 border-l-cosmic-cyan">
								<div className="flex items-start justify-between gap-4">
									<div className="flex-1">
										<div className="flex items-center gap-3 mb-2 flex-wrap">
											<span className="text-2xl">{getReasonIcon(candidate.reason)}</span>
											<h3 className="font-semibold text-gray-900">
												{candidate.existingContent?.title || candidate.url}
											</h3>
											<Badge variant="default" size="sm">
												{getReasonLabel(candidate.reason)}
											</Badge>
											<Badge variant={getPriorityColor(candidate.priority) as any} size="sm">
												{candidate.priority === 'high' ? t('appPages.contentUpdates.priorityHigh') : candidate.priority === 'medium' ? t('appPages.contentUpdates.priorityMedium') : t('appPages.contentUpdates.priorityLow')}
											</Badge>
										</div>
										<div className="space-y-2 mb-3">
											<p className="text-sm text-gray-600">
												<strong>URL:</strong>{' '}
												<a
													href={hrefOf(candidate.url) ?? undefined}
													target="_blank"
													rel="noopener noreferrer"
													className="text-cosmic-cyan hover:underline"
												>
													{candidate.url}
												</a>
											</p>
											{candidate.lastModified && (
												<p className="text-sm text-gray-600">
													<strong>{t('appPages.contentUpdates.lastUpdatedLabel')}</strong> {t('appPages.contentUpdates.daysAgo', { count: candidate.daysSinceUpdate })}
													{candidate.lastModified && (
														<span className="text-gray-500">
															{' '}
															({candidate.lastModified.toLocaleDateString(uiLocaleTag())})
														</span>
													)}
													{candidate.daysSinceUpdate >= 365 && (
														<span className="ml-2 px-2 py-0.5 bg-status-error/20 text-status-error text-xs font-semibold rounded">
															{t('appPages.contentUpdates.yearsWithoutUpdates', { count: Math.floor(candidate.daysSinceUpdate / 365) })}
														</span>
													)}
												</p>
											)}
											{candidate.existingContent?.seo_score !== undefined && (
												<p className="text-sm text-gray-600">
													<strong>SEO Score:</strong> {candidate.existingContent.seo_score}/100
												</p>
											)}
										</div>
										<div className="p-3 bg-gray-50 rounded-lg">
											<p className="text-xs text-gray-600 mb-2 font-semibold">{t('contentTools.refreshAutomation.suggestedChanges')}</p>
											<ul className="space-y-1">
												{candidate.suggestedChanges.map((change, idx) => (
													<li key={idx} className="text-xs text-gray-700 flex items-start gap-2">
														<span>•</span>
														<span>{suggestedChangeLabel(change, t)}</span>
													</li>
												))}
											</ul>
										</div>
									</div>
									<div className="flex flex-col gap-2">
										{candidate.existingContent && (
											<>
												<Button
													variant="primary"
													size="sm"
													onClick={() => handleApprove(candidate)}
													loading={approving === candidate.url}
													disabled={!!approving || !!rejecting || !!isRefreshing || !!factChecking}
												>
													{approving === candidate.url ? t('appPages.contentUpdates.approving') : t('appPages.contentUpdates.approve')}
												</Button>
												<Button
													variant="secondary"
													size="sm"
													onClick={() => handleReject(candidate)}
													loading={rejecting === candidate.url}
													disabled={!!approving || !!rejecting || !!isRefreshing || !!factChecking}
												>
													{rejecting === candidate.url ? t('appPages.contentUpdates.rejecting') : t('appPages.contentUpdates.reject')}
												</Button>
												<Button
													variant="secondary"
													size="sm"
													onClick={() => handleFactCheck(candidate)}
													loading={factChecking === candidate.url}
													disabled={!!factChecking || !!isRefreshing || !!approving || !!rejecting}
												>
													{factChecking === candidate.url ? t('appPages.contentUpdates.quickCheckRunning') : `🔍 ${t('appPages.contentUpdates.quickCheck')}`}
												</Button>
												<Button
													variant="secondary"
													size="sm"
													onClick={() => handleRefresh(candidate)}
													loading={isRefreshing === candidate.url}
													disabled={!!isRefreshing || !!factChecking || !!approving || !!rejecting}
												>
													{isRefreshing === candidate.url ? t('appPages.contentUpdates.refreshing') : t('appPages.contentUpdates.refresh')}
												</Button>
												<Button
													variant="secondary"
													size="sm"
													onClick={() => {
														window.location.href = `/content/${candidate.existingContent!.id}`;
													}}
												>
													{t('appPages.contentUpdates.view')}
												</Button>
											</>
										)}
										{!candidate.existingContent && (
											<>
												<Button
													variant="primary"
													size="sm"
													onClick={() => handleApprove(candidate)}
													loading={approving === candidate.url}
													disabled={!!approving || !!rejecting}
												>
													{approving === candidate.url ? t('appPages.contentUpdates.approving') : t('appPages.contentUpdates.approve')}
												</Button>
												<Button
													variant="secondary"
													size="sm"
													onClick={() => handleReject(candidate)}
													loading={rejecting === candidate.url}
													disabled={!!approving || !!rejecting}
												>
													{rejecting === candidate.url ? t('appPages.contentUpdates.rejecting') : t('appPages.contentUpdates.reject')}
												</Button>
												<Button
													variant="secondary"
													size="sm"
													onClick={() => {
														window.location.href = `/proposals?url=${encodeURIComponent(candidate.url)}`;
													}}
												>
													{t('appPages.contentUpdates.createContent')}
												</Button>
											</>
										)}
									</div>
								</div>
							</Card>
						))}
					</div>
				)}

				{candidates && candidates.length === 0 && !isLoading && (
					<EmptyState
						icon="✅"
						title={t('contentUpdates.emptyNoUpdatesTitle')}
						description={t('contentUpdates.emptyNoUpdatesDesc')}
						variant="minimal"
					/>
				)}

				{!selectedProjectId && (
					<EmptyState
						icon="📋"
						title={t('contentUpdates.emptySelectProjectTitle')}
						description={t('contentUpdates.emptySelectProjectDesc')}
						variant="minimal"
					/>
				)}
				</div>
			</div>

			<Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={hideToast} />
		</div>
	);
};


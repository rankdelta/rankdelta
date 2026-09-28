/**
 * Hook for background content analysis with persistence
 * 
 * Features:
 * - Runs analysis in background (continues even if user navigates away)
 * - Saves progress and results to project metadata
 * - Restores state when user returns to page
 * - Shows real-time progress updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { analyzeContentForUpdates } from '../services/sitemapAnalyzer';
import type { ContentUpdateCandidate } from '../services/sitemapAnalyzer';
import type { Project } from '../types/database';

interface AnalysisState {
	status: 'idle' | 'running' | 'completed' | 'error';
	progress?: {
		current: number;
		total: number;
		message: string;
	};
	results?: ContentUpdateCandidate[];
	error?: string;
	startedAt?: string;
	completedAt?: string;
}

const ANALYSIS_STATE_KEY = 'content_analysis_state';
const ANALYSIS_RESULTS_KEY = 'content_analysis_results';

/**
 * Save analysis state to project metadata
 */
const saveAnalysisState = async (
	projectId: string,
	state: AnalysisState
): Promise<void> => {
	try {
		const { data: project } = await supabase
			.from('projects')
			.select('metadata')
			.eq('id', projectId)
			.single();

		const currentMetadata = project?.metadata && typeof project.metadata === 'object'
			? project.metadata as Record<string, unknown>
			: {};

		await supabase
			.from('projects')
			.update({
				metadata: {
					...currentMetadata,
					[ANALYSIS_STATE_KEY]: state,
				},
			})
			.eq('id', projectId);
	} catch (error) {
		console.error('Error saving analysis state:', error);
	}
};

/**
 * Save analysis results to project metadata (in chunks to avoid size limits)
 */
const saveAnalysisResults = async (
	projectId: string,
	results: ContentUpdateCandidate[]
): Promise<void> => {
	try {
		const { data: project } = await supabase
			.from('projects')
			.select('metadata')
			.eq('id', projectId)
			.single();

		const currentMetadata = project?.metadata && typeof project.metadata === 'object'
			? project.metadata as Record<string, unknown>
			: {};

		// Convert to ultra-minimal format to save ALL candidates
		// Format: [url, priority, reason, contentId?, lastModified?]
		// This allows us to save hundreds of candidates efficiently
		const candidatesToSave = results
			.sort((a, b) => {
				const priorityOrder = { high: 3, medium: 2, low: 1 };
				if (priorityOrder[b.priority] !== priorityOrder[a.priority]) {
					return priorityOrder[b.priority] - priorityOrder[a.priority];
				}
				return (b.daysSinceUpdate || 0) - (a.daysSinceUpdate || 0);
			})
			.map(c => {
				// Ultra-minimal format: only essential data
				const minimal: any = {
					u: c.url, // URL (shortened key)
					p: c.priority === 'high' ? 'h' : c.priority === 'medium' ? 'm' : 'l', // Priority (single char)
					r: c.reason === 'outdated' ? 'o' : c.reason === 'low_performance' ? 'lp' : 'o', // Reason (abbreviated)
				};
				
				// Only add optional fields if they exist (to save space)
				if (c.existingContent?.id) {
					minimal.cid = c.existingContent.id;
				}
				if (c.lastModified) {
					// Store as timestamp number instead of ISO string (saves ~20 bytes per date)
					minimal.lm = c.lastModified.getTime();
				}
				if (c.daysSinceUpdate && c.daysSinceUpdate > 0) {
					minimal.y = c.daysSinceUpdate;
				}
				
				return minimal;
			});
		
		console.log(`💾 Saving ${candidatesToSave.length} candidates to metadata (ultra-minimal format)`);
		
		// Check size before saving
		const metadataSize = JSON.stringify({
			...currentMetadata,
			[ANALYSIS_RESULTS_KEY]: candidatesToSave,
			pending_content_updates: candidatesToSave,
			last_content_analysis: new Date().toISOString(),
		}).length;
		
		console.log(`📊 Metadata size: ${(metadataSize / 1024).toFixed(2)} KB (${candidatesToSave.length} candidates)`);

		// Try to save all candidates
		const { error: saveError } = await supabase
			.from('projects')
			.update({
				metadata: {
					...currentMetadata,
					[ANALYSIS_RESULTS_KEY]: candidatesToSave,
					// Also save in old format for compatibility
					pending_content_updates: candidatesToSave,
					last_content_analysis: new Date().toISOString(),
				},
			})
			.eq('id', projectId);

		if (saveError) {
			console.error('Error saving all candidates:', saveError);
			console.log(`⚠️ Attempting to save in smaller batches...`);
			
			// Fallback: Try saving in batches of 50
			const batchSize = 50;
			const batches: Array<any[]> = [];
			
			for (let i = 0; i < candidatesToSave.length; i += batchSize) {
				batches.push(candidatesToSave.slice(i, i + batchSize));
			}
			
			// Save only the first batch (top 50 by priority)
			// This ensures we at least save the most important candidates
			const topBatch = batches[0];

			if (!topBatch) {
				throw new Error('Failed to save analysis results: no candidates to save');
			}
			
			const { error: batchError } = await supabase
				.from('projects')
				.update({
					metadata: {
						...currentMetadata,
						[ANALYSIS_RESULTS_KEY]: topBatch,
						pending_content_updates: topBatch,
						last_content_analysis: new Date().toISOString(),
						// Store total count and batch info for reference
						content_analysis_total: candidatesToSave.length,
						content_analysis_saved: topBatch.length,
					},
				})
				.eq('id', projectId);
			
			if (batchError) {
				console.error('Error saving even top batch:', batchError);
				throw new Error(`Failed to save analysis results: ${batchError.message}`);
			} else {
				console.log(`✅ Saved top ${topBatch.length} candidates (out of ${candidatesToSave.length} total)`);
				console.warn(`⚠️ Only top ${topBatch.length} candidates saved due to metadata size limits. Consider reviewing metadata size.`);
			}
		} else {
			console.log(`✅ Successfully saved all ${candidatesToSave.length} candidates`);
		}
	} catch (error) {
		console.error('Error saving analysis results:', error);
		throw error; // Re-throw to let caller handle it
	}
};

/**
 * Load analysis state from project metadata
 */
const loadAnalysisState = async (projectId: string): Promise<AnalysisState | null> => {
	try {
		const { data: project } = await supabase
			.from('projects')
			.select('metadata')
			.eq('id', projectId)
			.single();

		if (!project?.metadata) return null;

		const metadata = project.metadata as Record<string, unknown>;
		const state = metadata[ANALYSIS_STATE_KEY] as AnalysisState | undefined;

		return state || null;
	} catch (error) {
		console.error('Error loading analysis state:', error);
		return null;
	}
};

/**
 * Load saved results from project metadata
 * Checks both new format (ANALYSIS_RESULTS_KEY) and old format (pending_content_updates) for compatibility
 */
const loadSavedResults = async (projectId: string): Promise<ContentUpdateCandidate[]> => {
	try {
		const { data: project } = await supabase
			.from('projects')
			.select('metadata')
			.eq('id', projectId)
			.single();

		if (!project?.metadata) return [];

		const metadata = project.metadata as Record<string, unknown>;
		// Try new format first, then fall back to old format for compatibility
		const savedCandidates = (metadata[ANALYSIS_RESULTS_KEY] as Array<any>) || 
		                       (metadata['pending_content_updates'] as Array<any>) || [];

		// Convert back to ContentUpdateCandidate format
		const contentIds = savedCandidates
			.map((c: any) => c.cid)
			.filter((id: string | undefined): id is string => !!id);

		const existingContentMap = new Map();
		if (contentIds.length > 0) {
			const { data: content } = await supabase
				.from('content')
				.select('*')
				.in('id', contentIds);

			if (content) {
				content.forEach((c) => {
					existingContentMap.set(c.id, c);
				});
			}
		}

		return savedCandidates.map((c: any) => {
			// Handle both old format (full keys) and new ultra-minimal format (short keys)
			const url = c.url || c.u;
			
			// Parse lastModified: can be ISO string, timestamp number, or Date
			let lastModified: Date | undefined;
			if (c.lastModified) {
				lastModified = new Date(c.lastModified);
			} else if (c.lm) {
				// Could be ISO string or timestamp number
				if (typeof c.lm === 'number') {
					lastModified = new Date(c.lm);
				} else {
					lastModified = new Date(c.lm);
				}
			}
			
			const daysSinceUpdate = lastModified
				? Math.floor((new Date().getTime() - lastModified.getTime()) / (1000 * 60 * 60 * 24))
				: 0;

			// Parse priority: can be full string or single char
			let priority: 'high' | 'medium' | 'low';
			if (c.priority) {
				priority = c.priority;
			} else if (c.p === 'h') {
				priority = 'high';
			} else if (c.p === 'm') {
				priority = 'medium';
			} else {
				priority = 'low';
			}

			// Parse reason: can be full string or abbreviated
			let reason: ContentUpdateCandidate['reason'];
			if (c.reason) {
				reason = c.reason;
			} else if (c.r === 'o') {
				reason = 'outdated';
			} else if (c.r === 'lp') {
				reason = 'low_performance';
			} else {
				reason = 'outdated';
			}

			const contentId = c.existingContentId || c.cid;

			return {
				url,
				lastModified,
				daysSinceUpdate,
				existingContent: contentId ? existingContentMap.get(contentId) : undefined,
				needsUpdate: true,
				reason,
				priority,
				suggestedChanges: [],
			} as ContentUpdateCandidate;
		});
	} catch (error) {
		console.error('Error loading saved results:', error);
		return [];
	}
};

export const useBackgroundContentAnalysis = (project: Project | null) => {
	const [state, setState] = useState<AnalysisState>({ status: 'idle' });
	const [results, setResults] = useState<ContentUpdateCandidate[]>([]);
	const analysisAbortRef = useRef<AbortController | null>(null);
	const queryClient = useQueryClient();

	// Load saved state and results when project changes
	useEffect(() => {
		if (!project?.id) {
			setState({ status: 'idle' });
			setResults([]);
			return;
		}

		const loadSavedData = async () => {
			const savedState = await loadAnalysisState(project.id);
			const savedResults = await loadSavedResults(project.id);

			if (savedState) {
				setState(savedState);
			}

			if (savedResults.length > 0) {
				setResults(savedResults);
			}

			// If analysis was running, check if it's still valid (not too old)
			if (savedState?.status === 'running' && savedState.startedAt) {
				const startedAt = new Date(savedState.startedAt);
				const hoursSinceStart = (Date.now() - startedAt.getTime()) / (1000 * 60 * 60);
				
				// If analysis started more than 2 hours ago, consider it stale
				if (hoursSinceStart > 2) {
					console.log('Previous analysis is stale, resetting state');
					setState({ status: 'idle' });
					await saveAnalysisState(project.id, { status: 'idle' });
				}
			}
		};

		loadSavedData();
	}, [project?.id]);

	// Start analysis
	const startAnalysis = useCallback(async () => {
		if (!project) return;

		// Cancel any existing analysis
		if (analysisAbortRef.current) {
			analysisAbortRef.current.abort();
		}

		const abortController = new AbortController();
		analysisAbortRef.current = abortController;

		const initialState: AnalysisState = {
			status: 'running',
			startedAt: new Date().toISOString(),
			progress: {
				current: 0,
				total: 100,
				message: 'Inizio analisi...',
			},
		};

		setState(initialState);
		setResults([]);
		await saveAnalysisState(project.id, initialState);

		// Run analysis in background
		(async () => {
			try {
				console.log('=== STARTING BACKGROUND CONTENT ANALYSIS ===');
				console.log('Project:', project.name);
				console.log('Website URL:', project.website_url);

				// Update progress
				const progressState: AnalysisState = {
					...initialState,
					progress: {
						current: 10,
						total: 100,
						message: 'Recupero sitemap...',
					},
				};
				setState(progressState);
				await saveAnalysisState(project.id, progressState);

				// Run analysis (this is the long-running operation)
				const analysisResults = await analyzeContentForUpdates(project);

				// Check if aborted
				if (abortController.signal.aborted) {
					console.log('Analysis aborted');
					return;
				}

				console.log('=== ANALYSIS COMPLETE ===');
				console.log('Total candidates found:', analysisResults.length);

				// Filter out rejected candidates
				const { data: rejectedUrls } = await supabase
					.from('content')
					.select('metadata')
					.eq('project_id', project.id)
					.not('metadata->content_updates->rejected', 'is', null);

				const rejectedSet = new Set(
					rejectedUrls?.flatMap(c => {
						const rejected = (c.metadata as any)?.content_updates?.rejected || [];
						return Array.isArray(rejected) ? rejected : [];
					}) || []
				);

				// Also check project metadata for rejected URLs
				const projectMetadata = project.metadata as Record<string, unknown> | null;
				if (projectMetadata) {
					const projectRejected = ((projectMetadata['rejected_content_updates'] as Array<string>) || []);
					projectRejected.forEach(url => rejectedSet.add(url));
				}

				const filteredResults = analysisResults.filter(c => !rejectedSet.has(c.url));

				// Save results (with error handling)
				try {
					await saveAnalysisResults(project.id, filteredResults);
				} catch (saveError) {
					console.error('Error saving results, but analysis completed:', saveError);
					// Continue anyway - results are still in memory and will be shown
					// User can manually save if needed
				}

				// Update state to completed
				const completedState: AnalysisState = {
					status: 'completed',
					results: filteredResults,
					startedAt: initialState.startedAt,
					completedAt: new Date().toISOString(),
				};

				setState(completedState);
				setResults(filteredResults);
				await saveAnalysisState(project.id, completedState);

				// Invalidate queries to refresh UI
				queryClient.invalidateQueries({ queryKey: ['projects', project.id] });
				queryClient.invalidateQueries({ queryKey: ['projects'] });

				console.log(`✅ Analysis completed: ${filteredResults.length} candidates found`);
			} catch (error) {
				if (abortController.signal.aborted) {
					console.log('Analysis aborted');
					return;
				}

				console.error('Error in background analysis:', error);
				const errorMessage = error instanceof Error ? error.message : 'Errore sconosciuto';

				const errorState: AnalysisState = {
					status: 'error',
					error: errorMessage,
					startedAt: initialState.startedAt,
				};

				setState(errorState);
				await saveAnalysisState(project.id, errorState);
			}
		})();
	}, [project, queryClient]);

	// Stop analysis
	const stopAnalysis = useCallback(() => {
		if (analysisAbortRef.current) {
			analysisAbortRef.current.abort();
			analysisAbortRef.current = null;
		}

		const stoppedState: AnalysisState = {
			status: 'idle',
		};

		setState(stoppedState);
		if (project) {
			saveAnalysisState(project.id, stoppedState);
		}
	}, [project]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (analysisAbortRef.current) {
				analysisAbortRef.current.abort();
			}
		};
	}, []);

	return {
		state,
		results,
		startAnalysis,
		stopAnalysis,
		isRunning: state.status === 'running',
		isCompleted: state.status === 'completed',
		hasError: state.status === 'error',
	};
};


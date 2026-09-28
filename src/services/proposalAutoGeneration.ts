/**
 * Automatic Proposal Generation Service
 * 
 * Automatically generates content proposals when a new project is created
 * or when onboarding is completed.
 * 
 * Uses database to persist generation state so it can resume even if user navigates away.
 */

import { contentAgent } from './contentAgent';
import { generateTopicalMap } from './siteAnalysis';
import { projectResearchLocale } from '../lib/seoMarkets';
import { isProxyEnabled } from './edgeProxy';
import { supabase } from '../lib/supabaseClient';
import type { Project } from '../types/database';
import type { TopicalMapCluster } from './siteAnalysis';

/**
 * Start automatic proposal generation for a project
 * Runs in background and doesn't block the UI
 */
export const startAutomaticProposalGeneration = async (
	project: Project,
	onProposalSaved?: (proposalId: string) => void
): Promise<void> => {
	// Check if project has primary keyword
	if (!project.primary_keyword) {
		console.log('Project has no primary keyword, skipping automatic proposal generation');
		return;
	}

	// AI generation requires the seo-proxy Edge Function (key stays server-side, never bundled).
	if (!isProxyEnabled()) {
		console.warn('LLM proxy not enabled, skipping automatic proposal generation');
		return;
	}

	try {
		console.log('🚀 Starting automatic proposal generation for project:', project.name);

		// Generate topical map from primary keyword
		const topicalMap = await generateTopicalMap(
			project.primary_keyword,
			project.website_url || '',
			project.language || 'it',
			// DataForSEO location derived from the project's market (DB default IT=2380; 2826 is the UK)
			projectResearchLocale(project).locationCode
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

		// TOPICAL AUTHORITY: Generate ALL clusters in the topical map (6-10 typically)
		// A complete topical map is essential for SEO semantic coverage and topical authority
		// Matt Diggity, Kyle Roof methodology: complete coverage = authority
		const clustersToGenerate = topicalMap;

		console.log(`📝 Generating proposals for ALL ${clustersToGenerate.length} clusters to achieve TOPICAL AUTHORITY...`);
		console.log(`⏱️ Estimated time: ${Math.ceil(clustersToGenerate.length * 0.5)} - ${clustersToGenerate.length} minutes`);

		// Save generation job to database for persistence
		const { data: job, error: jobError } = await supabase
			.from('generation_jobs')
			.insert({
				project_id: project.id,
				job_type: 'proposal_generation',
				status: 'running',
				clusters_data: clustersToGenerate,
				completed_clusters: [],
				current_cluster_index: 0,
				total_clusters: clustersToGenerate.length,
				metadata: {
					type: 'automatic',
					projectName: project.name,
				},
			})
			.select()
			.single();

		if (jobError || !job) {
			console.error('Error creating generation job:', jobError);
			// Continue anyway, but without persistence
		}

		const jobId = job?.id;

		// Process clusters asynchronously in background (don't block)
		// This allows generation to continue even if user navigates away
		// The job state is saved in database, so it can be resumed
		void (async () => {
			try {
				// Process clusters one by one, saving progress to database
				for (let i = 0; i < clustersToGenerate.length; i++) {
					const cluster = clustersToGenerate[i];
					if (!cluster) continue;

					try {
						console.log(`Generating proposal ${i + 1}/${clustersToGenerate.length} for: ${cluster.name}`);

						// Update job status
						if (jobId) {
							await supabase
								.from('generation_jobs')
								.update({
									current_cluster_index: i,
									metadata: {
										...(job?.metadata || {}),
										currentTask: `Generando proposta per: ${cluster.name}`,
									},
								})
								.eq('id', jobId);
						}

						// Generate proposal for this cluster
						const abortController = new AbortController();
						const proposal = await contentAgent.generateContentForCluster(
							project,
							cluster,
							abortController.signal
						);

						if (proposal && !abortController.signal.aborted) {
							// Save proposal to database
							const { error: proposalError } = await supabase
								.from('content_proposals')
								.insert({
									id: proposal.id,
									project_id: proposal.projectId,
									cluster_name: proposal.clusterName,
									cluster_keywords: proposal.clusterKeywords,
									primary_keyword: proposal.primaryKeyword,
									search_volume: proposal.searchVolume,
									difficulty: proposal.difficulty,
									title: proposal.title,
									slug: proposal.slug,
									body: proposal.body,
									seo_score: proposal.seoScore,
									readability_score: proposal.readabilityScore,
									status: proposal.status,
									generated_at: proposal.generatedAt,
									scheduled_date: proposal.scheduledDate,
									metadata: proposal.metadata,
								});

							if (proposalError) {
								console.error('Error saving proposal:', proposalError);
							} else {
								console.log('✅ Proposal saved:', proposal.title);
								onProposalSaved?.(proposal.id);

								// Update job with completed cluster
								if (jobId) {
									const { data: currentJob } = await supabase
										.from('generation_jobs')
										.select('completed_clusters')
										.eq('id', jobId)
										.single();

									const completedClusters = (currentJob?.completed_clusters as string[]) || [];
									completedClusters.push(cluster.name);

									await supabase
										.from('generation_jobs')
										.update({
											completed_clusters: completedClusters,
											current_cluster_index: i + 1,
										})
										.eq('id', jobId);
								}
							}
						}

						// Rate limiting: wait 5 seconds between generations (except for last one)
						if (i < clustersToGenerate.length - 1) {
							await new Promise((resolve) => setTimeout(resolve, 5000));
						}
					} catch (error) {
						console.error(`Error generating proposal for ${cluster.name}:`, error);
						
						// Update job with error (but don't mark as failed - continue with next cluster)
						if (jobId) {
							await supabase
								.from('generation_jobs')
								.update({
									metadata: {
										...(job?.metadata || {}),
										lastError: error instanceof Error ? error.message : 'Unknown error',
									},
								})
								.eq('id', jobId);
						}
						// Continue with next cluster
					}
				}

				// Mark job as completed
				if (jobId) {
					await supabase
						.from('generation_jobs')
						.update({
							status: 'completed',
							completed_at: new Date().toISOString(),
						})
						.eq('id', jobId);
				}

				console.log('✅ Automatic proposal generation completed');
			} catch (error) {
				console.error('Error in background generation:', error);
				// Mark job as failed if it exists
				if (jobId) {
					await supabase
						.from('generation_jobs')
						.update({
							status: 'failed',
							error_message: error instanceof Error ? error.message : 'Unknown error',
						})
						.eq('id', jobId);
				}
			}
		})();

		console.log('✅ Automatic proposal generation started in background');
	} catch (error) {
		console.error('Error starting automatic proposal generation:', error);
		// Don't throw - this is a background operation
	}
};

/**
 * Resume incomplete generation jobs
 * Called when user returns to the app - resumes from where it left off
 */
export const resumeIncompleteGenerations = async (): Promise<void> => {
	try {
		// Find all running generation jobs
		const { data: jobs, error } = await supabase
			.from('generation_jobs')
			.select('*')
			.eq('status', 'running')
			.order('started_at', { ascending: false });

		if (error) {
			console.error('Error fetching generation jobs:', error);
			return;
		}

		if (!jobs || jobs.length === 0) {
			return;
		}

		console.log(`Found ${jobs.length} incomplete generation job(s), resuming...`);

		// Resume each job
		for (const job of jobs) {
			try {
				// Get project data
				const { data: project, error: projectError } = await supabase
					.from('projects')
					.select('*')
					.eq('id', job.project_id)
					.single();

				if (projectError || !project) {
					console.error('Error fetching project for job:', job.id, projectError);
					continue;
				}

				// Get clusters data
				const clusters = job.clusters_data as TopicalMapCluster[];
				const completedClusters = (job.completed_clusters as string[]) || [];
				const currentIndex = job.current_cluster_index || 0;

				// Find remaining clusters to process
				const remainingClusters = clusters.slice(currentIndex);

				if (remainingClusters.length === 0) {
					// Job is actually complete, mark it
					await supabase
						.from('generation_jobs')
						.update({
							status: 'completed',
							completed_at: new Date().toISOString(),
						})
						.eq('id', job.id);
					continue;
				}

				console.log(`Resuming job ${job.id}: ${remainingClusters.length} clusters remaining`);

				// Continue generation from where it left off
				for (let i = 0; i < remainingClusters.length; i++) {
					const cluster = remainingClusters[i];
					if (!cluster) continue;
					const actualIndex = currentIndex + i;

					try {
						// Update job status
						await supabase
							.from('generation_jobs')
							.update({
								current_cluster_index: actualIndex,
								metadata: {
									...(job.metadata || {}),
									currentTask: `Generando proposta per: ${cluster.name}`,
								},
							})
							.eq('id', job.id);

						// Generate proposal
						const abortController = new AbortController();
						const proposal = await contentAgent.generateContentForCluster(
							project as Project,
							cluster,
							abortController.signal
						);

						if (proposal && !abortController.signal.aborted) {
							// Save proposal
							const { error: proposalError } = await supabase
								.from('content_proposals')
								.insert({
									id: proposal.id,
									project_id: proposal.projectId,
									cluster_name: proposal.clusterName,
									cluster_keywords: proposal.clusterKeywords,
									primary_keyword: proposal.primaryKeyword,
									search_volume: proposal.searchVolume,
									difficulty: proposal.difficulty,
									title: proposal.title,
									slug: proposal.slug,
									body: proposal.body,
									seo_score: proposal.seoScore,
									readability_score: proposal.readabilityScore,
									status: proposal.status,
									generated_at: proposal.generatedAt,
									scheduled_date: proposal.scheduledDate,
									metadata: proposal.metadata,
								});

							if (!proposalError) {
								// Update completed clusters
								const updatedCompleted = [...completedClusters, cluster.name];
								await supabase
									.from('generation_jobs')
									.update({
										completed_clusters: updatedCompleted,
										current_cluster_index: actualIndex + 1,
									})
									.eq('id', job.id);
							}
						}

						// Rate limiting
						if (i < remainingClusters.length - 1) {
							await new Promise((resolve) => setTimeout(resolve, 5000));
						}
					} catch (error) {
						console.error(`Error resuming cluster ${cluster.name}:`, error);
						// Continue with next cluster
					}
				}

				// Mark job as completed
				await supabase
					.from('generation_jobs')
					.update({
						status: 'completed',
						completed_at: new Date().toISOString(),
					})
					.eq('id', job.id);

				console.log(`✅ Resumed and completed job ${job.id}`);
			} catch (error) {
				console.error(`Error resuming job ${job.id}:`, error);
				// Mark job as failed
				await supabase
					.from('generation_jobs')
					.update({
						status: 'failed',
						error_message: error instanceof Error ? error.message : 'Unknown error',
					})
					.eq('id', job.id);
			}
		}
	} catch (error) {
		console.error('Error resuming incomplete generations:', error);
	}
};


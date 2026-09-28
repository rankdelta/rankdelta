/**
 * Projects Hook
 * 
 * Provides CRUD operations for project management.
 * Uses React Query for data fetching and caching.
 * 
 * When a project with website_url is created/updated, 
 * the sitemap is automatically fetched and saved for internal linking.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { saveSitemapToProject } from '../services/sitemapAnalyzer';
import { canCreateProject } from '../services/credits';
import { requiresSubscription } from '../config/deployment';
import type { ContentLanguage } from '../lib/contentLanguages';
import type { Project, WorkspaceMarket } from '../types/database';

/** Thrown when the user's plan project cap is reached. */
export class ProjectLimitError extends Error {
  constructor() {
    super('PROJECT_LIMIT_REACHED');
    this.name = 'ProjectLimitError';
  }
}

interface CreateProjectData {
	name: string;
	website_url?: string;
	primary_keyword?: string;
	main_topic?: string;
	tone?: string;
	content_length?: number;
	language?: string;
	/** Kept equal to `language` at creation so every reader agrees (DB default is 'en'). */
	primary_language?: ContentLanguage;
	/** Target market — drives DataForSEO location (keyword volume / SERP). Keep consistent with language. */
	market?: WorkspaceMarket;
	// Author profile for E-E-A-T
	author_name?: string;
	author_bio?: string;
	author_expertise?: string;
}

interface UpdateProjectData extends Partial<CreateProjectData> {
	id: string;
	primary_language?: ContentLanguage;
	market?: WorkspaceMarket;
	vertical?: 'saas' | 'ecommerce' | 'other';
	refresh_cadence?: 'weekly' | 'every_3_days' | 'daily';
	visibility_schedule_enabled?: boolean;
	visibility_scan_lock_at?: string | null;
	seed_keywords?: unknown;
	monthly_api_spend_cap_cents?: number | null;
	store_platform?: string | null;
	catalog_notes?: string | null;
	/** JSONB blob (sitemap cache, money_pages, …). Callers must MERGE with the existing metadata, not overwrite blindly. */
	metadata?: Record<string, unknown>;
}

/**
 * Get all projects for the current user
 */
export const useProjects = () => {
	return useQuery({
		queryKey: ['projects'],
		queryFn: async () => {
			const { data, error } = await supabase
				.from('projects')
				.select('*')
				.order('created_at', { ascending: false });

			if (error) throw error;
			return data as Project[];
		},
	});
};

/**
 * Get a single project by ID
 */
export const useProject = (projectId: string | undefined) => {
	return useQuery({
		queryKey: ['projects', projectId],
		queryFn: async () => {
			if (!projectId) return null;

			const { data, error } = await supabase
				.from('projects')
				.select('*')
				.eq('id', projectId)
				.single();

			if (error) throw error;
			return data as Project;
		},
		enabled: !!projectId,
		retry: (failureCount, err: unknown) => {
			const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: string }).code) : '';
			if (code === 'PGRST116') return false;
			return failureCount < 2;
		},
	});
};

/**
 * Create a new project
 * Automatically saves sitemap pages if website_url is provided
 */
export const useCreateProject = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (projectData: CreateProjectData) => {
			const {
				data: { user },
			} = await supabase.auth.getUser();

			if (!user) throw new Error('User not authenticated');

			// Self-host has no plans/billing — never gate project creation on a (non-existent) subscription.
			if (requiresSubscription()) {
				const gate = await canCreateProject(user.id);
				if (!gate.canCreate) {
					throw new ProjectLimitError();
				}
			}

			const { data, error } = await supabase
				.from('projects')
				.insert({
					...projectData,
					user_id: user.id,
				})
				.select()
				.single();

			if (error) throw error;
			
			const project = data as Project;

			// Automatically fetch and save sitemap if website_url is provided
			if (project.website_url) {
				console.log('🔗 Fetching sitemap for new project...');
				// Run in background, don't block project creation
				saveSitemapToProject(project.id, project.website_url)
					.then((result) => {
						if (result.success) {
							console.log(`✅ Saved ${result.pagesCount} sitemap pages for internal linking`);
						}
					})
					.catch((err: unknown) => {
						console.warn('⚠️ Failed to fetch sitemap:', err);
					});
			}

			return project;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['projects'] });
		},
	});
};

/**
 * Update an existing project
 * Refreshes sitemap if website_url is updated
 */
export const useUpdateProject = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ id, ...updateData }: UpdateProjectData) => {
			const { data, error } = await supabase
				.from('projects')
				.update(updateData)
				.eq('id', id)
				.select()
				.single();

			if (error) throw error;
			
			const project = data as Project;

			// Refresh sitemap if website_url was updated
			if (updateData.website_url && project.website_url) {
				console.log('🔄 Refreshing sitemap for updated project...');
				saveSitemapToProject(project.id, project.website_url)
					.then((result) => {
						if (result.success) {
							console.log(`✅ Updated ${result.pagesCount} sitemap pages for internal linking`);
						}
					})
					.catch((err: unknown) => {
						console.warn('⚠️ Failed to refresh sitemap:', err);
					});
			}

			return project;
		},
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: ['projects'] });
			queryClient.invalidateQueries({ queryKey: ['projects', data.id] });
		},
	});
};

/**
 * Delete a project
 */
export const useDeleteProject = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (projectId: string) => {
			const { error } = await supabase.from('projects').delete().eq('id', projectId);

			if (error) throw error;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['projects'] });
		},
	});
};


/**
 * Content Hooks
 * 
 * CRUD operations for generated content.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import type { Content } from '../types/database';

interface CreateContentData {
	project_id: string;
	title: string;
	slug?: string;
	body: string;
	topic?: string;
	keywords_used?: string[];
	seo_score?: number;
	readability_score?: number;
	status?: 'draft' | 'published' | 'archived';
	metadata?: Record<string, unknown>;
}

interface UpdateContentData extends Partial<CreateContentData> {
	id: string;
	published_date?: string | null;
}

/**
 * Get all content for a project
 */
export const useContentList = (projectId: string | undefined) => {
	return useQuery({
		queryKey: ['content', projectId],
		queryFn: async () => {
			if (!projectId) return [];

			// `body` stays: the calendar preview reads it (CalendarContent → article.body).
			const { data, error } = await supabase
				.from('content')
				.select('*')
				.eq('project_id', projectId)
				.order('generated_date', { ascending: false })
				.limit(500);

			if (error) throw error;
			return data as Content[];
		},
		enabled: !!projectId,
	});
};

/**
 * Get a single content by ID
 */
export const useContent = (contentId: string | undefined) => {
	return useQuery({
		queryKey: ['content', 'detail', contentId],
		queryFn: async () => {
			if (!contentId) return null;

			const { data, error } = await supabase
				.from('content')
				.select('*')
				.eq('id', contentId)
				.single();

			if (error) throw error;
			return data as Content;
		},
		enabled: !!contentId,
	});
};

/**
 * Create new content
 */
export const useCreateContent = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (contentData: CreateContentData) => {
			const { data, error } = await supabase
				.from('content')
				.insert(contentData)
				.select()
				.single();

			if (error) throw error;
			return data as Content;
		},
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: ['content', data.project_id] });
			queryClient.invalidateQueries({ queryKey: ['content', 'detail', data.id] });
		},
	});
};

/**
 * Update content
 */
export const useUpdateContent = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ id, ...updateData }: UpdateContentData) => {
			const { data, error } = await supabase
				.from('content')
				.update(updateData)
				.eq('id', id)
				.select()
				.single();

			if (error) throw error;
			return data as Content;
		},
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: ['content', data.project_id] });
			queryClient.invalidateQueries({ queryKey: ['content', 'detail', data.id] });
		},
	});
};

/**
 * Delete content
 */
export const useDeleteContent = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (contentId: string) => {
			// Get project_id before deleting
			const { data: content } = await supabase
				.from('content')
				.select('project_id')
				.eq('id', contentId)
				.single();

			const { error } = await supabase.from('content').delete().eq('id', contentId);

			if (error) throw error;
			return { contentId, projectId: content?.project_id };
		},
		onSuccess: ({ projectId }) => {
			queryClient.invalidateQueries({ queryKey: ['content', projectId] });
		},
	});
};


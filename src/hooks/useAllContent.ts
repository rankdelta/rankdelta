/**
 * Hook to get all content across all projects for calendar view
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import type { Content } from '../types/database';

/**
 * Get all content for the current user (across all projects)
 */
export const useAllContent = () => {
	return useQuery({
		queryKey: ['content', 'all'],
		queryFn: async () => {
			const {
				data: { user },
			} = await supabase.auth.getUser();

			if (!user) return [];

			// Get all projects for user
			const { data: projects } = await supabase
				.from('projects')
				.select('id')
				.eq('user_id', user.id);

			if (!projects || projects.length === 0) return [];

			const projectIds = projects.map((p) => p.id);

			// Get all content for these projects (`body` stays: the calendar preview reads it)
			const { data, error } = await supabase
				.from('content')
				.select('*')
				.in('project_id', projectIds)
				.order('generated_date', { ascending: false })
				.limit(500);

			if (error) throw error;
			return (data || []) as Content[];
		},
	});
};


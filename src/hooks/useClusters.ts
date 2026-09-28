/**
 * Clusters Hook
 * 
 * Manages clusters/topical map data
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import type { Cluster } from '../types/database';

interface CreateClusterData {
	project_id: string;
	cluster_name: string;
	keywords_list: string[];
	content_gaps?: Record<string, unknown>;
	visualization_data?: Record<string, unknown>;
}

/**
 * Get all clusters for a project
 */
export const useClusters = (projectId: string | undefined) => {
	return useQuery({
		queryKey: ['clusters', projectId],
		queryFn: async () => {
			if (!projectId) return [];

			const { data, error } = await supabase
				.from('clusters')
				.select('*')
				.eq('project_id', projectId)
				.order('created_at', { ascending: false });

			if (error) throw error;
			return (data || []) as Cluster[];
		},
		enabled: !!projectId,
	});
};

/**
 * Create a cluster
 */
export const useCreateCluster = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (clusterData: CreateClusterData) => {
			const { data, error } = await supabase
				.from('clusters')
				.insert({
					...clusterData,
					keywords_list: clusterData.keywords_list,
				})
				.select()
				.single();

			if (error) throw error;
			return data as Cluster;
		},
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: ['clusters', data.project_id] });
		},
	});
};

/**
 * Create multiple clusters (bulk insert)
 */
export const useCreateClusters = () => {
	const queryClient = useQueryClient();
	const createCluster = useCreateCluster();

	return useMutation({
		mutationFn: async (clustersData: CreateClusterData[]) => {
			const results = await Promise.all(
				clustersData.map((cluster) => createCluster.mutateAsync(cluster))
			);
			return results;
		},
		onSuccess: (data) => {
			if (data.length > 0) {
				queryClient.invalidateQueries({ queryKey: ['clusters', data[0]?.project_id] });
			}
		},
	});
};

/**
 * Save keywords from cluster
 */
export const useSaveKeywords = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			projectId,
			clusterId,
			keywords,
		}: {
			projectId: string;
			clusterId: string;
			keywords: Array<{ keyword: string; search_volume?: number; difficulty?: number }>;
		}) => {
			const keywordsToInsert = keywords.map((k) => ({
				project_id: projectId,
				cluster_id: clusterId,
				keyword: k.keyword,
				search_volume: k.search_volume,
				difficulty: k.difficulty,
			}));

			const { error } = await supabase.from('keywords').insert(keywordsToInsert);

			if (error) throw error;
		},
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: ['keywords', variables.projectId] });
		},
	});
};


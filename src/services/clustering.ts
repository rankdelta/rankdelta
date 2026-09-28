/**
 * Keyword Clustering Service
 * 
 * Handles semantic clustering of keywords using DataforSEO for enrichment
 * and intelligent grouping.
 */

import { getKeywordData, getKeywordSuggestions } from './dataforseo';
import { LOCATION } from '../lib/seoMarkets';

export interface Cluster {
	name: string;
	keywords: string[];
	search_volume?: number;
	difficulty?: number;
	gap_analysis?: string;
}

/**
 * Cluster keywords semantically with DataforSEO enrichment
 */
export const clusterKeywords = async (keywords: string[]): Promise<Cluster[]> => {
	// Get keyword data from DataforSEO
	let keywordData: Array<{ keyword: string; search_volume?: number; difficulty?: number }> = [];
	
	try {
		const data = await getKeywordData(keywords);
		keywordData = data;
	} catch (error) {
		console.warn('DataforSEO enrichment failed, using basic clustering:', error);
	}

	// Create clusters with enriched data
	const clusters: Cluster[] = [];
	const processed = new Set<string>();

	for (const keyword of keywords) {
		if (processed.has(keyword.toLowerCase())) continue;

		const data = keywordData.find((d) => d.keyword.toLowerCase() === keyword.toLowerCase());
		
		const cluster: Cluster = {
			name: keyword,
			keywords: [keyword],
			search_volume: data?.search_volume,
			difficulty: data?.difficulty,
		};

		// Find similar keywords (simple word matching)
		for (const otherKeyword of keywords) {
			if (processed.has(otherKeyword.toLowerCase())) continue;
			if (keyword === otherKeyword) continue;

			// Simple similarity check (words in common)
			const keywordWords = keyword.toLowerCase().split(/\s+/);
			const otherWords = otherKeyword.toLowerCase().split(/\s+/);
			const commonWords = keywordWords.filter((w) => otherWords.includes(w));

			if (commonWords.length > 0) {
				const otherData = keywordData.find((d) => d.keyword.toLowerCase() === otherKeyword.toLowerCase());
				cluster.keywords.push(otherKeyword);
				
				// Update cluster stats with highest values
				if (otherData?.search_volume && (!cluster.search_volume || otherData.search_volume > cluster.search_volume)) {
					cluster.search_volume = otherData.search_volume;
				}
				if (otherData?.difficulty && (!cluster.difficulty || otherData.difficulty > cluster.difficulty)) {
					cluster.difficulty = otherData.difficulty;
				}
				
				processed.add(otherKeyword.toLowerCase());
			}
		}

		processed.add(keyword.toLowerCase());
		clusters.push(cluster);
	}

	return clusters;
};

/**
 * Get related keywords for a cluster using DataforSEO
 */
export const enrichClusterWithRelatedKeywords = async (
	cluster: Cluster,
	limit: number = 10
): Promise<Cluster> => {
	try {
		// Get suggestions for the main cluster keyword
		const suggestions = await getKeywordSuggestions(cluster.name, LOCATION.US, 'en', limit);
		
		// Filter out keywords already in cluster
		const existing = new Set(cluster.keywords.map((k) => k.toLowerCase()));
		const newKeywords = suggestions.filter((k) => !existing.has(k.toLowerCase()));
		
		return {
			...cluster,
			keywords: [...cluster.keywords, ...newKeywords.slice(0, limit)],
		};
	} catch (error) {
		console.error('Failed to enrich cluster:', error);
		return cluster;
	}
};

/**
 * Enhanced clustering with Claude API (when available)
 */
export const clusterKeywordsWithClaude = async (
	keywords: string[]
): Promise<Cluster[]> => {
	// LLM clustering goes through seo-proxy when we wire it; never read a VITE_ provider key.
	return clusterKeywords(keywords);
};


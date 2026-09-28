/**
 * Rank Tracking Service
 * 
 * Tracks keyword rankings using DataforSEO API
 * Provides historical data and position changes
 */

import { getSERPAnalysis, getKeywordData } from './dataforseo';
import { LOCATION } from '../lib/seoMarkets';

export interface RankData {
	keyword: string;
	position: number | null;
	url: string | null;
	title: string | null;
	previousPosition: number | null;
	change: number; // positive = improved, negative = dropped
	searchVolume: number | null;
	difficulty: number | null;
	lastChecked: string;
	rankingId?: string; // Optional ranking ID for history lookup
	/** Outcome of the most recent check: a failed check is NOT "not ranked". */
	checkStatus?: 'completed' | 'failed' | 'pending';
	errorMessage?: string | null;
}

export interface RankHistory {
	keyword: string;
	history: Array<{
		date: string;
		position: number | null;
		url: string | null;
	}>;
}

/**
 * Track current rankings for keywords
 */
export const trackRankings = async (
	keywords: string[],
	websiteUrl: string,
	locationCode: number = LOCATION.ITALY,
	languageCode: string = 'it'
): Promise<RankData[]> => {
	const results: RankData[] = [];

	for (const keyword of keywords) {
		try {
			// Get SERP results
			const serpResults = await getSERPAnalysis(keyword, locationCode, languageCode, 100);
			
			// Find our website in results
			const ourResult = serpResults.find((result) => 
				result.url.toLowerCase().includes(new URL(websiteUrl).hostname.toLowerCase())
			);

			// Get keyword data
			const keywordData = await getKeywordData([keyword], locationCode, languageCode);
			const data = keywordData[0];

			results.push({
				keyword,
				position: ourResult ? ourResult.position : null,
				url: ourResult?.url || null,
				title: ourResult?.title || null,
				previousPosition: null, // Will be loaded from database
				change: 0,
				searchVolume: data?.search_volume || null,
				difficulty: data?.difficulty || null,
				lastChecked: new Date().toISOString(),
			});
		} catch (error) {
			console.error(`Error tracking keyword ${keyword}:`, error);
			results.push({
				keyword,
				position: null,
				url: null,
				title: null,
				previousPosition: null,
				change: 0,
				searchVolume: null,
				difficulty: null,
				lastChecked: new Date().toISOString(),
			});
		}
	}

	return results;
};

/**
 * Get ranking history for a keyword
 */
export const getRankingHistory = async (
	keyword: string,
	websiteUrl: string,
	locationCode: number = LOCATION.ITALY,
	languageCode: string = 'it'
): Promise<RankHistory> => {
	// In production, this would fetch from database
	// For now, return current position
	const currentRank = await trackRankings([keyword], websiteUrl, locationCode, languageCode);
	
	return {
		keyword,
		history: [
			{
				date: new Date().toISOString(),
				position: currentRank[0]?.position || null,
				url: currentRank[0]?.url || null,
			},
		],
	};
};

/**
 * Compare rankings with competitors
 */
export const compareWithCompetitors = async (
	keyword: string,
	competitorUrls: string[],
	locationCode: number = LOCATION.ITALY,
	languageCode: string = 'it'
): Promise<Array<{ url: string; position: number | null }>> => {
	const serpResults = await getSERPAnalysis(keyword, locationCode, languageCode, 100);
	
	return competitorUrls.map((url) => {
		const hostname = new URL(url).hostname.toLowerCase();
		const result = serpResults.find((r) => r.url.toLowerCase().includes(hostname));
		
		return {
			url,
			position: result?.position || null,
		};
	});
};


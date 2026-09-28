/**
 * DataforSEO Service
 * 
 * ⚠️ SECURITY WARNING: This service should NOT be used directly in production.
 * API credentials should NEVER be exposed in frontend code.
 * 
 * For production, use the secure API service (src/services/api.ts) which
 * calls a backend API that hides the credentials.
 * 
 * This is kept for MVP/development only.
 */

import { isProxyEnabled, proxyDataForSEO } from './edgeProxy';
import { LOCATION, resolveLocale } from '../lib/seoMarkets';

export { LOCATION, resolveLocale };

/** Tiny in-memory TTL cache to avoid duplicate paid calls within a session. */
const _cache = new Map<string, { at: number; value: unknown }>();
const CACHE_TTL_MS = 30 * 60 * 1000;
function cached<T>(key: string, factory: () => Promise<T>): Promise<T> {
	const hit = _cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value as T);
	return factory().then((value) => {
		_cache.set(key, { at: Date.now(), value });
		return value;
	});
}

/**
 * DataForSEO v3 responses use `{ tasks: [{ result: [...], cost, status_code }] }`.
 * Some legacy code assumed a top-level array; normalize here.
 */
export function extractDataForSeoTaskResults(body: unknown): unknown[] {
	if (body == null) return [];
	if (typeof body !== 'object') return [];
	const o = body as Record<string, unknown>;
	if (Array.isArray(o['tasks']) && o['tasks'].length > 0) {
		const t0 = o['tasks'][0] as Record<string, unknown>;
		const res = t0['result'];
		if (Array.isArray(res)) return res;
		return [];
	}
	// Rare/alternate: POST echo as array
	if (Array.isArray(body) && body.length > 0) {
		const first = body[0] as Record<string, unknown>;
		if (first && Array.isArray(first['result'])) return first['result'] as unknown[];
	}
	return [];
}

interface KeywordData {
	keyword: string;
	search_volume?: number;
	difficulty?: number;
	cpc?: number;
	competition?: number;
	monthly_searches?: Array<{ year: number; month: number; search_volume: number }>;
}

interface SERPResult {
	title: string;
	url: string;
	description: string;
	position: number;
}

/**
 * Make a DataforSEO request via the seo-proxy Edge Function.
 *
 * All calls route server-side so the DataForSEO login/password live as Edge Function secrets
 * and are NEVER bundled into the client. There is no client-side credential fallback by design.
 */
const makeRequest = async (endpoint: string, payload: unknown) => {
	if (!isProxyEnabled()) {
		throw new Error('Proxy DataForSEO non abilitato. Imposta VITE_USE_SUPABASE_PROXY=true e configura i secret DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD sulla Edge Function seo-proxy.');
	}
	const raw = await proxyDataForSEO(endpoint, payload);
	return extractDataForSeoTaskResults(raw);
};

/**
 * Get keyword data including search volume and difficulty
 * Uses the keyword_suggestions endpoint for single keywords or related_keywords for bulk
 */
export const getKeywordData = async (
	keywords: string[],
	locationCode: number = LOCATION.US, // Italy=2380 (US=2840, UK=2826)
	languageCode: string = 'en'
): Promise<KeywordData[]> => {
	try {
		const allResults: KeywordData[] = [];
		
		// Process keywords one at a time using keyword_suggestions endpoint
		for (const keyword of keywords) {
			const payload = {
				keyword: keyword,
				location_code: locationCode,
				language_code: languageCode,
				limit: 1,
				include_seed_keyword: true,
			};

			try {
				const results = await makeRequest('/dataforseo_labs/google/keyword_suggestions/live', payload);
				
				// Parse the response - DataforSEO v3 returns data in a nested structure
				if (Array.isArray(results) && results.length > 0) {
					const resultData = results[0] as Record<string, unknown>;
					const items = (resultData['items'] as Array<Record<string, unknown>>) || [];
					
					// Find the exact keyword match or use the first result
					const matchingItem = items.find((item: Record<string, unknown>) => 
						(item['keyword'] as string)?.toLowerCase() === keyword.toLowerCase()
					) || items[0];
					
					if (matchingItem) {
						const keywordInfo = (matchingItem['keyword_info'] as Record<string, unknown>) || {};
						const keywordProps = (matchingItem['keyword_properties'] as Record<string, unknown>) || {};
						
						allResults.push({
							keyword: (matchingItem['keyword'] as string) || keyword,
							search_volume: (keywordInfo['search_volume'] as number) || 0,
							difficulty: (keywordProps['keyword_difficulty'] as number) || undefined,
							cpc: (keywordInfo['cpc'] as number) || undefined,
							competition: (keywordInfo['competition'] as number) || undefined,
							monthly_searches: (keywordInfo['monthly_searches'] as Array<{ year: number; month: number; search_volume: number }>) || [],
						});
					} else {
						// No results found for this keyword
						allResults.push({
							keyword,
							search_volume: 0,
							difficulty: undefined,
						});
					}
				} else {
					allResults.push({
						keyword,
						search_volume: 0,
						difficulty: undefined,
					});
				}
			} catch (keywordError) {
				console.warn(`⚠️ Failed to get data for keyword "${keyword}":`, keywordError);
				allResults.push({
					keyword,
					search_volume: undefined,
					difficulty: undefined,
				});
			}
		}
		
		return allResults;
	} catch (error) {
		console.error('DataforSEO keyword data error:', error);
		// Return fallback data
		return keywords.map((keyword) => ({
			keyword,
			search_volume: undefined,
			difficulty: undefined,
		}));
	}
};

/**
 * Get SERP analysis for a keyword with advanced features
 */
export const getSERPAnalysis = async (
	keyword: string,
	locationCode: number = LOCATION.US, // Italy
	languageCode: string = 'en',
	limit: number = 10
): Promise<SERPResult[]> => {
	const payload = {
		keyword: keyword,
		location_code: locationCode,
		language_code: languageCode,
		depth: 100, // Maximum depth for results
		device: 'desktop',
		os: 'windows',
	};

	try {
		const results = (await makeRequest('/serp/google/organic/live/advanced', payload)) as Array<Record<string, unknown>>;
		
		// Parse the v3 response structure - results are nested in items
		if (Array.isArray(results) && results.length > 0) {
			const resultData = results[0] as Record<string, unknown>;
			const items = (resultData['items'] as Array<Record<string, unknown>>) || [];
			
			// Filter for organic results only
			const organicResults = items.filter((item: Record<string, unknown>) => 
				item['type'] === 'organic'
			);
			
			return organicResults
				.slice(0, limit)
				.map((item: Record<string, unknown>, index: number) => ({
					title: (item['title'] as string) || '',
					url: (item['url'] as string) || '',
					description: (item['description'] as string) || '',
					position: (item['rank_absolute'] as number) || index + 1,
				}));
		}
		
		return [];
	} catch (error) {
		console.error('DataforSEO SERP analysis error:', error);
		return [];
	}
};

/**
 * Get People Also Ask questions from SERP
 * Critical for topical authority (Matt Diggity methodology)
 */
export const getPeopleAlsoAsk = async (
	keyword: string,
	locationCode: number = LOCATION.US, // Italy
	languageCode: string = 'en'
): Promise<Array<{ question: string; answer: string; position: number }>> => {
	const payload = {
		keyword: keyword,
		location_code: locationCode,
		language_code: languageCode,
		depth: 100,
		device: 'desktop',
		os: 'windows',
	};

	try {
		const results = (await makeRequest('/serp/google/organic/live/advanced', payload)) as Array<Record<string, unknown>>;
		
		// Extract People Also Ask from SERP features
		const paa: Array<{ question: string; answer: string; position: number }> = [];
		
		// DataforSEO v3 returns PAA nested in result[0].items
		if (Array.isArray(results) && results.length > 0) {
			const resultData = results[0] as Record<string, unknown>;
			const items = (resultData['items'] as Array<Record<string, unknown>>) || [];
			
			items.forEach((item: Record<string, unknown>) => {
				if (item['type'] === 'people_also_ask') {
					const paaItems = (item['items'] as Array<Record<string, unknown>>) || [];
					paaItems.forEach((paaItem: Record<string, unknown>, index: number) => {
						paa.push({
							question: (paaItem['title'] as string) || (paaItem['question'] as string) || '',
							answer: (paaItem['snippet'] as string) || (paaItem['answer'] as string) || '',
							position: index + 1,
						});
					});
				}
			});
		}
		
		return paa.slice(0, 10); // Return top 10 PAA
	} catch (error) {
		console.error('DataforSEO PAA error:', error);
		return [];
	}
};

/**
 * Get Related Searches (bottom of SERP)
 * Important for keyword expansion
 */
export const getRelatedSearches = async (
	keyword: string,
	locationCode: number = LOCATION.US, // Italy
	languageCode: string = 'en'
): Promise<string[]> => {
	const payload = {
		keyword: keyword,
		location_code: locationCode,
		language_code: languageCode,
		depth: 100,
		device: 'desktop',
		os: 'windows',
	};

	try {
		const results = (await makeRequest('/serp/google/organic/live/advanced', payload)) as Array<Record<string, unknown>>;
		
		const related: string[] = [];
		
		// DataforSEO v3 returns related searches nested in result[0].items
		if (Array.isArray(results) && results.length > 0) {
			const resultData = results[0] as Record<string, unknown>;
			const items = (resultData['items'] as Array<Record<string, unknown>>) || [];
			
			items.forEach((item: Record<string, unknown>) => {
				if (item['type'] === 'related_searches') {
					const relatedItems = (item['items'] as Array<Record<string, unknown>>) || [];
					relatedItems.forEach((relatedItem: Record<string, unknown>) => {
						const query = (relatedItem['title'] as string) || (relatedItem['query'] as string);
						if (query) {
							related.push(query);
						}
					});
				}
			});
		}
		
		return related.slice(0, 20);
	} catch (error) {
		console.error('DataforSEO Related Searches error:', error);
		return [];
	}
};

/**
 * Get keyword suggestions (related keywords)
 */
export const getKeywordSuggestions = async (
	keyword: string,
	locationCode: number = LOCATION.US, // Italy
	languageCode: string = 'en',
	limit: number = 50
): Promise<string[]> => {
	const payload = {
		keyword: keyword,
		location_code: locationCode,
		language_code: languageCode,
		include_serp_info: false,
		limit: limit,
	};

	try {
		const results = await makeRequest('/dataforseo_labs/google/keyword_suggestions/live', payload);
		
		// Parse the v3 response structure
		if (Array.isArray(results) && results.length > 0) {
			const resultData = results[0] as Record<string, unknown>;
			const items = (resultData['items'] as Array<Record<string, unknown>>) || [];
			
			return items
				.slice(0, limit)
				.map((item: Record<string, unknown>) => item['keyword'] as string)
				.filter((k: string) => k && k.length > 0);
		}
		
		return [];
	} catch (error) {
		console.error('DataforSEO keyword suggestions error:', error);
		return [];
	}
};

/**
 * Get keyword difficulty score
 */
export const getKeywordDifficulty = async (
	keyword: string,
	locationCode: number = LOCATION.US, // Italy
	languageCode: string = 'en'
): Promise<number | null> => {
	try {
		const data = await getKeywordData([keyword], locationCode, languageCode);
		return data[0]?.difficulty || null;
	} catch (error) {
		console.error('DataforSEO keyword difficulty error:', error);
		return null;
	}
};

/**
 * Get search volume for keywords
 */
export const getSearchVolume = async (
	keywords: string[],
	locationCode: number = LOCATION.US, // Italy
	languageCode: string = 'en'
): Promise<Record<string, number>> => {
	try {
		const data = await getKeywordData(keywords, locationCode, languageCode);
		const volumeMap: Record<string, number> = {};
		
		data.forEach((item) => {
			volumeMap[item.keyword] = item.search_volume || 0;
		});
		
		return volumeMap;
	} catch (error) {
		console.error('DataforSEO search volume error:', error);
		return {};
	}
};

// ─── ACCURATE BULK ENDPOINTS (verified June 2026) ──────────────────────────────

/**
 * REAL Google Ads monthly search volume, bulk (up to 1000 keywords, one call).
 * Endpoint: keywords_data/google_ads/search_volume/live.
 * NOTE: response has NO `items` — each keyword is a direct object in result[].
 */
export const getSearchVolumeBulk = async (
	keywords: string[],
	locationCode: number = LOCATION.US,
	languageCode: string = 'en'
): Promise<Record<string, { searchVolume: number; cpc: number; competitionIndex: number }>> => {
	if (keywords.length === 0) return {};
	const key = `sv:${locationCode}:${languageCode}:${keywords.slice().sort().join('|')}`;
	return cached(key, async () => {
		const out: Record<string, { searchVolume: number; cpc: number; competitionIndex: number }> = {};
		try {
			// google_ads caps at 1000 kw/call; chunk to be safe
			for (let i = 0; i < keywords.length; i += 700) {
				const chunk = keywords.slice(i, i + 700);
				const results = await makeRequest('/keywords_data/google_ads/search_volume/live', {
					keywords: chunk,
					location_code: locationCode,
					language_code: languageCode,
				});
				(results as Array<Record<string, unknown>>).forEach((r) => {
					const kw = (r['keyword'] as string) ?? '';
					if (!kw) return;
					out[kw.toLowerCase()] = {
						searchVolume: (r['search_volume'] as number) ?? 0,
						cpc: (r['cpc'] as number) ?? 0,
						competitionIndex: (r['competition_index'] as number) ?? 0,
					};
				});
			}
		} catch (e) {
			console.warn('DataforSEO bulk search volume failed:', e);
		}
		return out;
	});
};

/**
 * REAL bulk keyword difficulty (0-100), up to 1000 keywords in one call.
 * Endpoint: dataforseo_labs/google/bulk_keyword_difficulty/live → result[].items[].keyword_difficulty.
 */
export const getBulkKeywordDifficulty = async (
	keywords: string[],
	locationCode: number = LOCATION.US,
	languageCode: string = 'en'
): Promise<Record<string, number>> => {
	if (keywords.length === 0) return {};
	const key = `kd:${locationCode}:${languageCode}:${keywords.slice().sort().join('|')}`;
	return cached(key, async () => {
		const out: Record<string, number> = {};
		try {
			const results = await makeRequest('/dataforseo_labs/google/bulk_keyword_difficulty/live', {
				keywords: keywords.slice(0, 1000),
				location_code: locationCode,
				language_code: languageCode,
			});
			const resultData = (results as Array<Record<string, unknown>>)[0];
			const items = (resultData?.['items'] as Array<Record<string, unknown>>) ?? [];
			items.forEach((it) => {
				const kw = (it['keyword'] as string) ?? '';
				if (kw) out[kw.toLowerCase()] = (it['keyword_difficulty'] as number) ?? 0;
			});
		} catch (e) {
			console.warn('DataforSEO bulk difficulty failed:', e);
		}
		return out;
	});
};

/**
 * Accurate enrichment: real Google Ads volume + real keyword difficulty, in 2 bulk calls
 * (vs the legacy per-keyword keyword_suggestions hack). Use this for audit/plan enrichment.
 */
export const getEnrichedKeywordData = async (
	keywords: string[],
	locationCode: number = LOCATION.US,
	languageCode: string = 'en'
): Promise<KeywordData[]> => {
	const [volumes, difficulties] = await Promise.all([
		getSearchVolumeBulk(keywords, locationCode, languageCode),
		getBulkKeywordDifficulty(keywords, locationCode, languageCode),
	]);
	return keywords.map((keyword) => {
		const v = volumes[keyword.toLowerCase()];
		return {
			keyword,
			search_volume: v?.searchVolume ?? 0,
			difficulty: difficulties[keyword.toLowerCase()],
			cpc: v?.cpc,
			competition: v ? v.competitionIndex / 100 : undefined,
		};
	});
};

// ─── COMBINED SERP (one call → organic + PAA + related) ────────────────────────

export interface SerpInsights {
	organic: SERPResult[];
	peopleAlsoAsk: Array<{ question: string; answer: string; position: number }>;
	relatedSearches: string[];
}

/**
 * ONE serp/google/organic/live/advanced call returns organic results, People Also Ask,
 * and Related Searches together (the old code made 3 identical paid calls). PAA answers
 * require people_also_ask_click_depth to be expanded.
 */
export const getSerpInsights = async (
	keyword: string,
	locationCode: number = LOCATION.US,
	languageCode: string = 'en',
	organicLimit: number = 10
): Promise<SerpInsights> => {
	const key = `serp:${locationCode}:${languageCode}:${keyword.toLowerCase()}`;
	return cached(key, async () => {
		const empty: SerpInsights = { organic: [], peopleAlsoAsk: [], relatedSearches: [] };
		try {
			const results = (await makeRequest('/serp/google/organic/live/advanced', {
				keyword,
				location_code: locationCode,
				language_code: languageCode,
				depth: 100,
				device: 'desktop',
				os: 'windows',
				people_also_ask_click_depth: 1,
			})) as Array<Record<string, unknown>>;

			if (!Array.isArray(results) || results.length === 0) return empty;
			const items = ((results[0] as Record<string, unknown>)['items'] as Array<Record<string, unknown>>) ?? [];

			const organic: SERPResult[] = [];
			const paa: Array<{ question: string; answer: string; position: number }> = [];
			const related: string[] = [];

			for (const item of items) {
				const type = item['type'];
				if (type === 'organic' && organic.length < organicLimit) {
					organic.push({
						title: (item['title'] as string) ?? '',
						url: (item['url'] as string) ?? '',
						description: (item['description'] as string) ?? '',
						position: (item['rank_absolute'] as number) ?? organic.length + 1,
					});
				} else if (type === 'people_also_ask') {
					const qItems = (item['items'] as Array<Record<string, unknown>>) ?? [];
					qItems.forEach((q, i) => {
						const expanded = (q['expanded_element'] as Array<Record<string, unknown>>) ?? [];
						const answer = (expanded[0]?.['description'] as string) ?? (expanded[0]?.['markdown'] as string) ?? '';
						const question = (q['title'] as string) ?? '';
						if (question) paa.push({ question, answer, position: i + 1 });
					});
				} else if (type === 'related_searches') {
					const relItems = (item['items'] as unknown[]) ?? [];
					relItems.forEach((r) => {
						if (typeof r === 'string') related.push(r);
						else if (r && typeof r === 'object') {
							const q = (r as Record<string, unknown>)['title'] ?? (r as Record<string, unknown>)['query'];
							if (typeof q === 'string') related.push(q);
						}
					});
				}
			}
			return { organic, peopleAlsoAsk: paa.slice(0, 12), relatedSearches: related.slice(0, 20) };
		} catch (error) {
			console.error('DataforSEO SERP insights error:', error);
			return empty;
		}
	});
};


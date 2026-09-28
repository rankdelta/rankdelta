/**
 * Sitemap Analyzer Service
 * 
 * Analyzes sitemap.xml to identify content that needs updating
 */

import { supabase } from '../lib/supabaseClient';
import { proxyFetchPage } from './edgeProxy';
import type { Content } from '../types/database';
import type { Project } from '../types/database';

export interface SitemapUrl {
	loc: string;
	lastmod?: string;
	changefreq?: string;
	priority?: number;
}

export interface ContentUpdateCandidate {
	url: string;
	lastModified?: Date;
	daysSinceUpdate: number;
	existingContent?: Content;
	needsUpdate: boolean;
	reason: 'outdated' | 'missing' | 'low_performance' | 'competitor_improved';
	priority: 'high' | 'medium' | 'low';
	suggestedChanges: Array<string>;
	serpPosition?: number;
	serpCompetitors?: Array<{ url: string; title: string }>;
}

/**
 * Parse XML sitemap index to extract child sitemap URLs
 */
const parseSitemapIndex = (xmlText: string): Array<string> => {
	const sitemapUrls: Array<string> = [];
	
	try {
		const sitemapMatches = xmlText.matchAll(/<sitemap>(.*?)<\/sitemap>/gs);
		for (const match of sitemapMatches) {
			const sitemapBlock = match[1];
			if (sitemapBlock) {
				const locMatch = sitemapBlock.match(/<loc>(.*?)<\/loc>/);
				if (locMatch && locMatch[1]) {
					sitemapUrls.push(locMatch[1].trim());
				}
			}
		}
	} catch (error) {
		console.error('Error parsing sitemap index:', error);
	}

	return sitemapUrls;
};

/**
 * Parse XML sitemap
 */
const parseSitemapXML = (xmlText: string): Array<SitemapUrl> => {
	const urls: Array<SitemapUrl> = [];
	
	try {
		// Simple XML parsing (for production, use a proper XML parser)
		// Handle both <url> and <urlset> formats
		const urlMatches = xmlText.matchAll(/<url>(.*?)<\/url>/gs);
		
		for (const match of urlMatches) {
			const urlBlock = match[1];
			if (urlBlock) {
				// Extract <loc> - can be on multiple lines
				const locMatch = urlBlock.match(/<loc>(.*?)<\/loc>/s);
				// Extract <lastmod> - can be on multiple lines
				const lastmodMatch = urlBlock.match(/<lastmod>(.*?)<\/lastmod>/s);
				const changefreqMatch = urlBlock.match(/<changefreq>(.*?)<\/changefreq>/s);
				const priorityMatch = urlBlock.match(/<priority>(.*?)<\/priority>/s);

				if (locMatch && locMatch[1]) {
					const loc = locMatch[1].trim().replace(/\s+/g, ' '); // Clean whitespace
					const lastmod = lastmodMatch && lastmodMatch[1] ? lastmodMatch[1].trim().replace(/\s+/g, ' ') : undefined;
					
					urls.push({
						loc,
						lastmod,
						changefreq: changefreqMatch && changefreqMatch[1] ? changefreqMatch[1].trim() : undefined,
						priority: priorityMatch && priorityMatch[1] ? parseFloat(priorityMatch[1].trim()) : undefined,
					});
				}
			}
		}
		
		console.log(`Parsed ${urls.length} URLs from sitemap XML`);
		const firstUrl = urls[0];
		if (firstUrl && firstUrl.lastmod) {
			console.log(`Sample URL: ${firstUrl.loc}, lastmod: ${firstUrl.lastmod}`);
		}
	} catch (error) {
		console.error('Error parsing sitemap XML:', error);
	}

	return urls;
};

/**
 * Fetch a URL from the browser, falling back to this install's own `seo-proxy` (server-side,
 * SSRF-guarded) when the site blocks cross-origin reads. Never a third-party public proxy.
 */
const fetchWithProxy = async (url: string): Promise<Response> => {
	// Try direct fetch first (with short timeout to quickly detect CORS)
	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 3000); // Short timeout to quickly detect CORS
		
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'Accept': 'application/xml, text/xml, */*',
				// Browser UA — many sites' WAFs 403 obvious bot UAs (e.g. "SEOBot"), blocking sitemap fetch.
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
			},
			signal: controller.signal,
		});
		
		clearTimeout(timeoutId);
		return response;
	} catch (error) {
		// CORS or network failure: fetch it server-side through this install's own seo-proxy.
		if (error instanceof TypeError) {
			console.warn(`CORS/network error detected for ${url}, fetching server-side...`);
			const page = await proxyFetchPage(url);
			if (!page.body && !page.ok) {
				throw new Error(`Failed to fetch ${url} (HTTP ${page.status || 'error'}).`);
			}
			return new Response(page.body, {
				status: page.status >= 200 && page.status <= 599 ? page.status : 200,
				headers: new Headers({ 'Content-Type': 'application/xml' }),
			});
		}
		throw error;
	}
};

/**
 * Both host variants of a base URL (with and without a leading "www."), same protocol, deduped and
 * order-preserving (the user's host first). Lets sitemap discovery survive a www/non-www mismatch or
 * a WAF that blocks bots on only one of the two hosts.
 */
export function buildHostVariants(baseUrl: string): string[] {
	try {
		const u = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`);
		const bare = u.hostname.replace(/^www\./i, '');
		const hosts = u.hostname.toLowerCase().startsWith('www.') ? [u.hostname, bare] : [u.hostname, `www.${bare}`];
		return [...new Set(hosts)].map((h) => `${u.protocol}//${h}`);
	} catch {
		return [baseUrl.replace(/\/$/, '')];
	}
}

/**
 * Fetch and parse sitemap.xml
 * Handles both regular sitemaps and sitemap indexes
 */
export const fetchSitemap = async (websiteUrl: string): Promise<Array<SitemapUrl>> => {
	try {
		// Normalize website URL
		const baseUrl = websiteUrl.replace(/\/$/, '');

		// Try BOTH host variants (with and without www). Many sites 301 the bare domain → www, and a
		// WAF may 403 bots on only one host (e.g. example-shop.com 403s bots but www.example-shop.com
		// serves the sitemap 200) — so relying on the user's exact host silently fails. Interleave by
		// path so the sitemap_index is found on either host early. Prioritize sitemap_index.xml.
		const hostVariants = buildHostVariants(baseUrl);
		const paths = ['/sitemap_index.xml', '/sitemap.xml', '/sitemaps/sitemap.xml', '/wp-sitemap.xml'];
		const sitemapUrls = paths.flatMap((p) => hostVariants.map((h) => `${h}${p}`));

		console.log('Fetching sitemap from:', sitemapUrls[0]);

		for (const sitemapUrl of sitemapUrls) {
			try {
				// Create timeout controller
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout
				
				const response = await fetchWithProxy(sitemapUrl);
				
				clearTimeout(timeoutId);

				if (response.ok) {
					const xmlText = await response.text();
					console.log(`Fetched sitemap from ${sitemapUrl}, size: ${xmlText.length} bytes`);
					
					// Check if it's a sitemap index
					if (xmlText.includes('<sitemapindex') || xmlText.includes('sitemapindex')) {
						console.log('Found sitemap index, fetching child sitemaps...');
						const childSitemaps = parseSitemapIndex(xmlText);
						console.log(`Found ${childSitemaps.length} child sitemaps in index`);
						
						// Prioritize post-sitemap.xml and page-sitemap.xml
						const prioritizedSitemaps = [
							...childSitemaps.filter(s => s.includes('post-sitemap.xml')),
							...childSitemaps.filter(s => s.includes('page-sitemap.xml')),
							...childSitemaps.filter(s => !s.includes('post-sitemap.xml') && !s.includes('page-sitemap.xml')),
						];
						
						console.log(`Found ${prioritizedSitemaps.length} child sitemaps, fetching...`);
						
						// Fetch all child sitemaps in parallel (but limit to first 10 for performance)
						// Use Promise.allSettled to continue even if some fail
						const fetchPromises = prioritizedSitemaps.slice(0, 10).map(async (childSitemapUrl) => {
							try {
								const childController = new AbortController();
								const childTimeoutId = setTimeout(() => childController.abort(), 20000);
								
								const childResponse = await fetchWithProxy(childSitemapUrl);
								
								clearTimeout(childTimeoutId);
								
								if (childResponse.ok) {
									const childXmlText = await childResponse.text();
									const parsed = parseSitemapXML(childXmlText);
									console.log(`✅ Fetched ${childSitemapUrl}: ${parsed.length} URLs`);
									return parsed;
								} else {
									console.warn(`⚠️ Child sitemap ${childSitemapUrl} returned status ${childResponse.status}`);
									return [];
								}
							} catch (error) {
								console.warn(`❌ Failed to fetch child sitemap ${childSitemapUrl}:`, error);
								return [];
							}
						});
						
						const allResults = await Promise.allSettled(fetchPromises);
						const mergedUrls: Array<SitemapUrl> = [];
						
						for (const result of allResults) {
							if (result.status === 'fulfilled') {
								mergedUrls.push(...result.value);
							} else {
								console.warn('Sitemap fetch failed:', result.reason);
							}
						}
						
						console.log(`✅ Total URLs from all sitemaps: ${mergedUrls.length}`);
						if (mergedUrls.length > 0) {
							console.log(`Sample URLs: ${mergedUrls.slice(0, 3).map(u => `${u.loc} (${u.lastmod || 'no date'})`).join(', ')}`);
						}
						return mergedUrls;
					} else {
						// Regular sitemap
						const parsed = parseSitemapXML(xmlText);
						console.log(`Successfully fetched sitemap from ${sitemapUrl}: ${parsed.length} URLs found`);
						if (parsed.length > 0) {
							console.log(`Sample URLs: ${parsed.slice(0, 3).map(u => `${u.loc} (${u.lastmod || 'no date'})`).join(', ')}`);
						}
						return parsed;
					}
				} else {
					console.warn(`Sitemap ${sitemapUrl} returned status ${response.status}`);
				}
			} catch (error) {
				console.warn(`Failed to fetch ${sitemapUrl}:`, error);
				continue;
			}
		}

		// If no sitemap found, try to discover URLs from robots.txt
		try {
			const robotsUrl = `${baseUrl}/robots.txt`;
			const robotsController = new AbortController();
			const robotsTimeoutId = setTimeout(() => robotsController.abort(), 10000);
			
			const robotsResponse = await fetchWithProxy(robotsUrl);
			
			clearTimeout(robotsTimeoutId);
			if (robotsResponse.ok) {
				const robotsText = await robotsResponse.text();
				const sitemapMatches = robotsText.match(/Sitemap:\s*(.+)/gi);
				if (sitemapMatches) {
					console.log(`Found ${sitemapMatches.length} sitemap references in robots.txt`);
					for (const match of sitemapMatches) {
						const sitemapPath = match.replace(/Sitemap:\s*/i, '').trim();
						try {
									const sitemapController = new AbortController();
									const sitemapTimeoutId = setTimeout(() => sitemapController.abort(), 20000);

									const response = await fetchWithProxy(sitemapPath);

									clearTimeout(sitemapTimeoutId);
							if (response.ok) {
								const xmlText = await response.text();
								
								// Check if it's a sitemap index
								if (xmlText.includes('<sitemapindex') || xmlText.includes('sitemapindex')) {
									console.log('Found sitemap index in robots.txt, fetching child sitemaps...');
									const childSitemaps = parseSitemapIndex(xmlText);
									
									// Prioritize post-sitemap.xml and page-sitemap.xml
									const prioritizedSitemaps = [
										...childSitemaps.filter(s => s.includes('post-sitemap.xml')),
										...childSitemaps.filter(s => s.includes('page-sitemap.xml')),
										...childSitemaps.filter(s => !s.includes('post-sitemap.xml') && !s.includes('page-sitemap.xml')),
									];
									
									console.log(`Found ${prioritizedSitemaps.length} child sitemaps from robots.txt, fetching...`);
									
									// Fetch all child sitemaps in parallel (but limit to first 10 for performance)
									// Use Promise.allSettled to continue even if some fail
									const fetchPromises = prioritizedSitemaps.slice(0, 10).map(async (childSitemapUrl) => {
										try {
											const childController = new AbortController();
											const childTimeoutId = setTimeout(() => childController.abort(), 20000);
											
											const childResponse = await fetchWithProxy(childSitemapUrl);
											
											clearTimeout(childTimeoutId);
											
											if (childResponse.ok) {
												const childXmlText = await childResponse.text();
												const parsed = parseSitemapXML(childXmlText);
												console.log(`✅ Fetched ${childSitemapUrl}: ${parsed.length} URLs`);
												return parsed;
											} else {
												console.warn(`⚠️ Child sitemap ${childSitemapUrl} returned status ${childResponse.status}`);
												return [];
											}
										} catch (error) {
											console.warn(`❌ Failed to fetch child sitemap ${childSitemapUrl}:`, error);
											return [];
										}
									});
									
									const allResults = await Promise.allSettled(fetchPromises);
									const mergedUrls: Array<SitemapUrl> = [];
									
									for (const result of allResults) {
										if (result.status === 'fulfilled') {
											mergedUrls.push(...result.value);
										} else {
											console.warn('Sitemap fetch failed:', result.reason);
										}
									}
									
									console.log(`✅ Total URLs from all sitemaps (robots.txt): ${mergedUrls.length}`);
									if (mergedUrls.length > 0) {
										console.log(`Sample URLs: ${mergedUrls.slice(0, 3).map(u => `${u.loc} (${u.lastmod || 'no date'})`).join(', ')}`);
									}
									return mergedUrls;
								} else {
									// Regular sitemap
									const parsed = parseSitemapXML(xmlText);
									console.log(`Successfully fetched sitemap from robots.txt: ${parsed.length} URLs found`);
									return parsed;
								}
							}
						} catch (error) {
							console.warn(`Failed to fetch sitemap from robots.txt (${sitemapPath}):`, error);
						}
					}
				}
			}
		} catch (error) {
			console.warn('Failed to fetch robots.txt:', error);
		}

		console.warn('No sitemap found, will analyze database content only');
		return [];
	} catch (error) {
		console.error('Error fetching sitemap:', error);
		return [];
	}
};

/**
 * Analyze sitemap and identify content that needs updating
 */
export const analyzeContentForUpdates = async (
	project: Project
): Promise<ContentUpdateCandidate[]> => {
	// Always analyze database content first (works even without sitemap)
	const dbCandidates = await analyzeDatabaseContent(project);
	
	if (!project.website_url) {
		// If no website URL, return only database analysis
		return dbCandidates;
	}

	// Try to fetch sitemap (but don't fail if it doesn't exist)
	let sitemapUrls: SitemapUrl[] = [];
	try {
		console.log(`Fetching sitemap for ${project.website_url}...`);
		sitemapUrls = await fetchSitemap(project.website_url);
		console.log(`Found ${sitemapUrls.length} URLs in sitemap`);
	} catch (error) {
		console.warn('Error fetching sitemap, using database content only:', error);
	}
	
	if (sitemapUrls.length === 0) {
		// No sitemap found, return database analysis
		console.log('No sitemap found, returning database analysis only');
		return dbCandidates;
	}

	// Get existing content from database
	const { data: existingContent } = await supabase
		.from('content')
		.select('*')
		.eq('project_id', project.id);

	const candidates: ContentUpdateCandidate[] = [];
	const now = new Date();
	const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
	const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

	// Analyze each URL from sitemap - prioritize by years since last update
	console.log(`Analyzing ${sitemapUrls.length} URLs from sitemap...`);
	let analyzedCount = 0;
	let outdatedCount = 0;
	let errorCount = 0;
	
	for (const sitemapUrl of sitemapUrls) {
		try {
		const url = sitemapUrl.loc;
		
		// Find matching content in database FIRST (optional - not required)
		let matchingContent: Content | undefined = undefined;
		if (existingContent) {
			matchingContent = existingContent.find((c) => {
				if (!c.slug) return false;
				try {
					const contentUrl = `${project.website_url?.replace(/\/$/, '')}/${c.slug.replace(/^\//, '')}`;
					const urlPath = new URL(url).pathname;
					const slugPath = c.slug.replace(/^\//, '');
					
					// Multiple matching strategies
					return url === contentUrl 
						|| url.toLowerCase() === contentUrl.toLowerCase()
						|| url.includes(slugPath) 
						|| slugPath.includes(urlPath)
						|| urlPath.includes(slugPath)
						|| urlPath === `/${slugPath}`
						|| urlPath === slugPath;
				} catch (error) {
					// If URL parsing fails, try simple string matching
					return url.includes(c.slug) || c.slug.includes(url);
				}
			});
		}
		
		let lastModified: Date | null = null;
		
		// Parse lastmod date - handle different formats
		if (sitemapUrl.lastmod) {
			try {
				lastModified = new Date(sitemapUrl.lastmod);
				// Check if date is valid
				if (isNaN(lastModified.getTime())) {
					console.warn(`Invalid date for ${url}: ${sitemapUrl.lastmod}`);
					lastModified = null;
				} else {
					// Log first few old dates for debugging
					const yearsSince = Math.floor((now.getTime() - lastModified.getTime()) / (1000 * 60 * 60 * 24 * 365));
					if (yearsSince >= 1 && analyzedCount < 5) {
						console.log(`Found old URL: ${url}, lastmod: ${sitemapUrl.lastmod}, years: ${yearsSince}`);
					}
				}
			} catch (error) {
				console.warn(`Error parsing date for ${url}: ${sitemapUrl.lastmod}`, error);
				lastModified = null;
			}
		}
		
		// Stable reference that is not narrowed away by the if/else chains below,
		// so date comparisons in later branches still typecheck.
		const lastModifiedDate: Date | null = lastModified;

		const daysSinceUpdate = lastModified
			? Math.floor((now.getTime() - lastModified.getTime()) / (1000 * 60 * 60 * 24))
			: 999;

		// Calculate years since update for prioritization
		const yearsSinceUpdate = lastModified
			? Math.floor((now.getTime() - lastModified.getTime()) / (1000 * 60 * 60 * 24 * 365))
			: 999;

		// Determine if update is needed - prioritize by years since update
		let needsUpdate = false;
		let reason: ContentUpdateCandidate['reason'] = 'outdated';
		let priority: ContentUpdateCandidate['priority'] = 'low';
		const suggestedChanges: Array<string> = [];

		// PRIORITY 1: Content not updated for more than 1 year (HIGHEST PRIORITY)
		// This should work even if content doesn't exist in database
		if (lastModified) {
			// Check by years
			if (yearsSinceUpdate >= 1) {
				needsUpdate = true;
				reason = 'outdated';
				outdatedCount++;
				// Higher priority for older content
				if (yearsSinceUpdate >= 3) {
					priority = 'high';
					suggestedChanges.push(`⚠️ Contenuto non aggiornato da ${yearsSinceUpdate} anni - URGENTE`);
				} else if (yearsSinceUpdate >= 2) {
					priority = 'high';
					suggestedChanges.push(`⚠️ Contenuto non aggiornato da ${yearsSinceUpdate} anni`);
				} else {
					priority = 'high';
					suggestedChanges.push(`Contenuto non aggiornato da più di 1 anno`);
				}
				suggestedChanges.push('Aggiorna statistiche e dati recenti');
				suggestedChanges.push('Rivedi e aggiorna esempi e case studies');
				suggestedChanges.push('Verifica che i link esterni siano ancora validi');
				suggestedChanges.push('Ottimizza per nuove keyword e intent di ricerca');
			}
			// Also check if lastModified is before 2024 (definitely old)
			else if (lastModified.getFullYear() < 2024) {
				needsUpdate = true;
				reason = 'outdated';
				priority = 'high';
				outdatedCount++;
				const year = lastModified.getFullYear();
				suggestedChanges.push(`⚠️ Contenuto non aggiornato dal ${year} - URGENTE`);
				suggestedChanges.push('Aggiorna statistiche e dati recenti');
				suggestedChanges.push('Rivedi e aggiorna esempi e case studies');
				suggestedChanges.push('Verifica che i link esterni siano ancora validi');
				suggestedChanges.push('Ottimizza per nuove keyword e intent di ricerca');
			}
		}
		// PRIORITY 2: Content outdated 6-12 months
		else if (lastModifiedDate && lastModifiedDate < sixMonthsAgo && yearsSinceUpdate < 1) {
			needsUpdate = true;
			reason = 'outdated';
			priority = 'medium';
			suggestedChanges.push('Aggiorna statistiche e dati recenti');
			suggestedChanges.push('Rivedi e aggiorna esempi e case studies');
			suggestedChanges.push('Verifica che i link esterni siano ancora validi');
		}

		// PRIORITY 3: Content exists in sitemap but not in database
		// If it has a lastmod date and is old, or if it has no lastmod (assume old)
		if (!matchingContent) {
			if (lastModified && lastModified < oneYearAgo) {
				if (!needsUpdate) {
			needsUpdate = true;
			reason = 'missing';
			priority = 'medium';
			suggestedChanges.push('Crea nuovo contenuto per questa URL');
					suggestedChanges.push('URL presente in sitemap ma non nel database');
				}
			} else if (!lastModified) {
				// No lastmod date - assume it might be old and needs review
				needsUpdate = true;
				reason = 'missing';
				priority = 'low';
				suggestedChanges.push('Crea nuovo contenuto per questa URL');
				suggestedChanges.push('URL presente in sitemap ma senza data di ultima modifica');
			}
		}

		// PRIORITY 4: Existing content has low SEO score
		if (matchingContent && (matchingContent.seo_score || 0) < 50) {
			if (!needsUpdate) {
			needsUpdate = true;
			reason = 'low_performance';
			}
			priority = (matchingContent.seo_score || 0) < 30 ? 'high' : priority === 'high' ? 'high' : 'medium';
			if (!suggestedChanges.some(c => c.includes('SEO'))) {
			suggestedChanges.push('Migliora keyword optimization');
			suggestedChanges.push('Aggiungi più heading strutturati');
			suggestedChanges.push('Migliora internal linking');
			}
		}

		if (needsUpdate) {
			analyzedCount++;
			candidates.push({
				url,
				lastModified: lastModified || undefined,
				daysSinceUpdate,
				existingContent: matchingContent,
				needsUpdate: true,
				reason,
				priority,
				suggestedChanges,
			});
		}
		} catch (error) {
			errorCount++;
			console.error(`Error analyzing URL ${sitemapUrl.loc}:`, error);
			// Continue with next URL even if this one fails
			if (errorCount <= 5) {
				console.warn(`Skipping URL due to error: ${sitemapUrl.loc}`);
			}
		}
	}
	
	console.log(`Analysis complete: ${analyzedCount} candidates found (${outdatedCount} outdated by 1+ years, ${errorCount} errors)`);

	// Also check existing content that might not be in sitemap
	if (existingContent) {
		for (const content of existingContent) {
			const isInSitemap = sitemapUrls.some((su) => {
				if (content.slug) {
					const contentUrl = `${project.website_url}/${content.slug}`;
					return su.loc === contentUrl || su.loc.includes(content.slug);
				}
				return false;
			});

			// Content exists in DB but not in sitemap - might need review
			if (!isInSitemap && (content.seo_score || 0) < 60) {
				candidates.push({
					url: content.slug ? `${project.website_url}/${content.slug}` : 'Unknown',
					daysSinceUpdate: Math.floor(
						(now.getTime() - new Date(content.generated_date).getTime()) / (1000 * 60 * 60 * 24)
					),
					existingContent: content as Content,
					needsUpdate: true,
					reason: 'low_performance',
					priority: 'medium',
					suggestedChanges: ['Migliora SEO score', 'Aggiungi alla sitemap se pubblicato'],
				});
			}
		}
	}

	// Sort by priority and years since update (older = higher priority)
	candidates.sort((a, b) => {
		const priorityOrder = { high: 3, medium: 2, low: 1 };
		const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
		
		// If same priority, sort by days since update (older first)
		if (priorityDiff === 0) {
			return (b.daysSinceUpdate || 0) - (a.daysSinceUpdate || 0);
		}
		
		return priorityDiff;
	});

	// Merge with database candidates, avoiding duplicates
	const urlSet = new Set(candidates.map(c => c.url));
	const mergedCandidates = [...candidates];
	
	for (const dbCandidate of dbCandidates) {
		if (!urlSet.has(dbCandidate.url)) {
			mergedCandidates.push(dbCandidate);
			urlSet.add(dbCandidate.url);
		}
	}

	// Re-sort merged results
	mergedCandidates.sort((a, b) => {
		const priorityOrder = { high: 3, medium: 2, low: 1 };
		const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
		
		if (priorityDiff === 0) {
			return (b.daysSinceUpdate || 0) - (a.daysSinceUpdate || 0);
		}
		
		return priorityDiff;
	});

	return mergedCandidates;
};

/**
 * Fallback: Analyze content from database only
 * This is the primary method when sitemap is not available
 */
const analyzeDatabaseContent = async (project: Project): Promise<ContentUpdateCandidate[]> => {
	const { data: existingContent } = await supabase
		.from('content')
		.select('*')
		.eq('project_id', project.id)
		.order('generated_date', { ascending: false });

	if (!existingContent || existingContent.length === 0) {
		// No content in database - return empty array
		return [];
	}

	const candidates: ContentUpdateCandidate[] = [];
	const now = new Date();
	const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
	const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

	existingContent.forEach((content) => {
		const generatedDate = new Date(content.generated_date);
		const daysSinceUpdate = Math.floor((now.getTime() - generatedDate.getTime()) / (1000 * 60 * 60 * 24));
		const seoScore = content.seo_score || 0;
		const publishedDate = content.published_date ? new Date(content.published_date) : null;
		
		// Check if already approved/rejected in content updates
		const metadata = (content.metadata as any) || {};
		const contentUpdates = metadata.content_updates || {};
		if (contentUpdates.approved || (Array.isArray(contentUpdates.rejected) && contentUpdates.rejected.length > 0)) {
			// Skip if already processed
			return;
		}

		// Determine if update is needed
		let needsUpdate = false;
		let reason: ContentUpdateCandidate['reason'] = 'outdated';
		let priority: ContentUpdateCandidate['priority'] = 'low';
		const suggestedChanges: string[] = [];

		// Check 1: Content is outdated (>6 months)
		if (generatedDate < sixMonthsAgo) {
			needsUpdate = true;
			reason = 'outdated';
			priority = generatedDate < oneYearAgo ? 'high' : 'medium';
			suggestedChanges.push('Aggiorna statistiche e dati recenti');
			suggestedChanges.push('Rivedi e aggiorna esempi e case studies');
			suggestedChanges.push('Verifica che i link esterni siano ancora validi');
		}

		// Check 2: Low SEO score
		if (seoScore < 50) {
			needsUpdate = true;
			reason = seoScore < 30 ? 'low_performance' : reason;
			priority = seoScore < 30 ? 'high' : (priority === 'high' ? 'high' : 'medium');
			if (!suggestedChanges.some(c => c.includes('SEO'))) {
				suggestedChanges.push('Migliora keyword optimization');
				suggestedChanges.push('Aggiungi più heading strutturati');
				suggestedChanges.push('Migliora internal linking');
			}
		}

		// Check 3: Content not published yet (draft status)
		if (content.status === 'draft' && daysSinceUpdate > 30) {
			needsUpdate = true;
			reason = 'outdated';
			priority = 'medium';
			suggestedChanges.push('Contenuto in bozza da più di 30 giorni - considera pubblicazione o aggiornamento');
		}

		// Check 4: Published but old
		if (publishedDate && publishedDate < sixMonthsAgo) {
			needsUpdate = true;
			reason = 'outdated';
			priority = publishedDate < oneYearAgo ? 'high' : 'medium';
			if (!suggestedChanges.length) {
				suggestedChanges.push('Contenuto pubblicato da più di 6 mesi - aggiorna per mantenere rilevanza');
			}
		}

		if (needsUpdate) {
			const url = content.slug && project.website_url 
				? `${project.website_url.replace(/\/$/, '')}/${content.slug.replace(/^\//, '')}`
				: content.slug || 'Unknown';
			
			candidates.push({
				url,
				lastModified: generatedDate,
				daysSinceUpdate,
				existingContent: content as Content,
				needsUpdate: true,
				reason,
				priority,
				suggestedChanges: suggestedChanges.length > 0 ? suggestedChanges : [
					'Aggiungi fact-check dei dati',
					'Rivedi e migliora il contenuto',
				],
			});
		}
	});

	// Sort by priority
	candidates.sort((a, b) => {
		const priorityOrder = { high: 3, medium: 2, low: 1 };
		return priorityOrder[b.priority] - priorityOrder[a.priority];
	});

	return candidates;
};

/**
 * Save sitemap pages to project metadata for internal linking
 * This should be called when the project is configured/updated
 */
export const saveSitemapToProject = async (
	projectId: string,
	websiteUrl: string
): Promise<{ success: boolean; pagesCount: number }> => {
	try {
		console.log(`📥 Fetching sitemap for project ${projectId}...`);
		
		const sitemapUrls = await fetchSitemap(websiteUrl);
		
		if (sitemapUrls.length === 0) {
			console.log('⚠️ No sitemap URLs found');
			return { success: false, pagesCount: 0 };
		}

		// Extract page titles from URLs
		const sitemapPages = sitemapUrls.slice(0, 500).map((url) => {
			// Extract title from URL path
			const urlPath = new URL(url.loc).pathname;
			const pathSegments = urlPath.split('/').filter(Boolean);
			const lastSegment = pathSegments[pathSegments.length - 1] || 'Home';
			
			// Convert slug to title (e.g., "my-blog-post" -> "My Blog Post")
			const title = lastSegment
				.replace(/-/g, ' ')
				.replace(/\.(html|php|htm)$/i, '')
				.split(' ')
				.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
				.join(' ');

			return {
				url: url.loc,
				title: title || url.loc,
				lastmod: url.lastmod || null,
			};
		});

		// Get current metadata
		const { data: project } = await supabase
			.from('projects')
			.select('metadata')
			.eq('id', projectId)
			.single();

		const currentMetadata = (project?.metadata as Record<string, unknown>) || {};

		// Update metadata with sitemap pages
		const { error } = await supabase
			.from('projects')
			.update({
				metadata: {
					...currentMetadata,
					sitemap_pages: sitemapPages,
					sitemap_updated_at: new Date().toISOString(),
				},
			})
			.eq('id', projectId);

		if (error) {
			console.error('Error saving sitemap to project:', error);
			return { success: false, pagesCount: 0 };
		}

		console.log(`✅ Saved ${sitemapPages.length} sitemap pages to project metadata`);
		return { success: true, pagesCount: sitemapPages.length };
	} catch (error) {
		console.error('Error in saveSitemapToProject:', error);
		return { success: false, pagesCount: 0 };
	}
};

/**
 * Refresh sitemap pages for a project (can be called manually or on schedule)
 */
export const refreshProjectSitemap = async (projectId: string): Promise<boolean> => {
	try {
		const { data: project } = await supabase
			.from('projects')
			.select('website_url')
			.eq('id', projectId)
			.single();

		if (!project?.website_url) {
			console.log('No website URL configured for project');
			return false;
		}

		const result = await saveSitemapToProject(projectId, project.website_url);
		return result.success;
	} catch (error) {
		console.error('Error refreshing project sitemap:', error);
		return false;
	}
};

/**
 * Quick heuristic check before a refresh (old years, many dated-looking statistics, no outbound
 * sources, low SEO score). It does NOT verify facts — the UI must not present it as one.
 */
export const factCheckContent = async (
	content: Content,
	_project: Project
): Promise<{
	isAccurate: boolean;
	issues: Array<{ type: 'outdated' | 'incorrect' | 'missing_source'; description: string }>;
	suggestions: string[];
}> => {
	const issues: Array<{ type: 'outdated' | 'incorrect' | 'missing_source'; description: string }> = [];
	const suggestions: string[] = [];

	// Check 1: Look for dates in content
	const dateMatches = content.body.match(/\b(20\d{2})\b/g);
	if (dateMatches) {
		const currentYear = new Date().getFullYear();
		const yearMatches = dateMatches.filter((d) => /20\d{2}/.test(d));
		const oldYears = yearMatches.filter((y) => parseInt(y) < currentYear - 2);
		
		if (oldYears.length > 0) {
			issues.push({
				type: 'outdated',
				description: `Contenuto contiene riferimenti a anni vecchi: ${oldYears.join(', ')}`,
			});
			suggestions.push('Aggiorna le date e le statistiche con dati recenti');
		}
	}

	// Check 2: Look for statistics/numbers that might be outdated
	const statPatterns = [
		/\b(\d+(?:\.\d+)?)\s*(?:milioni?|miliardi?|migliaia?)\s*(?:di\s*)?(?:utenti?|visitatori?|iscritti?)/gi,
		/\b(\d+(?:\.\d+)?)%\s*(?:di|delle|degli)\s*(?:persone|utenti|aziende)/gi,
		/\b(\d+(?:\.\d+)?)\s*(?:million|billion|thousand)\s*(?:users?|visitors?|subscribers?|people)/gi,
		/\b(\d+(?:\.\d+)?)%\s*of\s*(?:people|users|companies|businesses|consumers)/gi,
	];

	statPatterns.forEach((pattern) => {
		const matches = content.body.match(pattern);
		if (matches && matches.length > 3) {
			issues.push({
				type: 'outdated',
				description: 'Contenuto contiene molte statistiche che potrebbero essere obsolete',
			});
			suggestions.push('Verifica e aggiorna le statistiche con fonti recenti');
		}
	});

	// Check 3: Look for broken link patterns (though we can't actually check them)
	const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
	const links = Array.from(content.body.matchAll(linkPattern));
	if (links.length === 0 && content.body.length > 1000) {
		issues.push({
			type: 'missing_source',
			description: 'Contenuto lungo senza link a fonti esterne',
		});
		suggestions.push('Aggiungi link a fonti autorevoli per aumentare credibilità');
	}

	// Check 4: Check SEO score
	if ((content.seo_score || 0) < 60) {
		issues.push({
			type: 'incorrect',
			description: `SEO score basso (${content.seo_score}/100) - contenuto potrebbe non essere ottimizzato`,
		});
		suggestions.push('Migliora keyword optimization e struttura');
	}

	return {
		isAccurate: issues.length === 0,
		issues,
		suggestions,
	};
};


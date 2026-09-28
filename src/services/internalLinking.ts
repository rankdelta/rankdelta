/**
 * Internal Linking Service v3
 * 
 * Trova e inserisce automaticamente link interni rilevanti al contenuto.
 * 
 * STRATEGIA:
 * 1. PRIMARIO: Link verso pagine del sito dell'utente (dalla sitemap salvata nel progetto)
 * 2. FALLBACK: Link verso contenuti pubblicati dello stesso progetto (se hanno slug/URL reale)
 * 
 * ⚠️ IMPORTANTE: NON usare mai URL interni dell'app come /content/{id}
 * Questi non funzionerebbero sul sito finale dell'utente!
 * 
 * BEST PRACTICES SEO:
 * - Mai inserire link in H1, H2, H3, H4, H5, H6 (titoli)
 * - Mai inserire link nella bio autore
 * - Mai inserire link nel disclaimer
 * - Inserire link solo in paragrafi contestuali
 * - Max 3-5 link interni per articolo
 * - Anchor text naturale e contestuale
 */

import { supabase } from '../lib/supabaseClient';

interface InternalLink {
	url: string;
	title: string;
	anchorText: string;
	relevanceScore: number;
	source: 'sitemap' | 'published_content';
}

interface SitemapPage {
	url: string;
	title?: string;
}

// ============================================
// ZONE PROTETTE - Non inserire link in queste aree
// ============================================

const PROTECTED_ZONES = {
	// Pattern per identificare l'inizio di zone protette
	patterns: [
		/^#\s+.+/,                    // H1
		/^##\s+.+/,                   // H2
		/^###\s+.+/,                  // H3
		/^####\s+.+/,                 // H4
		/^#####\s+.+/,                // H5
		/^######\s+.+/,               // H6
		/^Articolo scritto da/i,      // Bio autore
		/^\*?Articolo scritto da/i,   // Bio autore in corsivo
		/^_?Articolo scritto da/i,    // Bio autore in corsivo
		/^\*Disclaimer/i,             // Disclaimer
		/^Disclaimer/i,               // Disclaimer
		/^Ultimo aggiornamento/i,     // Footer
		/^\|.+\|$/,                   // Tabelle markdown
	],
	
	// Frasi che indicano zone non adatte per link
	contextPatterns: [
		/sono\s+\w+\s+(di|da|esperto|esperta|appassionato|appassionata)/i,
		/ho\s+creato\s+questo\s+(blog|sito)/i,
		/proprietario\s+di/i,
		/autore\s+di/i,
	],
};

/**
 * Check if a line is in a protected zone (headings, bio, etc.)
 */
const isProtectedZone = (line: string): boolean => {
	const trimmedLine = line.trim();
	
	// Check all protection patterns
	for (const pattern of PROTECTED_ZONES.patterns) {
		if (pattern.test(trimmedLine)) {
			return true;
		}
	}
	
	// Check context patterns
	for (const pattern of PROTECTED_ZONES.contextPatterns) {
		if (pattern.test(trimmedLine)) {
			return true;
		}
	}
	
	return false;
};

/**
 * Get the full line containing a given index
 */
const getFullLine = (content: string, index: number): string => {
	const lineStart = content.lastIndexOf('\n', index - 1) + 1;
	const lineEnd = content.indexOf('\n', index);
	return content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
};

// ============================================
// SITEMAP LINKS (PRIMARY SOURCE)
// ============================================

/**
 * Get sitemap pages saved in project metadata
 */
const getSavedSitemapPages = async (projectId: string): Promise<SitemapPage[]> => {
	try {
		const { data: project } = await supabase
			.from('projects')
			.select('metadata, website_url')
			.eq('id', projectId)
			.single();

		if (!project) {
			console.log('⚠️ Project not found');
			return [];
		}

		const metadata = project.metadata as Record<string, unknown> | null;
		
		// Check for saved sitemap URLs (array of strings)
		if (metadata?.['sitemap_urls'] && Array.isArray(metadata['sitemap_urls'])) {
			const urls = metadata['sitemap_urls'] as string[];
			console.log(`📄 Found ${urls.length} saved sitemap URLs`);
			return urls.map(url => ({
				url,
				title: extractTitleFromUrl(url),
			}));
		}

		// Check for saved sitemap pages (array of objects)
		if (metadata?.['sitemap_pages'] && Array.isArray(metadata['sitemap_pages'])) {
			console.log(`📄 Found ${(metadata['sitemap_pages'] as SitemapPage[]).length} saved sitemap pages`);
			return metadata['sitemap_pages'] as SitemapPage[];
		}

		console.log('ℹ️ No sitemap data in project metadata');
		return [];
	} catch (error) {
		console.error('Error getting saved sitemap pages:', error);
		return [];
	}
};

/**
 * Extract a readable title from URL
 */
const extractTitleFromUrl = (url: string): string => {
	try {
		const urlObj = new URL(url);
		const path = urlObj.pathname;
		
		// Get last path segment
		const segments = path.split('/').filter(s => s.length > 0);
		const lastSegment = segments[segments.length - 1] || '';
		
		// Remove file extensions and clean up
		const cleaned = lastSegment
			.replace(/\.(html|htm|php|aspx?)$/i, '')
			.replace(/-/g, ' ')
			.replace(/_/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		
		// Capitalize first letter of each word
		return cleaned
			.split(' ')
			.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
			.join(' ');
	} catch {
		return url;
	}
};

// ============================================
// SEMANTIC MATCHING FOR INTERNAL LINKS
// ============================================

/**
 * Semantic topic clusters for better internal linking
 * If content is about topic A, it should also link to related topics B, C, D
 */
const SEMANTIC_CLUSTERS: Record<string, Array<string>> = {
	// Health & Supplements
	'testosterone': ['integratori', 'muscoli', 'fitness', 'palestra', 'bodybuilding', 'ormoni', 'massa muscolare', 'forza', 'energia', 'libido', 'uomo', 'salute maschile'],
	'integratori': ['vitamine', 'minerali', 'proteine', 'aminoacidi', 'bcaa', 'creatina', 'omega', 'supplementi', 'salute', 'benessere'],
	'proteine': ['whey', 'caseina', 'muscoli', 'massa', 'palestra', 'fitness', 'bodybuilding', 'recupero', 'allenamento'],
	'dimagrire': ['perdere peso', 'dieta', 'metabolismo', 'bruciare grassi', 'fitness', 'alimentazione', 'calorie', 'snellire'],
	'fitness': ['palestra', 'allenamento', 'esercizi', 'workout', 'muscoli', 'forza', 'resistenza', 'cardio'],
	
	// Finance
	'carta': ['prepagata', 'credito', 'debito', 'pagamenti', 'banca', 'conto', 'iban', 'ricaricabile', 'contactless'],
	'conto': ['corrente', 'deposito', 'risparmio', 'banca', 'online', 'home banking', 'bonifico', 'iban'],
	'investimenti': ['risparmio', 'trading', 'azioni', 'etf', 'obbligazioni', 'rendimento', 'portafoglio', 'borsa'],
	'mutuo': ['casa', 'immobiliare', 'tasso', 'rata', 'prestito', 'finanziamento', 'acquisto casa'],
	
	// Pets
	'cane': ['cani', 'cucciolo', 'razza', 'alimentazione cane', 'addestramento', 'veterinario', 'guinzaglio', 'cuccia', 'crocchette'],
	'gatto': ['gatti', 'micio', 'felino', 'alimentazione gatto', 'lettiera', 'tiragraffi', 'crocchette gatto'],
	'animali': ['pet', 'animali domestici', 'veterinario', 'cibo animali', 'accessori pet'],
	
	// Travel
	'viaggio': ['viaggiare', 'vacanza', 'turismo', 'destinazione', 'volo', 'hotel', 'prenotazione', 'itinerario'],
	'hotel': ['albergo', 'prenotazione', 'soggiorno', 'camera', 'resort', 'bed and breakfast', 'alloggio'],
	
	// Tech
	'smartphone': ['cellulare', 'telefono', 'android', 'iphone', 'mobile', 'app', 'display', 'batteria'],
	'computer': ['pc', 'laptop', 'notebook', 'desktop', 'processore', 'ram', 'ssd', 'scheda grafica'],
	
	// Home
	'casa': ['appartamento', 'arredamento', 'mobili', 'decorazione', 'ristrutturazione', 'giardino', 'elettrodomestici'],
	'cucina': ['ricette', 'cucinare', 'elettrodomestici cucina', 'pentole', 'forno', 'friggitrice'],
};

/**
 * Get semantically related terms for better matching
 */
const getSemanticTerms = (keywords: string[], contentBody: string): Array<string> => {
	const semanticTerms = new Set<string>();
	const contentLower = contentBody.toLowerCase();
	const allKeywords = keywords.map(k => k.toLowerCase()).join(' ') + ' ' + contentLower;
	
	// Check each cluster
	for (const [trigger, relatedTerms] of Object.entries(SEMANTIC_CLUSTERS)) {
		// If the trigger appears in keywords or content
		if (allKeywords.includes(trigger)) {
			// Add all related terms
			for (const term of relatedTerms) {
				semanticTerms.add(term);
			}
			// Also add the trigger itself
			semanticTerms.add(trigger);
		}
		
		// Also check if any related term appears (reverse lookup)
		for (const term of relatedTerms) {
			if (allKeywords.includes(term)) {
				semanticTerms.add(trigger);
				// Add some related terms too
				relatedTerms.slice(0, 5).forEach(t => semanticTerms.add(t));
				break;
			}
		}
	}
	
	// Extract root words from brand names (testoprime → testo → testosterone)
	for (const kw of keywords) {
		const kwLower = kw.toLowerCase();
		// Check for common prefixes
		if (kwLower.includes('testo')) semanticTerms.add('testosterone');
		if (kwLower.includes('protein')) semanticTerms.add('proteine');
		if (kwLower.includes('vitamin')) semanticTerms.add('vitamine');
		if (kwLower.includes('card') || kwLower.includes('cart')) semanticTerms.add('carta');
	}
	
	console.log(`🧠 Semantic terms found: ${[...semanticTerms].slice(0, 10).join(', ')}${semanticTerms.size > 10 ? '...' : ''}`);
	
	return [...semanticTerms];
};

/**
 * Find relevant links from sitemap based on content keywords with SEMANTIC matching
 */
const findSitemapLinks = async (
	projectId: string,
	keywords: string[],
	contentBody: string,
	maxLinks: number = 5
): Promise<InternalLink[]> => {
	const sitemapPages = await getSavedSitemapPages(projectId);
	
	if (sitemapPages.length === 0) {
		console.log('ℹ️ No sitemap pages available for internal linking');
		return [];
	}

	console.log(`🔍 Analyzing ${sitemapPages.length} sitemap pages for relevance...`);
	
	// Extract important terms from content
	const importantTerms = extractImportantTerms(contentBody, keywords);
	
	// Get semantically related terms
	const semanticTerms = getSemanticTerms(keywords, contentBody);
	
	// Combine all terms for matching
	const allSearchTerms = [...new Set([...importantTerms, ...semanticTerms])];
	console.log(`📝 Total search terms: ${allSearchTerms.length} (${importantTerms.length} direct + ${semanticTerms.length} semantic)`);
	
	const contentLower = contentBody.toLowerCase();
	const scoredPages: InternalLink[] = [];

	for (const page of sitemapPages) {
		// Skip obvious non-content pages
		const urlLower = page.url.toLowerCase();
		if (
			urlLower.includes('/privacy') ||
			urlLower.includes('/cookie') ||
			urlLower.includes('/contatti') ||
			urlLower.includes('/contact') ||
			urlLower.includes('/about') ||
			urlLower.includes('/chi-siamo') ||
			urlLower.includes('/login') ||
			urlLower.includes('/register') ||
			urlLower.includes('/cart') ||
			urlLower.includes('/checkout') ||
			urlLower.endsWith('/')
		) {
			continue;
		}
		
		const pageTitle = (page.title || extractTitleFromUrl(page.url)).toLowerCase();
		const urlPath = urlLower;
		
		// Extract slug from URL for better matching
		const urlSlug = urlPath.split('/').filter(s => s.length > 0).pop() || '';
		const slugWords = urlSlug.replace(/-/g, ' ').split(' ').filter(w => w.length > 2);
		
		let score = 0;
		let bestAnchor = page.title || extractTitleFromUrl(page.url);
		let bestMatchInContent = false;
		let matchType = '';

		// Score based on direct keyword matches (highest priority)
		for (const term of importantTerms) {
			const termLower = term.toLowerCase();
			const termSlug = termLower.replace(/\s+/g, '-');
			
			// High score if URL contains the term as slug
			if (urlPath.includes(termSlug) && termSlug.length > 3) {
				score += 50;
				bestAnchor = term;
				matchType = 'direct-url';
			}
			
			// Medium score if page title contains the term
			if (pageTitle.includes(termLower) && termLower.length > 3) {
				score += 40;
				if (term.length > bestAnchor.length / 2) {
					bestAnchor = term;
				}
				matchType = matchType || 'direct-title';
			}

			// Bonus if the term appears in our content (can use as anchor)
			if (contentLower.includes(termLower) && termLower.length > 3) {
				score += 15;
				bestMatchInContent = true;
			}
		}

		// Score based on SEMANTIC matches (medium priority)
		for (const term of semanticTerms) {
			const termLower = term.toLowerCase();
			
			// Check if semantic term appears in URL slug
			if (slugWords.some(w => w.includes(termLower) || termLower.includes(w))) {
				score += 35;
				matchType = matchType || 'semantic-url';
			}
			
			// Check if semantic term appears in page title
			if (pageTitle.includes(termLower)) {
				score += 30;
				matchType = matchType || 'semantic-title';
			}
			
			// Check if semantic term appears in our content (for anchor)
			if (contentLower.includes(termLower) && termLower.length > 3) {
				bestMatchInContent = true;
				if (!bestAnchor || bestAnchor.length > 30) {
					bestAnchor = term.charAt(0).toUpperCase() + term.slice(1);
				}
			}
		}

		// Also check provided keywords directly
		for (const keyword of keywords) {
			const kwLower = keyword.toLowerCase();
			const kwSlug = kwLower.replace(/\s+/g, '-');
			
			if (urlPath.includes(kwSlug) || pageTitle.includes(kwLower)) {
				score += 45;
				matchType = matchType || 'keyword-direct';
			}
		}

		// Include if score is high enough
		// Boost score if anchor can be found in content (easier to insert inline)
		const finalScore = bestMatchInContent ? score + 20 : score;
		
		// Lower threshold for semantic matches (they're still relevant!)
		const threshold = matchType.includes('semantic') ? 20 : 25;
		
		if (finalScore >= threshold) {
			scoredPages.push({
				url: page.url,
				title: page.title || extractTitleFromUrl(page.url),
				anchorText: bestAnchor,
				relevanceScore: finalScore,
				source: 'sitemap',
			});
			console.log(`  📎 Match [${matchType}]: "${bestAnchor}" → ${page.url} (score: ${finalScore})`);
		}
	}

	console.log(`📊 Total sitemap matches: ${scoredPages.length}`);
	
	return scoredPages
		.sort((a, b) => b.relevanceScore - a.relevanceScore)
		.slice(0, maxLinks);
};

// ============================================
// PUBLISHED CONTENT LINKS (SECONDARY SOURCE)
// ============================================

/**
 * Find published content with real URLs (not app URLs)
 */
const findPublishedContentLinks = async (
	projectId: string,
	currentContentId: string | null,
	keywords: string[],
	contentBody: string,
	siteUrl: string | null,
	maxLinks: number = 3
): Promise<InternalLink[]> => {
	if (!siteUrl) {
		console.log('ℹ️ No site URL configured - cannot create real URLs for content');
		return [];
	}

	try {
		console.log('🔍 Looking for published content with real URLs...');
		
		const { data, error } = await supabase
			.from('content')
			.select('id, title, slug, topic, keywords_used, status')
			.eq('project_id', projectId)
			.eq('status', 'published') // Only published content
			.not('slug', 'is', null) // Must have a slug
			.limit(50);

		if (error || !data || data.length === 0) {
			console.log('ℹ️ No published content found');
			return [];
		}

		console.log(`📄 Found ${data.length} published content items`);

		// Filter out current content
		const otherContent = data.filter((c) => {
			if (c.id === currentContentId) return false;
			if (!c.slug || c.slug.trim().length === 0) return false;
			if (!c.title || c.title.trim().length === 0) return false;
			return true;
		});

		if (otherContent.length === 0) {
			return [];
		}

		const importantTerms = extractImportantTerms(contentBody, keywords);
		const contentLower = contentBody.toLowerCase();
		const scoredContent: InternalLink[] = [];

		// Normalize site URL
		const baseUrl = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;

		for (const content of otherContent) {
			const title = content.title || '';
			const titleLower = title.toLowerCase();
			const slug = content.slug || '';
			const topic = content.topic || '';
			const topicLower = topic.toLowerCase();
			
			let score = 0;
			let bestAnchor = title;

			// Check if title appears in content
			if (titleLower.length > 5 && contentLower.includes(titleLower)) {
				score += 50;
				bestAnchor = title;
			}

			// Check if topic appears in content
			if (topicLower.length > 5 && contentLower.includes(topicLower)) {
				score += 40;
				bestAnchor = topic;
			}

			// Check keyword overlap
			const contentKeywords = content.keywords_used || [];
			for (const kw of contentKeywords) {
				if (!kw) continue;
				const kwLower = kw.toLowerCase();
				
				if (keywords.some((k) => k.toLowerCase() === kwLower)) {
					score += 20;
				}
				
				if (kwLower.length > 4 && contentLower.includes(kwLower)) {
					score += 15;
					if (kw.length > 4) {
						bestAnchor = kw;
					}
				}
			}

			// Check important terms
			for (const term of importantTerms) {
				const termLower = term.toLowerCase();
				if (titleLower.includes(termLower) || topicLower.includes(termLower)) {
					score += 25;
					if (term.length > 4) {
						bestAnchor = term;
					}
				}
			}

			if (score >= 30) {
				// Build REAL URL (not app URL!)
				const realUrl = `${baseUrl}/${slug}`;
				
				scoredContent.push({
					url: realUrl,
					title: title,
					anchorText: bestAnchor,
					relevanceScore: score,
					source: 'published_content',
				});
				console.log(`  📎 Published match: "${title}" → ${realUrl} (score: ${score})`);
			}
		}

		return scoredContent
			.sort((a, b) => b.relevanceScore - a.relevanceScore)
			.slice(0, maxLinks);
	} catch (error) {
		console.error('Error finding published content:', error);
		return [];
	}
};

// ============================================
// EXTRACT IMPORTANT TERMS
// ============================================

/**
 * Extract important terms from content for matching
 */
const extractImportantTerms = (content: string, keywords: string[]): string[] => {
	const terms = new Set<string>();

	// Add provided keywords and variations
	for (const k of keywords) {
		if (k && k.trim().length > 2) {
			terms.add(k.trim());
			
			// Also add individual significant words
			const words = k.trim().split(/\s+/);
			for (const word of words) {
				if (word.length > 4) {
					terms.add(word);
				}
			}
			
			// Add singular/plural variations for Italian
			if (k.endsWith('i')) {
				terms.add(k.slice(0, -1) + 'o'); // cani -> cano (won't match but try)
				terms.add(k.slice(0, -1) + 'e'); // brandine -> brandina variation
			}
			if (k.endsWith('e')) {
				terms.add(k.slice(0, -1) + 'a'); // brandine -> brandina
				terms.add(k.slice(0, -1) + 'i'); // cucce -> cucci
			}
		}
	}

	// Extract H2 headings (good sources for anchor text)
	const h2Matches = content.matchAll(/^##\s+(.+)$/gm);
	for (const match of h2Matches) {
		const heading = match[1]
			?.replace(/[*_`#]/g, '')
			.replace(/\s*\([^)]*\)/g, '')
			.replace(/:\s*$/, '')
			.trim();
		
		if (heading && heading.length > 5 && heading.length < 50) {
			terms.add(heading);
		}
	}

	// Extract bold terms (often key concepts)
	const boldMatches = content.matchAll(/\*\*([^*]+)\*\*/g);
	for (const match of boldMatches) {
		const term = match[1]?.trim();
		if (term && term.length > 4 && term.length < 35 && !/^\d+/.test(term)) {
			terms.add(term);
		}
	}

	// Extract product names (capitalized multi-word phrases)
	const productMatches = content.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g);
	for (const match of productMatches) {
		const phrase = match[1];
		if (phrase && phrase.length > 5 && phrase.length < 40) {
			terms.add(phrase);
		}
	}

	console.log(`📝 Extracted ${terms.size} important terms for matching`);
	return Array.from(terms);
};

// ============================================
// INSERT LINKS INTO CONTENT
// ============================================

/**
 * Insert internal links into content following SEO best practices
 */
export const insertInternalLinks = (
	content: string,
	links: InternalLink[],
	maxInlineLinks: number = 3
): string => {
	if (links.length === 0) {
		console.log('ℹ️ No links to insert');
		return content;
	}

	let modifiedContent = content;
	const insertedUrls = new Set<string>();
	const insertedAnchors = new Set<string>();
	let inlineCount = 0;

	// Sort by relevance
	const sortedLinks = [...links].sort((a, b) => b.relevanceScore - a.relevanceScore);

	console.log(`🔗 Attempting to insert ${sortedLinks.length} internal links...`);

	// PHASE 1: Insert inline links in safe positions
	for (const link of sortedLinks) {
		if (inlineCount >= maxInlineLinks) break;
		if (insertedUrls.has(link.url)) continue;

		const anchor = link.anchorText;
		if (!anchor || anchor.length < 4) continue;

		// Skip if we already used a similar anchor
		const anchorLower = anchor.toLowerCase();
		if (insertedAnchors.has(anchorLower)) continue;

		// Find the anchor in content
		const contentLower = modifiedContent.toLowerCase();
		let searchStart = 0;
		let foundValidPosition = false;

		// Try to find the anchor in a valid position
		while (searchStart < modifiedContent.length) {
			const index = contentLower.indexOf(anchorLower, searchStart);
			if (index === -1) break;

			// Get the full line containing this match
			const fullLine = getFullLine(modifiedContent, index);
			
			// Check if this is a protected zone
			if (isProtectedZone(fullLine)) {
				console.log(`  ⏭️ Skipping "${anchor}" - protected zone: ${fullLine.substring(0, 50)}...`);
				searchStart = index + 1;
				continue;
			}

			// Check if already part of a link
			const before = modifiedContent.slice(Math.max(0, index - 10), index);
			const after = modifiedContent.slice(index + anchor.length, index + anchor.length + 10);
			
			if (before.includes('[') || after.includes('](') || after.startsWith(']')) {
				searchStart = index + 1;
				continue;
			}

			// Check if in a list item that looks like a "Leggi Anche" section
			if (/^-\s*\[/.test(fullLine.trim())) {
				searchStart = index + 1;
				continue;
			}

			// Valid position found!
			const originalText = modifiedContent.slice(index, index + anchor.length);
			const markdownLink = `[${originalText}](${link.url})`;

			modifiedContent = 
				modifiedContent.slice(0, index) +
				markdownLink +
				modifiedContent.slice(index + anchor.length);

			insertedUrls.add(link.url);
			insertedAnchors.add(anchorLower);
			inlineCount++;
			foundValidPosition = true;
			
			console.log(`  ✓ Inline link: "${originalText}" → ${link.url}`);
			break;
		}

		if (!foundValidPosition) {
			console.log(`  ⚠️ No valid position found for "${anchor}"`);
		}
	}

	// PHASE 2: Add "Leggi Anche" section for remaining high-value links
	const remainingLinks = sortedLinks
		.filter((l) => !insertedUrls.has(l.url) && l.relevanceScore >= 30)
		.slice(0, 3);

	if (remainingLinks.length > 0) {
		console.log(`  📚 Adding ${remainingLinks.length} links to "Leggi Anche" section`);
		
		let relatedSection = '\n\n## 📚 Leggi Anche\n\n';
		relatedSection += remainingLinks
			.map((l) => `- [${l.title}](${l.url})`)
			.join('\n');

		// Find best position (before FAQ, Key Takeaways, or Disclaimer)
		const insertPositions = [
			{ regex: /^##\s*(FAQ|Domande Frequenti)/mi, name: 'FAQ' },
			{ regex: /^##\s*(Key Takeaways|Punti Chiave)/mi, name: 'Takeaways' },
			{ regex: /^\*?\*?Disclaimer/mi, name: 'Disclaimer' },
			{ regex: /^Ultimo aggiornamento:/mi, name: 'Footer' },
		];

		let insertIndex = -1;
		for (const pos of insertPositions) {
			const match = modifiedContent.match(pos.regex);
			if (match?.index !== undefined && match.index > 0) {
				insertIndex = match.index;
				console.log(`  📍 Inserting "Leggi Anche" before ${pos.name}`);
				break;
			}
		}

		if (insertIndex > 0) {
			modifiedContent = 
				modifiedContent.slice(0, insertIndex) +
				relatedSection + '\n\n' +
				modifiedContent.slice(insertIndex);
		} else {
			// Insert before last paragraph
			const lastDoubleNewline = modifiedContent.lastIndexOf('\n\n');
			if (lastDoubleNewline > modifiedContent.length / 2) {
				modifiedContent = 
					modifiedContent.slice(0, lastDoubleNewline) +
					relatedSection +
					modifiedContent.slice(lastDoubleNewline);
			} else {
				modifiedContent += relatedSection;
			}
		}
	}

	console.log(`✅ Inserted ${inlineCount} inline links + ${remainingLinks.length} in "Leggi Anche"`);
	
	return modifiedContent;
};

// ============================================
// MAIN FUNCTIONS
// ============================================

/**
 * Get site URL from project
 */
export const getProjectSiteUrl = async (projectId: string): Promise<string | null> => {
	try {
		const { data: project } = await supabase
			.from('projects')
			.select('website_url, metadata')
			.eq('id', projectId)
			.single();

		if (project?.website_url) {
			return project.website_url;
		}

		if (project?.metadata && typeof project.metadata === 'object') {
			const metadata = project.metadata as Record<string, unknown>;
			if ('site_url' in metadata) return metadata['site_url'] as string;
			if ('website_url' in metadata) return metadata['website_url'] as string;
		}

		return null;
	} catch {
		return null;
	}
};

/**
 * Find all relevant internal links (sitemap first, then published content)
 */
export const findAllRelevantLinks = async (
	projectId: string,
	currentContentId: string | null,
	siteUrl: string | null,
	keywords: string[],
	contentBody: string,
	maxLinks: number = 5
): Promise<InternalLink[]> => {
	const allLinks: InternalLink[] = [];

	// LEVEL 1: Sitemap pages (primary - real site URLs)
	console.log('🔍 Level 1: Searching sitemap pages...');
	const sitemapLinks = await findSitemapLinks(
		projectId,
		keywords,
		contentBody,
		maxLinks
	);
	allLinks.push(...sitemapLinks);

	// LEVEL 2: Published content (secondary - only if has real URLs)
	if (siteUrl && allLinks.length < maxLinks) {
		console.log('🔍 Level 2: Searching published content with real URLs...');
		const publishedLinks = await findPublishedContentLinks(
			projectId,
			currentContentId,
			keywords,
			contentBody,
			siteUrl,
			maxLinks - allLinks.length
		);
		
		// Add published links, avoiding duplicates
		for (const link of publishedLinks) {
			if (!allLinks.some(l => l.url === link.url)) {
				allLinks.push(link);
			}
		}
	}

	console.log(`✅ Total internal links found: ${allLinks.length}`);
	if (allLinks.length > 0) {
		console.log('   Links:');
		allLinks.forEach((l, i) => console.log(`   ${i + 1}. ${l.title} → ${l.url}`));
	}
	
	return allLinks
		.sort((a, b) => b.relevanceScore - a.relevanceScore)
		.slice(0, maxLinks);
};

/**
 * Main function: Add internal links to content
 */
export const addInternalLinks = async (
	projectId: string,
	currentContentId: string | null,
	keywords: string[],
	contentBody: string,
	maxLinks: number = 5
): Promise<string> => {
	console.log('🔗 Starting internal linking process (v3)...');
	
	// Get site URL
	const siteUrl = await getProjectSiteUrl(projectId);
	console.log(`📌 Site URL: ${siteUrl || 'Not configured'}`);
	
	// Find relevant links
	const links = await findAllRelevantLinks(
		projectId,
		currentContentId,
		siteUrl,
		keywords,
		contentBody,
		maxLinks
	);

	if (links.length === 0) {
		console.log('ℹ️ No relevant internal links found');
		console.log('   📋 Checklist:');
		console.log('   1. ✅ website_url configured in project? (needed to build URLs)');
		console.log('   2. ✅ Sitemap saved in project metadata? (sitemap_pages or sitemap_urls)');
		console.log('   3. ✅ Sitemap contains content pages with relevant keywords?');
		console.log('   4. ✅ Content keywords match sitemap page URLs/titles?');
		console.log('   💡 Try: Edit project settings, update website_url to refresh sitemap');
		return contentBody;
	}

	// Insert links
	const contentWithLinks = insertInternalLinks(contentBody, links);
	
	return contentWithLinks;
};

// Legacy exports for compatibility
export const findRelevantInternalLinks = findAllRelevantLinks;
export const findRelatedProjectContent = findPublishedContentLinks;

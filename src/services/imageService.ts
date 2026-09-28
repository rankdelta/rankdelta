/**
 * Image Service
 * 
 * Trova e inserisce automaticamente immagini copyright-free rilevanti al contenuto.
 * 
 * PRIORITÀ FONTI (ottimizzato per ACCURATEZZA + SICUREZZA):
 * 1. Wikimedia Commons - SOLO CC0/Public Domain (accurate E 100% sicure)
 * 2. Pexels API (fallback - stock generico ma sicuro)
 * 3. Unsplash API (fallback - stock generico ma sicuro)
 * 4. Lorem Picsum (fallback finale - placeholder generici)
 * 
 * ⚠️ FILTRI ULTRA-RIGOROSI WIKIMEDIA:
 * Accettiamo SOLO licenze con ZERO rischio legale per uso commerciale:
 * 
 * ✅ CC0 (Creative Commons Zero) - Pubblico dominio, nessun obbligo
 * ✅ Public Domain - Nessuna restrizione
 * ✅ PD-old, PD-art, etc. - Varianti pubblico dominio
 * 
 * ❌ CC-BY - ESCLUSO (richiede attribuzione)
 * ❌ CC-BY-SA - ESCLUSO (richiede attribuzione + ShareAlike)
 * ❌ CC-BY-NC - ESCLUSO (non commerciale)
 * ❌ CC-BY-ND - ESCLUSO (no derivatives)
 * ❌ GFDL - ESCLUSO (richiede attribuzione)
 * ❌ Qualsiasi altra licenza - ESCLUSA per sicurezza
 * 
 * Le immagini includono:
 * - Alt text ottimizzato per SEO
 * - Credit (per trasparenza, anche se non richiesto da CC0)
 * - Dimensioni appropriate per il web
 */

import { isProxyEnabled, proxyStockImage } from './edgeProxy';
import { pexelsCaptionLabels, prefersEnglishUi } from '../lib/contentLanguages';

// === WIKIMEDIA COMMONS TYPES ===
interface WikimediaImageInfo {
	url: string;
	descriptionurl: string;
	descriptionshorturl: string;
	width: number;
	height: number;
	extmetadata?: {
		LicenseShortName?: { value: string };
		License?: { value: string };
		UsageTerms?: { value: string };
		Artist?: { value: string };
		ImageDescription?: { value: string };
		DateTimeOriginal?: { value: string };
		Credit?: { value: string };
		Restrictions?: { value: string };
	};
}

interface WikimediaPage {
	pageid: number;
	title: string;
	imageinfo?: Array<WikimediaImageInfo>;
}

interface WikimediaSearchResult {
	query?: {
		search?: Array<{
			title: string;
			pageid: number;
		}>;
		pages?: Record<string, WikimediaPage>;
	};
}

// ⚠️ LICENZE ULTRA-SICURE: Solo CC0 e Public Domain
// Queste sono le UNICHE licenze che garantiscono 100% sicurezza per uso commerciale
// senza NESSUN requisito di attribuzione o condizione
const ULTRA_SAFE_LICENSES = [
	'cc0',
	'cc-zero',
	'cc zero',
	'cc0 1.0',
	'public domain',
	'public domain mark',
	'pd',
	'pd-old',
	'pd-us',
	'pd-art',
	'pd-self',
	'pd-author',
	'pd-ineligible',
	'no restrictions',
	'no known copyright',
];

// Licenze da ESCLUDERE - qualsiasi cosa che richieda attribuzione o abbia restrizioni
const EXCLUDED_LICENSES = [
	'cc-by',      // Richiede attribuzione - escludiamo per sicurezza
	'cc-by-sa',   // Richiede attribuzione + ShareAlike
	'cc-by-nc',   // Non commerciale
	'cc-by-nc-sa',
	'cc-by-nc-nd',
	'cc-by-nd',   // No derivatives
	'gfdl',       // Richiede attribuzione
	'nc',         // non-commercial
	'nd',         // no derivatives
	'all rights reserved',
	'copyrighted',
	'fair use',
	'attribution',
];

// === COMMON TYPES ===
interface ContentImage {
	url: string;
	alt: string;
	credit: string;
	creditUrl: string;
	topic: string;
	source: 'wikimedia' | 'pexels' | 'unsplash' | 'picsum';
	license?: string; // License info for Wikimedia
}

// Stock-image API keys live on seo-proxy (PEXELS_API_KEY / UNSPLASH_ACCESS_KEY). Never VITE_.

/**
 * Simplify text for better image search results
 */
const simplifyForImageSearch = (text: string): string => {
	const fillerWords = ['come', 'cosa', 'quale', 'quando', 'perché', 'migliore', 'migliori', 'guida', 'completa', 'definitiva', 'il', 'la', 'lo', 'i', 'le', 'gli', 'un', 'una', 'per', 'con', 'del', 'della', 'dei', 'delle', 'nel', 'nella', 'sul', 'sulla', 'al', 'alla'];
	
	const words = text.toLowerCase().split(/\s+/);
	const filtered = words.filter((w) => !fillerWords.includes(w) && w.length > 2);
	
	return filtered.slice(0, 4).join(' ');
};

/**
 * Generate SEO-optimized alt text for images
 */
const generateAltText = (topic: string, keyword: string): string => {
	const baseAlt = topic.toLowerCase().includes(keyword.toLowerCase())
		? topic
		: `${topic} - ${keyword}`;

	const cleanAlt = baseAlt.replace(/\s+/g, ' ').trim();
	return cleanAlt.charAt(0).toUpperCase() + cleanAlt.slice(1);
};

/**
 * Translate Italian keywords to English for better image search results
 * 
 * STRATEGIA MIGLIORATA:
 * 1. Rimuove parole inutili (verbi, articoli, preposizioni)
 * 2. Traduce solo i SOSTANTIVI chiave
 * 3. Restituisce una query pulita in inglese
 * 
 * Esempio: "cani possono mangiare tonno" → "dog tuna"
 */
const translateForSearch = (query: string): string => {
	// Extended translation dictionary
	const translations: Record<string, string> = {
		// Animals
		'cane': 'dog',
		'cani': 'dog',
		'gatto': 'cat',
		'gatti': 'cat',
		'animali': 'pet',
		'animale': 'pet',
		'cucciolo': 'puppy',
		'cuccioli': 'puppy',
		// Food
		'tonno': 'tuna',
		'pesce': 'fish',
		'carne': 'meat',
		'pollo': 'chicken',
		'manzo': 'beef',
		'verdure': 'vegetables',
		'frutta': 'fruit',
		'cibo': 'food',
		'alimento': 'food',
		'alimenti': 'food',
		// Health & Fitness
		'integratori': 'supplements',
		'integratore': 'supplement',
		'sportivi': 'athletic',
		'sportivo': 'athletic',
		'alimentazione': 'nutrition',
		'salute': 'health',
		'fitness': 'fitness',
		'benessere': 'wellness',
		'dieta': 'diet',
		// Home & Lifestyle
		'cucina': 'kitchen',
		'casa': 'home',
		'giardino': 'garden',
		'auto': 'car',
		'automobile': 'car',
		'viaggio': 'travel',
		'vacanza': 'vacation',
		// Technology
		'tecnologia': 'technology',
		'computer': 'computer',
		'telefono': 'phone',
		'smartphone': 'smartphone',
		// People
		'bambini': 'children',
		'bambino': 'child',
		'famiglia': 'family',
		'persona': 'person',
		'persone': 'people',
		// Work & Business
		'lavoro': 'work office',
		'ufficio': 'office',
		'affari': 'business',
		// Fashion & Beauty
		'moda': 'fashion',
		'bellezza': 'beauty',
		'vestiti': 'clothes',
		// Nature
		'sport': 'sports',
		'natura': 'nature',
		'mare': 'sea beach',
		'montagna': 'mountain',
		'città': 'city',
		'foresta': 'forest',
		// Finance
		'carta': 'card',
		'carte': 'card',
		'prepagata': 'prepaid',
		'prepagate': 'prepaid',
		'banca': 'bank',
		'soldi': 'money',
		'pagamento': 'payment',
		'pagamenti': 'payment',
		'conto': 'account',
		'credito': 'credit',
		'debito': 'debit',
	};

	// Words to REMOVE (verbs, articles, prepositions, question words)
	const stopWords = new Set([
		// Italian question words
		'come', 'cosa', 'quale', 'quando', 'perché', 'chi', 'dove', "cos'è", 'cosè',
		// Italian articles
		'il', 'la', 'lo', 'i', 'le', 'gli', 'un', 'una', 'uno',
		// Italian prepositions
		'per', 'con', 'del', 'della', 'dei', 'delle', 'nel', 'nella', 'sul', 'sulla', 'al', 'alla', 'a', 'di', 'da', 'in',
		// Italian common verbs
		'possono', 'può', 'sono', 'è', 'essere', 'fare', 'mangiare', 'bere', 'avere', 'hanno',
		'usare', 'comprare', 'vendere', 'scegliere', 'trovare', 'cercare', 'vedere', 'sapere',
		// Italian adjectives that don't add value
		'migliore', 'migliori', 'buono', 'buona', 'grande', 'piccolo', 'nuovo', 'vecchio',
		'guida', 'completa', 'definitiva', 'tutto', 'tutti', 'tutte', 'ogni',
	]);

	// Split into words and clean
	const words = query.toLowerCase()
		.replace(/[''`]/g, ' ')
		.split(/\s+/)
		.filter(w => w.length > 1);

	// Extract and translate only meaningful nouns
	const translatedTerms: Array<string> = [];
	
	for (const word of words) {
		// Skip stop words
		if (stopWords.has(word)) continue;
		
		// Translate if possible
		if (translations[word]) {
			const translated = translations[word];
			// Avoid duplicates
			if (!translatedTerms.includes(translated)) {
				translatedTerms.push(translated);
			}
		} else if (!stopWords.has(word) && word.length >= 3) {
			// Keep untranslated if it's a proper noun or technical term
			// Only if it looks like English or is a known brand/term
			const looksEnglish = /^[a-z]+$/i.test(word) && !word.match(/[àèéìòù]/);
			if (looksEnglish && !translatedTerms.some(t => t.includes(word))) {
				translatedTerms.push(word);
			}
		}
	}

	// If we have translated terms, return them
	if (translatedTerms.length > 0) {
		// Limit to 3 most relevant terms
		return translatedTerms.slice(0, 3).join(' ');
	}

	// Fallback: return simplified original (first 2-3 meaningful words)
	const meaningful = words.filter(w => !stopWords.has(w) && w.length >= 3);
	return meaningful.slice(0, 2).join(' ');
};

/**
 * Search for images on Pexels (PRIMARY SOURCE)
 */
export const searchPexelsImages = async (
	query: string,
	count: number = 1
): Promise<Array<ContentImage>> => {
	if (!isProxyEnabled()) return [];
	try {
		const searchQuery = translateForSearch(query);
		const photos = await proxyStockImage({ provider: 'pexels', query: searchQuery, count });
		return photos.map((photo) => ({
			url: photo.url,
			alt: photo.alt || query,
			credit: photo.photographer,
			creditUrl: photo.photographerUrl,
			topic: query,
			source: 'pexels' as const,
		}));
	} catch (error) {
		console.error('Pexels search failed:', error instanceof Error ? error.message : error);
		return [];
	}
};

/**
 * Search for images on Unsplash (FALLBACK)
 */
export const searchUnsplashImages = async (
	query: string,
	count: number = 1
): Promise<Array<ContentImage>> => {
	if (!isProxyEnabled()) return [];
	try {
		const searchQuery = translateForSearch(query);
		const photos = await proxyStockImage({ provider: 'unsplash', query: searchQuery, count });
		return photos.map((img) => ({
			url: img.url,
			alt: img.alt || query,
			credit: img.photographer,
			creditUrl: img.photographerUrl,
			topic: query,
			source: 'unsplash' as const,
		}));
	} catch (error) {
		console.error('Unsplash search failed:', error instanceof Error ? error.message : error);
		return [];
	}
};

/**
 * Check if a license is ULTRA-SAFE for commercial use
 * Returns true ONLY for CC0 and Public Domain licenses
 * These are the only licenses with ZERO legal risk for commercial use
 */
const isLicenseUltraSafe = (licenseInfo: string): boolean => {
	const licenseLower = licenseInfo.toLowerCase();
	
	// FIRST: Check if it contains any EXCLUDED terms - reject immediately
	for (const excluded of EXCLUDED_LICENSES) {
		if (licenseLower.includes(excluded)) {
			// Exception: "pd" shouldn't reject "pd-old" etc
			if (excluded === 'attribution' && licenseLower.includes('no attribution')) {
				continue; // "no attribution required" is fine
			}
			console.log(`❌ License "${licenseInfo}" excluded: contains "${excluded}"`);
			return false;
		}
	}
	
	// SECOND: Check if it matches any ULTRA-SAFE license (CC0/Public Domain only)
	for (const safeLicense of ULTRA_SAFE_LICENSES) {
		if (licenseLower.includes(safeLicense)) {
			console.log(`✅ License "${licenseInfo}" is ULTRA-SAFE (CC0/PD)`);
			return true;
		}
	}
	
	// If we can't confirm it's CC0/PD, reject it for safety
	console.log(`⚠️ License "${licenseInfo}" not CC0/Public Domain - rejecting for safety`);
	return false;
};

/**
 * Extract artist name from Wikimedia HTML credit
 */
const extractArtistName = (artistHtml: string | undefined): string => {
	if (!artistHtml) return 'Wikimedia Commons';
	
	// Try to extract text from HTML (remove tags)
	const textOnly = artistHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
	
	// Clean up common patterns
	const cleaned = textOnly
		.replace(/^by\s+/i, '')
		.replace(/\s*-\s*own work$/i, '')
		.replace(/\s*\(.*?\)$/g, '')
		.trim();
	
	return cleaned || 'Wikimedia Commons';
};

/**
 * Search for images on Wikimedia Commons
 * Only returns images with verified commercial-use licenses (CC0, CC-BY, CC-BY-SA)
 * 
 * ⚠️ IMPORTANT: This function performs strict license verification
 * Only images with 100% confirmed commercial licenses are returned
 */
export const searchWikimediaImages = async (
	query: string,
	count: number = 1
): Promise<Array<ContentImage>> => {
	try {
		const searchQuery = translateForSearch(query);
		const encodedQuery = encodeURIComponent(searchQuery);
		
		console.log(`🔍 Searching Wikimedia Commons for: "${searchQuery}"`);
		
		// Step 1: Search for images
		const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodedQuery}+filetype:bitmap&srnamespace=6&srlimit=${count * 3}&format=json&origin=*`;
		
		const searchResponse = await fetch(searchUrl);
		if (!searchResponse.ok) {
			console.error('Wikimedia search error:', searchResponse.status);
			return [];
		}
		
		const searchData = (await searchResponse.json()) as WikimediaSearchResult;
		
		if (!searchData.query?.search || searchData.query.search.length === 0) {
			console.log(`ℹ️ No Wikimedia results for: "${searchQuery}"`);
			return [];
		}
		
		// Step 2: Get detailed info for each image including license
		const titles = searchData.query.search.map((s) => s.title).join('|');
		const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1200&format=json&origin=*`;
		
		const infoResponse = await fetch(infoUrl);
		if (!infoResponse.ok) {
			console.error('Wikimedia info error:', infoResponse.status);
			return [];
		}
		
		const infoData = (await infoResponse.json()) as WikimediaSearchResult;
		
		if (!infoData.query?.pages) {
			return [];
		}
		
		const images: Array<ContentImage> = [];
		
		// Step 3: Filter and verify each image's license
		for (const page of Object.values(infoData.query.pages)) {
			if (images.length >= count) break;
			
			const imageInfo = page.imageinfo?.[0];
			if (!imageInfo?.url || !imageInfo.extmetadata) continue;
			
			const metadata = imageInfo.extmetadata;
			const licenseShort = metadata.LicenseShortName?.value || '';
			const license = metadata.License?.value || '';
			const usageTerms = metadata.UsageTerms?.value || '';
			const restrictions = metadata.Restrictions?.value || '';
			
			// Combine all license info for thorough check
			const combinedLicenseInfo = `${licenseShort} ${license} ${usageTerms}`.toLowerCase();
			
			// ULTRA-STRICT CHECK: Only accept CC0 and Public Domain
			if (!isLicenseUltraSafe(combinedLicenseInfo)) {
				console.log(`⏭️ Skipping "${page.title}" - not CC0/Public Domain: ${licenseShort}`);
				continue;
			}
			
			// Additional safety check: reject if restrictions field has concerning content
			if (restrictions && restrictions.toLowerCase().includes('personality')) {
				console.log(`⏭️ Skipping "${page.title}" - has personality rights restrictions`);
				continue;
			}
			
			const artistName = extractArtistName(metadata.Artist?.value);
			const description = metadata.ImageDescription?.value || query;
			
			// All images at this point are CC0/Public Domain, but we still credit for transparency
			console.log(`✅ CC0/Public Domain verified for "${page.title}": ${licenseShort}`);
			
			images.push({
				url: imageInfo.url,
				alt: description.replace(/<[^>]+>/g, '').substring(0, 100) || query,
				credit: artistName !== 'Wikimedia Commons' ? `${artistName} (Public Domain)` : 'Public Domain',
				creditUrl: imageInfo.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
				topic: query,
				source: 'wikimedia',
				license: 'CC0/Public Domain',
			});
		}
		
		console.log(`✅ Found ${images.length} verified commercial-use images from Wikimedia`);
		return images;
		
	} catch (error) {
		console.error('Error searching Wikimedia:', error);
		return [];
	}
};

/**
 * Search for images with fallback chain:
 * 1. Wikimedia Commons (primary - accurate images with verified licenses)
 * 2. Pexels (fallback - high quality stock)
 * 3. Unsplash (fallback)
 * 4. Lorem Picsum (final fallback)
 */
/**
 * Generate alternative search queries for better image results
 * When the main query doesn't find results, try related terms
 */
const generateAlternativeQueries = (query: string): Array<string> => {
	const alternatives: Array<string> = [];
	const translated = translateForSearch(query);
	
	// Add the translated query first
	alternatives.push(translated);
	
	// Common alternative patterns
	const words = translated.split(' ').filter(w => w.length > 2);
	
	if (words.length >= 2) {
		const firstWord = words[0];
		const secondWord = words[1];
		
		if (firstWord) {
			// Try first word alone (often the main subject)
			alternatives.push(firstWord);
			
			// Try combinations
			if (secondWord) {
				alternatives.push(`${firstWord} ${secondWord}`);
			}
		}
	}
	
	// Add context-specific alternatives
	const contextMap: Record<string, Array<string>> = {
		'dog': ['dog pet', 'happy dog', 'dog outdoor'],
		'cat': ['cat pet', 'cute cat', 'cat indoor'],
		'travel': ['travel adventure', 'vacation', 'journey'],
		'food': ['delicious food', 'cuisine', 'meal'],
		'health': ['healthy lifestyle', 'wellness', 'medical'],
		'finance': ['money finance', 'banking', 'financial'],
		'card': ['credit card', 'bank card', 'payment'],
	};
	
	for (const word of words) {
		if (contextMap[word]) {
			alternatives.push(...contextMap[word]);
		}
	}
	
	// Remove duplicates
	return [...new Set(alternatives)];
};

export const searchImages = async (
	query: string,
	count: number = 1
): Promise<Array<ContentImage>> => {
	const usedUrls = new Set<string>(); // Track URLs to avoid duplicates
	
	// PRIORITY ORDER: Accuracy + Safety
	// 1. Wikimedia Commons - ONLY CC0/Public Domain (accurate AND 100% safe)
	// 2. Pexels - Explicit commercial license (generic but safe)
	// 3. Unsplash - Explicit commercial license (generic but safe)
	// ⚠️ NO Lorem Picsum - generic placeholders don't add value
	
	const alternativeQueries = generateAlternativeQueries(query);
	
	// Search all sources in parallel for each query
	// This avoids the "await in loop" issue and is faster
	const searchPromises: Array<Promise<Array<ContentImage>>> = [];
	
	for (const searchQuery of alternativeQueries.slice(0, 3)) { // Limit to 3 queries
		searchPromises.push(searchWikimediaImages(searchQuery, count));
		searchPromises.push(searchPexelsImages(searchQuery, count));
		searchPromises.push(searchUnsplashImages(searchQuery, count));
	}
	
	// Wait for all searches to complete
	const allResults = await Promise.all(searchPromises);
	
	// Collect unique images maintaining priority order
	// (Wikimedia results come first in each batch, then Pexels, then Unsplash)
	const images: Array<ContentImage> = [];
	
	for (const resultBatch of allResults) {
		for (const img of resultBatch) {
			if (!usedUrls.has(img.url) && images.length < count * 2) { // Get extra for variety
				usedUrls.add(img.url);
				images.push(img);
			}
		}
	}

	// NO Lorem Picsum fallback - better to have fewer relevant images than generic placeholders
	if (images.length < count) {
		console.log(`ℹ️ Only found ${images.length}/${count} images. Skipping placeholders - quality over quantity.`);
	}

	return images.slice(0, count * 2); // Return up to 2x count for variety in selection
};

/**
 * Extract semantic context from content to find better image topics
 */
const extractSemanticContext = (content: string, primaryKeyword: string): Array<string> => {
	const contextTerms: Array<string> = [];
	const contentLower = content.toLowerCase();
	const keywordLower = primaryKeyword.toLowerCase();
	
	// Product/topic category mappings for better image search
	const categoryMappings: Record<string, Array<string>> = {
		// Supplements & Health
		'testosterone': ['fitness man', 'muscle workout', 'gym training', 'healthy lifestyle'],
		'integratore': ['supplements pills', 'vitamins health', 'fitness nutrition'],
		'integratori': ['supplements pills', 'vitamins health', 'fitness nutrition'],
		'proteine': ['protein powder', 'fitness gym', 'muscle workout'],
		'vitamine': ['vitamins supplements', 'healthy food', 'wellness'],
		'dimagrire': ['weight loss', 'fitness exercise', 'healthy diet'],
		'muscoli': ['muscle fitness', 'gym workout', 'bodybuilding'],
		
		// Finance
		'carta': ['credit card payment', 'financial banking', 'digital payment'],
		'conto': ['bank account', 'financial services', 'banking'],
		'prepagata': ['prepaid card', 'payment method', 'digital banking'],
		'risparmio': ['savings money', 'piggy bank', 'financial planning'],
		
		// Pets
		'cane': ['dog pet', 'happy dog', 'pet care'],
		'cani': ['dogs pets', 'happy dogs', 'pet care'],
		'gatto': ['cat pet', 'cute cat', 'pet care'],
		'gatti': ['cats pets', 'cute cats', 'pet care'],
		'animali': ['pets animals', 'pet care', 'animal love'],
		
		// Tech
		'smartphone': ['smartphone technology', 'mobile phone', 'tech device'],
		'computer': ['computer technology', 'laptop work', 'tech office'],
		'software': ['software technology', 'computer code', 'digital work'],
		
		// Travel
		'viaggio': ['travel adventure', 'vacation holiday', 'tourism'],
		'viaggiare': ['travel journey', 'adventure trip', 'exploration'],
		'hotel': ['hotel room', 'travel accommodation', 'vacation'],
		
		// Food
		'ricetta': ['cooking food', 'recipe kitchen', 'delicious meal'],
		'cucina': ['kitchen cooking', 'food preparation', 'chef'],
		'ristorante': ['restaurant dining', 'food service', 'eating out'],
	};
	
	// Check if primary keyword or content contains category terms
	for (const [trigger, alternatives] of Object.entries(categoryMappings)) {
		if (keywordLower.includes(trigger) || contentLower.includes(trigger)) {
			contextTerms.push(...alternatives);
		}
	}
	
	// Also check for product review patterns
	if (contentLower.includes('recensione') || contentLower.includes('review')) {
		// Try to extract what type of product is being reviewed
		const productPatterns = [
			/recensione\s+(?:di\s+)?([a-z]+)/i,
			/review\s+(?:of\s+)?([a-z]+)/i,
			/migliori?\s+([a-z]+)/i,
		];
		
		for (const pattern of productPatterns) {
			const match = content.match(pattern);
			if (match && match[1] && match[1].length > 3) {
				const productType = match[1].toLowerCase();
				if (categoryMappings[productType]) {
					contextTerms.push(...categoryMappings[productType]);
				}
			}
		}
	}
	
	return [...new Set(contextTerms)].slice(0, 4);
};

/**
 * Extract image topics from content
 */
export const extractImageTopics = (
	content: string,
	primaryKeyword: string,
	maxTopics: number = 3
): Array<string> => {
	const topics: Array<string> = [];

	// 1. Primary keyword as main topic (will try first)
	topics.push(primaryKeyword);
	
	// 2. Add semantic context terms (much better for stock photo search)
	const contextTerms = extractSemanticContext(content, primaryKeyword);
	if (contextTerms.length > 0) {
		console.log(`📝 Semantic context terms: ${contextTerms.join(', ')}`);
		topics.push(...contextTerms.slice(0, 2));
	}

	// 3. Extract H2 headings as topics (but filter out generic ones)
	const h2Matches = content.matchAll(/^##\s+(.+)$/gm);
	for (const match of h2Matches) {
		const rawHeading = match[1];
		if (!rawHeading) continue;
		
		const heading = rawHeading
			.replace(/[*_`#]/g, '')
			.replace(/\s*\([^)]*\)/g, '')
			.replace(/^\d+\.\s*/, '')
			.replace(/[?!:]/g, '')
			.trim();

		// EXPANDED list of generic/useless H2s to skip
		const skipHeadings = [
			'introduzione', 'conclusione', 'faq', 'domande frequenti', 
			'key takeaways', 'punti chiave', 'articoli correlati',
			'criteri', 'valutazione', 'metodologia', 'come abbiamo testato',
			'nostri', 'nostra', 'nostro', 'miei', 'mia', 'mio',
			'pro e contro', 'vantaggi', 'svantaggi', 'opinioni',
			'tabella', 'confronto', 'comparazione', 'classifica',
			'cosa', 'come', 'perché', 'quando', 'dove', 'chi',
			'guida', 'tutorial', 'passo', 'step',
			'disclaimer', 'fonti', 'riferimenti', 'aggiornamento',
		];
		
		const headingLower = heading.toLowerCase();
		if (skipHeadings.some((s) => headingLower.includes(s))) {
			continue;
		}
		
		// Skip very short or very generic headings
		if (heading.length < 8 || heading.split(' ').length < 2) {
			continue;
		}

		if (heading.length < 50) {
			const simplified = simplifyForImageSearch(heading);
			if (simplified && simplified.length > 3 && !topics.includes(simplified)) {
				topics.push(simplified);
			}
		}

		if (topics.length >= maxTopics + 2) break; // Get extras for fallback
	}

	// 4. Extract from bold terms only if we still need more
	if (topics.length < maxTopics) {
		const boldMatches = content.matchAll(/\*\*([^*]+)\*\*/g);
		for (const match of boldMatches) {
			const rawTerm = match[1];
			if (!rawTerm) continue;
			
			const term = rawTerm.trim();
			// Skip generic bold terms
			if (term.length > 5 && term.length < 25 && !/^\d+/.test(term)) {
				const termLower = term.toLowerCase();
				// Skip if it's a generic term
				if (!['importante', 'attenzione', 'nota', 'consiglio', 'suggerimento'].some(s => termLower.includes(s))) {
					const simplified = simplifyForImageSearch(term);
					if (simplified && !topics.includes(simplified)) {
						topics.push(simplified);
					}
				}
			}
			if (topics.length >= maxTopics + 2) break;
		}
	}

	return topics.slice(0, maxTopics + 2); // Return extra for fallback
};

/**
 * Calculate how many images to insert based on content length
 */
export const calculateImageCount = (content: string): number => {
	const wordCount = content.split(/\s+/).length;
	return Math.max(1, Math.min(5, Math.floor(wordCount / 450)));
};

/**
 * Find appropriate insertion points for images
 */
export const findImageInsertionPoints = (
	content: string,
	imageCount: number
): Array<{ index: number; topic: string }> => {
	const insertionPoints: Array<{ index: number; topic: string }> = [];
	
	const h2Regex = /^##\s+(.+)$/gm;
	const h2Positions: Array<{ index: number; heading: string; endIndex: number }> = [];
	
	let match;
	while ((match = h2Regex.exec(content)) !== null) {
		const rawHeading = match[1];
		if (!rawHeading) continue;
		
		const heading = rawHeading.replace(/[*_`#]/g, '').trim();
		
		const skipHeadings = ['introduzione', 'conclusione', 'faq', 'domande frequenti', 'key takeaways', 'punti chiave', 'articoli correlati'];
		if (skipHeadings.some((s) => heading.toLowerCase().includes(s))) {
			continue;
		}
		
		const nextHeadingMatch = content.slice(match.index + match[0].length).match(/^##?\s+/m);
		const endIndex = nextHeadingMatch?.index !== undefined
			? match.index + match[0].length + nextHeadingMatch.index
			: content.length;
		
		h2Positions.push({
			index: match.index + match[0].length,
			heading,
			endIndex,
		});
	}

	if (h2Positions.length === 0) {
		const firstParagraphEnd = content.indexOf('\n\n');
		if (firstParagraphEnd > 0) {
			insertionPoints.push({
				index: firstParagraphEnd + 2,
				topic: content.slice(0, 100).replace(/[#*_\n]/g, ' ').trim(),
			});
		}
		return insertionPoints;
	}

	const step = Math.max(1, Math.floor(h2Positions.length / imageCount));
	
	for (let sectionIndex = 0; sectionIndex < h2Positions.length && insertionPoints.length < imageCount; sectionIndex += step) {
		const section = h2Positions[sectionIndex];
		if (!section) continue;
		
		const sectionContent = content.slice(section.index, section.endIndex);
		
		// SEO BEST PRACTICE: Insert image RIGHT AFTER the H2 heading
		// This is the optimal position for SEO:
		// 1. Images after headings improve user engagement
		// 2. They don't break the flow of paragraphs
		// 3. They provide visual context for the section
		
		// Find the first complete paragraph (ends with double newline)
		const firstParagraphEnd = sectionContent.indexOf('\n\n');
		
		// Insert AFTER the first paragraph of the section (not in the middle of text)
		// This ensures the image appears after the introductory text of the section
		let insertIndex: number;
		
		if (firstParagraphEnd > 0 && firstParagraphEnd < 500) {
			// Insert after the first paragraph (best practice: image after intro text)
			insertIndex = section.index + firstParagraphEnd + 2;
		} else {
			// If no paragraph break found, insert right after the H2 line
			// Find the end of the H2 line (next newline)
			const nextNewline = sectionContent.indexOf('\n');
			insertIndex = section.index + (nextNewline > 0 ? nextNewline + 1 : 0);
		}
		
		// Verify we're not inserting in the middle of a sentence
		// Check if we're at a safe insertion point (after a period, newline, or list item)
		const textBefore = content.slice(Math.max(0, insertIndex - 50), insertIndex);
		const isSafePoint = /[.!?\n\-*]\s*$/.test(textBefore) || insertIndex === section.index;
		
		if (!isSafePoint) {
			// Find the next safe point (end of sentence or paragraph)
			const remainingContent = content.slice(insertIndex);
			const nextSafePoint = remainingContent.search(/[.!?]\s+|\n\n/);
			if (nextSafePoint > 0 && nextSafePoint < 200) {
				insertIndex += nextSafePoint + 2;
			}
		}

		insertionPoints.push({
			index: insertIndex,
			topic: simplifyForImageSearch(section.heading),
		});
	}

	return insertionPoints;
};

/**
 * Insert images into content at calculated positions
 */
export const insertImagesIntoContent = async (
	content: string,
	primaryKeyword: string,
	language: string = 'it'
): Promise<string> => {
	console.log('🖼️ Starting image insertion process...');
	
	const imageCount = calculateImageCount(content);
	console.log(`📊 Calculated ${imageCount} images needed for content length`);
	
	const insertionPoints = findImageInsertionPoints(content, imageCount);
	
	if (insertionPoints.length === 0) {
		console.log('ℹ️ No suitable insertion points found for images');
		return content;
	}

	console.log(`📍 Found ${insertionPoints.length} insertion points`);
	
	const topics = extractImageTopics(content, primaryKeyword, insertionPoints.length);
	console.log(`🔍 Image topics: ${topics.join(', ')}`);
	
	// Fetch images using the fallback chain
	// Request MORE images than needed to have options and avoid duplicates
	console.log('🔎 Searching for images...');
	const imagePromises = topics.map((topic) => searchImages(topic, 2)); // Get 2 per topic for variety
	const imagesArrays = await Promise.all(imagePromises);
	const allImages = imagesArrays.flat();

	if (allImages.length === 0) {
		console.warn('⚠️ No images found from any source. Content returned without images.');
		return content;
	}
	
	// DEDUPLICATE: Remove images with the same URL
	const usedUrls = new Set<string>();
	const uniqueImages: Array<ContentImage> = [];
	
	for (const img of allImages) {
		if (!usedUrls.has(img.url)) {
			usedUrls.add(img.url);
			uniqueImages.push(img);
		}
	}
	
	console.log(`✅ Found ${uniqueImages.length} unique images (from ${allImages.length} total)`);
	console.log(`   Sources: ${[...new Set(uniqueImages.map(image => image.source))].join(', ')}`);

	let modifiedContent = '';
	let lastIndex = 0;

	const sortedPoints = [...insertionPoints].sort((a, b) => a.index - b.index);
	
	// Only insert as many images as we have unique ones
	const imagesToInsert = Math.min(sortedPoints.length, uniqueImages.length);

	for (let pointIndex = 0; pointIndex < imagesToInsert; pointIndex++) {
		const point = sortedPoints[pointIndex];
		const image = uniqueImages[pointIndex];

		if (!point || !image) continue;

		modifiedContent += content.slice(lastIndex, point.index);

		const altText = generateAltText(image.topic, primaryKeyword);
		
		// Generate appropriate credit based on source
		let creditText: string;
		const { by, on } = pexelsCaptionLabels(language);
		const isItalian = !prefersEnglishUi(language);
		if (image.source === 'pexels') {
			creditText = `*${by} [${image.credit}](${image.creditUrl}) ${on} [Pexels](https://www.pexels.com)*`;
		} else if (image.source === 'unsplash') {
			creditText = `*${by} [${image.credit}](${image.creditUrl}) ${on} [Unsplash](https://unsplash.com/?utm_source=astroseo&utm_medium=referral)*`;
		} else if (image.source === 'wikimedia') {
			// Wikimedia Commons with proper CC0/PD credit
			if (image.license?.toLowerCase().includes('cc0') || image.license?.toLowerCase().includes('public domain')) {
				creditText = `*${isItalian ? 'Immagine' : 'Image'}: ${image.credit} via [Wikimedia Commons](${image.creditUrl}) (${image.license})*`;
			} else {
				creditText = `*${isItalian ? 'Immagine di' : 'Image by'} ${image.credit} via [Wikimedia Commons](${image.creditUrl})*`;
			}
		} else {
			// This case shouldn't happen anymore since we removed Lorem Picsum
			continue; // Skip unknown sources
		}
		
		const imageMarkdown = `
![${altText}](${image.url})
${creditText}

`;

		modifiedContent += imageMarkdown;
		lastIndex = point.index;
	}

	modifiedContent += content.slice(lastIndex);
	
	if (imagesToInsert < insertionPoints.length) {
		console.log(`ℹ️ Inserted ${imagesToInsert}/${insertionPoints.length} images (limited by available unique images)`);
	}

	return modifiedContent;
};

/**
 * Check if content already has images
 */
export const hasImages = (content: string): boolean => {
	return /!\[.*?\]\(.*?\)/.test(content);
};

/**
 * Count images in content
 */
export const countImages = (content: string): number => {
	const matches = content.match(/!\[.*?\]\(.*?\)/g);
	return matches ? matches.length : 0;
};

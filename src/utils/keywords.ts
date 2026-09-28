/**
 * Keyword Utilities
 * 
 * Centralizzato per gestire l'estrazione, pulizia e validazione delle keyword
 * Usato da: SEO scoring, GEO scoring, content generation, etc.
 */

/**
 * Common prefixes to remove from keywords (IT + EN)
 */
const KEYWORD_PREFIXES_TO_REMOVE = [
	// Italian
	'aggiornamento:',
	'aggiornamento',
	'guida completa:',
	'guida completa',
	'guida passo passo:',
	'guida passo passo',
	'guida:',
	'guida',
	'come fare:',
	'come fare',
	'tutorial:',
	'tutorial',
	'recensione:',
	'recensione',
	'analisi:',
	'analisi',
	'confronto:',
	'confronto',
	'migliori:',
	'migliori',
	'top:',
	'top',
	// English
	'update:',
	'update',
	'complete guide:',
	'complete guide',
	'step by step:',
	'step by step',
	'guide:',
	'guide',
	'how to:',
	'how to',
	'review:',
	'review',
	'analysis:',
	'analysis',
	'comparison:',
	'comparison',
	'best:',
	'best',
];

/**
 * Clean a keyword by removing common prefixes
 */
export const cleanKeyword = (keyword: string): string => {
	if (!keyword) return '';
	
	let cleaned = keyword.trim();
	
	// Remove common prefixes (case insensitive)
	for (const prefix of KEYWORD_PREFIXES_TO_REMOVE) {
		const prefixLower = prefix.toLowerCase();
		if (cleaned.toLowerCase().startsWith(prefixLower)) {
			cleaned = cleaned.substring(prefix.length).trim();
			// Check again in case of multiple prefixes
			break;
		}
	}
	
	// Remove leading/trailing punctuation
	cleaned = cleaned.replace(/^[:\-–—]+\s*/, '').replace(/\s*[:\-–—]+$/, '').trim();
	
	return cleaned;
};

/**
 * Check if a keyword appears in the content (case insensitive, word boundaries)
 */
export const keywordAppearsInContent = (keyword: string, content: string): boolean => {
	if (!keyword || keyword.length < 2 || !content) return false;
	
	const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'gi');
	return regex.test(content);
};

/**
 * Count keyword occurrences in content (case insensitive, word boundaries)
 */
export const countKeywordOccurrences = (keyword: string, content: string): number => {
	if (!keyword || keyword.length < 2 || !content) return 0;
	
	const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'gi');
	const matches = content.match(regex);
	
	return matches ? matches.length : 0;
};

/**
 * Calculate keyword density
 */
export const calculateKeywordDensity = (keyword: string, content: string): number => {
	if (!content) return 0;
	
	const wordCount = content.split(/\s+/).filter((w) => w.trim().length > 0).length;
	if (wordCount === 0) return 0;
	
	const keywordCount = countKeywordOccurrences(keyword, content);
	return (keywordCount / wordCount) * 100;
};

/**
 * Extract the best primary keyword from various sources
 * Priority: keywords_used > topic > metadata > title
 * Always validates that keyword appears in content
 */
export const extractPrimaryKeyword = (
	sources: {
		keywordsUsed?: Array<string> | null;
		topic?: string | null;
		metadata?: Record<string, unknown> | null;
		title?: string | null;
	},
	contentBody: string
): { keyword: string; source: string } => {
	const body = contentBody || '';

	// Helper to validate keyword
	const validate = (kw: string, source: string): { keyword: string; source: string } | null => {
		const cleaned = cleanKeyword(kw);
		if (cleaned && cleaned.length >= 3 && keywordAppearsInContent(cleaned, body)) {
			return { keyword: cleaned, source };
		}
		return null;
	};

	// 1. Check keywords_used array
	if (sources.keywordsUsed && sources.keywordsUsed.length > 0) {
		for (const kw of sources.keywordsUsed) {
			if (kw && kw.trim()) {
				const result = validate(kw.trim(), 'keywords_used');
				if (result) return result;
			}
		}
	}

	// 2. Check topic field (with cleaning)
	if (sources.topic && sources.topic.trim()) {
		const result = validate(sources.topic.trim(), 'topic');
		if (result) return result;
	}

	// 3. Check metadata
	if (sources.metadata) {
		const metadata = sources.metadata;
		if (metadata['primaryKeyword'] && typeof metadata['primaryKeyword'] === 'string') {
			const result = validate(metadata['primaryKeyword'], 'metadata.primaryKeyword');
			if (result) return result;
		}
		if (metadata['keyword'] && typeof metadata['keyword'] === 'string') {
			const result = validate(metadata['keyword'], 'metadata.keyword');
			if (result) return result;
		}
	}

	// 4. Extract from title
	if (sources.title && sources.title.trim()) {
		const title = sources.title.trim();
		
		// 4a. Part before ":"
		if (title.includes(':')) {
			const beforeColon = (title.split(':')[0] ?? '').trim();
			const result = validate(beforeColon, 'title (before colon)');
			if (result) return result;
		}
		
		// 4b. Try full cleaned title
		const result = validate(title, 'title');
		if (result) return result;
		
		// 4c. Find proper nouns/brands
		const properNounMatch = title.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/);
		if (properNounMatch && properNounMatch[1]) {
			const propResult = validate(properNounMatch[1], 'title (proper noun)');
			if (propResult) return propResult;
		}
	}

	// 5. Find most frequent capitalized phrase in body
	if (body.length > 100) {
		const capitalizedPhrases = body.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g) || [];
		if (capitalizedPhrases.length > 0) {
			const freq: Record<string, number> = {};
			for (const phrase of capitalizedPhrases) {
				if (phrase.length >= 5) {
					freq[phrase] = (freq[phrase] || 0) + 1;
				}
			}
			const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
			if (sorted[0] && sorted[0][1] >= 3) {
				return { keyword: sorted[0][0], source: 'body (frequent phrase)' };
			}
		}
	}

	// 6. Fallback: return cleaned topic or title even if not found
	if (sources.topic && sources.topic.trim()) {
		const cleaned = cleanKeyword(sources.topic.trim());
		return { keyword: cleaned || sources.topic.trim(), source: 'topic (fallback)' };
	}

	if (sources.title && sources.title.trim()) {
		const cleaned = cleanKeyword(sources.title.trim());
		if (cleaned && cleaned.length <= 50) {
			return { keyword: cleaned, source: 'title (fallback)' };
		}
	}

	return { keyword: '', source: 'not found' };
};

/**
 * Get keyword variations for matching (singular/plural, with/without articles)
 */
export const getKeywordVariations = (keyword: string): Array<string> => {
	if (!keyword) return [];
	
	const variations = new Set<string>();
	variations.add(keyword);
	variations.add(keyword.toLowerCase());
	
	// Remove common articles
	const withoutArticles = keyword
		.replace(/^(il|lo|la|i|gli|le|un|uno|una|the|a|an)\s+/i, '')
		.trim();
	if (withoutArticles !== keyword) {
		variations.add(withoutArticles);
	}
	
	// Basic singular/plural (Italian)
	if (keyword.endsWith('i')) {
		variations.add(keyword.slice(0, -1) + 'o'); // cani -> cano (not perfect but helps)
		variations.add(keyword.slice(0, -1) + 'e'); // cani -> cane
	}
	if (keyword.endsWith('e')) {
		variations.add(keyword.slice(0, -1) + 'i'); // cane -> cani
	}
	
	return Array.from(variations);
};


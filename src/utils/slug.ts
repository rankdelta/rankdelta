/**
 * SEO-Optimized Slug Generator
 * 
 * Best practices implementate:
 * 1. Breve: 3-5 parole max (idealmente 50-60 caratteri)
 * 2. Solo parole chiave importanti
 * 3. Rimuove articoli, preposizioni, congiunzioni
 * 4. Solo lettere minuscole
 * 5. Trattini come separatori
 * 6. No caratteri speciali o accenti
 * 7. No date a meno che non siano nel focus keyword
 */

// Parole da rimuovere (stop words in italiano e inglese)
const STOP_WORDS = new Set([
	// Italian articles
	'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una',
	// Italian prepositions
	'di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra',
	// Italian conjunctions
	'e', 'ed', 'o', 'ma', 'però', 'quindi', 'perché', 'che', 'se',
	// Italian common words
	'del', 'dello', 'della', 'dei', 'degli', 'delle',
	'al', 'allo', 'alla', 'ai', 'agli', 'alle',
	'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle',
	'nel', 'nello', 'nella', 'nei', 'negli', 'nelle',
	'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle',
	'come', 'cosa', 'quale', 'quando', 'dove', 'chi',
	'tutto', 'tutti', 'tutte', 'ogni', 'altro', 'altri',
	'questo', 'questa', 'questi', 'queste',
	'quello', 'quella', 'quelli', 'quelle',
	'suo', 'sua', 'suoi', 'sue', 'proprio', 'propria',
	'molto', 'molta', 'molti', 'molte', 'più', 'meno',
	'anche', 'ancora', 'già', 'sempre', 'mai', 'solo',
	'fare', 'sapere', 'dovere', 'potere', 'volere',
	// English stop words
	'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
	'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
	'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
	'could', 'should', 'may', 'might', 'must', 'shall',
	'this', 'that', 'these', 'those', 'it', 'its',
	'how', 'what', 'when', 'where', 'who', 'which', 'why',
	'all', 'each', 'every', 'both', 'few', 'more', 'most',
	'other', 'some', 'such', 'no', 'not', 'only', 'own', 'same',
	'so', 'than', 'too', 'very', 'just', 'also',
	// Common filler words
	'guida', 'completa', 'definitiva', 'migliore', 'migliori',
	'ultimate', 'complete', 'best', 'top',
]);

// Parole importanti da mantenere sempre (brand, termini tecnici)
const IMPORTANT_WORDS = new Set([
	// Common important terms (NO YEARS - they make URLs obsolete!)
	'seo', 'geo', 'ai', 'api', 'app', 'web', 'blog',
]);

// Pattern per riconoscere gli anni (da escludere dagli slug)
const YEAR_PATTERN = /^(19|20)\d{2}$/;

/**
 * Rimuove accenti e caratteri speciali
 */
const removeAccents = (str: string): string => {
	return str
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[æ]/g, 'ae')
		.replace(/[œ]/g, 'oe')
		.replace(/[ß]/g, 'ss');
};

/**
 * Estrae le parole chiave più importanti dal titolo
 */
const extractKeywords = (title: string, primaryKeyword?: string): Array<string> => {
	// Normalize and clean
	const cleaned = removeAccents(title.toLowerCase());
	
	// Split into words
	const words = cleaned
		.replace(/[^a-z0-9\s-]/g, ' ')
		.split(/\s+/)
		.filter(w => w.length > 1);
	
	// If we have a primary keyword, prioritize its words
	const keywordWords = primaryKeyword 
		? removeAccents(primaryKeyword.toLowerCase())
			.replace(/[^a-z0-9\s-]/g, ' ')
			.split(/\s+/)
			.filter(w => w.length > 1)
		: [];
	
	const keywordSet = new Set(keywordWords);
	
	// Score and filter words
	const scoredWords: Array<{ word: string; score: number }> = [];
	
	for (const word of words) {
		// Skip stop words (unless in primary keyword)
		if (STOP_WORDS.has(word) && !keywordSet.has(word)) {
			continue;
		}
		
		// ALWAYS skip years - they make URLs obsolete when the year changes
		if (YEAR_PATTERN.test(word)) {
			continue;
		}
		
		let score = 1;
		
		// Boost if in primary keyword
		if (keywordSet.has(word)) {
			score += 10;
		}
		
		// Boost important terms
		if (IMPORTANT_WORDS.has(word)) {
			score += 5;
		}
		
		// Boost longer words (usually more meaningful)
		if (word.length >= 6) {
			score += 2;
		}
		
		// Boost if starts with capital in original (proper nouns/brands)
		const originalWord = title.split(/\s+/).find(w => 
			removeAccents(w.toLowerCase()) === word
		);
		if (originalWord && /^[A-Z]/.test(originalWord)) {
			score += 3;
		}
		
		scoredWords.push({ word, score });
	}
	
	// Sort by score (descending) and take top words
	scoredWords.sort((a, b) => b.score - a.score);
	
	// Deduplicate while maintaining order
	const seen = new Set<string>();
	const keywords: Array<string> = [];
	
	for (const { word } of scoredWords) {
		if (!seen.has(word)) {
			seen.add(word);
			keywords.push(word);
		}
	}
	
	return keywords;
};

/**
 * Genera uno slug SEO-friendly dal titolo
 * 
 * @param title - Il titolo dell'articolo
 * @param primaryKeyword - La keyword principale (opzionale, per priorità)
 * @param maxWords - Numero massimo di parole nello slug (default: 5)
 * @param maxLength - Lunghezza massima in caratteri (default: 60)
 * @returns Slug ottimizzato per SEO
 * 
 * @example
 * generateSEOSlug("Guida Completa alla SEO per Principianti nel 2025")
 * // Returns: "guida-seo-principianti-2025"
 * 
 * @example
 * generateSEOSlug("Come Scegliere la Migliore Carta Prepagata", "carta prepagata")
 * // Returns: "scegliere-carta-prepagata"
 */
export const generateSEOSlug = (
	title: string,
	primaryKeyword?: string,
	maxWords: number = 5,
	maxLength: number = 60
): string => {
	if (!title || title.trim().length === 0) {
		return 'articolo';
	}

	// Extract important keywords
	const keywords = extractKeywords(title, primaryKeyword);
	
	if (keywords.length === 0) {
		// Fallback: use first few words of cleaned title
		const fallback = removeAccents(title.toLowerCase())
			.replace(/[^a-z0-9\s]/g, '')
			.split(/\s+/)
			.filter(w => w.length > 2)
			.slice(0, 3)
			.join('-');
		
		return fallback || 'articolo';
	}
	
	// Build slug with top keywords
	let slug = '';
	let wordCount = 0;
	
	for (const word of keywords) {
		if (wordCount >= maxWords) break;
		
		const newSlug = slug ? `${slug}-${word}` : word;
		
		// Check length limit
		if (newSlug.length > maxLength && slug.length > 0) {
			break;
		}
		
		slug = newSlug;
		wordCount++;
	}
	
	// Final cleanup
	slug = slug
		.replace(/--+/g, '-')  // Remove double dashes
		.replace(/^-+|-+$/g, ''); // Remove leading/trailing dashes
	
	// Ensure minimum length
	if (slug.length < 3) {
		slug = removeAccents(title.toLowerCase())
			.replace(/[^a-z0-9]/g, '-')
			.replace(/--+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, maxLength);
	}
	
	return slug;
};

/**
 * Verifica se uno slug è SEO-friendly
 */
export const isSlugSEOFriendly = (slug: string): { 
	isValid: boolean; 
	issues: Array<string>;
	score: number;
} => {
	const issues: Array<string> = [];
	let score = 100;
	
	// Check length
	if (slug.length > 60) {
		issues.push('Slug troppo lungo (max 60 caratteri)');
		score -= 20;
	}
	
	// Check word count
	const wordCount = slug.split('-').length;
	if (wordCount > 5) {
		issues.push('Troppe parole (max 5 raccomandate)');
		score -= 15;
	}
	
	// Check for uppercase
	if (/[A-Z]/.test(slug)) {
		issues.push('Contiene lettere maiuscole');
		score -= 10;
	}
	
	// Check for special characters
	if (/[^a-z0-9-]/.test(slug)) {
		issues.push('Contiene caratteri speciali');
		score -= 15;
	}
	
	// Check for double dashes
	if (/--/.test(slug)) {
		issues.push('Contiene trattini doppi');
		score -= 5;
	}
	
	// Check for leading/trailing dashes
	if (/^-|-$/.test(slug)) {
		issues.push('Inizia o finisce con un trattino');
		score -= 5;
	}
	
	// Check for numbers only
	if (/^[0-9-]+$/.test(slug)) {
		issues.push('Contiene solo numeri');
		score -= 20;
	}
	
	// Check for stop words
	const words = slug.split('-');
	const stopWordsFound = words.filter(w => STOP_WORDS.has(w));
	if (stopWordsFound.length > 1) {
		issues.push(`Contiene stop words: ${stopWordsFound.join(', ')}`);
		score -= 10;
	}
	
	return {
		isValid: issues.length === 0,
		issues,
		score: Math.max(0, score),
	};
};

/**
 * Suggerisce miglioramenti per uno slug esistente
 */
export const improveSEOSlug = (
	currentSlug: string,
	title: string,
	primaryKeyword?: string
): string => {
	const validation = isSlugSEOFriendly(currentSlug);
	
	if (validation.score >= 80) {
		// Slug is already good
		return currentSlug;
	}
	
	// Generate a better slug
	return generateSEOSlug(title, primaryKeyword);
};


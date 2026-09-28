/**
 * SEO Utility Functions
 * 
 * Helper functions for SEO scoring and analysis.
 * Updated for 2025 with GEO (Generative Engine Optimization) metrics.
 * MULTILINGUAL: Supports both Italian and English patterns
 */

import { 
	cleanKeyword, 
	countKeywordOccurrences,
	extractPrimaryKeyword as extractKeyword
} from './keywords';
import { 
	detectSearchIntent, 
	getGEOWeightsForIntent,
	type SearchIntent 
} from './searchIntent';

// Re-export for backward compatibility
export { cleanKeyword, countKeywordOccurrences };
export const extractPrimaryKeyword = extractKeyword;

// ============================================
// MULTILINGUAL PATTERN DEFINITIONS
// ============================================

// Personal Experience Patterns (IT + EN)
const EXPERIENCE_PATTERNS = [
	// Italiano
	/nel\s+\d{4}/gi,
	/negli ultimi \d+ anni/gi,
	/da oltre \d+ anni/gi,
	/nella mia (esperienza|pratica|carriera)/gi,
	/ho (scoperto|imparato|trovato|testato|provato|commesso)/gi,
	/quando ho (iniziato|scoperto|provato)/gi,
	/mi ha (insegnato|mostrato|fatto capire)/gi,
	/voglio condividere/gi,
	// English
	/in my experience/gi,
	/i('ve| have) (found|discovered|learned|tested|tried)/gi,
	/after (testing|trying|using)/gi,
	/what (i|we) learned/gi,
];

// Author Credentials Patterns (IT + EN)
const CREDENTIALS_PATTERNS = [
	// Italiano
	/articolo scritto da/gi,
	/con oltre \d+ anni di esperienza/gi,
	/\d+ anni di esperienza/gi,
	/membro (di|dell')/gi,
	/certificato|qualificato/gi,
	/autore di (diverse|numerose) pubblicazioni/gi,
	/consulente|esperto|specialista/gi,
	/fondatore (di|del)/gi,
	// English
	/written by|author:/gi,
	/with (\d+) years of experience/gi,
	/certified (in|by)/gi,
	/member of/gi,
	/founder of/gi,
	/expert|specialist|professional/gi,
];

// External Citations Patterns (IT + EN)
const CITATION_PATTERNS = [
	// Italiano
	/secondo (uno studio|una ricerca|i dati|un rapporto)/gi,
	/come riportato (da|in)/gi,
	/come sottolinea/gi,
	/(studio|ricerca|rapporto) (condotto|pubblicato|del)/gi,
	/— [A-Z][^,\n]+,\s*\d{4}/g,
	/\([A-Z][^)]+,\s*\d{4}\)/g,
	/(banca|università|istituto|centro studi|federazione|associazione)/gi,
	/peer-reviewed/gi,
	// English
	/according to/gi,
	/research (by|from)/gi,
	/study (by|from|published)/gi,
	/as reported by/gi,
];

// Statistics Patterns
const STATISTICS_PATTERNS = [
	/\d+([.,]\d+)?%/g,
	/\d+ (su|di|dei|delle|of|out of) \d+/gi,
	/il \d+% (degli?|delle?|dei)/gi,
	/\d+\s*(milioni?|miliardi?|million|billion)/gi,
];

// Case Study Patterns (IT + EN)
const CASE_STUDY_PATTERNS = [
	// Italiano
	/caso (di|studio)/gi,
	/case study/gi,
	/situazione iniziale/gi,
	/intervento/gi,
	/risultati (documentati|ottenuti|raggiunti)/gi,
	/lezione appresa/gi,
	/\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4}/gi,
	// English
	/initial situation/gi,
	/documented results/gi,
	/lesson learned/gi,
];

// Trust Signal Patterns (IT + EN)
const TRUST_PATTERNS = [
	// Italiano
	/disclaimer/gi,
	/scopo informativo/gi,
	/consulta (sempre )?(un|il tuo) (esperto|consulente|medico|professionista)/gi,
	/fonti e metodologia/gi,
	/ultimo aggiornamento/gi,
	/prossima revisione/gi,
	// English
	/for informational purposes/gi,
	/consult (a|your) (professional|expert)/gi,
	/last updated/gi,
];

// FAQ Patterns (IT + EN)
const FAQ_PATTERNS = [
	/^#+\s*(faq|domande frequenti|domande comuni|frequently asked)/gim,
	/^\d+\.\s+[^?\n]+\?$/gm,
];

// Key Takeaways Patterns (IT + EN)
const TAKEAWAY_PATTERNS = [
	/^#+\s*(key takeaways?|punti chiave|conclusioni|riepilogo|summary)/gim,
	/in (sintesi|conclusione|breve|summary)/gi,
];

// ============================================
// HELPER FUNCTIONS
// ============================================

const countPatternMatches = (text: string, patterns: Array<RegExp>): number => {
	let count = 0;
	for (const pattern of patterns) {
		const globalPattern = new RegExp(pattern.source, 'gi');
		const matches = text.match(globalPattern);
		if (matches) {
			count += matches.length;
		}
	}
	return count;
};

// ============================================
// MAIN SCORING FUNCTIONS
// ============================================

/**
 * Calculate COMBINED SEO + GEO score
 * Weights: Traditional SEO 40%, GEO factors 60%
 * Intent-aware: Adjusts GEO weights based on search intent
 */
export const calculateSEOScore = (content: string, primaryKeyword: string, intent?: SearchIntent): number => {
	// Always clean the keyword first
	const cleanedKeyword = cleanKeyword(primaryKeyword);
	
	// Auto-detect intent if not provided
	const detectedIntent = intent || detectSearchIntent(cleanedKeyword).intent;
	
	const traditionalSEO = calculateTraditionalSEOScore(content, cleanedKeyword);
	const geoScore = calculateGEOScoreWithIntent(content, detectedIntent);
	
	// Weighted average: 40% traditional SEO, 60% GEO
	const combinedScore = Math.round(traditionalSEO * 0.4 + geoScore * 0.6);
	
	return Math.min(combinedScore, 100);
};

/**
 * Calculate GEO score with intent-based weight adjustments
 */
export const calculateGEOScoreWithIntent = (content: string, intent: SearchIntent): number => {
	const detailed = calculateGEOScoreDetailed(content);
	const weights = getGEOWeightsForIntent(intent);
	
	// Apply weights to each category
	const weightedSum = 
		(detailed.humanExpertise / 25) * 25 * weights.humanExpertise +
		(detailed.uniqueData / 20) * 20 * weights.uniqueData +
		(detailed.citability / 20) * 20 * weights.citability +
		(detailed.contentDepth / 20) * 20 * weights.contentDepth +
		(detailed.eeat / 15) * 15 * weights.eeat;
	
	const totalWeight = 
		weights.humanExpertise * 25 +
		weights.uniqueData * 20 +
		weights.citability * 20 +
		weights.contentDepth * 20 +
		weights.eeat * 15;
	
	// Normalize to 0-100
	return Math.round((weightedSum / totalWeight) * 100);
};

// Local patterns for calculateGEOScoreDetailed (inline to avoid missing references)
const GEO_EXPERIENCE_PATTERNS = [
	/nel\s+\d{4}/gi,
	/negli ultimi \d+ anni/gi,
	/nella mia (esperienza|pratica|carriera)/gi,
	/ho (scoperto|imparato|trovato|testato)/gi,
	/in my experience/gi,
	/i('ve| have) (found|discovered|learned)/gi,
];

const GEO_CREDENTIALS_PATTERNS = [
	/articolo scritto da/gi,
	/\d+ anni di esperienza/gi,
	/esperto|specialista|consulente/gi,
	/membro (di|dell)/gi,
	/written by|author/gi,
	/certified|qualified/gi,
];

const GEO_UNIQUE_DATA_PATTERNS = [
	/\d+([.,]\d+)?%/g, // Percentages
	/secondo (i nostri dati|il nostro studio)/gi,
	/abbiamo (documentato|rilevato|analizzato)/gi,
	/nel nostro studio/gi,
	/our (data|research|study) shows/gi,
];

const GEO_STUDY_PATTERNS = [
	/studio (interno|condotto)/gi,
	/tra \w+ e \w+ \d{4}/gi,
	/su \d+ (utenti|clienti|casi)/gi,
	/internal study|our research/gi,
];

const GEO_CITABLE_PATTERNS = [
	/"[^"]{15,}"/g, // Quoted definitions
	/è (un|una|il|la) [^.]{10,}\./gi, // "X è un/una..."
	/significa [^.]{10,}\./gi, // "X significa..."
	/is defined as|refers to/gi,
];

/**
 * Calculate detailed GEO scores by category
 */
export const calculateGEOScoreDetailed = (content: string): {
	humanExpertise: number;
	uniqueData: number;
	citability: number;
	contentDepth: number;
	eeat: number;
	total: number;
} => {
	const wordCount = content.split(/\s+/).length;
	
	// Helper to count pattern matches
	const countMatches = (text: string, patterns: Array<RegExp>): number => {
		let count = 0;
		for (const pattern of patterns) {
			const matches = text.match(pattern);
			if (matches) count += matches.length;
		}
		return count;
	};
	
	// 1. Human Expertise (25 points max)
	let humanExpertise = 0;
	const experienceCount = countMatches(content, GEO_EXPERIENCE_PATTERNS);
	const credentialsCount = countMatches(content, GEO_CREDENTIALS_PATTERNS);
	if (experienceCount >= 3 && credentialsCount >= 2) humanExpertise = 25;
	else if (experienceCount >= 2 || credentialsCount >= 1) humanExpertise = 15;
	else if (experienceCount >= 1) humanExpertise = 8;
	
	// 2. Unique Data (20 points max)
	let uniqueData = 0;
	const uniqueDataCount = countMatches(content, GEO_UNIQUE_DATA_PATTERNS);
	const studyCount = countMatches(content, GEO_STUDY_PATTERNS);
	if (uniqueDataCount >= 5 && studyCount >= 1) uniqueData = 20;
	else if (uniqueDataCount >= 3) uniqueData = 12;
	else if (uniqueDataCount >= 1) uniqueData = 6;
	
	// 3. Citability (20 points max)
	let citability = 0;
	const citableDefCount = countMatches(content, GEO_CITABLE_PATTERNS);
	const quoteCount = (content.match(/^>\s+.+$/gm) || []).length;
	const blockquoteCount = (content.match(/"[^"]{20,}"/g) || []).length;
	const totalCitable = citableDefCount + quoteCount + blockquoteCount;
	if (totalCitable >= 5) citability = 20;
	else if (totalCitable >= 3) citability = 12;
	else if (totalCitable >= 1) citability = 6;
	
	// 4. Content Depth (20 points max)
	let contentDepth = 0;
	const h2Count = (content.match(/^##\s+/gm) || []).length;
	const h3Count = (content.match(/^###\s+/gm) || []).length;
	const hasDepth = h2Count >= 5 && h3Count >= 8 && wordCount >= 1500;
	const hasFAQ = /##\s*(FAQ|domande|questions)/i.test(content);
	const hasCaseStudy = /caso (di )?studio|case study/i.test(content);
	if (hasDepth && hasFAQ && hasCaseStudy) contentDepth = 20;
	else if (hasDepth && (hasFAQ || hasCaseStudy)) contentDepth = 14;
	else if (h2Count >= 4 && wordCount >= 1000) contentDepth = 8;
	
	// 5. E-E-A-T (15 points max)
	let eeat = 0;
	const hasAuthorBio = /articolo scritto da|written by|autore:/i.test(content);
	const hasDisclaimer = /disclaimer|avvertenz|questo articolo ha scopo informativo/i.test(content);
	const hasMethodology = /metodologia|fonti|sources|methodology/i.test(content);
	const hasLastUpdate = /ultimo aggiornamento|last updated|aggiornato il/i.test(content);
	const trustSignals = [hasAuthorBio, hasDisclaimer, hasMethodology, hasLastUpdate].filter(Boolean).length;
	if (trustSignals >= 4) eeat = 15;
	else if (trustSignals >= 2) eeat = 10;
	else if (trustSignals >= 1) eeat = 5;
	
	const total = humanExpertise + uniqueData + citability + contentDepth + eeat;
	
	return {
		humanExpertise,
		uniqueData,
		citability,
		contentDepth,
		eeat,
		total,
	};
};

/**
 * Calculate Traditional SEO score (keyword optimization, structure)
 */
export const calculateTraditionalSEOScore = (content: string, primaryKeyword: string): number => {
	let score = 0;
	const contentLower = content.toLowerCase();
	
	// Clean the keyword before analysis
	const cleanedKeyword = cleanKeyword(primaryKeyword);
	const keywordLower = cleanedKeyword.toLowerCase();

	// Keyword density (1-3% is optimal)
	const wordCount = contentLower.split(/\s+/).length;
	const keywordCount = countKeywordOccurrences(cleanedKeyword, content);
	const density = wordCount > 0 ? (keywordCount / wordCount) * 100 : 0;

	if (density >= 0.5 && density <= 3) {
		score += 20;
	} else if (density > 0 && density < 5) {
		score += 10;
	}

	// Keyword in title (H1)
	const h1Match = content.match(/^#\s+(.+)$/m);
	if (h1Match && h1Match[1]?.toLowerCase().includes(keywordLower)) {
		score += 15;
	}

	// Keyword in H2s (check for cleaned keyword)
	const h2Matches = content.match(/^##\s+(.+)$/gm) || [];
	const h2WithKeyword = h2Matches.filter((h) => {
		const h2Lower = h.toLowerCase();
		return h2Lower.includes(keywordLower) || 
			(cleanedKeyword.includes(' ') && h2Lower.includes((cleanedKeyword.split(' ')[0] ?? '').toLowerCase()));
	}).length;
	if (h2WithKeyword >= 2) score += 10;
	else if (h2WithKeyword >= 1) score += 5;

	// Headings structure
	const h1Count = (content.match(/^#\s+/gm) || []).length;
	const h2Count = (content.match(/^##\s+/gm) || []).length;
	const h3Count = (content.match(/^###\s+/gm) || []).length;

	if (h1Count === 1) score += 5;
	if (h2Count >= 4) score += 10;
	else if (h2Count >= 2) score += 5;
	if (h3Count >= 2) score += 5;

	// Content length
	if (wordCount >= 2500) score += 15;
	else if (wordCount >= 2000) score += 12;
	else if (wordCount >= 1500) score += 8;
	else if (wordCount >= 1000) score += 5;

	// Links (internal + external)
	const linkMatches = content.match(/\[([^\]]+)\]\([^\)]+\)/g) || [];
	if (linkMatches.length >= 5) score += 10;
	else if (linkMatches.length >= 2) score += 5;

	// Images with alt text
	const imageMatches = content.match(/!\[[^\]]+\]\([^\)]+\)/g) || [];
	if (imageMatches.length >= 3) score += 10;
	else if (imageMatches.length >= 1) score += 5;

	return Math.min(score, 100);
};

/**
 * Calculate GEO Score (Generative Engine Optimization) - 2025
 * Measures how well content will perform with AI summaries and AI Overviews
 * MULTILINGUAL: Supports both Italian and English
 */
export const calculateGEOScore = (content: string): number => {
	let score = 0;
	const wordCount = content.split(/\s+/).length;
	
	// 1. Human Expertise & Credentials (25 points)
	const experienceCount = countPatternMatches(content, EXPERIENCE_PATTERNS);
	const credentialsCount = countPatternMatches(content, CREDENTIALS_PATTERNS);
	
	if (experienceCount >= 3 && credentialsCount >= 2) score += 25;
	else if (experienceCount >= 2 || credentialsCount >= 1) score += 15;
	else if (experienceCount >= 1) score += 8;
	
	// 2. Data, Statistics & Citations (25 points)
	const citationCount = countPatternMatches(content, CITATION_PATTERNS);
	const statisticsCount = countPatternMatches(content, STATISTICS_PATTERNS);
	
	if (citationCount >= 3 && statisticsCount >= 5) score += 25;
	else if (citationCount >= 2 && statisticsCount >= 3) score += 18;
	else if (citationCount >= 1 || statisticsCount >= 2) score += 10;
	
	// 3. Content Depth - Case Studies, FAQ, Takeaways (25 points)
	const caseStudyCount = countPatternMatches(content, CASE_STUDY_PATTERNS);
	const faqCount = countPatternMatches(content, FAQ_PATTERNS);
	const takeawayCount = countPatternMatches(content, TAKEAWAY_PATTERNS);
	const h2Count = (content.match(/^##\s+/gm) || []).length;
	
	let depthScore = 0;
	if (caseStudyCount >= 3) depthScore += 8;
	else if (caseStudyCount >= 1) depthScore += 4;
	
	if (faqCount >= 1) depthScore += 8;
	if (takeawayCount >= 1) depthScore += 5;
	
	if (wordCount >= 2000 && h2Count >= 5) depthScore += 4;
	else if (wordCount >= 1500 && h2Count >= 3) depthScore += 2;
	
	score += Math.min(depthScore, 25);
	
	// 4. E-E-A-T & Trust Signals (25 points)
	const trustCount = countPatternMatches(content, TRUST_PATTERNS);
	
	// Check specific trust elements
	const hasDisclaimer = /disclaimer/i.test(content);
	const hasMethodology = /metodologia|fonti e metodologia|methodology|sources/i.test(content);
	const hasLastUpdated = /ultimo aggiornamento|last updated/i.test(content);
	
	let trustScore = 0;
	if (credentialsCount >= 2) trustScore += 8;
	else if (credentialsCount >= 1) trustScore += 4;
	
	if (hasDisclaimer) trustScore += 5;
	if (hasMethodology) trustScore += 5;
	if (hasLastUpdated) trustScore += 4;
	if (trustCount >= 2) trustScore += 3;
	
	score += Math.min(trustScore, 25);
	
	return Math.min(score, 100);
};

/**
 * Calculate E-E-A-T Score (Experience, Expertise, Authoritativeness, Trustworthiness)
 * MULTILINGUAL version
 */
export const calculateEEATScore = (content: string): { total: number; breakdown: Record<string, number> } => {
	const breakdown: Record<string, number> = {
		experience: 0,
		expertise: 0,
		authoritativeness: 0,
		trustworthiness: 0,
	};
	
	// Experience signals (IT + EN)
	const experienceCount = countPatternMatches(content, EXPERIENCE_PATTERNS);
	breakdown['experience'] = Math.min(experienceCount * 5, 25);
	
	// Expertise signals (IT + EN)
	const credentialsCount = countPatternMatches(content, CREDENTIALS_PATTERNS);
	breakdown['expertise'] = Math.min(credentialsCount * 5, 25);
	
	// Authoritativeness signals (IT + EN)
	const citationCount = countPatternMatches(content, CITATION_PATTERNS);
	breakdown['authoritativeness'] = Math.min(citationCount * 5, 25);
	
	// Trustworthiness signals (IT + EN)
	const trustCount = countPatternMatches(content, TRUST_PATTERNS);
	breakdown['trustworthiness'] = Math.min(trustCount * 5, 25);
	
	const total = Object.values(breakdown).reduce((sum, val) => sum + val, 0);
	
	return { total, breakdown };
};

/**
 * Calculate Citability Score - How likely AI will cite this content
 * MULTILINGUAL version
 */
export const calculateCitabilityScore = (content: string): number => {
	let score = 0;
	
	// Clear definitions (easily quotable) - IT + EN
	const definitionPatterns = [
		/[A-Z][^.]*\b(è|sono|significa|rappresenta)\s+[^.]{20,100}\./gi, // Italian
		/\b\w+\s+is\s+(a|an|the)\s+[^.]{10,60}\./gi, // English
	];
	const definitionCount = countPatternMatches(content, definitionPatterns);
	score += Math.min(definitionCount * 6, 20);
	
	// Quotable statements (text in quotes)
	const quotableCount = (content.match(/[""][^""]{20,200}[""]|«[^»]{20,200}»/g) || []).length;
	score += Math.min(quotableCount * 8, 25);
	
	// Statistics and data points
	const statisticsCount = countPatternMatches(content, STATISTICS_PATTERNS);
	score += Math.min(statisticsCount * 4, 25);
	
	// Expert attributions
	const citationCount = countPatternMatches(content, CITATION_PATTERNS);
	score += Math.min(citationCount * 6, 20);
	
	// Author credentials (makes content more citable)
	const credentialsCount = countPatternMatches(content, CREDENTIALS_PATTERNS);
	score += Math.min(credentialsCount * 5, 10);
	
	return Math.min(score, 100);
};

/**
 * Calculate Flesch-Kincaid readability score
 * Supports Italian vowels
 */
export const calculateReadability = (content: string): number => {
	const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
	const words = content.split(/\s+/).filter((w) => w.length > 0);
	const syllables = words.reduce((count, word) => {
		const wordLower = word.toLowerCase();
		const vowelMatches = wordLower.match(/[aeiouàèéìòùy]+/gi);
		return count + (vowelMatches ? vowelMatches.length : 1);
	}, 0);

	if (sentences.length === 0 || words.length === 0) return 0;

	const avgSentenceLength = words.length / sentences.length;
	const avgSyllablesPerWord = syllables / words.length;

	// Flesch Reading Ease formula
	const score = 206.835 - 1.015 * avgSentenceLength - 84.6 * avgSyllablesPerWord;

	return Math.max(0, Math.min(100, Math.round(score)));
};

/**
 * Extract keywords from content
 */
export const extractKeywords = (content: string, count: number = 10): Array<string> => {
	// Common stop words (IT + EN)
	const stopWords = new Set([
		'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra',
		'che', 'non', 'sono', 'come', 'anche', 'più', 'questo', 'quello', 'essere', 'avere', 'fare', 'dire', 'potere',
		'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with', 'he', 'as',
		'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or', 'an', 'will',
	]);

	const words = content
		.toLowerCase()
		.replace(/[^\w\sàèéìòù]/g, ' ')
		.split(/\s+/)
		.filter((w) => w.length > 4 && !stopWords.has(w));

	const wordFreq: Record<string, number> = {};
	words.forEach((word) => {
		wordFreq[word] = (wordFreq[word] || 0) + 1;
	});

	return Object.entries(wordFreq)
		.sort(([, a], [, b]) => b - a)
		.slice(0, count)
		.map(([word]) => word);
};

/**
 * Get detailed SEO+GEO analysis breakdown
 */
export const getDetailedAnalysis = (content: string, primaryKeyword: string): {
	traditionalSEO: number;
	geoScore: number;
	combinedScore: number;
	citability: number;
	eeat: { total: number; breakdown: Record<string, number> };
	readability: number;
	wordCount: number;
} => {
	return {
		traditionalSEO: calculateTraditionalSEOScore(content, primaryKeyword),
		geoScore: calculateGEOScore(content),
		combinedScore: calculateSEOScore(content, primaryKeyword),
		citability: calculateCitabilityScore(content),
		eeat: calculateEEATScore(content),
		readability: calculateReadability(content),
		wordCount: content.split(/\s+/).length,
	};
};

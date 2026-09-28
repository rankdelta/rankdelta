/**
 * Fact-Checking Service
 * 
 * Verifica automaticamente le affermazioni nel contenuto generato.
 * Identifica e rimuove/corregge informazioni non verificabili.
 * 
 * STRATEGIA (AGGIORNATA CON PERPLEXITY):
 * 1. Pattern-based: Estrae affermazioni sospette (veloce, senza API)
 * 2. Perplexity verification: Verifica claim sospetti con ricerca web reale
 * 3. Correzione: Rimuove/corregge affermazioni non verificabili
 * 4. Fonti: Raccoglie fonti verificate per la sezione "Riferimenti"
 * 
 * PERPLEXITY INTEGRATION:
 * - Pre-generation research: Raccoglie fatti verificati PRIMA di generare
 * - Post-generation check: Verifica claim sospetti DOPO la generazione
 * - Source collection: Raccoglie fonti per aumentare E-E-A-T
 */

import { complete } from './openrouter';
import { isProxyEnabled } from './edgeProxy';
import { contentLocale, verifiedSourcesSectionLabels } from '../lib/contentLanguages';
import { sourceNeededPlaceholder } from '../lib/contentIntegrity';
import { 
	isPerplexityAvailable, 
	verifyMultipleClaimsWithPerplexity,
	researchTopicWithSources,
	formatResearchForPrompt,
	type ResearchResult,
	type PerplexitySource,
	type ClaimVerificationResult,
} from './perplexity';

// Tipi di affermazioni da verificare
interface Claim {
	type: 'person' | 'study' | 'statistic' | 'institution' | 'quote';
	text: string;
	context: string;
	startIndex: number;
	endIndex: number;
	isVerified: boolean;
	verificationResult?: string;
	suggestedReplacement?: string;
}

/** Single suspicious claim entry returned by the AI fact-check response. */
interface AISuspiciousClaim {
	original: string;
	reason: string;
	/** Ignored: a model-written "correction" could itself contain invented facts. */
	replacement?: string;
}

/** Parsed shape of the AI fact-check JSON response. */
interface AIFactCheckAnalysis {
	suspiciousClaims?: AISuspiciousClaim[];
	overallAssessment?: string;
	suggestedFixes?: string[];
}

export interface FactCheckResult {
	originalContent: string;
	correctedContent: string;
	claimsFound: number;
	claimsVerified: number;
	/** Claims actually neutralised in `correctedContent` (replaced by a placeholder or a sourced correction). */
	claimsRemoved: number;
	claims: Array<Claim>;
	overallScore: number; // 0-100
	// New: collected sources for reference section
	verifiedSources?: PerplexitySource[];
	perplexityUsed?: boolean;
	/** True when a verification step could not run (API error, unparseable answer): the article is NOT fully checked. */
	checkFailed?: boolean;
	/** Human-readable reasons when checkFailed is true. */
	warnings?: string[];
}

export interface FactCheckOptions {
	/** Article language — placeholders are written in it (default English). */
	language?: string;
	/** Real names that must never be flagged (e.g. the project's configured author). */
	trustedTerms?: string[];
}

/** Max characters sent to the AI fact-checker per call; longer articles are checked in chunks. */
export const FACT_CHECK_CHUNK_CHARS = 8000;

// Export ResearchResult for use in contentAgent
export type { ResearchResult, PerplexitySource };

// Capitalised word (incl. accented) and lowercase connectors, for multi-word institution names.
const CAP = "[A-ZÀ-Ý][A-Za-zÀ-ÿ'’-]+";
const CONN = '(?:\\s+(?:di|del|della|dello|dei|degli|delle|per|e|of|for|and|the))*';

// Pattern per identificare affermazioni potenzialmente inventate
// (niente flag /i dove [A-Z] indica una maiuscola: con /i combaciava qualsiasi parola)
const CLAIM_PATTERNS = {
	// Nomi di persone inventate (Dr., Prof., Dott., etc.)
	person: [
		/(?:Dr\.|Dott\.|Prof\.|Dottore|Professor|Professoressa)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/g,
		/(?:[Ss]econdo|[Aa]fferma|[Ss]piega|[Cc]onferma|[Dd]ice)\s+(?:il\s+)?(?:Dr\.|Dott\.|Prof\.)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/g,
		/(?:[Aa]ccording to|says|explains|confirms)\s+(?:Dr\.|Prof\.|Professor)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/g,
	],
	
	// Studi scientifici con anno (spesso inventati)
	study: [
		/Journal\s+of\s+[A-Z][a-zA-Z\s]+\s*\(\d{4}\)/g,
		/[A-Z][a-z]+\s+et\s+al\.\s*[\(,]\s*\d{4}/g,
		/(?:studio|ricerca|analisi)\s+(?:pubblicat[ao]|condott[ao])\s+(?:su|dal|dalla)\s+[A-Z][a-zA-Z\s]+\s*\(\d{4}\)/gi,
		/(?:Secondo|Come riportato da|Come indicato da)\s+(?:uno studio|una ricerca)\s+(?:del|di|pubblicato su)\s+[A-Z][a-zA-Z\s]+/gi,
		/(?:according to|as reported by)\s+a\s+(?:study|survey|report)\s+(?:by|from|published in)\s+[A-Z][a-zA-Z\s]+/gi,
		/\ba\s+\d{4}\s+(?:study|survey)\s+(?:by|from)\s+[A-Z][a-zA-Z]+/gi,
	],
	
	// Statistiche molto precise (spesso fabbricate)
	statistic: [
		/\b\d{1,2}[.,]\d+\s?%/g, // Percentuali con decimali (es. 73.2%, 73,2 %)
		/\b(?:su|tra|di)\s+\d{3,}\s+(?:casi|pazienti|soggetti|cani|utenti|persone)/gi,
		/(?:nel nostro studio|secondo i nostri dati|dati proprietari)/gi,
		/(?:abbiamo documentato|abbiamo osservato|nei nostri test)\s+che/gi,
		/\b(?:of|among|out of)\s+\d{3,}\s+(?:cases|patients|subjects|dogs|users|people|customers|respondents)/gi,
		/(?:in our (?:study|tests|research)|our (?:internal |proprietary )?data (?:shows?|suggests?)|proprietary data)/gi,
		/(?:we (?:documented|observed|found|measured))\s+that/gi,
	],
	
	// Istituzioni (potrebbero essere inventate)
	institution: [
		/Università\s+di\s+[A-Z][a-z]+/g,
		new RegExp(`Associazione\\s+(?:Italiana|Nazionale|Internazionale)(?:${CONN}\\s+${CAP})+`, 'g'),
		new RegExp(`Istituto(?:${CONN}\\s+${CAP})+`, 'g'),
		new RegExp(`Centro\\s+(?:Studi|Ricerche|di Ricerca)(?:${CONN}\\s+${CAP})+`, 'g'),
		/University\s+of\s+[A-Z][a-z]+/g,
	],
	
	// Citazioni attribuite
	quote: [
		/"[^"]+"\s*[—–-]\s*[A-Z][a-z]+\s+[A-Z][a-z]+/g,
		/[Cc]ome\s+(?:afferma|sottolinea|spiega)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/g,
		/as\s+[A-Z][a-z]+\s+[A-Z][a-z]+\s+(?:says|explains|puts it|notes)/g,
	],
};

// Istituzioni/organizzazioni REALI e verificabili
const VERIFIED_ENTITIES = new Set([
	// Enti italiani reali
	'enpa',
	'fnovi',
	'ministero della salute',
	'istituto superiore di sanità',
	'iss',
	'asl',
	'ats',
	'regione lombardia',
	'regione lazio',
	// Enti internazionali reali
	'oms',
	'who',
	'cdc',
	'fda',
	'ema',
	'efsa',
	// Università molto note (verificabili)
	'università di bologna',
	'università di milano',
	'università la sapienza',
	'politecnico di milano',
	'harvard',
	'oxford',
	'cambridge',
	'mit',
	'stanford',
]);

/** Whole-word match of a known entity inside a claim (so "smith" does not match "mit"). */
const mentionsKnownEntity = (textLower: string): boolean => {
	for (const entity of VERIFIED_ENTITIES) {
		const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		if (new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, 'u').test(textLower)) return true;
	}
	return false;
};

/**
 * Estrae tutte le affermazioni verificabili dal contenuto.
 * The regexes cover Italian and English; other languages rely on the AI pass (aiAssistedFactCheck),
 * which is language-agnostic and reads the whole article in chunks.
 */
export const extractClaims = (content: string, trustedTerms: string[] = []): Array<Claim> => {
	const claims: Array<Claim> = [];
	const seenTexts = new Set<string>();
	const trusted = trustedTerms.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 2);
	
	for (const [type, patterns] of Object.entries(CLAIM_PATTERNS)) {
		for (const pattern of patterns) {
			const regex = new RegExp(pattern.source, pattern.flags);
			let match;
			
			while ((match = regex.exec(content)) !== null) {
				const text = match[0];
				
				// Evita duplicati
				if (seenTexts.has(text.toLowerCase())) continue;
				seenTexts.add(text.toLowerCase());
				
				// Controlla se è un'entità verificata o un nome reale fornito (es. l'autore del progetto)
				const lower = text.toLowerCase();
				const isKnownEntity = mentionsKnownEntity(lower) || trusted.some((t) => lower.includes(t));
				
				// Estrai contesto (50 caratteri prima e dopo)
				const contextStart = Math.max(0, match.index - 50);
				const contextEnd = Math.min(content.length, match.index + text.length + 50);
				const context = content.slice(contextStart, contextEnd);
				
				claims.push({
					type: type as Claim['type'],
					text,
					context,
					startIndex: match.index,
					endIndex: match.index + text.length,
					isVerified: isKnownEntity,
					verificationResult: isKnownEntity ? 'Entità nota e verificabile' : undefined,
				});
			}
		}
	}
	
	// Ordina per posizione nel testo
	claims.sort((a, b) => a.startIndex - b.startIndex);
	
	return claims;
};

/**
 * Sostituzione sicura per un'affermazione non verificata: un placeholder visibile nella lingua
 * dell'articolo che racchiude il testo originale (es. "[Source needed: 73.2% of dogs]"), così
 * l'autore lo verifica con una fonte reale o lo elimina. Vale per tutti i tipi di claim
 * (persone, studi, statistiche, istituzioni, citazioni): nessuno resta come fatto non verificato.
 */
export const generateSafeReplacement = (claim: Pick<Claim, 'text'>, language: string = 'en'): string =>
	sourceNeededPlaceholder(language, claim.text);

/**
 * Applica le correzioni ai claim non verificati e restituisce quante sono state DAVVERO applicate.
 * Claim sovrapposti (es. "secondo il Dr. X Y" e "Dr. X Y") vengono uniti in un unico placeholder.
 * Claim non localizzabili nel testo non vengono contati.
 */
export const applyClaimCorrections = (
	content: string,
	claims: Array<Claim>,
	language: string = 'en',
): { content: string; applied: number } => {
	const located = claims
		.filter((c) => !c.isVerified && c.startIndex >= 0 && c.endIndex > c.startIndex && content.slice(c.startIndex, c.endIndex) === c.text)
		.sort((a, b) => a.startIndex - b.startIndex);

	const spans: Array<{ start: number; end: number; claims: Array<Claim> }> = [];
	for (const claim of located) {
		const last = spans[spans.length - 1];
		if (last && claim.startIndex < last.end) {
			last.end = Math.max(last.end, claim.endIndex);
			last.claims.push(claim);
		} else {
			spans.push({ start: claim.startIndex, end: claim.endIndex, claims: [claim] });
		}
	}

	let correctedContent = '';
	let cursor = 0;
	for (const span of spans) {
		const single = span.claims.length === 1 ? span.claims[0] : undefined;
		const replacement = single?.suggestedReplacement || sourceNeededPlaceholder(language, content.slice(span.start, span.end));
		correctedContent += content.slice(cursor, span.start) + replacement;
		cursor = span.end;
	}
	correctedContent += content.slice(cursor);

	console.log(`📝 Fact-check: ${spans.length} modifiche applicate`);

	// Solo pulizia minimale (non rompere la formattazione markdown)
	correctedContent = correctedContent.replace(/\n{4,}/g, '\n\n\n');

	return { content: correctedContent, applied: spans.length };
};

/** Corregge il contenuto sostituendo le affermazioni non verificate con un placeholder. */
export const correctUnverifiedClaims = (content: string, claims: Array<Claim>, language: string = 'en'): string =>
	applyClaimCorrections(content, claims, language).content;

/**
 * Verifica euristica di un'affermazione (senza rete): entità note → verificata, altrimenti
 * non verificata. La verifica reale sul web è factCheckWithPerplexity.
 */
export const verifyClaimOnline = async (
	claim: Claim,
	_useExternalAPI: boolean = false
): Promise<{
	isVerified: boolean;
	confidence: number;
	source?: string;
}> => {
	// Verifica euristica per entità note
	const textLower = claim.text.toLowerCase();
	
	// Check against known entities (whole words only)
	if (mentionsKnownEntity(textLower)) {
		return {
			isVerified: true,
			confidence: 90,
			source: 'Known verified entity',
		};
	}
	
	// Pattern che indicano contenuto inventato
	const fabricationIndicators = [
		/\d{1,2}\.\d+%/, // Percentuali troppo precise
		/et\s+al\./i, // Citazioni accademiche
		/Journal\s+of/i, // Nomi di riviste
		/nostro\s+studio|our\s+study/i, // "Nostro studio"
		/dati\s+proprietari|proprietary\s+data/i, // "Dati proprietari"
		/abbiamo\s+documentato|we\s+documented/i, // "Abbiamo documentato"
	];
	
	for (const indicator of fabricationIndicators) {
		if (indicator.test(claim.text)) {
			return {
				isVerified: false,
				confidence: 80,
				source: 'Pattern matches likely fabrication',
			};
		}
	}
	
	// Default: non verificato ma bassa confidenza
	return {
		isVerified: false,
		confidence: 50,
		source: 'Unable to verify - treating as unverified for safety',
	};
};

/**
 * Esegue il fact-check pattern-based del contenuto (nessuna rete): ogni claim non verificabile
 * diventa un placeholder visibile.
 */
export const factCheckContent = async (content: string, options: FactCheckOptions = {}): Promise<FactCheckResult> => {
	const language = options.language ?? 'en';
	console.log('🔍 Starting fact-check process...');
	
	// 1. Estrai le affermazioni
	const claims = extractClaims(content, options.trustedTerms);
	console.log(`📋 Found ${claims.length} claims to verify`);
	
	// 2. Verifica ogni affermazione
	let verifiedCount = 0;
	for (const claim of claims) {
		if (claim.isVerified) {
			verifiedCount++;
			continue;
		}
		
		const verification = await verifyClaimOnline(claim);
		claim.isVerified = verification.isVerified;
		claim.verificationResult = verification.source;
		
		if (verification.isVerified) {
			verifiedCount++;
		} else {
			claim.suggestedReplacement = generateSafeReplacement(claim, language);
			console.log(`⚠️ Unverified: "${claim.text}" → "${claim.suggestedReplacement}"`);
		}
	}
	
	// 3. Correggi il contenuto
	const { content: correctedContent, applied } = applyClaimCorrections(content, claims, language);
	
	// 4. Calcola score
	const overallScore = claims.length > 0 
		? Math.round((verifiedCount / claims.length) * 100)
		: 100;
	
	console.log(`✅ Fact-check complete: ${verifiedCount}/${claims.length} verified (${overallScore}% score)`);
	
	return {
		originalContent: content,
		correctedContent,
		claimsFound: claims.length,
		claimsVerified: verifiedCount,
		claimsRemoved: applied,
		claims,
		overallScore,
	};
};

/** Split an article into chunks of at most `maxChars`, on paragraph boundaries where possible. */
export const splitIntoChunks = (content: string, maxChars: number = FACT_CHECK_CHUNK_CHARS): string[] => {
	if (content.length <= maxChars) return content ? [content] : [];
	const chunks: string[] = [];
	let current = '';
	for (const paragraph of content.split(/(\n\n+)/)) {
		if (current.length + paragraph.length > maxChars && current) {
			chunks.push(current);
			current = '';
		}
		// A single paragraph longer than the limit is hard-split.
		let rest = paragraph;
		while (rest.length > maxChars) {
			chunks.push(rest.slice(0, maxChars));
			rest = rest.slice(maxChars);
		}
		current += rest;
	}
	if (current) chunks.push(current);
	return chunks;
};

const AI_FACT_CHECK_SYSTEM_PROMPT = `You are a strict fact-checker. The article may be in any language. Identify statements that are likely invented or cannot be verified from the article itself:
1. Named people, experts or quotes attributed to them (e.g. "Dr. X", "Prof. Y", "as Z says")
2. Studies, journals, surveys, reports or institutions cited as the source of a claim
3. Precise statistics, percentages or figures presented as fact without a linked source
4. "Our data", "our study", "we tested/observed" and similar first-hand claims
5. Case studies, customer stories, before/after results about specific companies or people

Do NOT flag: general well-established knowledge, structural counts ("5 steps"), dates, product names, or placeholders in square brackets.

For each suspicious statement return the EXACT text as it appears in the article (copy it verbatim, keep it short: the smallest span that contains the claim) and why it is suspicious.

Reply ONLY with valid JSON in this format (no other text):
{"suspiciousClaims":[{"original":"exact text from the article","reason":"why it is suspicious"}]}`;

/**
 * Usa un LLM per identificare affermazioni potenzialmente inventate su TUTTO l'articolo (a chunk)
 * e le sostituisce con un placeholder visibile nella lingua dell'articolo. Il modello non riscrive
 * il testo: un suo "rimpiazzo" potrebbe a sua volta contenere fatti inventati.
 */
export const aiAssistedFactCheck = async (
	content: string,
	options: FactCheckOptions & { skipTexts?: string[] } = {},
): Promise<FactCheckResult> => {
	const language = options.language ?? 'en';
	if (!isProxyEnabled()) {
		console.warn('LLM proxy not enabled, using pattern-based fact-check only');
		return factCheckContent(content, options);
	}

	console.log('🤖 Running AI-assisted fact-check...');

	const chunks = splitIntoChunks(content);
	const skip = new Set((options.skipTexts ?? []).map((t) => t.toLowerCase()));
	const trusted = (options.trustedTerms ?? []).map((t) => t.trim().toLowerCase()).filter((t) => t.length > 2);
	const claims: Array<Claim> = [];
	const seen = new Set<string>();
	const warnings: string[] = [];
	let failedChunks = 0;

	for (const [i, chunk] of chunks.entries()) {
		try {
			const analysisText = await complete(
				[{ role: 'user', content: `Analyse this article excerpt (part ${i + 1} of ${chunks.length}):\n\n${chunk}` }],
				{ model: 'openai/gpt-4o-mini', systemPrompt: AI_FACT_CHECK_SYSTEM_PROMPT, temperature: 0.2 }
			);
			if (!analysisText) throw new Error('No response from AI');

			// The model may wrap the JSON in prose/markdown; extract the object defensively.
			const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
			const analysis = JSON.parse(jsonMatch ? jsonMatch[0] : analysisText) as AIFactCheckAnalysis;

			for (const suspicious of analysis.suspiciousClaims || []) {
				const original = typeof suspicious?.original === 'string' ? suspicious.original.trim() : '';
				if (!original || original.startsWith('[')) continue;
				const lower = original.toLowerCase();
				if (seen.has(lower) || skip.has(lower) || trusted.some((t) => lower.includes(t))) continue;
				seen.add(lower);
				// Only count claims that really are in the article: an unlocatable quote fixes nothing.
				const index = content.indexOf(original);
				if (index < 0) continue;
				claims.push({
					type: 'study', // Default type
					text: original,
					context: suspicious.reason,
					startIndex: index,
					endIndex: index + original.length,
					isVerified: false,
					verificationResult: suspicious.reason,
					suggestedReplacement: generateSafeReplacement({ text: original }, language),
				});
			}
		} catch (error) {
			failedChunks++;
			console.error(`AI fact-check failed on chunk ${i + 1}/${chunks.length}:`, error);
		}
	}

	if (chunks.length > 0 && failedChunks === chunks.length) {
		console.error('AI fact-check failed on every chunk, falling back to pattern-based');
		const fallback = await factCheckContent(content, options);
		return { ...fallback, checkFailed: true, warnings: ['AI fact-check failed; only the pattern-based check ran.'] };
	}
	if (failedChunks > 0) {
		warnings.push(`AI fact-check failed on ${failedChunks} of ${chunks.length} parts of the article; those parts were not checked.`);
	}

	const { content: correctedContent, applied } = applyClaimCorrections(content, claims, language);
	
	console.log(`🤖 AI found ${claims.length} suspicious claims`);
	
	return {
		originalContent: content,
		correctedContent,
		claimsFound: claims.length,
		claimsVerified: 0, // AI ha identificato solo quelli sospetti
		claimsRemoved: applied,
		claims,
		overallScore: claims.length === 0 ? 100 : Math.max(0, 100 - claims.length * 10),
		...(warnings.length > 0 ? { checkFailed: true, warnings } : {}),
	};
};

/**
 * Combina fact-check pattern-based e AI-assisted (sull'intero articolo, qualsiasi lingua).
 */
export const comprehensiveFactCheck = async (
	content: string,
	useAI: boolean = true,
	options: FactCheckOptions = {},
): Promise<FactCheckResult> => {
	// Prima passa con pattern-based (veloce)
	const patternResult = await factCheckContent(content, options);
	
	// Poi l'AI su tutto l'articolo: i pattern coprono solo IT/EN, l'AI qualsiasi lingua.
	if (useAI && isProxyEnabled()) {
		const aiResult = await aiAssistedFactCheck(patternResult.correctedContent, options);
		
		// Combina i risultati
		return {
			originalContent: content,
			correctedContent: aiResult.correctedContent,
			claimsFound: patternResult.claimsFound + aiResult.claimsFound,
			claimsVerified: patternResult.claimsVerified,
			claimsRemoved: patternResult.claimsRemoved + aiResult.claimsRemoved,
			claims: [...patternResult.claims, ...aiResult.claims],
			overallScore: Math.min(patternResult.overallScore, aiResult.overallScore),
			...(aiResult.checkFailed ? { checkFailed: true, warnings: aiResult.warnings } : {}),
		};
	}
	
	return patternResult;
};

// ═══════════════════════════════════════════════════════════════
// PERPLEXITY-POWERED FACT-CHECKING (NEW)
// ═══════════════════════════════════════════════════════════════

/**
 * PRE-GENERATION RESEARCH
 * 
 * Raccoglie fatti verificati PRIMA di generare contenuto.
 * Questo previene le allucinazioni alla fonte fornendo a GPT
 * informazioni reali verificate da usare nel contenuto.
 * 
 * @param topic - Argomento dell'articolo
 * @param keywords - Keyword correlate
 * @param language - Lingua
 * @returns ResearchResult con fatti, statistiche, esperti verificati
 */
export const preGenerationResearch = async (
	topic: string,
	keywords: string[] = [],
	language: string = 'it'
): Promise<{ research: ResearchResult; promptContext: string }> => {
	console.log('🔬 Pre-generation research starting...', { topic, keywords });
	
	if (!isPerplexityAvailable()) {
		console.warn('⚠️ Perplexity not available, skipping pre-generation research');
		return {
			research: {
				topic,
				verifiedFacts: [],
				statistics: [],
				experts: [],
				recentStudies: [],
				sources: [],
				rawContent: '',
			},
			promptContext: '',
		};
	}
	
	try {
		const research = await researchTopicWithSources(topic, keywords, language);
		const promptContext = formatResearchForPrompt(research, language);
		
		console.log('✅ Pre-generation research complete:', {
			facts: research.verifiedFacts.length,
			statistics: research.statistics.length,
			sources: research.sources.length,
		});
		
		return { research, promptContext };
	} catch (error) {
		console.error('Pre-generation research failed:', error);
		return {
			research: {
				topic,
				verifiedFacts: [],
				statistics: [],
				experts: [],
				recentStudies: [],
				sources: [],
				rawContent: '',
			},
			promptContext: '',
		};
	}
};

/**
 * ENHANCED FACT-CHECK WITH PERPLEXITY
 * 
 * 1. Pattern-based claims (IT/EN) verificati sul web con Perplexity (con il loro contesto).
 * 2. Pass AI sull'intero articolo (a chunk, qualsiasi lingua) per i claim che i pattern non vedono.
 * Ogni claim non verificato diventa un placeholder visibile; `checkFailed` segnala verifiche non riuscite.
 * 
 * @param content - Contenuto da verificare
 * @param topic - Contesto/topic per la verifica
 */
export const factCheckWithPerplexity = async (
	content: string,
	topic?: string,
	options: FactCheckOptions & { aiPass?: boolean } = {},
): Promise<FactCheckResult> => {
	const language = options.language ?? 'en';
	console.log('🔍 Starting Perplexity-enhanced fact-check...');
	
	// Step 1: Pattern-based extraction (veloce)
	const claims = extractClaims(content, options.trustedTerms);
	console.log(`📋 Found ${claims.length} claims to verify`);
	
	// Step 2: Filter out already verified entities
	const unverifiedClaims = claims.filter(c => !c.isVerified);
	
	// Step 3: If Perplexity available and we have unverified claims, verify them
	let perplexityResults: ClaimVerificationResult[] = [];
	const verifiedSources: PerplexitySource[] = [];
	const warnings: string[] = [];
	
	if (isPerplexityAvailable() && unverifiedClaims.length > 0) {
		console.log(`🌐 Verifying ${unverifiedClaims.length} claims with Perplexity...`);
		
		try {
			// Verify each claim WITH its surrounding sentence: a bare "73.2%" cannot be checked.
			const claimTexts = unverifiedClaims.map(c => c.context || c.text);
			perplexityResults = await verifyMultipleClaimsWithPerplexity(claimTexts, topic);
			
			// Update claims with Perplexity results
			for (let i = 0; i < unverifiedClaims.length; i++) {
				const result = perplexityResults[i];
				const claim = unverifiedClaims[i];
				if (result && claim) {
					claim.isVerified = result.isVerified;
					claim.verificationResult = result.explanation;
					
					// A corrected version is only trusted when Perplexity names its source.
					claim.suggestedReplacement = !result.isVerified
						? (result.verifiedVersion && result.source ? result.verifiedVersion : generateSafeReplacement(claim, language))
						: undefined;
					
					// Collect sources from verification
					if (result.source) {
						verifiedSources.push({
							title: result.source,
							url: '', // Perplexity may not always provide URL
						});
					}
				}
			}
			
			console.log('✅ Perplexity verification complete');
		} catch (error) {
			console.error('Perplexity verification failed, using fallback:', error);
			warnings.push('Web verification (Perplexity) failed; unverified claims were replaced with placeholders.');
			for (const claim of unverifiedClaims) {
				if (!claim.isVerified) claim.suggestedReplacement = generateSafeReplacement(claim, language);
			}
		}
	} else {
		// No Perplexity, use pattern-based replacement
		for (const claim of unverifiedClaims) {
			claim.suggestedReplacement = generateSafeReplacement(claim, language);
		}
	}
	
	// Step 4: Correct content
	const stillUnverified = claims.filter(c => !c.isVerified);
	const { content: patternCorrected, applied } = applyClaimCorrections(content, claims, language);
	
	// Step 5: AI pass over the WHOLE article (chunked, any language), skipping what Perplexity verified.
	let correctedContent = patternCorrected;
	let aiClaims: Array<Claim> = [];
	let aiApplied = 0;
	let aiScore = 100;
	if (options.aiPass !== false && isProxyEnabled()) {
		const aiResult = await aiAssistedFactCheck(patternCorrected, {
			...options,
			skipTexts: claims.filter(c => c.isVerified).map(c => c.text),
		});
		correctedContent = aiResult.correctedContent;
		aiClaims = aiResult.claims;
		aiApplied = aiResult.claimsRemoved;
		aiScore = aiResult.overallScore;
		if (aiResult.warnings) warnings.push(...aiResult.warnings);
	}
	
	// Step 6: Calculate score
	const verifiedCount = claims.filter(c => c.isVerified).length;
	const patternScore = claims.length > 0 
		? Math.round((verifiedCount / claims.length) * 100)
		: 100;
	const overallScore = Math.min(patternScore, aiScore);
	
	console.log(`✅ Fact-check complete: ${verifiedCount}/${claims.length} verified, ${stillUnverified.length + aiClaims.length} flagged (${overallScore}% score)`);
	
	return {
		originalContent: content,
		correctedContent,
		claimsFound: claims.length + aiClaims.length,
		claimsVerified: verifiedCount,
		claimsRemoved: applied + aiApplied,
		claims: [...claims, ...aiClaims],
		overallScore,
		verifiedSources,
		perplexityUsed: isPerplexityAvailable() && unverifiedClaims.length > 0,
		...(warnings.length > 0 ? { checkFailed: true, warnings } : {}),
	};
};

/**
 * GENERATE SOURCES SECTION
 * 
 * Genera una sezione "Fonti e Riferimenti" per l'articolo.
 * Da aggiungere alla fine dell'articolo per aumentare E-E-A-T.
 * 
 * QUANDO AGGIUNGERE FONTI:
 * - Articoli informativi/educational → SÌ
 * - Guide pratiche → SÌ
 * - Commercial investigation (confronti) → SÌ
 * - Articoli molto brevi (<500 parole) → NO
 * - Articoli transazionali puri → OPZIONALE
 * 
 * @param research - Risultato della ricerca pre-generazione
 * @param factCheckResult - Risultato del fact-check
 * @param intent - Tipo di intent dell'articolo
 * @param language - Lingua
 */
export const generateSourcesSection = (
	research: ResearchResult | null,
	factCheckResult: FactCheckResult | null,
	intent: 'informational' | 'commercial_investigation' | 'transactional' | 'navigational' = 'informational',
	language: string = 'it'
): string => {
	const { header, intro, checkedOnLabel } = verifiedSourcesSectionLabels(language);
	const sources: Array<{ title: string; url?: string; description?: string }> = [];
	
	// Collect sources from research
	if (research?.sources) {
		for (const source of research.sources) {
			if (source.title && !sources.some(s => s.title === source.title)) {
				sources.push({
					title: source.title,
					url: source.url,
					description: source.snippet,
				});
			}
		}
	}
	
	// Collect sources from recent studies
	if (research?.recentStudies) {
		for (const study of research.recentStudies) {
			if (study.title && !sources.some(s => s.title === study.title)) {
				sources.push({
					title: `${study.title} (${study.year})${study.journal ? ` - ${study.journal}` : ''}`,
					url: study.url,
					description: study.keyFinding,
				});
			}
		}
	}
	
	// Collect sources from fact-check
	if (factCheckResult?.verifiedSources) {
		for (const source of factCheckResult.verifiedSources) {
			if (source.title && !sources.some(s => s.title === source.title)) {
				sources.push({
					title: source.title,
					url: source.url,
				});
			}
		}
	}
	
	// Don't add section if no sources or transactional intent
	if (sources.length === 0) {
		return '';
	}
	
	// For transactional intent, only add if we have high-quality sources
	if (intent === 'transactional' && sources.length < 3) {
		return '';
	}
	
	const sourcesList = sources.slice(0, 10).map((source, index) => {
		if (source.url) {
			return `${index + 1}. [${source.title}](${source.url})${source.description ? ` - ${source.description}` : ''}`;
		}
		return `${index + 1}. ${source.title}${source.description ? ` - ${source.description}` : ''}`;
	}).join('\n');

	const disclaimer =
		`\n\n*${checkedOnLabel}: ${new Date().toLocaleDateString(contentLocale(language))}*`;

	return `\n\n---\n\n${header}\n\n${intro}\n\n${sourcesList}${disclaimer}`;
};

/**
 * FULL PIPELINE: Research + Generate + Fact-check + Sources
 * 
 * Pipeline completa per contenuti di alta qualità:
 * 1. Ricerca pre-generazione con Perplexity
 * 2. Fact-check post-generazione
 * 3. Aggiunta sezione fonti
 * 
 * @param topic - Argomento dell'articolo
 * @param keywords - Keyword correlate
 * @param language - Lingua
 */
export const getResearchContext = async (
	topic: string,
	keywords: string[] = [],
	language: string = 'it'
): Promise<{
	promptContext: string;
	research: ResearchResult;
}> => {
	const { research, promptContext } = await preGenerationResearch(topic, keywords, language);
	return { promptContext, research };
};

/**
 * APPEND SOURCES TO CONTENT
 * 
 * Aggiunge la sezione fonti alla fine del contenuto se appropriato.
 * 
 * @param content - Contenuto dell'articolo
 * @param research - Risultato della ricerca
 * @param factCheckResult - Risultato del fact-check
 * @param intent - Intent dell'articolo
 * @param language - Lingua
 */
export const appendSourcesToContent = (
	content: string,
	research: ResearchResult | null,
	factCheckResult: FactCheckResult | null,
	intent: 'informational' | 'commercial_investigation' | 'transactional' | 'navigational' = 'informational',
	language: string = 'it'
): string => {
	// Check if content already has a sources section
	const hasSourcesSection = 
		/##\s*(fonti|riferimenti|sources|references)/i.test(content) ||
		/\*\*fonti\*\*/i.test(content);
	
	if (hasSourcesSection) {
		console.log('Content already has sources section, skipping');
		return content;
	}
	
	// Check content length - don't add sources to very short content
	const wordCount = content.split(/\s+/).length;
	if (wordCount < 500) {
		console.log('Content too short for sources section');
		return content;
	}
	
	const sourcesSection = generateSourcesSection(research, factCheckResult, intent, language);
	
	if (!sourcesSection) {
		return content;
	}
	
	// Insert before final disclaimer if present, otherwise at end
	const disclaimerPattern = /(\*\*Disclaimer:\*\*|\*Disclaimer:)/i;
	const disclaimerMatch = content.match(disclaimerPattern);
	
	if (disclaimerMatch && disclaimerMatch.index) {
		// Insert before disclaimer
		const beforeDisclaimer = content.slice(0, disclaimerMatch.index).trimEnd();
		const disclaimer = content.slice(disclaimerMatch.index);
		return `${beforeDisclaimer}${sourcesSection}\n\n${disclaimer}`;
	}
	
	// Append at end
	return content.trimEnd() + sourcesSection;
};


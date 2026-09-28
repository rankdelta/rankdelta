/**
 * Perplexity API Service
 * 
 * Usa Perplexity per:
 * 1. PRE-GENERATION RESEARCH: Raccogliere fatti verificati PRIMA di generare contenuto
 * 2. FACT-CHECKING: Verificare claim specifici DOPO la generazione
 * 
 * Perplexity è ideale per fact-checking perché:
 * - Ha accesso a dati in tempo reale
 * - Fornisce citazioni con fonti verificabili
 * - È ottimizzato per rispondere a domande fattuali
 * 
 * ⚠️ SECURITY WARNING: API key exposed in frontend - use backend in production
 */

import { isProxyEnabled, proxyLLM } from './edgeProxy';
import { prefersEnglishUi, promptLangName } from '../lib/contentLanguages';

// Perplexity / fact-checking configuration.
// All calls route through the `seo-proxy` Edge Function, which resolves the provider
// (OpenRouter sonar models, or the direct Perplexity API) from its own server-side secrets.
// No provider key is ever read into the client bundle.

export interface PerplexitySource {
	title: string;
	url: string;
	snippet?: string;
}

export interface VerifiedFact {
	claim: string;
	isVerified: boolean;
	confidence: number; // 0-100
	source?: PerplexitySource;
	correction?: string; // If the fact is wrong, what's the correct version
	explanation?: string;
}

export interface ResearchResult {
	topic: string;
	verifiedFacts: Array<{
		fact: string;
		source: string;
		confidence: number;
	}>;
	statistics: Array<{
		stat: string;
		source: string;
		year?: number;
	}>;
	experts: Array<{
		name: string;
		title: string;
		institution: string;
		isVerified: boolean;
	}>;
	recentStudies: Array<{
		title: string;
		authors?: string;
		year: number;
		journal?: string;
		url?: string;
		keyFinding?: string;
	}>;
	sources: PerplexitySource[];
	rawContent: string;
}

export interface ClaimVerificationResult {
	originalClaim: string;
	isVerified: boolean;
	confidence: number;
	verifiedVersion?: string;
	source?: string;
	explanation: string;
}

/** Shape of the JSON the research prompt asks Perplexity to return. */
interface ResearchResponseJSON {
	verifiedFacts?: ResearchResult['verifiedFacts'];
	statistics?: ResearchResult['statistics'];
	experts?: ResearchResult['experts'];
	recentStudies?: ResearchResult['recentStudies'];
	sources?: ResearchResult['sources'];
}

/** Shape of the JSON the claim-verification prompt asks Perplexity to return. */
interface ClaimVerificationResponseJSON {
	isVerified?: boolean;
	confidence?: number;
	verifiedVersion?: string;
	source?: string;
	explanation?: string;
}

/**
 * Check if Perplexity API is available
 */
export const isPerplexityAvailable = (): boolean => {
	// The key lives server-side in the Edge Function, so availability == proxy enabled.
	return isProxyEnabled();
};

/**
 * Make a request to Perplexity API
 */
const callPerplexityAPI = async (
	messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
	options?: {
		model?: string;
		temperature?: number;
		maxTokens?: number;
		timeoutMs?: number;
	}
): Promise<string> => {
	// Models: sonar-pro (best, web search) / sonar (faster). Old pplx-*/llama-sonar-* are deprecated.
	const model = options?.model || 'sonar-pro';
	const temperature = options?.temperature ?? 0.2;
	const maxTokens = options?.maxTokens ?? 4000;

	// Bound the call: a stalled sonar web-search must NOT hang the whole generation.
	const timeoutMs = options?.timeoutMs ?? 45_000;

	// All calls route through the Edge Function (key stays server-side). The proxy maps
	// `perplexity/*` to OpenRouter, or to the direct Perplexity API, from its own secrets.
	if (!isProxyEnabled()) {
		throw new Error('Proxy fact-check non abilitato. Imposta VITE_USE_SUPABASE_PROXY=true e configura i secret della Edge Function seo-proxy.');
	}
	const orModel = model.startsWith('perplexity/') ? model : `perplexity/${model}`;
	return proxyLLM({ model: orModel, messages, temperature, maxTokens, timeoutMs });
};

/**
 * PRE-GENERATION RESEARCH
 * 
 * Raccoglie fatti verificati su un argomento PRIMA di generare contenuto.
 * Questo è il modo migliore per prevenire le allucinazioni: fornire a GPT
 * fatti reali verificati invece di lasciarlo inventare.
 * 
 * @param topic - L'argomento principale dell'articolo
 * @param keywords - Keyword correlate per ampliare la ricerca
 * @param language - Lingua per i risultati (default: italiano)
 */
export const researchTopicWithSources = async (
	topic: string,
	keywords: string[] = [],
	language: string = 'it'
): Promise<ResearchResult> => {
	if (!isPerplexityAvailable()) {
		console.warn('Perplexity not available, returning empty research');
		return {
			topic,
			verifiedFacts: [],
			statistics: [],
			experts: [],
			recentStudies: [],
			sources: [],
			rawContent: '',
		};
	}

	const isItalian = !prefersEnglishUi(language);
	const outputLanguage = promptLangName(language);
	const currentYear = new Date().getFullYear();
	
	const keywordContext = keywords.length > 0 
		? `\nKeyword correlate: ${keywords.slice(0, 5).join(', ')}`
		: '';

	const systemPrompt = isItalian
		? `Sei un ricercatore esperto. Il tuo compito è trovare informazioni VERIFICABILI e RECENTI su un argomento.

REGOLE FONDAMENTALI:
1. Fornisci SOLO informazioni che puoi verificare con fonti reali
2. Per ogni fatto, indica la fonte (nome sito/istituzione, URL se disponibile)
3. Indica l'anno delle statistiche/studi quando disponibile
4. Se non trovi informazioni verificabili, dillo chiaramente invece di inventare
5. Preferisci fonti italiane quando disponibili, ma includi anche fonti internazionali autorevoli
6. L'anno corrente è ${currentYear}

Rispondi in formato JSON strutturato.`
		: `You are an expert researcher. Your task is to find VERIFIABLE and RECENT information about a topic.

FUNDAMENTAL RULES:
1. Provide ONLY information you can verify with real sources
2. For each fact, indicate the source (site/institution name, URL if available)
3. Indicate the year of statistics/studies when available
4. If you can't find verifiable information, say so clearly instead of making things up
5. Current year is ${currentYear}
6. Write all JSON text values in ${outputLanguage}

Respond in structured JSON format.`;

	const userPrompt = isItalian
		? `Ricerca informazioni verificabili sull'argomento: "${topic}"${keywordContext}

Trova e riporta in formato JSON:

{
  "verifiedFacts": [
    {"fact": "affermazione verificata", "source": "nome fonte", "confidence": 90}
  ],
  "statistics": [
    {"stat": "statistica con numero", "source": "fonte", "year": ${currentYear}}
  ],
  "experts": [
    {"name": "Nome Cognome", "title": "Titolo/Ruolo", "institution": "Istituzione", "isVerified": true}
  ],
  "recentStudies": [
    {"title": "Titolo studio", "year": ${currentYear}, "journal": "Nome rivista", "keyFinding": "risultato principale"}
  ],
  "sources": [
    {"title": "Nome fonte", "url": "URL", "snippet": "breve descrizione"}
  ]
}

IMPORTANTE:
- Includi SOLO fatti che puoi verificare con fonti reali
- Per statistiche, indica sempre la fonte e l'anno
- Per esperti, verifica che esistano realmente
- Se non trovi informazioni verificabili su qualcosa, omettilo invece di inventare`
		: `Research verifiable information about: "${topic}"${keywordContext}

Find and report in JSON format:

{
  "verifiedFacts": [
    {"fact": "verified statement", "source": "source name", "confidence": 90}
  ],
  "statistics": [
    {"stat": "statistic with number", "source": "source", "year": ${currentYear}}
  ],
  "experts": [
    {"name": "Full Name", "title": "Title/Role", "institution": "Institution", "isVerified": true}
  ],
  "recentStudies": [
    {"title": "Study title", "year": ${currentYear}, "journal": "Journal name", "keyFinding": "main finding"}
  ],
  "sources": [
    {"title": "Source name", "url": "URL", "snippet": "brief description"}
  ]
}

IMPORTANT:
- Include ONLY facts you can verify with real sources
- For statistics, always indicate source and year
- For experts, verify they actually exist
- If you can't find verifiable information, omit it instead of making things up
- Write all JSON text values in ${outputLanguage}`;

	try {
		console.log('🔍 Perplexity: Researching topic with verified sources...', topic);
		
		const response = await callPerplexityAPI([
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt },
		], {
			temperature: 0.1, // Very low for factual research
			maxTokens: 4000,
		});

		// Parse JSON response
		let result: ResearchResult = {
			topic,
			verifiedFacts: [],
			statistics: [],
			experts: [],
			recentStudies: [],
			sources: [],
			rawContent: response,
		};

		try {
			// Extract JSON from response (may have markdown formatting)
			const jsonMatch = response.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]) as ResearchResponseJSON;
				result = {
					...result,
					verifiedFacts: parsed.verifiedFacts || [],
					statistics: parsed.statistics || [],
					experts: parsed.experts || [],
					recentStudies: parsed.recentStudies || [],
					sources: parsed.sources || [],
				};
			}
		} catch (parseError) {
			console.warn('Could not parse Perplexity response as JSON, using raw content');
		}

		console.log('✅ Perplexity research complete:', {
			facts: result.verifiedFacts.length,
			statistics: result.statistics.length,
			experts: result.experts.length,
			studies: result.recentStudies.length,
		});

		return result;
	} catch (error) {
		console.error('Perplexity research failed:', error);
		return {
			topic,
			verifiedFacts: [],
			statistics: [],
			experts: [],
			recentStudies: [],
			sources: [],
			rawContent: '',
		};
	}
};

/**
 * FACT-CHECK SINGLE CLAIM
 * 
 * Verifica un'affermazione specifica usando la ricerca web di Perplexity.
 * Usato per verificare claim sospetti dopo la generazione del contenuto.
 * 
 * @param claim - L'affermazione da verificare
 * @param context - Contesto aggiuntivo (es. topic dell'articolo)
 */
export const verifyClaimWithPerplexity = async (
	claim: string,
	context?: string
): Promise<ClaimVerificationResult> => {
	if (!isPerplexityAvailable()) {
		return {
			originalClaim: claim,
			isVerified: false,
			confidence: 0,
			explanation: 'Perplexity API not available for verification',
		};
	}

	const contextInfo = context ? `\nContesto: ${context}` : '';

	const systemPrompt = `Sei un fact-checker professionale. Il tuo compito è verificare se un'affermazione è vera, falsa, o non verificabile.

REGOLE:
1. Cerca fonti REALI per verificare l'affermazione
2. Se l'affermazione contiene nomi di persone/studi/istituzioni, verifica che esistano
3. Se trovi che l'affermazione è falsa o imprecisa, fornisci la versione corretta
4. Indica il livello di confidenza (0-100) nella tua valutazione
5. Cita sempre la fonte della tua verifica

Rispondi in formato JSON:
{
  "isVerified": true/false,
  "confidence": 0-100,
  "verifiedVersion": "versione corretta se diversa",
  "source": "fonte della verifica",
  "explanation": "spiegazione dettagliata"
}`;

	const userPrompt = `Verifica questa affermazione:

"${claim}"${contextInfo}

Questa affermazione è vera, falsa, o non verificabile? Fornisci prove dalla tua ricerca.`;

	try {
		console.log('🔍 Perplexity: Verifying claim...', claim.substring(0, 100));
		
		const response = await callPerplexityAPI([
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt },
		], {
			temperature: 0.1,
			maxTokens: 1000,
		});

		// Parse response
		try {
			const jsonMatch = response.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]) as ClaimVerificationResponseJSON;
				return {
					originalClaim: claim,
					isVerified: parsed.isVerified ?? false,
					confidence: parsed.confidence ?? 50,
					verifiedVersion: parsed.verifiedVersion,
					source: parsed.source,
					explanation: parsed.explanation || response,
				};
			}
		} catch {
			// If JSON parsing fails, try to extract info from text
		}

		// Fallback: analyze response text
		const isVerified = response.toLowerCase().includes('verificat') && 
			!response.toLowerCase().includes('non verificat') &&
			!response.toLowerCase().includes('false');
		
		return {
			originalClaim: claim,
			isVerified,
			confidence: 50,
			explanation: response,
		};
	} catch (error) {
		console.error('Claim verification failed:', error);
		return {
			originalClaim: claim,
			isVerified: false,
			confidence: 0,
			explanation: `Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
		};
	}
};

/**
 * BATCH FACT-CHECK MULTIPLE CLAIMS
 * 
 * Verifica più affermazioni in una singola chiamata API (più efficiente).
 * Usato quando il sistema pattern-based identifica più claim sospetti.
 * 
 * @param claims - Array di affermazioni da verificare
 * @param context - Contesto dell'articolo
 */
export const verifyMultipleClaimsWithPerplexity = async (
	claims: string[],
	context?: string
): Promise<ClaimVerificationResult[]> => {
	if (!isPerplexityAvailable()) {
		return claims.map(claim => ({
			originalClaim: claim,
			isVerified: false,
			confidence: 0,
			explanation: 'Perplexity API not available for verification',
		}));
	}

	if (claims.length === 0) {
		return [];
	}

	// If only one claim, use single verification
	if (claims.length === 1 && claims[0] !== undefined) {
		const result = await verifyClaimWithPerplexity(claims[0], context);
		return [result];
	}

	const contextInfo = context ? `\nContesto dell'articolo: ${context}` : '';
	const claimsList = claims.map((c, i) => `${i + 1}. "${c}"`).join('\n');

	const systemPrompt = `Sei un fact-checker professionale. Verifica OGNI affermazione nella lista.

REGOLE:
1. Cerca fonti REALI per ogni affermazione
2. Se contiene nomi di persone/studi/istituzioni, verifica che esistano
3. Per ogni affermazione, indica: verificata (true/false), confidenza (0-100), versione corretta se necessario
4. Se un'affermazione sembra inventata (nome falso, studio inesistente), dillo chiaramente

Rispondi in formato JSON array:
[
  {
    "claimIndex": 1,
    "originalClaim": "...",
    "isVerified": true/false,
    "confidence": 0-100,
    "verifiedVersion": "versione corretta se diversa (opzionale)",
    "source": "fonte (opzionale)",
    "explanation": "spiegazione breve"
  }
]`;

	const userPrompt = `Verifica queste affermazioni:

${claimsList}${contextInfo}

Per OGNI affermazione, determina se è vera, falsa, o non verificabile.`;

	try {
		console.log('🔍 Perplexity: Batch verifying', claims.length, 'claims...');
		
		const response = await callPerplexityAPI([
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt },
		], {
			temperature: 0.1,
			maxTokens: Math.min(claims.length * 500, 4000),
		});

		// Parse response
		try {
			const jsonMatch = response.match(/\[[\s\S]*\]/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]) as Array<{
					claimIndex?: number;
					originalClaim?: string;
					isVerified?: boolean;
					confidence?: number;
					verifiedVersion?: string;
					source?: string;
					explanation?: string;
				}>;
				
				// Map results back to claims
				return claims.map((claim, index) => {
					const result = parsed.find(r => 
						r.claimIndex === index + 1 || 
						r.originalClaim?.includes(claim.substring(0, 50))
					);
					
					if (result) {
						return {
							originalClaim: claim,
							isVerified: result.isVerified ?? false,
							confidence: result.confidence ?? 50,
							verifiedVersion: result.verifiedVersion,
							source: result.source,
							explanation: result.explanation || '',
						};
					}
					
					return {
						originalClaim: claim,
						isVerified: false,
						confidence: 30,
						explanation: 'Could not find verification result for this claim',
					};
				});
			}
		} catch {
			console.warn('Could not parse batch verification response');
		}

		// Fallback: return unverified for all
		return claims.map(claim => ({
			originalClaim: claim,
			isVerified: false,
			confidence: 30,
			explanation: 'Batch verification parsing failed',
		}));
	} catch (error) {
		console.error('Batch verification failed:', error);
		return claims.map(claim => ({
			originalClaim: claim,
			isVerified: false,
			confidence: 0,
			explanation: `Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
		}));
	}
};

/**
 * FORMAT RESEARCH RESULT FOR GPT PROMPT
 * 
 * Formatta i risultati della ricerca Perplexity per essere usati
 * come contesto nel prompt di generazione contenuto.
 * 
 * @param research - Risultato della ricerca Perplexity
 * @param language - Lingua per il formato
 */
export const formatResearchForPrompt = (
	research: ResearchResult,
	language: string = 'it'
): string => {
	const isItalian = !prefersEnglishUi(language);
	const sections: string[] = [];

	// Verified Facts
	if (research.verifiedFacts.length > 0) {
		const factsHeader = isItalian ? '📚 FATTI VERIFICATI (usa questi nel contenuto):' : '📚 VERIFIED FACTS (use these in content):';
		const factsContent = research.verifiedFacts
			.filter(f => f.confidence >= 70)
			.map(f => `• ${f.fact} [Fonte: ${f.source}, Affidabilità: ${f.confidence}%]`)
			.join('\n');
		if (factsContent) {
			sections.push(`${factsHeader}\n${factsContent}`);
		}
	}

	// Statistics
	if (research.statistics.length > 0) {
		const statsHeader = isItalian ? '📊 STATISTICHE VERIFICATE:' : '📊 VERIFIED STATISTICS:';
		const statsContent = research.statistics
			.map(s => `• ${s.stat} [Fonte: ${s.source}${s.year ? `, Anno: ${s.year}` : ''}]`)
			.join('\n');
		sections.push(`${statsHeader}\n${statsContent}`);
	}

	// Experts
	if (research.experts.length > 0) {
		const expertsHeader = isItalian ? '👤 ESPERTI REALI (puoi citarli):' : '👤 REAL EXPERTS (you can cite them):';
		const expertsContent = research.experts
			.filter(e => e.isVerified)
			.map(e => `• ${e.name}, ${e.title} - ${e.institution}`)
			.join('\n');
		if (expertsContent) {
			sections.push(`${expertsHeader}\n${expertsContent}`);
		}
	}

	// Recent Studies
	if (research.recentStudies.length > 0) {
		const studiesHeader = isItalian ? '🔬 STUDI RECENTI (puoi citarli):' : '🔬 RECENT STUDIES (you can cite them):';
		const studiesContent = research.recentStudies
			.map(s => `• "${s.title}" (${s.year})${s.journal ? ` - ${s.journal}` : ''}${s.keyFinding ? `\n  Risultato: ${s.keyFinding}` : ''}`)
			.join('\n');
		sections.push(`${studiesHeader}\n${studiesContent}`);
	}

	// Sources
	if (research.sources.length > 0) {
		const sourcesHeader = isItalian ? '🔗 FONTI VERIFICATE:' : '🔗 VERIFIED SOURCES:';
		const sourcesContent = research.sources
			.slice(0, 5)
			.map(s => `• ${s.title}: ${s.url}`)
			.join('\n');
		sections.push(`${sourcesHeader}\n${sourcesContent}`);
	}

	if (sections.length === 0) {
		return isItalian 
			? '⚠️ Nessuna informazione verificata trovata. Usa solo affermazioni generiche e verificabili.'
			: '⚠️ No verified information found. Use only generic and verifiable statements.';
	}

	const header = isItalian
		? `═══════════════════════════════════════════════════════════════
📋 INFORMAZIONI VERIFICATE DA PERPLEXITY (USA QUESTE!)
═══════════════════════════════════════════════════════════════
⚠️ IMPORTANTE: Usa SOLO le informazioni seguenti per fatti, statistiche e citazioni.
NON inventare altri nomi, studi o statistiche non presenti in questa lista.
═══════════════════════════════════════════════════════════════`
		: `═══════════════════════════════════════════════════════════════
📋 VERIFIED INFORMATION FROM PERPLEXITY (USE THESE!)
═══════════════════════════════════════════════════════════════
⚠️ IMPORTANT: Use ONLY the following information for facts, statistics and citations.
DO NOT invent other names, studies or statistics not present in this list.
═══════════════════════════════════════════════════════════════`;

	return `${header}\n\n${sections.join('\n\n')}`;
};

/**
 * QUICK FACT-CHECK FOR SINGLE QUESTION
 * 
 * Per verifiche rapide di singoli fatti durante la scrittura.
 * 
 * @param question - Domanda fattuale da verificare
 */
export const quickFactCheck = async (
	question: string
): Promise<{ answer: string; sources: PerplexitySource[]; confidence: number }> => {
	if (!isPerplexityAvailable()) {
		return {
			answer: 'Fact-check non disponibile (API Perplexity non configurata)',
			sources: [],
			confidence: 0,
		};
	}

	const response = await callPerplexityAPI([
		{
			role: 'system',
			content: 'Sei un fact-checker. Rispondi in modo conciso con fonti verificate. Se non sei sicuro, dillo.',
		},
		{
			role: 'user',
			content: question,
		},
	], {
		temperature: 0.1,
		maxTokens: 1000,
	});

	// Extract sources from response (Perplexity usually includes them)
	const sources: PerplexitySource[] = [];
	const urlMatches = response.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
	for (const match of urlMatches) {
		const title = match[1];
		const url = match[2];
		if (title === undefined || url === undefined) continue;
		sources.push({
			title,
			url,
		});
	}

	return {
		answer: response,
		sources,
		confidence: sources.length > 0 ? 80 : 50,
	};
};


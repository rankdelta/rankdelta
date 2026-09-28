/**
 * Site Analysis Service
 * 
 * Analyzes a website to extract keywords, topics, and structure
 * Based on best practices from Matt Diggity, Kyle Roof, and other SEO experts
 */

import { getSERPAnalysis, getKeywordData, getPeopleAlsoAsk, getRelatedSearches } from './dataforseo';
import { langName } from '../lib/contentLanguages';
import { complete } from './openrouter';
import { isProxyEnabled } from './edgeProxy';
import { LOCATION } from '../lib/seoMarkets';

// AI features route through the seo-proxy Edge Function (key stays server-side, never bundled).
// When the proxy is disabled the service degrades gracefully to its non-AI fallbacks.
const aiEnabled = isProxyEnabled();

export interface SiteAnalysis {
	websiteUrl: string;
	primaryKeyword: string;
	suggestedTopics: string[];
	topicalMap: TopicalMapCluster[];
	competitors: string[];
	recommendations: string[];
}

export interface TopicalMapCluster {
	name: string;
	keywords: string[];
	searchVolume: number;
	difficulty: number;
	priority: 'high' | 'medium' | 'low';
	contentGaps: string[];
}

/**
 * Extract primary keywords from website content using AI
 */
export const extractPrimaryKeywords = async (websiteUrl: string): Promise<string[]> => {
	if (!aiEnabled) {
		// Fallback: extract from URL
		const domain = new URL(websiteUrl).hostname.replace('www.', '');
		const keywords = (domain.split('.')[0] ?? '').split('-').filter((k) => k.length > 2);
		return keywords.slice(0, 3);
	}

	try {
		// Use OpenAI to analyze the website and extract primary keywords
		const prompt = `Analizza il sito web "${websiteUrl}" e identifica le 3-5 keyword principali su cui si concentra.

Considera:
- Il dominio e la struttura URL
- Ipotizza il settore/nicchia
- Keyword commerciali vs informative
- Long-tail vs head terms

Rispondi con un array JSON di keyword in ordine di importanza:
["keyword1", "keyword2", "keyword3"]`;

		const content = await complete(
			[{ role: 'user', content: prompt }],
			{
				model: 'openai/gpt-4o-mini',
				systemPrompt: 'Sei un esperto SEO. Analizza siti web e identifica keyword principali.',
				temperature: 0.3,
				maxTokens: 200,
			}
		);
		const jsonMatch = content.match(/\[[\s\S]*\]/);
		if (jsonMatch) {
			return JSON.parse(jsonMatch[0]) as string[];
		}

		// Fallback
		return [];
	} catch (error) {
		console.error('Error extracting primary keywords:', error);
		// Fallback
		const domain = new URL(websiteUrl).hostname.replace('www.', '');
		const keywords = (domain.split('.')[0] ?? '').split('-').filter((k) => k.length > 2);
		return keywords.slice(0, 3);
	}
};

/**
 * Generate topical map based on SEO best practices
 * Inspired by Matt Diggity's topical authority framework and Kyle Roof's cluster approach
 * With graceful error handling and fallbacks
 */
/**
 * Check if two cluster names are semantically similar
 */
const areClustersSimilar = (name1: string, name2: string, similarityThreshold: number = 0.6): boolean => {
	const words1 = name1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
	const words2 = name2.toLowerCase().split(/\s+/).filter(w => w.length > 2);
	
	if (words1.length === 0 || words2.length === 0) return false;
	
	const commonWords = words1.filter(w => words2.includes(w));
	const similarity = commonWords.length / Math.max(words1.length, words2.length);
	
	// Also check if one name contains the other
	const oneContainsOther = name1.toLowerCase().includes(name2.toLowerCase()) || 
	                         name2.toLowerCase().includes(name1.toLowerCase());
	
	return similarity >= similarityThreshold || oneContainsOther;
};

/**
 * Check if a cluster is similar to any existing proposals
 */
const isClusterSimilarToExisting = (
	cluster: TopicalMapCluster,
	existingProposals: Array<{ title: string; clusterName?: string }>
): boolean => {
	return existingProposals.some((existing) => {
		// Check cluster name similarity
		if (existing.clusterName && areClustersSimilar(cluster.name, existing.clusterName)) {
			return true;
		}
		// Check title similarity (proposals might have similar titles)
		if (areClustersSimilar(cluster.name, existing.title)) {
			return true;
		}
		return false;
	});
};

export const generateTopicalMap = async (
	primaryKeyword: string,
	_websiteUrl: string,
	language: string = 'it',
	locationCode: number = LOCATION.ITALY,
	existingProposals: Array<{ title: string; clusterName?: string }> = [] // Existing proposals to avoid duplicates
): Promise<TopicalMapCluster[]> => {
	if (!aiEnabled) {
		// Fallback: create basic clusters without AI
		return [
			{
				name: `${primaryKeyword} - Guida Completa`,
				keywords: [primaryKeyword, `${primaryKeyword} guida`, `${primaryKeyword} tutorial`],
				searchVolume: 1000,
				difficulty: 40,
				priority: 'high',
				contentGaps: [],
			},
			{
				name: `${primaryKeyword} - Best Practices`,
				keywords: [`${primaryKeyword} best practices`, `${primaryKeyword} consigli`],
				searchVolume: 800,
				difficulty: 35,
				priority: 'high',
				contentGaps: [],
			},
		];
	}

	try {
		// Step 1: Generate strategic keywords with ChatGPT FIRST (fast, always available)
		console.log('🔍 Step 1: Generating strategic keywords with ChatGPT...');
		let aiGeneratedKeywords: string[] = [];

		if (aiEnabled) {
			try {
				// Get current year dynamically
			const currentYear = new Date().getFullYear();
			
			const keywordPrompt = `Sei un esperto SEO specializzato in TOPICAL AUTHORITY e SEMANTIC SEO (metodologie Matt Diggity, Kyle Roof, Koray Tuğberk GÜBÜR).

📅 ANNO CORRENTE: ${currentYear} - Usa SEMPRE questo anno nei titoli e contenuti, MAI anni passati come 2023 o 2024.

Per la keyword principale "${primaryKeyword}", crea una TOPICAL MAP COMPLETA per raggiungere TOPICAL AUTHORITY.

⚠️ CONCETTO FONDAMENTALE - TOPICAL AUTHORITY:
La Topical Authority NON si costruisce con variazioni della keyword principale!
Si costruisce coprendo TUTTI GLI ARGOMENTI CORRELATI che supportano e contestualizzano la keyword principale.

🎯 STRUTTURA CORRETTA DI UNA TOPICAL MAP:

1. **PILLAR CONTENT (1 cluster)**: Copre la keyword principale in modo esaustivo
   - Questo è l'UNICO cluster che contiene la keyword principale
   - Guida completa, definitiva, che copre tutti gli aspetti

2. **SUPPORTING TOPICS (5-8 cluster)**: Argomenti CORRELATI ma DIVERSI dalla keyword principale
   - NON sono variazioni della keyword principale
   - Sono ARGOMENTI SEPARATI che supportano semanticamente il topic
   - Costruiscono il CONTESTO semantico attorno alla keyword principale
   - Google usa questi per capire che sei un'autorità sul TOPIC, non solo sulla keyword

📌 ESEMPIO CONCRETO - Keyword: "integratori per cani"

✅ TOPICAL MAP CORRETTA (supporting topics):
- PILLAR: "Integratori per Cani - Guida Completa" (keyword principale)
- SUPPORTING 1: "Alimentazione del Cane" (argomento correlato - nutrizione canina)
- SUPPORTING 2: "Salute Articolare nei Cani" (argomento correlato - problemi fisici)  
- SUPPORTING 3: "Vitamine e Minerali per Cani" (argomento correlato - nutrienti)
- SUPPORTING 4: "Sistema Immunitario del Cane" (argomento correlato - salute)
- SUPPORTING 5: "Pelo e Cute del Cane" (argomento correlato - estetica/salute)
- SUPPORTING 6: "Digestione e Flora Intestinale Cane" (argomento correlato - salute digestiva)
- SUPPORTING 7: "Cani Anziani - Cura e Benessere" (argomento correlato - target specifico)

❌ TOPICAL MAP SBAGLIATA (solo variazioni keyword):
- "integratori cani guida" ← SBAGLIATO: è solo una variazione
- "migliori integratori cani" ← SBAGLIATO: è solo una variazione  
- "integratori cani come scegliere" ← SBAGLIATO: è solo una variazione
- "integratori cani prezzi" ← SBAGLIATO: è solo una variazione

📌 ALTRO ESEMPIO - Keyword: "marketing digitale"

✅ TOPICAL MAP CORRETTA:
- PILLAR: "Marketing Digitale - Guida Completa"
- SUPPORTING 1: "SEO e Ottimizzazione per Motori di Ricerca"
- SUPPORTING 2: "Social Media Marketing"
- SUPPORTING 3: "Email Marketing e Automazione"
- SUPPORTING 4: "Content Marketing e Strategia Contenuti"
- SUPPORTING 5: "Google Ads e Pubblicità Online"
- SUPPORTING 6: "Analytics e Misurazione ROI"
- SUPPORTING 7: "Funnel di Vendita Online"
- SUPPORTING 8: "Lead Generation B2B"

🔑 COME IDENTIFICARE I SUPPORTING TOPICS:
1. Chiediti: "Quali ALTRI argomenti deve conoscere qualcuno interessato a ${primaryKeyword}?"
2. Pensa alle ENTITÀ CORRELATE nel knowledge graph di Google
3. Considera i PREREQUISITI e le CONSEGUENZE del topic
4. Identifica argomenti che CONTESTUALIZZANO la keyword principale
5. Trova topic che un ESPERTO del settore dovrebbe assolutamente trattare

LINGUAGGIO: ${langName(language)}

FORMATO OUTPUT JSON:
{
  "pillar": {
    "topic": "Nome del PILLAR (keyword principale)",
    "keywords": ["keyword principale", "variazioni principali per il pillar"]
  },
  "supporting_topics": [
    {
      "topic": "Nome SUPPORTING TOPIC (argomento correlato DIVERSO)",
      "keywords": ["keyword1 del topic", "keyword2 del topic", ...],
      "relation_to_main": "Come questo topic supporta la keyword principale"
    }
  ],
  "all_keywords": ["tutte le keyword"]
}

GENERA:
- 1 PILLAR sulla keyword principale "${primaryKeyword}"
- 6-8 SUPPORTING TOPICS che sono ARGOMENTI DIVERSI ma correlati semanticamente
- Ogni supporting topic deve avere 4-8 keyword specifiche per QUEL topic
- I supporting topics NON devono contenere "${primaryKeyword}" nelle keyword (sono argomenti diversi!)

⚠️ CONTROLLO QUALITÀ FINALE:
Prima di generare, verifica che:
1. Il PILLAR copra la keyword principale
2. I SUPPORTING TOPICS siano ARGOMENTI DIVERSI (non variazioni della keyword)
3. Ogni supporting topic possa essere un ARTICOLO STANDALONE su un argomento correlato
4. Insieme, pillar + supporting topics costruiscano AUTORITÀ SEMANTICA sul macro-topic`;

				const content = await complete(
					[{ role: 'user', content: keywordPrompt }],
					{
						model: 'openai/gpt-4o-mini',
						systemPrompt: `Sei un esperto SEO specializzato in TOPICAL AUTHORITY e SEMANTIC SEO.
Conosci le metodologie di Matt Diggity, Kyle Roof, Koray Tuğberk GÜBÜR (topical authority), e la semantica di Google NLP.

⚠️ CONCETTO CHIAVE - TOPICAL AUTHORITY:
La Topical Authority si costruisce coprendo ARGOMENTI DI SUPPORTO correlati, NON variazioni della keyword principale.

STRUTTURA CORRETTA:
1. PILLAR: Un articolo sulla keyword principale
2. SUPPORTING TOPICS: Articoli su ARGOMENTI DIVERSI ma semanticamente correlati

ESEMPIO: Per "caffè specialty"
- PILLAR: "Caffè Specialty - Guida Completa"
- SUPPORTING: "Metodi di Estrazione Caffè", "Tostatura del Caffè", "Origini del Caffè", "Macinatura Caffè", "Attrezzatura Barista"

NON generare variazioni della keyword (es. "caffè specialty guida", "caffè specialty consigli") - questi NON costruiscono topical authority!
Genera ARGOMENTI CORRELATI che un esperto del settore dovrebbe trattare per essere considerato un'autorità.`,
						temperature: 0.9, // Alta per creatività nei supporting topics
						maxTokens: 3000,
					}
				);

				// Try to parse structured JSON with new pillar/supporting_topics structure
				interface TopicalMapJSON {
					pillar?: { topic: string; keywords: string[] };
					supporting_topics?: Array<{ topic: string; keywords: string[]; relation_to_main?: string }>;
					clusters?: Array<{ topic: string; keywords: string[] }>; // Legacy format
					all_keywords?: string[];
				}
				
				let parsedData: TopicalMapJSON | null = null;
				const jsonMatch = content.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					try {
						parsedData = JSON.parse(jsonMatch[0]) as TopicalMapJSON;
					} catch {
						// Try to extract from text
					}
				}
				
				// NEW: Handle pillar + supporting_topics structure (Topical Authority model)
				if (parsedData && parsedData.pillar && parsedData.supporting_topics) {
					console.log('✅ Detected Topical Authority structure (pillar + supporting topics)');
					
					// Extract keywords from pillar
					const pillarKeywords = parsedData.pillar.keywords?.filter((k) => 
						k && typeof k === 'string' && k.trim().length > 2
					) || [];
					
					// Extract keywords from supporting topics
					const supportingKeywords = parsedData.supporting_topics.flatMap((topic) => 
						(topic.keywords || []).filter((k) => k && typeof k === 'string' && k.trim().length > 2)
					);
					
					// Also extract topic names as they represent semantic entities
					const topicNames = [
						parsedData.pillar.topic,
						...parsedData.supporting_topics.map((t) => t.topic)
					].filter((t) => t && t.length > 2);
					
					aiGeneratedKeywords = [...pillarKeywords, ...supportingKeywords, ...topicNames];
					aiGeneratedKeywords = [...new Set(aiGeneratedKeywords)]; // Remove duplicates
					
					console.log(`✅ Topical Authority Map: 1 pillar + ${parsedData.supporting_topics.length} supporting topics`);
					console.log(`   Pillar: "${parsedData.pillar.topic}" (${pillarKeywords.length} keywords)`);
					console.log(`   Supporting topics: ${parsedData.supporting_topics.map(t => t.topic).join(', ')}`);
					console.log(`   Total keywords: ${aiGeneratedKeywords.length}`);
					
					// Store the structured data for later cluster creation
					(parsedData as any)._isTopicalAuthorityStructure = true;
				} else if (parsedData && parsedData.all_keywords && Array.isArray(parsedData.all_keywords)) {
					// Legacy: Use all_keywords array
					aiGeneratedKeywords = parsedData.all_keywords.filter((k) => 
						k && typeof k === 'string' && k.trim().length > 2 && k.trim().length < 100
					);
					console.log(`✅ ChatGPT generated ${aiGeneratedKeywords.length} strategic keywords organized in ${parsedData.clusters?.length || 0} clusters`);
				} else if (parsedData && parsedData.clusters) {
					// Legacy: Extract from clusters
					aiGeneratedKeywords = parsedData.clusters.flatMap((cluster) => 
						cluster.keywords.filter((k) => k && typeof k === 'string' && k.trim().length > 2)
					);
					console.log(`✅ ChatGPT generated ${aiGeneratedKeywords.length} keywords from ${parsedData.clusters.length} clusters`);
				} else {
					// Fallback: try simple array
					const arrayMatch = content.match(/\[[\s\S]*\]/);
					if (arrayMatch) {
						try {
							aiGeneratedKeywords = JSON.parse(arrayMatch[0]) as string[];
							aiGeneratedKeywords = aiGeneratedKeywords.filter((k) => 
								k && typeof k === 'string' && k.trim().length > 2 && k.trim().length < 100
							);
							console.log(`✅ ChatGPT generated ${aiGeneratedKeywords.length} keywords (array format)`);
						} catch {
							// Last resort: extract from text
							const lines = content.split('\n').filter((line) => line.trim().length > 0);
							aiGeneratedKeywords = lines
								.map((line) => line.replace(/^[-*•\d.\s"']+/, '').replace(/["']/g, '').trim())
								.filter((k) => k.length > 2 && k.length < 100 && !k.includes('FORMATO') && !k.includes('OUTPUT'))
								.slice(0, 70);
							console.log(`✅ Extracted ${aiGeneratedKeywords.length} keywords from text`);
						}
					} else {
						// Last resort: extract from text
						const lines = content.split('\n').filter((line) => line.trim().length > 0);
						aiGeneratedKeywords = lines
							.map((line) => line.replace(/^[-*•\d.\s"']+/, '').replace(/["']/g, '').trim())
							.filter((k) => k.length > 2 && k.length < 100 && !k.includes('FORMATO') && !k.includes('OUTPUT'))
							.slice(0, 70);
						console.log(`✅ Extracted ${aiGeneratedKeywords.length} keywords from text`);
					}
				}
				
				// NOTE: For Topical Authority, we do NOT filter keywords to only include primary keyword
				// Supporting topics are DIFFERENT topics that build semantic authority
				// Only do light validation (length, not empty)
				aiGeneratedKeywords = aiGeneratedKeywords
					.filter((k) => k && k.trim().length > 2 && k.trim().length < 100)
					.slice(0, 80); // Allow more keywords for complete topical coverage
				
				console.log(`✅ Final Topical Authority keywords: ${aiGeneratedKeywords.length} (pillar + supporting topics)`);
			} catch (error) {
				console.warn('Error generating keywords with ChatGPT, continuing without them:', error);
			}
		}

		// Step 2: Enrich with DataforSEO data (REAL volumes and difficulties)
		console.log('🔍 Step 2: Enriching keywords with DataforSEO data...');
		let relatedKeywords: string[] = [];
		let keywordData: Array<{ keyword: string; search_volume?: number; difficulty?: number }> = [];
		
		// Combine AI keywords with primary keyword
		const allKeywordsToCheck = [
			primaryKeyword,
			...aiGeneratedKeywords.slice(0, 49), // Max 50 per API call
		].filter((k, index, arr) => arr.indexOf(k) === index); // Remove duplicates

		try {
			// Get real data from DataforSEO for all keywords
			if (allKeywordsToCheck.length > 0) {
				keywordData = await getKeywordData(allKeywordsToCheck, locationCode, language);
				console.log(`✅ Enriched ${keywordData.length} keywords with real volume/difficulty from DataforSEO`);
				
				// Filter keywords with good potential (volume > 0 or difficulty < 70)
				relatedKeywords = keywordData
					.filter((k) => (k.search_volume && k.search_volume > 0) || (k.difficulty && k.difficulty < 70))
					.map((k) => k.keyword)
					.slice(0, 50);
			}
			
			// If DataforSEO didn't return enough, use AI keywords as fallback
			if (relatedKeywords.length < 20 && aiGeneratedKeywords.length > 0) {
				relatedKeywords = [
					...relatedKeywords,
					...aiGeneratedKeywords.filter((k) => !relatedKeywords.includes(k)),
				].slice(0, 50);
				console.log(`✅ Using ${relatedKeywords.length} total keywords (AI + DataforSEO)`);
			}
		} catch (error) {
			console.warn('Error getting DataforSEO data, using AI keywords as fallback:', error);
			// Fallback to AI keywords if DataforSEO fails
			relatedKeywords = aiGeneratedKeywords.length > 0 
				? [primaryKeyword, ...aiGeneratedKeywords].slice(0, 50)
				: [primaryKeyword];
		}
		
		// Step 2: Get SERP analysis + People Also Ask + Related Searches (CRITICAL for topical authority)
		console.log('🔍 Step 2: Analyzing SERP features...');
		let serpResults: Awaited<ReturnType<typeof getSERPAnalysis>> = [];
		let peopleAlsoAsk: Array<{ question: string; answer: string }> = [];
		let relatedSearches: string[] = [];

		try {
			serpResults = await getSERPAnalysis(primaryKeyword, locationCode, language, 20);

			// Get People Also Ask (Matt Diggity methodology - critical for topical authority)
			peopleAlsoAsk = await getPeopleAlsoAsk(primaryKeyword, locationCode, language);
			console.log(`✅ Found ${peopleAlsoAsk.length} People Also Ask questions`);
			
			// Get Related Searches (bottom of SERP)
			relatedSearches = await getRelatedSearches(primaryKeyword, locationCode, language);
			console.log(`✅ Found ${relatedSearches.length} related searches`);
		} catch (error) {
			console.warn('Error getting SERP analysis, continuing without it:', error);
		}

		// Step 3: Extract topics from PAA and Related Searches (REAL DATA, not AI-generated)
		const paaTopics = peopleAlsoAsk.map((paa) => paa.question);
		const allRealKeywords = [
			primaryKeyword,
			...relatedKeywords, // Already includes AI + DataforSEO keywords
			...relatedSearches,
			...paaTopics,
		].filter((k, index, arr) => arr.indexOf(k) === index); // Remove duplicates
		
		console.log(`✅ Total keywords pool: ${allRealKeywords.length} (AI: ${aiGeneratedKeywords.length}, DataforSEO: ${keywordData.length}, PAA: ${paaTopics.length}, Related: ${relatedSearches.length})`);

		// Step 4: Use AI to create intelligent clusters from REAL DATA
		console.log('🔍 Step 4: Creating topical clusters from validated keywords...');
		console.log(`📊 Using ${allRealKeywords.length} keywords for clustering (${peopleAlsoAsk.length} PAA, ${relatedSearches.length} Related, ${serpResults.length} competitors)`);
		
		// Filter out clusters similar to existing proposals
		let existingClusterNames: string[] = [];
		if (existingProposals.length > 0) {
			existingClusterNames = existingProposals.map(p => p.clusterName || '').filter(Boolean);
			console.log(`🔍 Found ${existingProposals.length} existing proposals. Will avoid similar clusters.`);
		}
		
		// Get current year for prompts
		const currentYear = new Date().getFullYear();
		
		const prompt = `Crea una TOPICAL MAP per raggiungere TOPICAL AUTHORITY sulla keyword "${primaryKeyword}".

📅 ANNO CORRENTE: ${currentYear} - Se menzioni anni nei titoli o contenuti, usa SEMPRE ${currentYear}, MAI anni passati (2023, 2024).

⚠️ CONCETTO FONDAMENTALE - TOPICAL AUTHORITY (Matt Diggity, Kyle Roof, Koray Tuğberk GÜBÜR):
La Topical Authority NON si costruisce con variazioni della keyword principale!
Si costruisce con 1 PILLAR + SUPPORTING TOPICS che sono ARGOMENTI CORRELATI MA DIVERSI.

${existingProposals.length > 0 ? `⚠️ EVITA cluster simili a quelli esistenti:
- Esistenti: ${existingClusterNames.slice(0, 5).join(', ')}${existingClusterNames.length > 5 ? '...' : ''}` : ''}

🎯 STRUTTURA TOPICAL MAP PER TOPICAL AUTHORITY:

**CLUSTER 1 - PILLAR (obbligatorio):**
- Copre "${primaryKeyword}" in modo completo ed esaustivo
- È l'UNICO cluster che contiene la keyword principale
- Titolo tipo: "${primaryKeyword} - Guida Completa"

**CLUSTER 2-8 - SUPPORTING TOPICS (obbligatori):**
- Sono ARGOMENTI CORRELATI ma DIVERSI dalla keyword principale
- NON sono variazioni della keyword (no "come scegliere ${primaryKeyword}", "migliori ${primaryKeyword}")
- Sono topic che costruiscono CONTESTO SEMANTICO attorno al pillar
- Un esperto del settore DEVE conoscere questi argomenti

📌 ESEMPIO per capire - Keyword: "caffè specialty"
✅ TOPICAL MAP CORRETTA:
- PILLAR: "Caffè Specialty - Guida Completa" ← keyword principale
- SUPPORTING: "Metodi di Estrazione del Caffè" ← argomento correlato DIVERSO
- SUPPORTING: "Tostatura del Caffè" ← argomento correlato DIVERSO
- SUPPORTING: "Origini e Terroir del Caffè" ← argomento correlato DIVERSO
- SUPPORTING: "Macinatura del Caffè" ← argomento correlato DIVERSO
- SUPPORTING: "Attrezzatura da Barista" ← argomento correlato DIVERSO
- SUPPORTING: "Degustazione e Cupping" ← argomento correlato DIVERSO

❌ SBAGLIATO (solo variazioni keyword):
- "caffè specialty guida" ← SBAGLIATO: variazione
- "migliori caffè specialty" ← SBAGLIATO: variazione
- "caffè specialty come scegliere" ← SBAGLIATO: variazione

DATI DISPONIBILI:
- ${relatedKeywords.length} keyword correlate
- ${peopleAlsoAsk.length} People Also Ask
- ${relatedSearches.length} ricerche correlate

PEOPLE ALSO ASK (per ispirare supporting topics):
${peopleAlsoAsk.slice(0, 8).map((paa, i) => `${i + 1}. ${paa.question}`).join('\n')}

KEYWORD POOL (usa queste per popolare i cluster):
${allRealKeywords.slice(0, 50).map((k) => {
	const kwData = keywordData.find((kd) => kd.keyword.toLowerCase() === k.toLowerCase());
	const volume = kwData?.search_volume ? `${kwData.search_volume.toLocaleString()}` : '-';
	return `${k} (${volume})`;
}).join(', ')}

🔑 COME IDENTIFICARE I SUPPORTING TOPICS per "${primaryKeyword}":
1. Quali ALTRI argomenti deve conoscere chi è interessato a "${primaryKeyword}"?
2. Quali sono i PREREQUISITI per capire "${primaryKeyword}"?
3. Quali CONSEGUENZE o APPLICAZIONI ha "${primaryKeyword}"?
4. Quali ARGOMENTI CORRELATI tratta un esperto del settore?
5. Cosa c'è nel KNOWLEDGE GRAPH di Google attorno a "${primaryKeyword}"?

FORMATO OUTPUT JSON:
[
  {
    "name": "Nome Cluster (PILLAR o SUPPORTING)",
    "type": "pillar" | "supporting",
    "keywords": ["keyword1", "keyword2", ...],
    "searchVolume": 1000,
    "difficulty": 45,
    "priority": "high" | "medium" | "low",
    "contentGaps": [],
    "relationToMain": "Come questo topic supporta la keyword principale (solo per supporting)"
  }
]

GENERA:
- 1 cluster PILLAR: "${primaryKeyword} - Guida Completa" (o titolo simile)
- 5-7 cluster SUPPORTING: argomenti CORRELATI ma DIVERSI che costruiscono topical authority

⚠️ VERIFICA FINALE per ogni SUPPORTING topic:
1. È un ARGOMENTO DIVERSO dalla keyword principale? (non una variazione)
2. Un esperto del settore DEVE conoscerlo?
3. Costruisce CONTESTO SEMANTICO attorno al pillar?
4. Potrebbe essere un ARTICOLO STANDALONE su un tema correlato?

Se la risposta a TUTTE è SÌ → è un buon supporting topic ✅
Se anche una è NO → è probabilmente una variazione keyword ❌`;

		const content = await complete(
			[{ role: 'user', content: prompt }],
			{
				model: 'openai/gpt-4o-mini',
				systemPrompt: `Sei un esperto di TOPICAL AUTHORITY e SEMANTIC SEO.

⚠️ REGOLA FONDAMENTALE:
TOPICAL AUTHORITY = 1 PILLAR + SUPPORTING TOPICS (argomenti correlati DIVERSI)
NON = variazioni della keyword principale

STRUTTURA CORRETTA:
- PILLAR: Articolo completo sulla keyword principale
- SUPPORTING: Articoli su ARGOMENTI DIVERSI ma correlati semanticamente

ESEMPIO per "yoga":
- PILLAR: "Yoga - Guida Completa"
- SUPPORTING: "Respirazione e Pranayama", "Meditazione", "Postura e Allineamento", "Filosofia Yoga", "Attrezzatura Yoga"

NON generare: "yoga per principianti", "yoga benefici", "yoga come iniziare" - questi sono variazioni, NON supporting topics!

I supporting topics sono ARGOMENTI AUTONOMI che costruiscono AUTORITÀ SEMANTICA sul macro-topic.`,
				temperature: 0.9, // Alta per creatività nei supporting topics
				maxTokens: 3500,
			}
		);
		const jsonMatch = content.match(/\[[\s\S]*\]/);
		if (jsonMatch) {
			let clusters = JSON.parse(jsonMatch[0]) as TopicalMapCluster[];
			
			// Post-process: Remove duplicate or too similar clusters (AGGRESSIVE filtering for semantic diversity)
			console.log('🔍 Step 4a: Ensuring semantic diversity in clusters (aggressive filtering)...');
			const filteredClusters: TopicalMapCluster[] = [];
			const usedKeywords = new Set<string>();
			
			// Helper function to check if two clusters are semantically similar
			const areClustersSimilar = (cluster1: TopicalMapCluster, cluster2: TopicalMapCluster): boolean => {
				const name1 = cluster1.name.toLowerCase();
				const name2 = cluster2.name.toLowerCase();
				
				// Check 1: Name similarity (if > 50% words in common, consider similar)
				const words1 = name1.split(/\s+/).filter(w => w.length > 2);
				const words2 = name2.split(/\s+/).filter(w => w.length > 2);
				const commonWords = words1.filter(w => words2.includes(w));
				const nameSimilarity = commonWords.length / Math.max(words1.length, words2.length);
				
				// Check 2: One name contains the other (likely duplicate)
				const oneContainsOther = name1.includes(name2) || name2.includes(name1);
				
				// Check 3: Keyword overlap (> 30% overlap = too similar)
				const keywords1 = new Set(cluster1.keywords.map(k => k.toLowerCase()));
				const keywords2 = new Set(cluster2.keywords.map(k => k.toLowerCase()));
				const commonKeywords = [...keywords1].filter(k => keywords2.has(k));
				const keywordOverlap = commonKeywords.length / Math.max(keywords1.size, keywords2.size);
				
				// Check 4: Semantic similarity in keyword stems
				const stems1 = new Set(cluster1.keywords.map(k => k.toLowerCase().split(/\s+/)[0])); // First word of each keyword
				const stems2 = new Set(cluster2.keywords.map(k => k.toLowerCase().split(/\s+/)[0]));
				const commonStems = [...stems1].filter(s => stems2.has(s));
				const stemOverlap = commonStems.length / Math.max(stems1.size, stems2.size);
				
				return nameSimilarity > 0.5 || oneContainsOther || keywordOverlap > 0.3 || stemOverlap > 0.5;
			};
			
			// Sort clusters by priority (more keywords = higher priority) to keep better ones
			const sortedClusters = [...clusters].sort((a, b) => b.keywords.length - a.keywords.length);
			
			for (const cluster of sortedClusters) {
				// Check if cluster is similar to any existing cluster
				const isSimilar = filteredClusters.some((existing) => areClustersSimilar(cluster, existing));
				
				// Filter out keywords already used in other clusters
				const uniqueKeywords = cluster.keywords.filter(k => !usedKeywords.has(k.toLowerCase()));
				
				// Only add cluster if it's unique and has unique keywords (at least 4 unique keywords)
				if (!isSimilar && uniqueKeywords.length >= 4) {
					cluster.keywords = uniqueKeywords;
					uniqueKeywords.forEach(k => usedKeywords.add(k.toLowerCase()));
					filteredClusters.push(cluster);
					console.log(`✅ Added unique cluster: "${cluster.name}" (${uniqueKeywords.length} keywords)`);
				} else {
					console.log(`⚠️ Filtered out duplicate/similar cluster: "${cluster.name}" (similarity: ${isSimilar}, unique keywords: ${uniqueKeywords.length})`);
				}
			}
			
			clusters = filteredClusters;
			console.log(`✅ Filtered to ${clusters.length} semantically distinct clusters (removed ${sortedClusters.length - clusters.length} duplicates)`);
			
			// Additional filtering: Remove clusters similar to existing proposals
			if (existingProposals.length > 0) {
				console.log('🔍 Step 4c: Filtering out clusters similar to existing proposals...');
				const uniqueClusters = clusters.filter((cluster) => {
					const isSimilar = isClusterSimilarToExisting(cluster, existingProposals);
					if (isSimilar) {
						console.log(`⚠️ Filtered out cluster similar to existing: "${cluster.name}"`);
					}
					return !isSimilar;
				});
				clusters = uniqueClusters;
				console.log(`✅ Filtered to ${clusters.length} clusters different from existing proposals (removed ${filteredClusters.length - clusters.length} similar ones)`);
			}
			
			if (clusters.length === 0) {
				console.warn('⚠️ No clusters remaining after filtering. Using original clusters.');
				clusters = sortedClusters.slice(0, 6); // Fallback to first 6 original clusters
			}
			
			// Enrich with REAL data from DataForSEO (CRITICAL - use real volumes/difficulties)
			console.log(`🔍 Step 4b: Enriching ${clusters.length} clusters with real DataforSEO data...`);
			const enrichedClusters = await Promise.all(
				clusters.map(async (cluster) => {
					if (cluster.keywords.length > 0) {
						try {
							// Get real data for all keywords in cluster
							const clusterKeywordData = await getKeywordData(cluster.keywords.slice(0, 10), locationCode, language);
							
							// Calculate real metrics
							const validData = clusterKeywordData.filter((k) => k.search_volume && k.difficulty);
							const totalVolume = validData.reduce((sum, k) => sum + (k.search_volume || 0), 0);
							const avgDifficulty = validData.length > 0
								? validData.reduce((sum, k) => sum + (k.difficulty || 0), 0) / validData.length
								: 50;
							
							// Filter out keywords with too high difficulty
							const feasibleKeywords = cluster.keywords.filter((kw) => {
								const kwData = clusterKeywordData.find((k) => k.keyword.toLowerCase() === kw.toLowerCase());
								return !kwData || (kwData.difficulty || 100) < 70;
							});
							
							// Identify content gaps from competitor analysis
							const contentGaps: string[] = [];
							if (serpResults.length > 0) {
								// Find topics covered by competitors but not in our cluster
								const competitorTopics = serpResults.map((r) => r.title.toLowerCase());
								const ourTopics = cluster.keywords.map((k) => k.toLowerCase());
								const gaps = competitorTopics.filter((topic) => 
									!ourTopics.some((our) => our.includes(topic) || topic.includes(our))
								);
								contentGaps.push(...gaps.slice(0, 3));
							}
							
							// Add PAA questions as content gaps if not covered
							const paaInCluster = peopleAlsoAsk.filter((paa) =>
								cluster.keywords.some((kw) => paa.question.toLowerCase().includes(kw.toLowerCase()))
							);
							if (paaInCluster.length === 0 && peopleAlsoAsk.length > 0) {
								contentGaps.push(`Rispondere a: ${peopleAlsoAsk[0]?.question || ''}`);
							}
							
							return {
								...cluster,
								keywords: feasibleKeywords.length > 0 ? feasibleKeywords : cluster.keywords,
								searchVolume: totalVolume || cluster.searchVolume || 1000,
								difficulty: Math.round(avgDifficulty) || cluster.difficulty || 40,
								priority: avgDifficulty < 50 ? 'high' as const : avgDifficulty < 65 ? 'medium' as const : 'low' as const,
								contentGaps: contentGaps.length > 0 ? contentGaps : cluster.contentGaps,
							};
						} catch (error) {
							console.warn('Error enriching cluster, using AI data:', error);
							return {
								...cluster,
								searchVolume: cluster.searchVolume || 1000,
								difficulty: cluster.difficulty || 40,
							};
						}
					}
					return {
						...cluster,
						searchVolume: cluster.searchVolume || 1000,
						difficulty: cluster.difficulty || 40,
					};
				})
			);
			
			// Sort by priority and difficulty
			enrichedClusters.sort((a, b) => {
				if (a.priority === 'high' && b.priority !== 'high') return -1;
				if (b.priority === 'high' && a.priority !== 'high') return 1;
				return (a.difficulty || 50) - (b.difficulty || 50);
			});
			
			console.log(`✅ Created ${enrichedClusters.length} clusters with real data`);

			return enrichedClusters.length > 0 ? enrichedClusters : [
				{
					name: `${primaryKeyword} - Guida Base`,
					keywords: [primaryKeyword],
					searchVolume: 1000,
					difficulty: 40,
					priority: 'high' as const,
					contentGaps: [],
				},
			];
		}

		// Fallback if JSON parsing fails
		return [
			{
				name: `${primaryKeyword} - Guida Base`,
				keywords: [primaryKeyword],
				searchVolume: 1000,
				difficulty: 40,
				priority: 'high',
				contentGaps: [],
			},
		];
	} catch (error) {
		console.error('Error generating topical map:', error);
		// Return fallback clusters
		return [
			{
				name: `${primaryKeyword} - Guida Completa`,
				keywords: [primaryKeyword, `${primaryKeyword} guida`],
				searchVolume: 1000,
				difficulty: 40,
				priority: 'high',
				contentGaps: [],
			},
		];
	}
};

/**
 * Analyze website and generate complete analysis
 * With graceful error handling and fallbacks
 */
export const analyzeWebsite = async (
	websiteUrl: string,
	primaryKeyword?: string,
	language: string = 'it',
	locationCode: number = LOCATION.ITALY
): Promise<SiteAnalysis> => {
	try {
	// Extract primary keyword if not provided
	let mainKeyword = primaryKeyword;
	if (!mainKeyword) {
			try {
		const extracted = await extractPrimaryKeywords(websiteUrl);
		mainKeyword = extracted[0] || 'marketing digitale';
			} catch (error) {
				console.warn('Error extracting keywords, using fallback:', error);
				// Fallback: extract from URL
				const domain = new URL(websiteUrl).hostname.replace('www.', '');
				mainKeyword = (domain.split('.')[0] ?? '').replace(/-/g, ' ') || 'marketing digitale';
			}
		}

		// Generate topical map with fallback
		let topicalMap: TopicalMapCluster[] = [];
		try {
			topicalMap = await generateTopicalMap(mainKeyword, websiteUrl, language, locationCode);
		} catch (error) {
			console.warn('Error generating topical map, using fallback:', error);
			// Fallback: create basic clusters
			topicalMap = [
				{
					name: `${mainKeyword} - Guida Completa`,
					keywords: [mainKeyword, `${mainKeyword} guida`, `${mainKeyword} come fare`],
					searchVolume: 1000,
					difficulty: 40,
					priority: 'high',
					contentGaps: [],
				},
				{
					name: `${mainKeyword} - Best Practices`,
					keywords: [`${mainKeyword} best practices`, `${mainKeyword} consigli`, `${mainKeyword} strategie`],
					searchVolume: 800,
					difficulty: 35,
					priority: 'high',
					contentGaps: [],
				},
				{
					name: `${mainKeyword} - Tools e Risorse`,
					keywords: [`${mainKeyword} tools`, `${mainKeyword} risorse`, `${mainKeyword} software`],
					searchVolume: 600,
					difficulty: 30,
					priority: 'medium',
					contentGaps: [],
				},
			];
		}

		// Get SERP competitors with fallback
		let competitors: string[] = [];
		try {
	const serpResults = await getSERPAnalysis(mainKeyword, locationCode, language, 10);
			competitors = [...new Set(serpResults.map((r) => {
				try {
					return new URL(r.url).hostname;
				} catch {
					return r.url;
				}
			}))].slice(0, 5);
		} catch (error) {
			console.warn('Error getting SERP analysis, using fallback:', error);
			competitors = [];
		}

	// Extract topics from topical map
	const suggestedTopics = topicalMap.map((cluster) => cluster.name);

	// Generate recommendations
	const recommendations: string[] = [];
	if (topicalMap.length > 0) {
		recommendations.push(`Crea contenuti per ${topicalMap.length} cluster tematici identificati`);
		recommendations.push(`Prioritizza ${topicalMap.filter((c) => c.priority === 'high').length} cluster ad alta priorità`);
	}
	recommendations.push('Mantieni coerenza semantica tra i contenuti del cluster');
	recommendations.push('Crea internal linking tra articoli correlati');

	return {
		websiteUrl,
		primaryKeyword: mainKeyword,
		suggestedTopics,
		topicalMap,
		competitors,
		recommendations,
	};
	} catch (error) {
		console.error('Error in analyzeWebsite:', error);
		// Ultimate fallback - return minimal analysis
		const domain = new URL(websiteUrl).hostname.replace('www.', '');
		const fallbackKeyword = primaryKeyword || (domain.split('.')[0] ?? '').replace(/-/g, ' ') || 'marketing digitale';
		
		return {
			websiteUrl,
			primaryKeyword: fallbackKeyword,
			suggestedTopics: [fallbackKeyword],
			topicalMap: [
				{
					name: `${fallbackKeyword} - Guida Base`,
					keywords: [fallbackKeyword],
					searchVolume: 1000,
					difficulty: 40,
					priority: 'high',
					contentGaps: [],
				},
			],
			competitors: [],
			recommendations: ['Inizia creando contenuti per la keyword principale', 'Espandi gradualmente con contenuti correlati'],
		};
	}
};


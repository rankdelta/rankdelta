/**
 * Search Intent Detection & Content Optimization
 * 
 * Rileva l'intent della keyword e fornisce:
 * - Tipo di intent (informational, commercial, transactional, navigational)
 * - Struttura contenuto consigliata
 * - Pesi GEO specifici per l'intent
 * - Elementi obbligatori/raccomandati
 */

// ============================================
// TYPES
// ============================================

export type SearchIntent = 
	| 'informational' 
	| 'commercial_investigation' 
	| 'transactional' 
	| 'navigational';

export interface IntentAnalysis {
	intent: SearchIntent;
	confidence: number; // 0-100
	subType: string; // es. "how-to", "comparison", "pricing"
	signals: Array<string>; // pattern che hanno matchato
}

export interface ContentStructure {
	intent: SearchIntent;
	title: {
		pattern: string;
		examples: Array<string>;
	};
	sections: Array<{
		name: string;
		required: boolean;
		description: string;
		h2Example: string;
	}>;
	geoWeights: {
		humanExpertise: number;
		uniqueData: number;
		citability: number;
		contentDepth: number;
		eeat: number;
	};
	keyElements: Array<string>;
	avoidElements: Array<string>;
	tone: string;
	idealWordCount: { min: number; max: number };
}

// ============================================
// INTENT DETECTION PATTERNS (IT + EN)
// ============================================

const INFORMATIONAL_PATTERNS = [
	// How-to / Guide
	/^come\s+(fare|creare|usare|iniziare|imparare)/i,
	/^how\s+to/i,
	/^guida\s+(a|per|completa|passo)/i,
	/^guide\s+to/i,
	/^tutorial/i,
	// What is / Definition
	/^(cos'è|cosa\s+è|che\s+cos'è|cosa\s+sono)/i,
	/^what\s+(is|are)/i,
	/^definizione\s+di/i,
	// Why / Explanation
	/^perché/i,
	/^why\s+(is|are|do|does)/i,
	/^quando\s+(usare|fare)/i,
	/^when\s+to/i,
	// Learning
	/^impara(re)?\s+a/i,
	/^learn\s+(how|to)/i,
	/^capire\s+(come|cosa)/i,
	// Tips / Advice
	/consigli\s+(per|su)/i,
	/tips\s+(for|on)/i,
	/suggerimenti/i,
];

const COMMERCIAL_INVESTIGATION_PATTERNS = [
	// Best / Top
	/^(migliori?|top\s*\d*|best)\s/i,
	/^i\s+migliori/i,
	/^le\s+migliori/i,
	// Comparison
	/\s+vs\.?\s+/i,
	/confronto\s+(tra|di)/i,
	/comparison/i,
	/\s+o\s+.+\?\s*$/i, // "X o Y?"
	// Review / Opinion
	/recensione/i,
	/review/i,
	/opinioni/i,
	/pareri/i,
	/\s+vale\s+la\s+pena/i,
	// Alternatives
	/alternative\s+(a|to)/i,
	/\s+alternative$/i,
	// Evaluation
	/pro\s+e\s+contro/i,
	/pros\s+and\s+cons/i,
	/vantaggi\s+e\s+svantaggi/i,
];

const TRANSACTIONAL_PATTERNS = [
	// Buy / Purchase
	/^(compra|acquista|ordina)/i,
	/^buy\s/i,
	/^purchase/i,
	/dove\s+(comprare|acquistare)/i,
	/where\s+to\s+buy/i,
	// Price / Cost
	/\s+prezz[oi]/i,
	/\s+cost[oi]/i,
	/\s+price/i,
	/quanto\s+costa/i,
	/how\s+much/i,
	// Discount / Offer
	/\s+(sconto|offerta|promozione|coupon)/i,
	/\s+(discount|deal|offer|coupon)/i,
	/codice\s+sconto/i,
	// Subscribe / Register
	/\s+(abbonamento|iscrizione|registrazione)/i,
	/\s+(subscription|signup|register)/i,
	// Download / Get
	/^(scarica|download|ottieni|get)\s/i,
];

const NAVIGATIONAL_PATTERNS = [
	// Brand + action
	/^[A-Z][a-z]+\s+(login|accesso|accedi|registrati)/i,
	/^[A-Z][a-z]+\s+(app|sito|website|official)/i,
	// Specific product/service lookup
	/^(carta|conto|account)\s+[A-Z]/i, // "Carta Monese", "Conto N26"
	// Support / Contact
	/\s+(assistenza|supporto|contatti|help|support)$/i,
	/\s+(numero|telefono|email)\s+(verde|assistenza)/i,
];

// ============================================
// INTENT DETECTION
// ============================================

/**
 * Detect the search intent of a keyword/topic
 */
export const detectSearchIntent = (keyword: string): IntentAnalysis => {
	const keywordLower = keyword.toLowerCase().trim();
	const signals: Array<string> = [];
	
	// Count matches for each intent
	let informationalScore = 0;
	let commercialScore = 0;
	let transactionalScore = 0;
	let navigationalScore = 0;

	// Check informational patterns
	for (const pattern of INFORMATIONAL_PATTERNS) {
		if (pattern.test(keywordLower)) {
			informationalScore += 30;
			signals.push(`informational: ${pattern.source}`);
		}
	}

	// Check commercial investigation patterns
	for (const pattern of COMMERCIAL_INVESTIGATION_PATTERNS) {
		if (pattern.test(keywordLower)) {
			commercialScore += 30;
			signals.push(`commercial: ${pattern.source}`);
		}
	}

	// Check transactional patterns
	for (const pattern of TRANSACTIONAL_PATTERNS) {
		if (pattern.test(keywordLower)) {
			transactionalScore += 30;
			signals.push(`transactional: ${pattern.source}`);
		}
	}

	// Check navigational patterns
	for (const pattern of NAVIGATIONAL_PATTERNS) {
		if (pattern.test(keywordLower)) {
			navigationalScore += 30;
			signals.push(`navigational: ${pattern.source}`);
		}
	}

	// Additional heuristics
	// Brand names at start often indicate navigational
	if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)?$/.test(keyword.trim())) {
		navigationalScore += 20;
		signals.push('brand_name_pattern');
	}

	// Questions often indicate informational
	if (keywordLower.includes('?') || /^(come|cosa|perché|quando|dove|chi|quale)/i.test(keywordLower)) {
		informationalScore += 15;
		signals.push('question_pattern');
	}

	// Default: if nothing matches strongly, assume informational
	if (informationalScore === 0 && commercialScore === 0 && transactionalScore === 0 && navigationalScore === 0) {
		informationalScore = 40;
		signals.push('default_informational');
	}

	// Determine winner
	const scores = {
		informational: informationalScore,
		commercial_investigation: commercialScore,
		transactional: transactionalScore,
		navigational: navigationalScore,
	};

	const maxScore = Math.max(...Object.values(scores));
	const intent = (Object.entries(scores).find(([, score]) => score === maxScore)?.[0] || 'informational') as SearchIntent;
	
	// Calculate confidence
	const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
	const confidence = totalScore > 0 ? Math.round((maxScore / totalScore) * 100) : 50;

	// Determine subtype
	const subType = getIntentSubType(keyword, intent);

	return {
		intent,
		confidence,
		subType,
		signals,
	};
};

/**
 * Get more specific subtype of intent
 */
const getIntentSubType = (keyword: string, intent: SearchIntent): string => {
	const kw = keyword.toLowerCase();

	switch (intent) {
		case 'informational':
			if (/^come\s/i.test(kw) || /how\s+to/i.test(kw)) return 'how-to';
			if (/^(cos'è|cosa\s+è|what\s+is)/i.test(kw)) return 'definition';
			if (/guida|guide|tutorial/i.test(kw)) return 'guide';
			if (/perché|why/i.test(kw)) return 'explanation';
			if (/consigli|tips/i.test(kw)) return 'tips';
			return 'general';

		case 'commercial_investigation':
			if (/^(migliori?|top|best)/i.test(kw)) return 'best-of';
			if (/\s+vs\.?\s+|\s+o\s+/i.test(kw)) return 'comparison';
			if (/recensione|review/i.test(kw)) return 'review';
			if (/alternative/i.test(kw)) return 'alternatives';
			if (/pro\s+e\s+contro|pros\s+and/i.test(kw)) return 'pros-cons';
			return 'evaluation';

		case 'transactional':
			if (/prezz|cost|price/i.test(kw)) return 'pricing';
			if (/compra|acquista|buy/i.test(kw)) return 'purchase';
			if (/sconto|offerta|coupon|discount/i.test(kw)) return 'deals';
			if (/scarica|download/i.test(kw)) return 'download';
			return 'conversion';

		case 'navigational':
			if (/login|accesso|accedi/i.test(kw)) return 'login';
			if (/app|sito|website/i.test(kw)) return 'official-site';
			if (/assistenza|supporto|help/i.test(kw)) return 'support';
			return 'brand-lookup';
	}
};

// ============================================
// CONTENT STRUCTURE PER INTENT
// ============================================

/**
 * Get optimal content structure for a given intent
 */
export const getContentStructure = (intentAnalysis: IntentAnalysis): ContentStructure => {
	const { intent, subType } = intentAnalysis;

	switch (intent) {
		case 'informational':
			return getInformationalStructure(subType);
		case 'commercial_investigation':
			return getCommercialStructure(subType);
		case 'transactional':
			return getTransactionalStructure(subType);
		case 'navigational':
			return getNavigationalStructure(subType);
	}
};

const getInformationalStructure = (subType: string): ContentStructure => ({
	intent: 'informational',
	title: {
		pattern: subType === 'how-to' ? 'Come [Azione]: Guida Completa [Anno]' : '[Topic]: Tutto Quello che Devi Sapere',
		examples: [
			'Come Aprire un Conto Online: Guida Completa 2025',
			'Carte Prepagate: Tutto Quello che Devi Sapere',
		],
	},
	sections: [
		{ name: 'Introduzione con Esperienza', required: true, description: 'Hook personale + promessa di valore', h2Example: 'Introduzione' },
		{ name: 'Definizione/Cos\'è', required: true, description: 'Definizione chiara e citabile', h2Example: 'Cos\'è [Topic]?' },
		{ name: 'Come Funziona', required: true, description: 'Spiegazione meccanismo/processo', h2Example: 'Come Funziona [Topic]' },
		{ name: 'Guida Passo Passo', required: subType === 'how-to', description: 'Steps numerati con dettagli', h2Example: 'Come [Fare X]: Guida Passo Passo' },
		{ name: 'Vantaggi e Svantaggi', required: false, description: 'Analisi bilanciata', h2Example: 'Vantaggi e Svantaggi' },
		{ name: 'Errori da Evitare', required: false, description: 'Esperienza personale su errori', h2Example: 'Errori Comuni da Evitare' },
		{ name: 'Caso Studio', required: true, description: 'Esempio reale dettagliato', h2Example: 'Caso Studio: [Nome]' },
		{ name: 'FAQ', required: true, description: 'Domande frequenti (min 3)', h2Example: 'Domande Frequenti' },
		{ name: 'Key Takeaways', required: true, description: 'Punti chiave riassuntivi', h2Example: 'Key Takeaways' },
	],
	geoWeights: {
		humanExpertise: 1.2,    // Molto importante per guide
		uniqueData: 1.0,
		citability: 1.3,        // Definizioni citabili cruciali
		contentDepth: 1.2,      // Profondità importante
		eeat: 1.1,
	},
	keyElements: [
		'Definizione quotabile all\'inizio di ogni sezione',
		'Esperienza personale con date specifiche',
		'Steps numerati e chiari',
		'Almeno 1 caso studio dettagliato',
		'FAQ con almeno 3-5 domande reali',
		'Citazioni da fonti autorevoli',
	],
	avoidElements: [
		'CTA aggressive di vendita',
		'Troppo focus su prezzi',
		'Contenuto superficiale',
	],
	tone: 'educativo, autorevole, amichevole',
	idealWordCount: { min: 2000, max: 4000 },
});

const getCommercialStructure = (subType: string): ContentStructure => ({
	intent: 'commercial_investigation',
	title: {
		pattern: subType === 'best-of' ? 'Migliori [Prodotto] [Anno]: Confronto e Recensione' : '[Prodotto A] vs [Prodotto B]: Quale Scegliere?',
		examples: [
			'Migliori Carte Prepagate 2025: Confronto Completo',
			'N26 vs Revolut: Quale Scegliere nel 2025?',
		],
	},
	sections: [
		{ name: 'Introduzione con Esperienza', required: true, description: 'Ho testato X prodotti, ecco cosa ho scoperto', h2Example: 'Introduzione' },
		{ name: 'Criteri di Valutazione', required: true, description: 'Come abbiamo valutato', h2Example: 'I Nostri Criteri di Valutazione' },
		{ name: 'Tabella Comparativa', required: true, description: 'Confronto visuale rapido', h2Example: 'Confronto Rapido' },
		{ name: 'Recensione Dettagliata', required: true, description: 'Analisi di ogni opzione', h2Example: '[Prodotto]: Analisi Completa' },
		{ name: 'Pro e Contro', required: true, description: 'Per ogni prodotto', h2Example: 'Pro e Contro di [Prodotto]' },
		{ name: 'Per Chi è Indicato', required: true, description: 'Matching utente-prodotto', h2Example: 'Quale Scegliere in Base alle Tue Esigenze' },
		{ name: 'Il Mio Preferito', required: true, description: 'Raccomandazione personale', h2Example: 'La Mia Scelta Personale' },
		{ name: 'FAQ', required: true, description: 'Domande su confronto', h2Example: 'Domande Frequenti' },
		{ name: 'Key Takeaways', required: true, description: 'Sintesi delle raccomandazioni', h2Example: 'Key Takeaways' },
	],
	geoWeights: {
		humanExpertise: 1.4,    // MOLTO importante - "ho testato personalmente"
		uniqueData: 1.3,        // Dati comparativi proprietari
		citability: 1.0,
		contentDepth: 1.1,
		eeat: 1.3,              // Trust per raccomandazioni
	},
	keyElements: [
		'Tabella comparativa chiara',
		'"Ho testato personalmente X per Y settimane"',
		'Pro e contro per ogni opzione',
		'Raccomandazione chiara "Il mio preferito è..."',
		'Dati specifici (prezzi, percentuali)',
		'Disclaimer su affiliazioni se presenti',
	],
	avoidElements: [
		'Recensioni generiche copiate',
		'Mancanza di opinione personale',
		'Assenza di confronto diretto',
	],
	tone: 'esperto, obiettivo ma con opinione, utile',
	idealWordCount: { min: 2500, max: 5000 },
});

const getTransactionalStructure = (subType: string): ContentStructure => ({
	intent: 'transactional',
	title: {
		pattern: subType === 'pricing' ? '[Prodotto]: Prezzi, Piani e Costi [Anno]' : 'Come Acquistare [Prodotto]: Guida Completa',
		examples: [
			'Monese: Prezzi, Piani e Costi 2025',
			'Come Attivare la Carta N26: Guida Rapida',
		],
	},
	sections: [
		{ name: 'Introduzione Breve', required: true, description: 'Subito al punto', h2Example: 'Introduzione' },
		{ name: 'Panoramica Prezzi', required: true, description: 'Tabella prezzi chiara', h2Example: 'Prezzi e Piani Disponibili' },
		{ name: 'Cosa Include', required: true, description: 'Features per piano', h2Example: 'Cosa Include Ogni Piano' },
		{ name: 'Come Acquistare/Attivare', required: true, description: 'Steps per l\'acquisto', h2Example: 'Come Acquistare [Prodotto]' },
		{ name: 'Metodi di Pagamento', required: subType === 'purchase', description: 'Opzioni disponibili', h2Example: 'Metodi di Pagamento Accettati' },
		{ name: 'Offerte Attuali', required: false, description: 'Sconti/promozioni', h2Example: 'Offerte e Sconti Attivi' },
		{ name: 'Garanzie e Rimborsi', required: true, description: 'Politiche rassicuranti', h2Example: 'Garanzie e Politica di Rimborso' },
		{ name: 'FAQ', required: true, description: 'Domande pre-acquisto', h2Example: 'Domande Frequenti' },
	],
	geoWeights: {
		humanExpertise: 0.8,    // Meno critico per transazionale
		uniqueData: 1.2,        // Prezzi/dati aggiornati importanti
		citability: 0.9,
		contentDepth: 0.7,      // Non serve troppa profondità
		eeat: 1.4,              // Trust MOLTO importante per acquisti
	},
	keyElements: [
		'Prezzi chiari e aggiornati',
		'CTA chiare (dove/come acquistare)',
		'Trust signals (garanzie, sicurezza)',
		'Ultimo aggiornamento prezzi visibile',
		'Comparazione piani se esistono',
	],
	avoidElements: [
		'Troppo contenuto informativo generico',
		'Prezzi nascosti o confusi',
		'Mancanza di CTA',
	],
	tone: 'diretto, chiaro, rassicurante',
	idealWordCount: { min: 1200, max: 2500 },
});

const getNavigationalStructure = (_subType: string): ContentStructure => ({
	intent: 'navigational',
	title: {
		pattern: '[Brand]: [Azione/Info] - Guida Ufficiale',
		examples: [
			'Monese Login: Come Accedere al Tuo Conto',
			'N26 App: Download e Configurazione',
		],
	},
	sections: [
		{ name: 'Risposta Diretta', required: true, description: 'Subito la risposta cercata', h2Example: 'Come Accedere a [Brand]' },
		{ name: 'Panoramica Brand', required: true, description: 'Info essenziali sul brand', h2Example: 'Cos\'è [Brand]' },
		{ name: 'Guida Passo Passo', required: true, description: 'Steps specifici', h2Example: 'Guida Passo Passo' },
		{ name: 'Problemi Comuni', required: true, description: 'Troubleshooting', h2Example: 'Problemi Comuni e Soluzioni' },
		{ name: 'Contatti Supporto', required: true, description: 'Come contattare', h2Example: 'Contattare l\'Assistenza' },
		{ name: 'FAQ', required: true, description: 'Domande specifiche brand', h2Example: 'Domande Frequenti' },
	],
	geoWeights: {
		humanExpertise: 0.7,    // Meno critico
		uniqueData: 0.8,
		citability: 0.9,
		contentDepth: 0.6,      // Utente vuole risposta rapida
		eeat: 1.2,              // Trust sul brand importante
	},
	keyElements: [
		'Link ufficiali al brand',
		'Info contatto aggiornate',
		'Screenshots/guide visuali',
		'Troubleshooting comune',
	],
	avoidElements: [
		'Contenuto troppo lungo',
		'Info non ufficiali/sbagliate',
		'Mancanza di link diretti',
	],
	tone: 'pratico, rapido, utile',
	idealWordCount: { min: 800, max: 1800 },
});

// ============================================
// PROMPT GENERATION
// ============================================

/**
 * Generate additional prompt instructions based on intent
 */
export const getIntentPromptInstructions = (intentAnalysis: IntentAnalysis): string => {
	const structure = getContentStructure(intentAnalysis);
	const { intent, subType } = intentAnalysis;

	const sectionsList = structure.sections
		.filter((s) => s.required)
		.map((s) => `- ${s.h2Example}: ${s.description}`)
		.join('\n');

	const keyElementsList = structure.keyElements.map((e) => `✅ ${e}`).join('\n');
	const avoidList = structure.avoidElements.map((e) => `❌ ${e}`).join('\n');

	return `
🎯 SEARCH INTENT: ${intent.toUpperCase()} (${subType})

📋 STRUTTURA OBBLIGATORIA per questo intent:
${sectionsList}

✨ ELEMENTI CHIAVE da includere:
${keyElementsList}

🚫 DA EVITARE per questo intent:
${avoidList}

📝 TONO: ${structure.tone}

📏 LUNGHEZZA IDEALE: ${structure.idealWordCount.min}-${structure.idealWordCount.max} parole

${intent === 'commercial_investigation' ? `
💡 IMPORTANTE per CONFRONTI:
- Inizia con "Ho testato personalmente [X] per [periodo]..."
- Includi una tabella comparativa con | Prodotto | Pro | Contro | Prezzo | Voto |
- Termina ogni sezione prodotto con "Il mio verdetto: ..."
- Chiudi con "La mia raccomandazione personale è [X] perché..."
` : ''}

${intent === 'transactional' ? `
💡 IMPORTANTE per CONTENUTO TRANSAZIONALE:
- Prezzi SEMPRE visibili e chiari
- Includi "Ultimo aggiornamento prezzi: [data]"
- CTA chiare: "Come acquistare", "Dove comprare"
- Trust signals: garanzie, sicurezza pagamenti, recensioni
` : ''}

${intent === 'informational' ? `
💡 IMPORTANTE per CONTENUTO INFORMATIVO:
- Inizia ogni H2 con una definizione quotabile tra virgolette
- Includi almeno 1 caso studio dettagliato con timeline
- FAQ con almeno 5 domande reali
- Cita fonti esterne autorevoli
` : ''}
`;
};

// ============================================
// GEO WEIGHT ADJUSTMENT
// ============================================

/**
 * Get adjusted GEO weights based on intent
 * Returns multipliers for each GEO factor
 */
export const getGEOWeightsForIntent = (intent: SearchIntent): ContentStructure['geoWeights'] => {
	const structure = getContentStructure({ intent, confidence: 100, subType: '', signals: [] });
	return structure.geoWeights;
};

/**
 * Apply intent-based weights to GEO scores
 */
export const adjustGEOScoreForIntent = (
	baseScores: {
		humanExpertise: number;
		uniqueData: number;
		citability: number;
		contentDepth: number;
		eeat: number;
	},
	intent: SearchIntent
): number => {
	const weights = getGEOWeightsForIntent(intent);
	
	const weightedSum = 
		baseScores.humanExpertise * weights.humanExpertise +
		baseScores.uniqueData * weights.uniqueData +
		baseScores.citability * weights.citability +
		baseScores.contentDepth * weights.contentDepth +
		baseScores.eeat * weights.eeat;

	const totalWeight = 
		weights.humanExpertise +
		weights.uniqueData +
		weights.citability +
		weights.contentDepth +
		weights.eeat;

	// Normalize to 0-100
	const maxPossible = 25 + 20 + 20 + 20 + 15; // Max scores per category
	return Math.round((weightedSum / totalWeight / maxPossible) * 100);
};


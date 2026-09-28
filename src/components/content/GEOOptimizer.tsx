/**
 * GEO (Generative Engine Optimization) Component
 * 
 * Ottimizza i contenuti per essere citati da AI Overviews, ChatGPT, Perplexity, etc.
 * Basato sulle ultime best practices 2025 per content che sopravvive agli AI summaries.
 * 
 * MULTILINGUAL: Supporta pattern sia in italiano che in inglese
 */

import { useMemo, type ReactElement } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Toast } from '../ui/Toast';
import { useToast } from '../../hooks/useToast';
import { detectSearchIntent, getContentStructure, type IntentAnalysis } from '../../utils/searchIntent';
import type { Content } from '../../types/database';

interface GEOOptimizerProps {
	content: Content;
	onContentUpdated?: () => void;
}

interface GEOMetric {
	name: string;
	score: number;
	maxScore: number;
	icon: string;
	description: string;
	suggestions: Array<string>;
	details: Array<string>; // What was detected
	status: 'excellent' | 'good' | 'needs_work' | 'poor';
}

// ============================================
// PATTERN MULTILINGUE (IT + EN)
// ============================================

// Patterns for PERSONAL EXPERIENCE (IT + EN)
const PERSONAL_EXPERIENCE_PATTERNS = [
	// Italiano
	/nel\s+\d{4}/gi, // "nel 2008", "nel 2020"
	/negli ultimi \d+ anni/gi,
	/da oltre \d+ anni/gi,
	/con oltre \d+ anni/gi,
	/nella mia (esperienza|pratica|carriera)/gi,
	/ho (scoperto|imparato|trovato|testato|provato|commesso)/gi,
	/quando ho (iniziato|scoperto|provato)/gi,
	/mi (ritrovai|trovai|accorsi|resi conto)/gi,
	/mi ha (insegnato|mostrato|fatto capire)/gi,
	/la mia esperienza/gi,
	/voglio condividere/gi,
	/personalmente/gi,
	// English
	/in my experience/gi,
	/i('ve| have) (found|discovered|learned|tested|tried)/gi,
	/after (testing|trying|using)/gi,
	/what (i|we) learned/gi,
	/i was (surprised|shocked|amazed)/gi,
];

// Patterns for AUTHOR CREDENTIALS (IT + EN)
const AUTHOR_CREDENTIALS_PATTERNS = [
	// Italiano - Bio autore
	/articolo scritto da/gi,
	/autore:/gi,
	/\bdi\s+[A-Z][a-z]+\s+[A-Z][a-z]+,?\s+(consulente|esperto|specialista|professionista|dott\.|dr\.|ing\.|avv\.)/gi,
	/con oltre \d+ anni di esperienza/gi,
	/\d+ anni di esperienza/gi,
	/membro (di|dell')/gi,
	/certificato|qualificato/gi,
	/autore di (diverse|numerose|varie) pubblicazioni/gi,
	/fondatore (di|del)/gi,
	/direttore|responsabile/gi,
	// English
	/author:|written by/gi,
	/with (\d+) years of experience/gi,
	/certified (in|by)/gi,
	/member of/gi,
	/founder of/gi,
];

// Patterns for EXTERNAL CITATIONS (IT + EN)
const EXTERNAL_CITATIONS_PATTERNS = [
	// Italiano
	/secondo (uno studio|una ricerca|i dati|un rapporto)/gi,
	/come riportato (da|in)/gi,
	/come sottolinea (il|la|lo)\s+\w+/gi,
	/(studio|ricerca|rapporto) (condotto|pubblicato|del)/gi,
	/— [A-Z][^,\n]+,\s*\d{4}/g, // "— Federazione Europea, 2024"
	/\([A-Z][^)]+,\s*\d{4}\)/g, // "(Thompson et al., 2024)"
	/(banca|università|istituto|centro studi|federazione|associazione) (d'italia|italiana|europeo|europee?)/gi,
	/(journal of|studio del)/gi,
	/peer-reviewed/gi,
	// English
	/according to/gi,
	/research (by|from)/gi,
	/study (by|from|published)/gi,
	/as reported by/gi,
];

// Patterns for PROPRIETARY DATA (IT + EN)
const PROPRIETARY_DATA_PATTERNS = [
	// Italiano
	/secondo i (nostri|dati della nostra)/gi,
	/i nostri dati (mostrano|indicano|rivelano)/gi,
	/nella nostra (ricerca|analisi|pratica|azienda)/gi,
	/dati proprietari/gi,
	/abbiamo (analizzato|studiato|documentato|seguito)/gi,
	/su \d+ (utenti|clienti|pazienti|casi|aziende|persone)/gi,
	/tra .+ e .+ \d{4}/gi, // "tra gennaio e giugno 2024"
	// English
	/our (data|research|analysis|study) (shows?|reveals?|indicates?)/gi,
	/we (analyzed|surveyed|studied|tested) (\d+)/gi,
	/proprietary (data|research)/gi,
];

// Patterns for STATISTICS with sources
const STATISTICS_PATTERNS = [
	/\d+([.,]\d+)?%/g, // Percentuali: 65%, 73.2%
	/\d+ (su|di|dei|delle) \d+/gi, // "8 su 10", "65 dei 100"
	/il \d+% (degli?|delle?|dei)/gi, // "il 65% degli utenti"
	/\d+\s*(milioni?|miliardi?|migliaia?)/gi, // numeri grandi
];

// Patterns for CASE STUDIES (IT + EN)
const CASE_STUDY_PATTERNS = [
	// Italiano
	/caso (di|studio)/gi,
	/case study/gi,
	/situazione iniziale/gi,
	/intervento/gi,
	/risultati (documentati|ottenuti|raggiunti)/gi,
	/lezione appresa/gi,
	/prima.{0,20}dopo/gi,
	/\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4}/gi,
	/settimana \d+/gi,
	// English
	/initial situation/gi,
	/intervention/gi,
	/documented results/gi,
	/lesson learned/gi,
];

// Patterns for QUOTABLE STATEMENTS
const QUOTABLE_PATTERNS = [
	/"[^"]{20,200}"/g, // Virgolette inglesi
	/"[^"]{20,200}"/g, // Virgolette italiane
	/«[^»]{20,200}»/g, // Virgolette francesi
	/>\s*"[^"]+"/gm, // Blockquote markdown
];

// Patterns for FAQ SECTION
const FAQ_PATTERNS = [
	/^#+\s*(faq|domande frequenti|domande comuni)/gim,
	/^\d+\.\s+[^?\n]+\?$/gm, // "1. Le carte prepagate sono sicure?"
	/^#+\s*\d+\.\s+[^?\n]+\?/gm,
	/domanda:/gi,
	/risposta:/gi,
];

// Patterns for KEY TAKEAWAYS
const TAKEAWAY_PATTERNS = [
	/^#+\s*(key takeaways?|punti chiave|conclusioni|riepilogo)/gim,
	/in (sintesi|conclusione|breve)/gi,
	/ricorda (sempre )?che/gi,
];

// Patterns for TRUST SIGNALS
const TRUST_SIGNALS_PATTERNS = [
	// Italiano
	/disclaimer/gi,
	/scopo informativo/gi,
	/consulta (sempre )?(un|il tuo) (esperto|consulente|medico|veterinario|professionista)/gi,
	/fonti e metodologia/gi,
	/ultimo aggiornamento/gi,
	/prossima revisione/gi,
	/i risultati possono variare/gi,
	/le condizioni possono variare/gi,
	// English
	/for informational purposes/gi,
	/consult (a|your) (professional|expert|doctor)/gi,
	/last updated/gi,
	/results may vary/gi,
];

// Patterns for DEPTH (why, how, contraindications)
const DEPTH_PATTERNS = [
	// Italiano
	/perché funziona/gi,
	/come funziona/gi,
	/il meccanismo/gi,
	/a differenza (di|delle)/gi,
	/vantaggi e svantaggi/gi,
	/pro e contro/gi,
	/quando (non|evitare)/gi,
	/attenzione:/gi,
	/importante:/gi,
	/nota:/gi,
	// English
	/how it works/gi,
	/why it works/gi,
	/pros and cons/gi,
	/when (not to|to avoid)/gi,
];

// ============================================
// HELPER FUNCTIONS
// ============================================

const countPatternMatches = (text: string, patterns: Array<RegExp>): number => {
	let count = 0;
	for (const pattern of patterns) {
		// Clone pattern with global flag to count all matches
		const globalPattern = new RegExp(pattern.source, 'gi');
		const matches = text.match(globalPattern);
		if (matches) {
			count += matches.length;
		}
	}
	return count;
};

const findMatchExamples = (text: string, patterns: Array<RegExp>, maxExamples: number = 3): Array<string> => {
	const examples: Array<string> = [];
	for (const pattern of patterns) {
		if (examples.length >= maxExamples) break;
		const globalPattern = new RegExp(pattern.source, 'gi');
		const matches = text.match(globalPattern);
		if (matches) {
			for (const match of matches) {
				if (examples.length >= maxExamples) break;
				const cleanMatch = match.trim().substring(0, 80);
				if (cleanMatch.length > 5 && !examples.includes(cleanMatch)) {
					examples.push(cleanMatch);
				}
			}
		}
	}
	return examples;
};

// ============================================
// MAIN COMPONENT
// ============================================

export const GEOOptimizer = ({ content }: GEOOptimizerProps): ReactElement => {
	const { t } = useTranslation();
	const { toast, hideToast } = useToast();

	// Detect search intent based on topic/title
	const intentAnalysis: IntentAnalysis = useMemo(() => {
		const keyword = content.topic || content.title || '';
		return detectSearchIntent(keyword);
	}, [content.topic, content.title]);

	const contentStructure = useMemo(() => {
		return getContentStructure(intentAnalysis);
	}, [intentAnalysis]);

	const geoAnalysis = useMemo(() => {
		const body = content.body || '';
		const wordCount = body.split(/\s+/).filter((w) => w.trim().length > 0).length;
		
		// Get intent-based weights
		const weights = contentStructure.geoWeights;
		
		const metrics: Array<GEOMetric> = [];
		let totalScore = 0;
		let maxTotalScore = 0;

		// =============================================
		// 1. HUMAN EXPERTISE (25 points)
		// =============================================
		const personalExpCount = countPatternMatches(body, PERSONAL_EXPERIENCE_PATTERNS);
		const credentialsCount = countPatternMatches(body, AUTHOR_CREDENTIALS_PATTERNS);
		const personalExpExamples = findMatchExamples(body, PERSONAL_EXPERIENCE_PATTERNS);
		const credentialsExamples = findMatchExamples(body, AUTHOR_CREDENTIALS_PATTERNS);
		
		let expertiseScore = 0;
		const expertiseSuggestions: Array<string> = [];
		const expertiseDetails: Array<string> = [];
		
		// Score calculation
		if (personalExpCount >= 3) expertiseScore += 12;
		else if (personalExpCount >= 1) expertiseScore += 6;
		
		if (credentialsCount >= 2) expertiseScore += 13;
		else if (credentialsCount >= 1) expertiseScore += 7;
		
		// Details
		if (personalExpExamples.length > 0) {
			expertiseDetails.push(t('contentTools.geo.details.personalExperience', { example: personalExpExamples[0] }));
		}
		if (credentialsExamples.length > 0) {
			expertiseDetails.push(t('contentTools.geo.details.authorCredentials', { example: credentialsExamples[0] }));
		}
		
		// Suggestions
		if (personalExpCount === 0) {
			expertiseSuggestions.push(t('contentTools.geo.suggestions.addPersonalExperience'));
		}
		if (credentialsCount === 0) {
			expertiseSuggestions.push(t('contentTools.geo.suggestions.addAuthorBio'));
		}

		metrics.push({
			name: 'Human Expertise',
			score: expertiseScore,
			maxScore: 25,
			icon: '🧠',
			description: t('contentTools.geo.metricDescriptions.humanExpertise'),
			suggestions: expertiseSuggestions,
			details: expertiseDetails,
			status: expertiseScore >= 20 ? 'excellent' : expertiseScore >= 15 ? 'good' : expertiseScore >= 8 ? 'needs_work' : 'poor',
		});

		// =============================================
		// 2. UNIQUE DATA & CITATIONS (20 points)
		// =============================================
		const proprietaryDataCount = countPatternMatches(body, PROPRIETARY_DATA_PATTERNS);
		const externalCitationsCount = countPatternMatches(body, EXTERNAL_CITATIONS_PATTERNS);
		const statisticsCount = countPatternMatches(body, STATISTICS_PATTERNS);
		
		const dataExamples = findMatchExamples(body, PROPRIETARY_DATA_PATTERNS);
		const citationExamples = findMatchExamples(body, EXTERNAL_CITATIONS_PATTERNS);
		const statsExamples = findMatchExamples(body, STATISTICS_PATTERNS, 5);
		
		let dataScore = 0;
		const dataSuggestions: Array<string> = [];
		const dataDetails: Array<string> = [];
		
		// Score calculation
		if (externalCitationsCount >= 3) dataScore += 8;
		else if (externalCitationsCount >= 1) dataScore += 4;
		
		if (proprietaryDataCount >= 2) dataScore += 6;
		else if (proprietaryDataCount >= 1) dataScore += 3;
		
		if (statisticsCount >= 5) dataScore += 6;
		else if (statisticsCount >= 2) dataScore += 3;
		
		// Details
		if (citationExamples.length > 0) {
			dataDetails.push(t('contentTools.geo.details.externalCitations', { count: externalCitationsCount, example: citationExamples[0] }));
		}
		if (dataExamples.length > 0) {
			dataDetails.push(t('contentTools.geo.details.proprietaryData', { count: proprietaryDataCount, example: dataExamples[0] }));
		}
		if (statsExamples.length > 0) {
			dataDetails.push(t('contentTools.geo.details.statistics', { count: statisticsCount, examples: statsExamples.slice(0, 3).join(', ') }));
		}
		
		// Suggestions
		if (externalCitationsCount < 2) {
			dataSuggestions.push(t('contentTools.geo.suggestions.addCitations'));
		}
		if (statisticsCount < 3) {
			dataSuggestions.push(t('contentTools.geo.suggestions.addStatistics'));
		}

		metrics.push({
			name: 'Data & Citations',
			score: dataScore,
			maxScore: 20,
			icon: '📊',
			description: t('contentTools.geo.metricDescriptions.dataCitations'),
			suggestions: dataSuggestions,
			details: dataDetails,
			status: dataScore >= 15 ? 'excellent' : dataScore >= 10 ? 'good' : dataScore >= 5 ? 'needs_work' : 'poor',
		});

		// =============================================
		// 3. CITABILITY & QUOTABILITY (20 points)
		// =============================================
		const quotableCount = countPatternMatches(body, QUOTABLE_PATTERNS);
		const quotableExamples = findMatchExamples(body, QUOTABLE_PATTERNS, 2);
		
		// Check for clear definitions (sentences starting with "X è/sono")
		const definitionPattern = /[A-Z][^.]*\b(è|sono|significa|rappresenta)\s+[^.]{20,100}\./gi;
		const definitionCount = (body.match(definitionPattern) || []).length;
		
		let citabilityScore = 0;
		const citabilitySuggestions: Array<string> = [];
		const citabilityDetails: Array<string> = [];
		
		// Score calculation
		if (quotableCount >= 3) citabilityScore += 10;
		else if (quotableCount >= 1) citabilityScore += 5;
		
		if (definitionCount >= 3) citabilityScore += 6;
		else if (definitionCount >= 1) citabilityScore += 3;
		
		// Bonus for author credentials (makes citations more likely)
		if (credentialsCount >= 2) citabilityScore += 4;
		
		// Details
		if (quotableCount > 0) {
			dataDetails.push(t('contentTools.geo.details.quotableStatements', { count: quotableCount }));
			if (quotableExamples[0]) {
				citabilityDetails.push(t('contentTools.geo.details.quotesFound', { example: quotableExamples[0].substring(0, 60) }));
			}
		}
		if (definitionCount > 0) {
			citabilityDetails.push(t('contentTools.geo.details.clearDefinitions', { count: definitionCount }));
		}
		if (credentialsCount >= 2) {
			citabilityDetails.push(t('contentTools.geo.details.credentialsBoostCitability'));
		}
		
		// Suggestions
		if (quotableCount < 2) {
			citabilitySuggestions.push(t('contentTools.geo.suggestions.addQuotable'));
		}
		if (definitionCount < 2) {
			citabilitySuggestions.push(t('contentTools.geo.suggestions.addDefinitions'));
		}

		metrics.push({
			name: 'Citability',
			score: citabilityScore,
			maxScore: 20,
			icon: '📝',
			description: t('contentTools.geo.metricDescriptions.citability'),
			suggestions: citabilitySuggestions,
			details: citabilityDetails,
			status: citabilityScore >= 15 ? 'excellent' : citabilityScore >= 10 ? 'good' : citabilityScore >= 5 ? 'needs_work' : 'poor',
		});

		// =============================================
		// 4. CONTENT DEPTH (20 points)
		// =============================================
		const caseStudyCount = countPatternMatches(body, CASE_STUDY_PATTERNS);
		const depthPatternCount = countPatternMatches(body, DEPTH_PATTERNS);
		const faqCount = countPatternMatches(body, FAQ_PATTERNS);
		const takeawayCount = countPatternMatches(body, TAKEAWAY_PATTERNS);
		
		const caseStudyExamples = findMatchExamples(body, CASE_STUDY_PATTERNS);
		
		// Structure analysis
		const h2Count = (body.match(/^##\s+/gm) || []).length;
		const h3Count = (body.match(/^###\s+/gm) || []).length;
		
		let depthScore = 0;
		const depthSuggestions: Array<string> = [];
		const depthDetails: Array<string> = [];
		
		// Score calculation
		// Word count
		if (wordCount >= 2000) depthScore += 4;
		else if (wordCount >= 1500) depthScore += 2;
		
		// Structure
		if (h2Count >= 5) depthScore += 3;
		else if (h2Count >= 3) depthScore += 2;
		
		// Case studies
		if (caseStudyCount >= 4) depthScore += 5;
		else if (caseStudyCount >= 2) depthScore += 3;
		
		// FAQ section
		if (faqCount >= 3) depthScore += 4;
		else if (faqCount >= 1) depthScore += 2;
		
		// Key takeaways
		if (takeawayCount >= 1) depthScore += 2;
		
		// Depth patterns (why, how, pros/cons)
		if (depthPatternCount >= 3) depthScore += 2;
		
		// Details
		depthDetails.push(t('contentTools.geo.details.length', { count: wordCount }));
		depthDetails.push(t('contentTools.geo.details.structure', { h2: h2Count, h3: h3Count }));
		if (caseStudyCount > 0) {
			depthDetails.push(t('contentTools.geo.details.caseStudies', { count: caseStudyCount, example: caseStudyExamples[0] || t('contentTools.geo.details.caseStudiesFallback') }));
		}
		if (faqCount > 0) {
			depthDetails.push(t('contentTools.geo.details.faqDetected'));
		}
		if (takeawayCount > 0) {
			depthDetails.push(t('contentTools.geo.details.takeawaysDetected'));
		}
		
		// Suggestions
		if (caseStudyCount < 2) {
			depthSuggestions.push(t('contentTools.geo.suggestions.addCaseStudies'));
		}
		if (faqCount === 0) {
			depthSuggestions.push(t('contentTools.geo.suggestions.addFaq'));
		}
		if (takeawayCount === 0) {
			depthSuggestions.push(t('contentTools.geo.suggestions.addTakeaways'));
		}

		metrics.push({
			name: 'Content Depth',
			score: depthScore,
			maxScore: 20,
			icon: '🔬',
			description: t('contentTools.geo.metricDescriptions.contentDepth'),
			suggestions: depthSuggestions,
			details: depthDetails,
			status: depthScore >= 15 ? 'excellent' : depthScore >= 10 ? 'good' : depthScore >= 5 ? 'needs_work' : 'poor',
		});

		// =============================================
		// 5. E-E-A-T & TRUST SIGNALS (15 points)
		// =============================================
		const trustExamples = findMatchExamples(body, TRUST_SIGNALS_PATTERNS);
		
		// Check for last updated date
		const hasLastUpdated = /ultimo aggiornamento|last updated/i.test(body);
		const hasDisclaimer = /disclaimer/i.test(body);
		const hasMethodology = /metodologia|fonti e metodologia/i.test(body);
		
		let eeatScore = 0;
		const eeatSuggestions: Array<string> = [];
		const eeatDetails: Array<string> = [];
		
		// Score calculation
		// Credentials (already counted)
		if (credentialsCount >= 2) eeatScore += 5;
		else if (credentialsCount >= 1) eeatScore += 3;
		
		// Trust signals
		if (hasDisclaimer) eeatScore += 3;
		if (hasMethodology) eeatScore += 3;
		if (hasLastUpdated) eeatScore += 2;
		
		// External citations (authority)
		if (externalCitationsCount >= 3) eeatScore += 2;
		
		// Details
		if (credentialsCount > 0) {
			eeatDetails.push(t('contentTools.geo.details.credentialsPresent'));
		}
		if (hasDisclaimer) {
			eeatDetails.push(t('contentTools.geo.details.disclaimerPresent'));
		}
		if (hasMethodology) {
			eeatDetails.push(t('contentTools.geo.details.methodologyPresent'));
		}
		if (hasLastUpdated) {
			eeatDetails.push(t('contentTools.geo.details.lastUpdatedPresent'));
		}
		if (trustExamples.length > 0) {
			eeatDetails.push(t('contentTools.geo.details.trustSignals', { example: trustExamples[0] }));
		}
		
		// Suggestions
		if (!hasDisclaimer) {
			eeatSuggestions.push(t('contentTools.geo.suggestions.addDisclaimer'));
		}
		if (!hasMethodology) {
			eeatSuggestions.push(t('contentTools.geo.suggestions.addMethodology'));
		}
		if (!hasLastUpdated) {
			eeatSuggestions.push(t('contentTools.geo.suggestions.addLastUpdated'));
		}

		metrics.push({
			name: 'E-E-A-T Signals',
			score: eeatScore,
			maxScore: 15,
			icon: '🏆',
			description: 'Experience, Expertise, Authoritativeness, Trustworthiness',
			suggestions: eeatSuggestions,
			details: eeatDetails,
			status: eeatScore >= 12 ? 'excellent' : eeatScore >= 8 ? 'good' : eeatScore >= 4 ? 'needs_work' : 'poor',
		});

		// =============================================
		// CALCULATE TOTALS WITH INTENT-BASED WEIGHTS
		// =============================================
		
		// Map metric names to weight keys — must match the `name`s above exactly, otherwise that
		// metric silently falls back to weight 1 and the intent weighting stops applying to it.
		const weightMap: Record<string, keyof typeof weights> = {
			'Human Expertise': 'humanExpertise',
			'Data & Citations': 'uniqueData',
			'Citability': 'citability',
			'Content Depth': 'contentDepth',
			'E-E-A-T Signals': 'eeat',
		};
		
		let weightedScore = 0;
		let totalWeight = 0;
		
		metrics.forEach((m) => {
			const weightKey = weightMap[m.name];
			const weight = weightKey ? weights[weightKey] : 1;
			
			// Weighted contribution
			const normalizedScore = (m.score / m.maxScore) * m.maxScore * weight;
			weightedScore += normalizedScore;
			totalWeight += m.maxScore * weight;
			
			// For display
			totalScore += m.score;
			maxTotalScore += m.maxScore;
		});

		// Use weighted percentage for intent-aware scoring
		const percentage = totalWeight > 0 
			? Math.round((weightedScore / totalWeight) * 100)
			: Math.round((totalScore / maxTotalScore) * 100);
		
		let overallStatus: 'excellent' | 'good' | 'needs_work' | 'poor';
		let overallMessage: string;
		
		if (percentage >= 80) {
			overallStatus = 'excellent';
			overallMessage = t('contentTools.geo.overall.excellent');
		} else if (percentage >= 60) {
			overallStatus = 'good';
			overallMessage = t('contentTools.geo.overall.good');
		} else if (percentage >= 40) {
			overallStatus = 'needs_work';
			overallMessage = t('contentTools.geo.overall.needsWork');
		} else {
			overallStatus = 'poor';
			overallMessage = t('contentTools.geo.overall.poor');
		}

		return {
			metrics,
			totalScore,
			maxTotalScore,
			percentage,
			overallStatus,
			overallMessage,
			weightedScore,
			totalWeight,
		};
	}, [content, contentStructure.geoWeights, t]);

	const getStatusColor = (status: GEOMetric['status']): string => {
		switch (status) {
			case 'excellent': return 'text-cosmic-green bg-cosmic-green/10 border-cosmic-green/30';
			case 'good': return 'text-cosmic-cyan bg-cosmic-cyan/10 border-cosmic-cyan/30';
			case 'needs_work': return 'text-amber-500 bg-amber-500/10 border-amber-500/30';
			case 'poor': return 'text-red-500 bg-red-500/10 border-red-500/30';
		}
	};

	const getScoreColor = (percentage: number): string => {
		if (percentage >= 80) return 'text-cosmic-green';
		if (percentage >= 60) return 'text-cosmic-cyan';
		if (percentage >= 40) return 'text-amber-500';
		return 'text-red-500';
	};

	// Get intent display info
	const getIntentDisplay = (intent: IntentAnalysis['intent']): { label: string; icon: string; color: string } => {
		switch (intent) {
			case 'informational':
				return { label: t('contentTools.geo.intents.informational'), icon: '📚', color: 'bg-blue-500/10 text-blue-600 border-blue-500/30' };
			case 'commercial_investigation':
				return { label: t('contentTools.geo.intents.commercialInvestigation'), icon: '🛒', color: 'bg-amber-500/10 text-amber-600 border-amber-500/30' };
			case 'transactional':
				return { label: t('contentTools.geo.intents.transactional'), icon: '💳', color: 'bg-green-500/10 text-green-600 border-green-500/30' };
			case 'navigational':
				return { label: t('contentTools.geo.intents.navigational'), icon: '🔍', color: 'bg-purple-500/10 text-purple-600 border-purple-500/30' };
		}
	};

	const intentDisplay = getIntentDisplay(intentAnalysis.intent);

	return (
		<div className="space-y-6">
			{/* Header */}
			<Card className="bg-gradient-to-r from-cosmic-purple/20 to-cosmic-cyan/20 border-cosmic-purple/30">
				<div className="flex items-center gap-4 mb-4">
					<div className="text-4xl">🤖</div>
					<div>
						<h3 className="text-xl font-bold text-gray-900">GEO - Generative Engine Optimization</h3>
						<p className="text-sm text-gray-600">
							{t('contentTools.geo.header.subtitle')}
						</p>
					</div>
				</div>
				<p className="text-xs text-gray-500 leading-relaxed">
					<Trans i18nKey="contentTools.geo.header.intro" components={{ strong: <strong /> }} />
				</p>
			</Card>

			{/* Search Intent Detection */}
			<Card className="bg-gradient-to-r from-slate-50 to-white">
				<div className="flex items-center justify-between mb-3">
					<div className="flex items-center gap-2">
						<span className="text-xl">{intentDisplay.icon}</span>
						<h4 className="font-semibold text-gray-800">{t('contentTools.geo.intent.detected')}</h4>
					</div>
					<span className={`${intentDisplay.color} border rounded-full`}>
						<Badge size="sm">
							{intentDisplay.label} ({intentAnalysis.confidence}%)
						</Badge>
					</span>
				</div>
				
				<div className="text-xs text-gray-600 mb-3">
					<strong>SubType:</strong> {intentAnalysis.subType} | 
					<strong className="ml-2">{t('contentTools.geo.intent.recommendedTone')}</strong> {t(`appPages.searchIntent.tone.${intentAnalysis.intent}`)}
				</div>

				<div className="grid grid-cols-5 gap-2 mt-3">
					{Object.entries(contentStructure.geoWeights).map(([key, weight]) => {
						const labels: Record<string, string> = {
							humanExpertise: t('contentTools.geo.intent.weightLabels.humanExpertise'),
							uniqueData: t('contentTools.geo.intent.weightLabels.uniqueData'),
							citability: t('contentTools.geo.intent.weightLabels.citability'),
							contentDepth: t('contentTools.geo.intent.weightLabels.contentDepth'),
							eeat: t('contentTools.geo.intent.weightLabels.eeat'),
						};
						const isHighPriority = weight >= 1.2;
						const isLowPriority = weight <= 0.8;
						
						return (
							<div 
								key={key}
								className={`text-center p-2 rounded-lg text-xs ${
									isHighPriority 
										? 'bg-green-50 border border-green-200' 
										: isLowPriority 
											? 'bg-gray-50 border border-gray-200' 
											: 'bg-blue-50 border border-blue-200'
								}`}
							>
								<div className="font-medium">{labels[key] || key}</div>
								<div className={`text-sm font-bold ${
									isHighPriority 
										? 'text-green-600' 
										: isLowPriority 
											? 'text-gray-400' 
											: 'text-blue-600'
								}`}>
									{weight.toFixed(1)}x
								</div>
							</div>
						);
					})}
				</div>
				
				<p className="text-xs text-gray-500 mt-3 italic">
					{t('contentTools.geo.intent.weightsNote', {
						intent: intentDisplay.label.toLowerCase(),
						factors: [
							contentStructure.geoWeights.humanExpertise > 1 ? t('contentTools.geo.intent.factorExpertise') : '',
							contentStructure.geoWeights.uniqueData > 1 ? t('contentTools.geo.intent.factorUniqueData') : '',
							contentStructure.geoWeights.eeat > 1 ? t('contentTools.geo.intent.factorEeat') : '',
						].filter(Boolean).join(t('contentTools.geo.intent.factorSeparator')),
					})}
				</p>
			</Card>

			{/* Overall Score */}
			<Card>
				<div className="text-center mb-6">
					<div className="relative w-36 h-36 mx-auto mb-4">
						<svg className="transform -rotate-90 w-36 h-36">
							<circle
								className="text-gray-200"
								cx="72"
								cy="72"
								fill="none"
								r="62"
								stroke="currentColor"
								strokeWidth="10"
							/>
							<circle
								className={getScoreColor(geoAnalysis.percentage)}
								cx="72"
								cy="72"
								fill="none"
								r="62"
								stroke="currentColor"
								strokeDasharray={`${(geoAnalysis.percentage / 100) * 390} 390`}
								strokeWidth="10"
							/>
						</svg>
						<div className="absolute inset-0 flex flex-col items-center justify-center">
							<span className={`text-4xl font-bold ${getScoreColor(geoAnalysis.percentage)}`}>
								{geoAnalysis.percentage}
							</span>
							<span className="text-xs text-gray-500">GEO Score</span>
						</div>
					</div>
					<p className={`text-sm font-medium px-4 py-2 rounded-lg ${getStatusColor(geoAnalysis.overallStatus)}`}>
						{geoAnalysis.overallMessage}
					</p>
				</div>
			</Card>

			{/* Metrics Breakdown */}
			<div className="space-y-4">
				{geoAnalysis.metrics.map((metric) => (
					<Card key={metric.name} className={`border-l-4 ${getStatusColor(metric.status)}`}>
						<div className="flex items-start justify-between gap-4 mb-3">
							<div className="flex items-center gap-3">
								<span className="text-2xl">{metric.icon}</span>
								<div>
									<h4 className="font-semibold text-gray-900">{metric.name}</h4>
									<p className="text-xs text-gray-500">{metric.description}</p>
								</div>
							</div>
							<div className="text-right">
								<div className="text-2xl font-bold text-gray-900">
									{metric.score}/{metric.maxScore}
								</div>
								<Badge
									size="sm"
									variant={metric.status === 'excellent' ? 'success' : metric.status === 'good' ? 'info' : metric.status === 'needs_work' ? 'warning' : 'error'}
								>
									{Math.round((metric.score / metric.maxScore) * 100)}%
								</Badge>
							</div>
						</div>

						{/* Progress Bar */}
						<div className="w-full bg-gray-200 rounded-full h-2 mb-3">
							<div
								style={{ width: `${(metric.score / metric.maxScore) * 100}%` }}
								className={`h-2 rounded-full transition-all ${
									metric.status === 'excellent' ? 'bg-cosmic-green' :
									metric.status === 'good' ? 'bg-cosmic-cyan' :
									metric.status === 'needs_work' ? 'bg-amber-500' : 'bg-red-500'
								}`}
							/>
						</div>

						{/* What was detected */}
						{metric.details.length > 0 && (
							<div className="mb-3 p-2 bg-green-50 rounded-lg border border-green-200">
								<p className="text-xs font-semibold text-green-700 mb-1">{t('contentTools.geo.detectedInContent')}</p>
								<ul className="space-y-0.5">
									{metric.details.map((detail, index) => (
										<li key={index} className="text-xs text-green-600 truncate">
											{detail}
										</li>
									))}
								</ul>
							</div>
						)}

						{/* Suggestions */}
						{metric.suggestions.length > 0 && (
							<div className="pt-3 border-t border-gray-200">
								<p className="text-xs font-semibold text-gray-700 mb-2">{t('contentTools.geo.howToImprove')}</p>
								<ul className="space-y-1">
									{metric.suggestions.map((suggestion, index) => (
										<li key={index} className="text-xs text-gray-600 flex items-start gap-2">
											<span className="text-amber-500">•</span>
											<span>{suggestion}</span>
										</li>
									))}
								</ul>
							</div>
						)}
					</Card>
				))}
			</div>

			{/* Quick Reference */}
			<Card className="bg-gradient-to-br from-gray-50 to-gray-100">
				<h4 className="font-bold text-gray-900 mb-3">{t('contentTools.geo.checklist.title')}</h4>
				<div className="grid md:grid-cols-2 gap-4 text-xs">
					<div className="space-y-2">
						<p className="font-semibold text-cosmic-purple">{t('contentTools.geo.checklist.keyElements')}</p>
						<ul className="space-y-1 text-gray-600">
							<li>{t('contentTools.geo.checklist.do.authorBio')}</li>
							<li>{t('contentTools.geo.checklist.do.personalExperience')}</li>
							<li>{t('contentTools.geo.checklist.do.citations')}</li>
							<li>{t('contentTools.geo.checklist.do.statistics')}</li>
							<li>{t('contentTools.geo.checklist.do.caseStudies')}</li>
							<li>{t('contentTools.geo.checklist.do.faq')}</li>
							<li>{t('contentTools.geo.checklist.do.takeaways')}</li>
							<li>{t('contentTools.geo.checklist.do.disclaimer')}</li>
						</ul>
					</div>
					<div className="space-y-2">
						<p className="font-semibold text-red-500">{t('contentTools.geo.checklist.avoid')}</p>
						<ul className="space-y-1 text-gray-600">
							<li>{t('contentTools.geo.checklist.dont.generic')}</li>
							<li>{t('contentTools.geo.checklist.dont.unsourcedStats')}</li>
							<li>{t('contentTools.geo.checklist.dont.noExamples')}</li>
							<li>{t('contentTools.geo.checklist.dont.noCredentials')}</li>
							<li>{t('contentTools.geo.checklist.dont.noTrustSignals')}</li>
							<li>{t('contentTools.geo.checklist.dont.shortContent')}</li>
						</ul>
					</div>
				</div>
			</Card>

			<Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={hideToast} />
		</div>
	);
};

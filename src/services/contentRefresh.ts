/**
 * Content Refresh Automation Service
 * 
 * Automatically identifies and refreshes outdated content
 * Now uses sitemap analysis for better identification
 */

import { supabase } from '../lib/supabaseClient';
import { generateBlogPost } from './openai';
import { getSERPAnalysis } from './dataforseo';
import { projectResearchLocale } from '../lib/seoMarkets';
import { calculateSEOScore, calculateReadability } from '../utils/seo';
import { analyzeContentForUpdates } from './sitemapAnalyzer';
import { comprehensiveFactCheck } from './factCheck';
import { sourceNeededLabel } from '../lib/contentIntegrity';
import type { Content } from '../types/database';
import type { Project } from '../types/database';
import type { TFunction } from 'i18next';

export interface ContentRefreshCandidate {
	content: Content;
	reason: 'outdated' | 'low_score' | 'competitor_improved' | 'missing_updates';
	priority: 'high' | 'medium' | 'low';
	lastUpdated: Date;
	daysSinceUpdate: number;
	suggestedChanges: string[];
}

/*
 * Suggested changes stay Italian at the source on purpose: the same strings are sent verbatim to the
 * refresh LLM prompt ("Modifiche richieste", see refreshContent) and stored in content metadata
 * (refresh_reason / suggestedChanges). They are translated only for display, via suggestedChangeLabel().
 * Covers the strings produced here and in sitemapAnalyzer; unknown strings are shown as-is.
 */
const SUGGESTED_CHANGE_KEYS = {
	'Aggiorna statistiche e dati': 'appPages.contentRefreshService.changes.updateStats',
	'Aggiungi informazioni recenti': 'appPages.contentRefreshService.changes.addRecentInfo',
	'Rivedi link esterni (potrebbero essere rotti)': 'appPages.contentRefreshService.changes.reviewExternalLinks',
	'Aggiorna esempi e case studies': 'appPages.contentRefreshService.changes.updateExamples',
	'Migliora keyword optimization': 'appPages.contentRefreshService.changes.improveKeywordOptimization',
	'Aggiungi più heading strutturati': 'appPages.contentRefreshService.changes.addStructuredHeadings',
	'Migliora internal linking': 'appPages.contentRefreshService.changes.improveInternalLinking',
	'Aggiungi meta description ottimizzata': 'appPages.contentRefreshService.changes.addMetaDescription',
	'Contenuto non aggiornato da più di 1 anno': 'appPages.contentRefreshService.changes.notUpdatedOverYear',
	'Aggiorna statistiche e dati recenti': 'appPages.contentRefreshService.changes.updateRecentStats',
	'Rivedi e aggiorna esempi e case studies': 'appPages.contentRefreshService.changes.reviewExamples',
	'Verifica che i link esterni siano ancora validi': 'appPages.contentRefreshService.changes.verifyExternalLinks',
	'Ottimizza per nuove keyword e intent di ricerca': 'appPages.contentRefreshService.changes.optimizeNewKeywords',
	'Crea nuovo contenuto per questa URL': 'appPages.contentRefreshService.changes.createForUrl',
	'URL presente in sitemap ma non nel database': 'appPages.contentRefreshService.changes.urlNotInDb',
	'URL presente in sitemap ma senza data di ultima modifica': 'appPages.contentRefreshService.changes.urlNoLastmod',
	'Migliora SEO score': 'appPages.contentRefreshService.changes.improveSeoScore',
	'Aggiungi alla sitemap se pubblicato': 'appPages.contentRefreshService.changes.addToSitemap',
	'Contenuto in bozza da più di 30 giorni - considera pubblicazione o aggiornamento': 'appPages.contentRefreshService.changes.draftOver30Days',
	'Contenuto pubblicato da più di 6 mesi - aggiorna per mantenere rilevanza': 'appPages.contentRefreshService.changes.publishedOver6Months',
	'Aggiungi fact-check dei dati': 'appPages.contentRefreshService.changes.addFactCheck',
	'Rivedi e migliora il contenuto': 'appPages.contentRefreshService.changes.reviewAndImprove',
} as const;

const DYNAMIC_SUGGESTED_CHANGES = [
	{ pattern: /^⚠️ Contenuto non aggiornato da (\d+) anni - URGENTE$/, key: 'appPages.contentRefreshService.changes.notUpdatedYearsUrgent', param: 'years' },
	{ pattern: /^⚠️ Contenuto non aggiornato da (\d+) anni$/, key: 'appPages.contentRefreshService.changes.notUpdatedYears', param: 'years' },
	{ pattern: /^⚠️ Contenuto non aggiornato dal (\d+) - URGENTE$/, key: 'appPages.contentRefreshService.changes.notUpdatedSinceUrgent', param: 'year' },
] as const;

/** Display label for a stored/prompt-side suggested change, in the current UI language. */
export const suggestedChangeLabel = (change: string, t: TFunction): string => {
	const key = (SUGGESTED_CHANGE_KEYS as Record<string, (typeof SUGGESTED_CHANGE_KEYS)[keyof typeof SUGGESTED_CHANGE_KEYS] | undefined>)[change];
	if (key) return t(key);
	for (const { pattern, key: dynamicKey, param } of DYNAMIC_SUGGESTED_CHANGES) {
		const match = change.match(pattern);
		if (match) return t(dynamicKey, { [param]: match[1] });
	}
	return change;
};

/**
 * Find content that needs refreshing
 * Uses sitemap analysis for better identification
 */
export const findContentToRefresh = async (projectId: string): Promise<ContentRefreshCandidate[]> => {
	// Get project
	const { data: project, error: projectError } = await supabase
		.from('projects')
		.select('*')
		.eq('id', projectId)
		.single();

	if (projectError) throw projectError;

	// Use sitemap analyzer if website URL is available
	if (project.website_url) {
		try {
			const sitemapCandidates = await analyzeContentForUpdates(project);
			// Convert to ContentRefreshCandidate format
			return sitemapCandidates
				.filter((c) => c.existingContent)
				.map((c) => ({
					content: c.existingContent!,
					reason: c.reason === 'outdated' ? 'outdated' : c.reason === 'low_performance' ? 'low_score' : 'outdated',
					priority: c.priority,
					lastUpdated: c.lastModified || new Date(c.existingContent!.generated_date),
					daysSinceUpdate: c.daysSinceUpdate,
					suggestedChanges: c.suggestedChanges,
				}));
		} catch (error) {
			console.warn('Sitemap analysis failed, falling back to database analysis:', error);
		}
	}

	// Fallback: database-only analysis
	const { data: contentList, error } = await supabase
		.from('content')
		.select('*')
		.eq('project_id', projectId)
		.order('generated_date', { ascending: false });

	if (error) throw error;

	const candidates: ContentRefreshCandidate[] = [];
	const now = new Date();
	const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
	const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

	contentList?.forEach((content) => {
		const generatedDate = new Date(content.generated_date);
		const daysSinceUpdate = Math.floor((now.getTime() - generatedDate.getTime()) / (1000 * 60 * 60 * 24));
		const seoScore = content.seo_score || 0;

		// Candidate 1: Outdated content (>6 months)
		if (generatedDate < sixMonthsAgo) {
			candidates.push({
				content: content as Content,
				reason: 'outdated',
				priority: generatedDate < oneYearAgo ? 'high' : 'medium',
				lastUpdated: generatedDate,
				daysSinceUpdate,
				suggestedChanges: [
					'Aggiorna statistiche e dati',
					'Aggiungi informazioni recenti',
					'Rivedi link esterni (potrebbero essere rotti)',
					'Aggiorna esempi e case studies',
				],
			});
		}

		// Candidate 2: Low SEO score
		if (seoScore < 50) {
			candidates.push({
				content: content as Content,
				reason: 'low_score',
				priority: seoScore < 30 ? 'high' : 'medium',
				lastUpdated: generatedDate,
				daysSinceUpdate,
				suggestedChanges: [
					'Migliora keyword optimization',
					'Aggiungi più heading strutturati',
					'Migliora internal linking',
					'Aggiungi meta description ottimizzata',
				],
			});
		}
	});

	// Sort by priority
	candidates.sort((a, b) => {
		const priorityOrder = { high: 3, medium: 2, low: 1 };
		return priorityOrder[b.priority] - priorityOrder[a.priority];
	});

	return candidates;
};

/**
 * How a refresh may touch facts: suggested changes such as "Aggiorna statistiche e dati" must never
 * be read as "write new numbers" — the refresh has no verified data, so outdated figures are removed
 * or flagged with a visible placeholder for the author.
 */
export const REFRESH_DATA_RULE = (language: string): string =>
	`DATA RULE FOR THIS REFRESH: you have NO new verified data. "Update statistics/data/examples" means: keep figures that are still clearly valid with their original source, and remove or replace every outdated or unsourced figure, study, example or case study with a visible placeholder "[${sourceNeededLabel(language)}: …]" in the article's language. Never write new numbers, dates of studies, sources or case studies.`;

/**
 * Refresh a single content piece
 */
export const refreshContent = async (
	content: Content,
	project: Project,
	changes?: string[]
): Promise<Content> => {
	const primaryKeyword = content.keywords_used?.[0] || content.topic || '';
	
	// Get updated SERP analysis
	const { locationCode } = projectResearchLocale(project);
	const serpResults = await getSERPAnalysis(primaryKeyword, locationCode, project.language, 5);
	
	const serpContext = serpResults.length > 0
		? `\n\nAnalisi SERP aggiornata (Top ${serpResults.length} risultati):\n${serpResults
				.map((r, index) => `${index + 1}. ${r.title}\n   ${r.description}`)
				.join('\n')}\n\nAggiorna il contenuto per superare questi competitor.`
		: '';

	// Generate refreshed content with real author info
	const generatedBody = await generateBlogPost({
		topic: content.topic || content.title,
		primaryKeyword,
		tone: project.tone,
		length: project.content_length,
		language: project.language,
		serpContext: `Contenuto originale da aggiornare:\n${content.body.substring(0, 500)}...\n\n${serpContext}\n\n${
			changes ? `Modifiche richieste: ${changes.join(', ')}` : 'Migliora la qualità e la completezza.'
		}\n\n${REFRESH_DATA_RULE(project.language)}`,
		// Pass real author info from project settings
		authorName: project.author_name ?? undefined,
		authorBio: project.author_bio ?? undefined,
		authorExpertise: project.author_expertise ?? undefined,
	});

	// Fact-check the refreshed article (whole text): unverified claims become visible placeholders.
	let refreshedBody = generatedBody;
	let factCheckMeta: Record<string, unknown> = { fact_checked: false, fact_check_warning: 'Fact-check did not run' };
	try {
		const check = await comprehensiveFactCheck(generatedBody, true, {
			language: project.language,
			trustedTerms: project.author_name ? [project.author_name] : [],
		});
		refreshedBody = check.correctedContent;
		factCheckMeta = check.checkFailed
			? { fact_checked: false, fact_check_warning: (check.warnings ?? ['Fact-check incomplete']).join(' ') }
			: { fact_checked: true };
	} catch (error) {
		console.warn('Refresh fact-check failed:', error);
		factCheckMeta = { fact_checked: false, fact_check_warning: `Fact-check failed: ${error instanceof Error ? error.message : String(error)}` };
	}

	// Calculate new scores
	const newSeoScore = calculateSEOScore(refreshedBody, primaryKeyword);
	const newReadabilityScore = calculateReadability(refreshedBody);

	// Update content
	const { data: updatedContent, error } = await supabase
		.from('content')
		.update({
			body: refreshedBody,
			seo_score: newSeoScore,
			readability_score: newReadabilityScore,
			updated_at: new Date().toISOString(),
			metadata: {
				...(content.metadata ?? {}),
				refreshed_at: new Date().toISOString(),
				original_score: content.seo_score,
				refresh_reason: changes?.join(', ') || 'outdated',
				...factCheckMeta,
			},
		})
		.eq('id', content.id)
		.select()
		.single();

	if (error) throw error;

	return updatedContent as Content;
};


/**
 * Content Agent Service
 * 
 * AI Agent that automatically generates content for clusters in the background.
 * Works autonomously and proposes content for human approval (human-in-the-loop).
 * 
 * Inspired by agentic AI patterns where the system works proactively.
 */

import { generateBlogPost } from './openai';
import { getSERPAnalysis } from './dataforseo';
import { projectResearchLocale } from '../lib/seoMarkets';
import { cleanKeyword } from '../utils/keywords';
import { generateSEOSlug } from '../utils/slug';
import { complete } from './openrouter';
import { isProxyEnabled, proxyFetchPage } from './edgeProxy';
import { findAllRelevantLinks, insertInternalLinks, getProjectSiteUrl } from './internalLinking';
import { insertImagesIntoContent, hasImages } from './imageService';
import { 
	comprehensiveFactCheck, 
	factCheckWithPerplexity,
	getResearchContext,
	appendSourcesToContent,
	type FactCheckResult,
	type ResearchResult,
} from './factCheck';
import { isPerplexityAvailable } from './perplexity';
import { sourceNeededLabel } from '../lib/contentIntegrity';
import { detectSearchIntent } from '../utils/searchIntent';
import type { Project } from '../types/database';
import type { TopicalMapCluster } from './siteAnalysis';

/**
 * Outcome of the post-generation fact-check, reported to the caller so `fact_checked` reflects what
 * really happened: ok=false when the check threw or a verification step could not run.
 */
export interface FactCheckStatus {
	ok: boolean;
	claimsFound: number;
	claimsReplaced: number;
	warning?: string;
}

/** Map a fact-check result (or the error it threw) to the status stored on the content. */
export const toFactCheckStatus = (result: FactCheckResult | null, error?: unknown): FactCheckStatus => {
	if (!result) {
		const reason = error instanceof Error ? error.message : error ? String(error) : 'not run';
		return { ok: false, claimsFound: 0, claimsReplaced: 0, warning: `Fact-check failed: ${reason}` };
	}
	return {
		ok: !result.checkFailed,
		claimsFound: result.claimsFound,
		claimsReplaced: result.claimsRemoved,
		...(result.checkFailed ? { warning: (result.warnings ?? ['Fact-check incomplete']).join(' ') } : {}),
	};
};

/** Real names configured on the project that the fact-check must not flag (e.g. the author). */
const projectTrustedTerms = (project: Project): string[] =>
	[project.author_name].filter((t): t is string => typeof t === 'string' && t.trim().length > 0);

/** DataForSEO location for a project — from its market (DB default IT=2380; 2826 is the UK). */
const projectLocationCode = (project: Project): number =>
	projectResearchLocale(project).locationCode;

export interface ContentProposal {
	id: string;
	projectId: string;
	clusterName: string;
	clusterKeywords: string[];
	primaryKeyword: string; // Keyword principale rilevante
	searchVolume?: number; // Volume di ricerca da DataforSEO
	difficulty?: number; // Difficulty della keyword
	title: string;
	slug: string;
	body: string;
	seoScore: number;
	readabilityScore: number;
	status: 'pending' | 'approved' | 'rejected' | 'modified' | 'archived';
	generatedAt: string;
	scheduledDate?: string; // Data quando viene aggiunta al calendario
	metadata: {
		tone?: string;
		length?: number;
		keywordsUsed?: string[];
		serpAnalysis?: Array<{ title: string; url: string; description: string }>;
		keywordDataLoading?: boolean;
		keywordDataSource?: string;
		keywordDataLoadFailed?: boolean;
		needsContentGeneration?: boolean;
		clusterName?: string;
		clusterSearchVolume?: number;
		clusterDifficulty?: number;
		clusterPriority?: 'high' | 'medium' | 'low';
	};
}

export interface AgentStatus {
	isRunning: boolean;
	currentTask: string | null;
	completedTasks: number;
	totalTasks: number;
	errors: Array<{ timestamp: string; message: string }>;
}

class ContentAgent {
	private isRunning = false;
	private currentTask: string | null = null;
	private completedTasks = 0;
	private totalTasks = 0;
	private errors: Array<{ timestamp: string; message: string }> = [];
	private activeJobs: Map<string, AbortController> = new Map();

	/**
	 * Start generating content for selected clusters
	 */
	async startGeneration(
		project: Project,
		clusters: TopicalMapCluster[],
		onProposalGenerated: (proposal: ContentProposal) => Promise<void>,
		onStatusUpdate?: (status: AgentStatus) => void
	): Promise<void> {
		if (this.isRunning) {
			throw new Error('Agent is already running');
		}

		this.isRunning = true;
		this.completedTasks = 0;
		this.totalTasks = clusters.length;
		this.errors = [];

		try {
			// Process clusters sequentially to avoid rate limits
			for (const cluster of clusters) {
				if (!this.isRunning) break; // Allow cancellation

				const jobId = `cluster-${cluster.name}-${Date.now()}`;
				const abortController = new AbortController();
				this.activeJobs.set(jobId, abortController);

				this.currentTask = `Generando proposta per: ${cluster.name}`;
				this.updateStatus(onStatusUpdate);

				try {
					const proposal = await this.generateContentForCluster(project, cluster, abortController.signal);
					
					if (proposal && !abortController.signal.aborted) {
						// Save proposal immediately with minimal data
						await onProposalGenerated(proposal);
						
						// Load keyword data in background and update proposal
						this.loadKeywordDataInBackground(proposal, project, onProposalGenerated).catch((error) => {
							console.error('Error loading keyword data in background:', error);
						});
						
						this.completedTasks++;
					}
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					this.errors.push({
						timestamp: new Date().toISOString(),
						message: `Error generating content for ${cluster.name}: ${errorMessage}`,
					});
					console.error(`Error generating content for cluster ${cluster.name}:`, error);
				} finally {
					this.activeJobs.delete(jobId);
					this.currentTask = null;
					this.updateStatus(onStatusUpdate);

					// Rate limiting: wait 5 seconds between generations
					if (this.isRunning && clusters.indexOf(cluster) < clusters.length - 1) {
						await this.delay(5000);
					}
				}
			}
		} finally {
			this.isRunning = false;
			this.currentTask = null;
			this.updateStatus(onStatusUpdate);
		}
	}

	/**
	 * Generate content for a single cluster
	 * Public method for external use (e.g., resuming jobs)
	 */
	async generateContentForCluster(
		project: Project,
		cluster: TopicalMapCluster,
		signal: AbortSignal
	): Promise<ContentProposal | null> {
		if (signal.aborted) return null;

		try {
		// Select primary keyword from cluster (highest volume or first)
		// Clean the keyword to remove prefixes like "Aggiornamento:", "Guida:", etc.
		const rawKeyword = cluster.keywords[0] || cluster.name;
		const primaryKeyword = cleanKeyword(rawKeyword);
			console.log('Generating content for keyword:', primaryKeyword, '(raw:', rawKeyword, ')');

			// Step 1: Generate title FIRST (fast operation)
		console.log('Generating proposal title with OpenAI...');
		let title = cluster.name;
		let slug = '';
		
		try {
			// Get current year dynamically
			const currentYear = new Date().getFullYear();
			
			// Generate a good title for the proposal
			const titlePrompt = `Sei un esperto SEO. Genera SOLO un titolo ottimizzato per SEO (max 60 caratteri) per un articolo su "${cluster.name}" con keyword principale "${primaryKeyword}".

📅 ANNO CORRENTE: ${currentYear} - Se il titolo include un anno, usa SEMPRE ${currentYear}, MAI anni passati (2023, 2024).

Requisiti:
- Ottimizzato per SEO
- Attraente e clickable
- Max 60 caratteri
- In italiano
- Include la keyword principale se possibile
- Se menzioni un anno, usa ${currentYear}

Rispondi SOLO con il titolo, senza altre spiegazioni.`;

			if (isProxyEnabled()) {
				const generatedTitle = (await complete(
					[{ role: 'user', content: titlePrompt }],
					{
						model: 'openai/gpt-4o-mini',
						systemPrompt: `Sei un esperto SEO. Genera solo titoli ottimizzati. L'anno corrente è ${currentYear}.`,
						temperature: 0.7,
						maxTokens: 50,
					}
				))?.trim();
				if (generatedTitle && generatedTitle.length > 0) {
					title = generatedTitle.replace(/^["']|["']$/g, '').trim(); // Remove quotes if present
					if (title.length > 60) {
						title = title.substring(0, 57) + '...';
					}
				}
			}
		} catch (error) {
			console.warn('Error generating title, using cluster name:', error);
			// Use cluster name as fallback
		}

		// Generate SEO-optimized slug from title
		// Best practices: 3-5 parole, solo keywords importanti, no stop words
		slug = generateSEOSlug(title, cluster.keywords[0], 5, 60);
		console.log(`📝 Generated SEO slug: "${slug}" (from title: "${title}")`);

		console.log('Proposal title generated:', title);

		if (signal.aborted) return null;

			// Step 2: Create proposal with cluster data (searchVolume and difficulty from topical map)
			// The cluster already has real DataforSEO data from generateTopicalMap
			const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
			
			// Use cluster data as initial values - these come from DataforSEO via generateTopicalMap
			// searchVolume in cluster is the total for all keywords, difficulty is the average
			const initialSearchVolume = cluster.searchVolume || undefined;
			const initialDifficulty = cluster.difficulty || undefined;
			
			console.log('Creating proposal with cluster data:', {
				clusterName: cluster.name,
				searchVolume: initialSearchVolume,
				difficulty: initialDifficulty,
			});
			
			const initialProposal: ContentProposal = {
				id: proposalId,
			projectId: project.id,
			clusterName: cluster.name,
			clusterKeywords: cluster.keywords,
				primaryKeyword,
				searchVolume: initialSearchVolume, // Use cluster data (total volume from DataforSEO)
				difficulty: initialDifficulty, // Use cluster data (avg difficulty from DataforSEO)
			title,
			slug,
			body: '', // Empty body - will be generated when user clicks "Genera Ora"
				seoScore: 0,
				readabilityScore: 0,
			status: 'pending',
			generatedAt: new Date().toISOString(),
			metadata: {
				tone: project.tone,
				length: project.content_length,
				keywordsUsed: cluster.keywords.slice(0, 5),
					serpAnalysis: [], // Will be loaded in background
					// If we have cluster data, mark as loaded; otherwise loading in background
					keywordDataLoading: !initialSearchVolume && !initialDifficulty,
				needsContentGeneration: true,
				clusterName: cluster.name,
					// Store cluster-level metrics
					clusterSearchVolume: cluster.searchVolume,
					clusterDifficulty: cluster.difficulty,
					clusterPriority: cluster.priority,
			},
		};

			// Return immediately - keyword data will be loaded in background
			return initialProposal;
		} catch (error) {
			console.error('Error in generateContentForCluster:', error);
			if (error instanceof Error) {
				throw new Error(`Errore nella generazione del contenuto: ${error.message}`);
			}
			throw new Error('Errore sconosciuto nella generazione del contenuto');
		}
	}

	/**
	 * Generate a single proposal (public method)
	 */
	async generateSingleProposal(
		project: Project,
		cluster: TopicalMapCluster,
		onProposalGenerated: (proposal: ContentProposal) => Promise<void>
	): Promise<ContentProposal> {
		try {
			const abortController = new AbortController();
			const proposal = await this.generateContentForCluster(project, cluster, abortController.signal);
			
			if (!proposal) {
				throw new Error('Failed to generate proposal');
			}

			// Save proposal before returning
			await onProposalGenerated(proposal);
			return proposal;
		} catch (error) {
			console.error('Error in generateSingleProposal:', error);
			if (error instanceof Error) {
				throw new Error(`Errore nella generazione: ${error.message}`);
			}
			throw new Error('Errore sconosciuto nella generazione della proposta');
		}
	}

	/**
	 * Generate full content for an approved proposal
	 * Called when user clicks "Genera Ora" in calendar
	 * 
	 * ENHANCED PIPELINE WITH PERPLEXITY:
	 * 1. PRE-RESEARCH: Raccolta fatti verificati con Perplexity (NUOVO!)
	 * 2. SERP Analysis: Analisi competitor
	 * 3. CONTENT GENERATION: GPT-4o con contesto verificato
	 * 4. FACT-CHECK: Verifica post-generazione con Perplexity
	 * 5. INTERNAL LINKS: Link interni
	 * 6. IMAGES: Inserimento immagini
	 * 7. SOURCES: Aggiunta sezione fonti per E-E-A-T (NUOVO!)
	 */
	async generateFullContent(
		proposal: ContentProposal,
		project: Project,
		onProgress?: (status: string) => void,
		onFactCheck?: (status: FactCheckStatus) => void
	): Promise<string> {
		try {
			// Track research for sources section
			let research: ResearchResult | null = null;
			let factCheckResult: FactCheckResult | null = null;
			
			// Step 1: PRE-GENERATION RESEARCH with Perplexity
			// This is the KEY to preventing hallucinations - we give GPT REAL facts to use
			let researchContext = '';
			if (isPerplexityAvailable()) {
				onProgress?.('🔬 Ricerca fatti verificati con Perplexity...');
				try {
					const researchResult = await getResearchContext(
						proposal.clusterName,
						proposal.clusterKeywords.slice(0, 5),
						project.language
					);
					research = researchResult.research;
					researchContext = researchResult.promptContext;
					
					console.log('✅ Pre-research complete:', {
						facts: research.verifiedFacts.length,
						statistics: research.statistics.length,
						sources: research.sources.length,
					});
				} catch (error) {
					console.warn('Pre-research failed, continuing without:', error);
				}
			} else {
				console.log('⚠️ Perplexity not available, skipping pre-research');
			}
			
			// Step 2: Analyze SERP
			onProgress?.('📊 Analisi SERP...');
			let serpResults: Array<{ title: string; url: string; description: string }> = [];
			try {
				serpResults = await getSERPAnalysis(
					proposal.primaryKeyword,
					projectLocationCode(project),
					project.language,
					5
				);
			} catch (error) {
				console.warn('Error in SERP analysis, continuing without SERP data:', error);
			}

			// Step 3: Generate content with VERIFIED CONTEXT from Perplexity + SERP insights
			onProgress?.('✍️ Generazione contenuto con OpenAI (GPT-4o)...');
			const serpContext = serpResults.length > 0
				? `\n\nAnalisi SERP (Top ${serpResults.length} risultati):\n${serpResults
						.map((r, index) => `${index + 1}. ${r.title}\n   ${r.description}`)
					.join('\n')}\n\nCrea contenuto che superi questi competitor in qualità, completezza e valore per l'utente.`
				: '';
			
			// Combine verified research context with SERP context
			const fullContext = researchContext 
				? `${researchContext}\n\n${serpContext}`
				: serpContext;

		let content = await generateBlogPost({
			topic: proposal.clusterName,
			primaryKeyword: proposal.primaryKeyword,
			tone: project.tone,
			length: project.content_length,
			language: project.language,
			serpContext: fullContext, // Now includes verified facts from Perplexity!
			useAdvancedModel: true, // Use GPT-4o for GEO-optimized content
			// Pass real author info from project settings
			authorName: project.author_name ?? undefined,
			authorBio: project.author_bio ?? undefined,
			authorExpertise: project.author_expertise ?? undefined,
		});

		if (!content || content.trim().length === 0) {
			throw new Error('OpenAI ha restituito contenuto vuoto');
		}

		// Step 4: FACT-CHECK with Perplexity verification (whole article; unverified claims → placeholders)
		onProgress?.('🔍 Fact-checking del contenuto...');
		const factCheckOptions = { language: project.language, trustedTerms: projectTrustedTerms(project) };
		try {
			// Use enhanced fact-check with Perplexity if available
			if (isPerplexityAvailable()) {
				const result = await factCheckWithPerplexity(content, proposal.clusterName, factCheckOptions);
				factCheckResult = result;
				
				if (result.claimsRemoved > 0) {
					console.log(`🔍 Fact-check (Perplexity): ${result.claimsRemoved} elementi non verificabili sostituiti con un placeholder`);
					content = result.correctedContent;
				} else {
					console.log('✅ Fact-check: Nessun elemento sospetto trovato');
				}
			} else {
				// Fallback to pattern-based + AI
				const result = await comprehensiveFactCheck(content, true, factCheckOptions);
				factCheckResult = result;
				
				if (result.claimsRemoved > 0) {
					console.log(`🔍 Fact-check (pattern): ${result.claimsRemoved} elementi non verificabili sostituiti con un placeholder`);
					content = result.correctedContent;
				}
			}
			onFactCheck?.(toFactCheckStatus(factCheckResult));
		} catch (error) {
			// The article is NOT fact-checked: report it (fact_checked=false + warning), never pretend.
			console.warn('Fact-check failed, continuing with original content:', error);
			onFactCheck?.(toFactCheckStatus(null, error));
		}

		// Step 5: Insert internal links
			// LEVEL 1: Link to other content in the same project (always works!)
			// LEVEL 2: Link to pages on the project's website (if configured)
			onProgress?.('Inserimento link interni...');
			try {
				const siteUrl = await getProjectSiteUrl(project.id);
				const keywords = [proposal.primaryKeyword, ...proposal.clusterKeywords.slice(0, 5)];
				
				// Find all relevant links (from project content + sitemap)
				const relevantLinks = await findAllRelevantLinks(
					project.id,
					null, // currentContentId - not saved yet
					siteUrl,
					keywords,
					content,
					5
				);
				
				if (relevantLinks.length > 0) {
					console.log(`Found ${relevantLinks.length} relevant internal links`);
					content = insertInternalLinks(content, relevantLinks);
				} else {
					console.log('No relevant internal links found');
				}
			} catch (error) {
				console.warn('Error inserting internal links, continuing without:', error);
			}

			// Step 6: Insert copyright-free images
			onProgress?.('🖼️ Inserimento immagini...');
			try {
				// Only insert images if content doesn't already have them
				if (!hasImages(content)) {
					content = await insertImagesIntoContent(
						content,
						proposal.primaryKeyword,
						project.language
					);
					console.log('Images inserted successfully');
				} else {
					console.log('Content already has images, skipping image insertion');
				}
			} catch (error) {
				console.warn('Error inserting images, continuing without:', error);
			}

			// Step 7: Add Sources section for E-E-A-T (NEW!)
			// Only add sources for informational/educational content with enough verified sources
			if (research || factCheckResult?.verifiedSources) {
				onProgress?.('📚 Aggiunta sezione fonti...');
				try {
					// Detect intent to decide if sources section makes sense
					const intentAnalysis = detectSearchIntent(proposal.title || proposal.primaryKeyword);
					const intent = intentAnalysis.intent as 'informational' | 'commercial_investigation' | 'transactional' | 'navigational';
					
					// Only add sources for informational and commercial_investigation intents
					if (intent === 'informational' || intent === 'commercial_investigation') {
						content = appendSourcesToContent(
							content,
							research,
							factCheckResult,
							intent,
							project.language
						);
						console.log('Sources section added for E-E-A-T');
					} else {
						console.log(`Skipping sources section for ${intent} intent`);
					}
				} catch (error) {
					console.warn('Error adding sources section:', error);
				}
			}

			onProgress?.('✅ Contenuto generato con successo!');
			return content;
		} catch (error) {
			console.error('Error generating full content:', error);
			if (error instanceof Error) {
				throw new Error(`Errore nella generazione del contenuto: ${error.message}`);
			}
			throw new Error('Errore sconosciuto nella generazione del contenuto');
		}
	}

	/**
	 * Generate refreshed content for a content update proposal
	 * Fetches original content, analyzes it, and creates an improved version
	 * with fact-checking, GEO optimization, and SEO optimization
	 * 
	 * ENHANCED WITH PERPLEXITY:
	 * - Pre-research for updated facts
	 * - Perplexity-powered fact-check
	 * - Sources section for E-E-A-T
	 */
	async generateRefreshContent(
		proposal: ContentProposal,
		project: Project,
		onProgress?: (status: string) => void,
		onFactCheck?: (status: FactCheckStatus) => void
	): Promise<string> {
		try {
			const metadata = proposal.metadata as Record<string, unknown>;
			const originalUrl = metadata['originalUrl'] as string | undefined;
			const originalBody = metadata['originalBody'] as string | undefined;
			const suggestedChanges = metadata['suggestedChanges'] as string[] | undefined;
			const refreshReason = metadata['refreshReason'] as string | undefined;
			
			// Track research for sources section
			let research: ResearchResult | null = null;
			let factCheckResult: FactCheckResult | null = null;
			
			onProgress?.('📄 Analisi contenuto originale...');
			
			// Step 1: Fetch original content from URL if available
			let fetchedContent = '';
			if (originalUrl) {
				try {
					fetchedContent = await this.fetchContentFromUrl(originalUrl);
					console.log('Fetched original content:', fetchedContent.length, 'chars');
				} catch (error) {
					console.warn('Could not fetch original content from URL:', error);
					// Fall back to stored original body
				}
			}
			
			// Use fetched content or fall back to stored original
			const existingContent = fetchedContent || originalBody || '';
			
			// Step 1.5: PRE-RESEARCH with Perplexity for updated facts
			let researchContext = '';
			if (isPerplexityAvailable()) {
				onProgress?.('🔬 Ricerca fatti aggiornati con Perplexity...');
				try {
					const researchResult = await getResearchContext(
						proposal.clusterName.replace('Aggiornamento: ', ''),
						proposal.clusterKeywords.slice(0, 5),
						project.language
					);
					research = researchResult.research;
					researchContext = researchResult.promptContext;
					
					console.log('✅ Pre-research for refresh complete:', {
						facts: research.verifiedFacts.length,
						statistics: research.statistics.length,
					});
				} catch (error) {
					console.warn('Pre-research failed:', error);
				}
			}
			
			// Step 2: Analyze SERP for current competitors
			onProgress?.('📊 Analisi SERP e competitor...');
			let serpResults: Array<{ title: string; url: string; description: string }> = [];
			try {
				serpResults = await getSERPAnalysis(
					proposal.primaryKeyword,
					projectLocationCode(project),
					project.language,
					5
				);
			} catch (error) {
				console.warn('Error in SERP analysis:', error);
			}
			
			// Step 3: Perform fact-checking analysis on original content
			onProgress?.('🔍 Fact-checking e verifica dati...');
			const factCheckAnalysis = this.analyzeContentForFactCheck(existingContent);
			
			// Step 4: Generate refreshed content
			onProgress?.('Generazione contenuto aggiornato con GEO e SEO...');
			
			const currentYear = new Date().getFullYear();
			const serpContext = serpResults.length > 0
				? `\n\n📊 ANALISI SERP ATTUALE (Top ${serpResults.length} risultati):\n${serpResults
						.map((r, index) => `${index + 1}. ${r.title}\n   ${r.description}`)
					.join('\n')}\n\nSuperare questi competitor in qualità, completezza e valore.`
				: '';
			
			// Build refresh prompt with verified research context
		const refreshPrompt = `🔄 AGGIORNAMENTO CONTENUTO ESISTENTE

📝 CONTENUTO ORIGINALE DA AGGIORNARE:
${existingContent.substring(0, 3000)}${existingContent.length > 3000 ? '...' : ''}

📅 ANNO CORRENTE: ${currentYear}

🔍 MOTIVO AGGIORNAMENTO: ${refreshReason || 'outdated'}

📋 MODIFICHE SUGGERITE:
${suggestedChanges?.map((c, i) => `${i + 1}. ${c}`).join('\n') || '- Rivedi dati e statistiche (senza inventarne di nuovi)\n- Migliora SEO e leggibilità'}

🔬 ANALISI FACT-CHECK:
${factCheckAnalysis}

${researchContext ? `\n${researchContext}\n` : ''}

${serpContext}

📢 ISTRUZIONI:
1. RISCRIVI completamente il contenuto mantenendo il topic principale
2. AGGIORNA i riferimenti temporali a ${currentYear}. Statistiche e dati: aggiornali SOLO con i fatti verificati forniti sopra (con la loro fonte); un dato obsoleto senza sostituto verificato va rimosso o sostituito con un placeholder visibile "[${sourceNeededLabel(project.language)}: …]". MAI scrivere numeri nuovi non forniti.
3. CORREGGI eventuali informazioni obsolete o errate identificate nel fact-check
4. ${researchContext ? 'USA SOLO i FATTI VERIFICATI forniti sopra per statistiche e citazioni' : 'Nessun dato verificato fornito: niente statistiche o citazioni nuove, usa placeholder dove servono'}
5. OTTIMIZZA per GEO (Generative Engine Optimization):
   - Cita solo le fonti verificate fornite sopra; altrimenti un placeholder "[${sourceNeededLabel(project.language)}: …]"
   - Dati e statistiche solo dai fatti verificati forniti, con la loro fonte
   - Struttura con schema markup friendly (FAQ, How-to, etc.)
   - Rispondi a domande specifiche che gli utenti potrebbero fare
6. OTTIMIZZA per SEO tradizionale:
   - Keyword principale: "${proposal.primaryKeyword}"
   - Usa heading gerarchici (H2, H3)
   - Meta description ottimizzata
   - Internal linking suggestions
7. MIGLIORA la leggibilità e l'engagement
8. NON menzionare che questo è un aggiornamento nel testo
9. NON inventare nomi, studi o statistiche non verificabili

Il risultato deve essere un articolo completo, moderno e autorevole.`;

		// For content updates, use the ORIGINAL TITLE for intent detection
		// The title is more indicative of the actual intent than the keyword
		// Example: keyword "Carte Mediolanum" looks navigational, but title 
		// "Carte Mediolanum a confronto: caratteristiche e costi" is clearly commercial_investigation
		const originalTitle = proposal.title?.replace(/^🔄\s*/, '').replace(/^Aggiornamento:\s*/i, '') || '';
		
		let content = await generateBlogPost({
			topic: proposal.clusterName.replace('Aggiornamento: ', ''),
			primaryKeyword: proposal.primaryKeyword,
			tone: project.tone,
			length: project.content_length,
			language: project.language,
			serpContext: refreshPrompt,
			useAdvancedModel: true, // Use GPT-4o for best quality
			intentSource: originalTitle, // Use title for intent detection in content updates
			// Pass real author info from project settings
			authorName: project.author_name ?? undefined,
			authorBio: project.author_bio ?? undefined,
			authorExpertise: project.author_expertise ?? undefined,
		});

			if (!content || content.trim().length === 0) {
				throw new Error('OpenAI ha restituito contenuto vuoto');
			}

			// Step 5: Fact-check refreshed content with Perplexity
			onProgress?.('🔍 Verifica contenuto aggiornato...');
			const factCheckOptions = { language: project.language, trustedTerms: projectTrustedTerms(project) };
			try {
				if (isPerplexityAvailable()) {
					const result = await factCheckWithPerplexity(content, proposal.clusterName, factCheckOptions);
					factCheckResult = result;
					
					if (result.claimsRemoved > 0) {
						console.log(`🔍 Fact-check refresh: ${result.claimsRemoved} elementi sostituiti con un placeholder`);
						content = result.correctedContent;
					}
				} else {
					const result = await comprehensiveFactCheck(content, true, factCheckOptions);
					factCheckResult = result;
					if (result.claimsRemoved > 0) {
						content = result.correctedContent;
					}
				}
				onFactCheck?.(toFactCheckStatus(factCheckResult));
			} catch (error) {
				console.warn('Fact-check failed:', error);
				onFactCheck?.(toFactCheckStatus(null, error));
			}

			// Step 6: Insert internal links
			onProgress?.('🔗 Inserimento link interni...');
			try {
				const siteUrl = await getProjectSiteUrl(project.id);
				const keywords = [proposal.primaryKeyword, ...proposal.clusterKeywords.slice(0, 5)];
				
				const relevantLinks = await findAllRelevantLinks(
					project.id,
					null,
					siteUrl,
					keywords,
					content,
					5
				);
				
				if (relevantLinks.length > 0) {
					console.log(`Found ${relevantLinks.length} relevant internal links for refreshed content`);
					content = insertInternalLinks(content, relevantLinks);
				}
			} catch (error) {
				console.warn('Error inserting internal links:', error);
			}

			// Step 7: Insert images
			onProgress?.('🖼️ Inserimento immagini...');
			try {
				if (!hasImages(content)) {
					content = await insertImagesIntoContent(
						content,
						proposal.primaryKeyword,
						project.language
					);
				}
			} catch (error) {
				console.warn('Error inserting images:', error);
			}

			// Step 8: Add Sources section for E-E-A-T
			if (research || factCheckResult?.verifiedSources) {
				onProgress?.('📚 Aggiunta sezione fonti...');
				try {
					const intentAnalysis = detectSearchIntent(proposal.title || proposal.primaryKeyword);
					const intent = intentAnalysis.intent as 'informational' | 'commercial_investigation' | 'transactional' | 'navigational';
					
					if (intent === 'informational' || intent === 'commercial_investigation') {
						content = appendSourcesToContent(
							content,
							research,
							factCheckResult,
							intent,
							project.language
						);
						console.log('Sources section added to refreshed content');
					}
				} catch (error) {
					console.warn('Error adding sources section:', error);
				}
			}

			onProgress?.('✅ Contenuto aggiornato con successo!');
			return content;
		} catch (error) {
			console.error('Error generating refresh content:', error);
			if (error instanceof Error) {
				throw new Error(`Errore nell'aggiornamento del contenuto: ${error.message}`);
			}
			throw new Error('Errore sconosciuto nell\'aggiornamento del contenuto');
		}
	}

	/**
	 * Fetch content from a URL server-side, through this install's own seo-proxy.
	 */
	private async fetchContentFromUrl(url: string): Promise<string> {
		const page = await proxyFetchPage(url);
		if (!page.ok || !page.body) throw new Error('Could not fetch content from URL');
		return this.extractTextFromHtml(page.body);
	}

	/**
	 * Extract readable text content from HTML
	 */
	private extractTextFromHtml(html: string): string {
		// Remove scripts, styles, and other non-content elements
		let text = html
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
			.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
			.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
			.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
			.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '');

		// Try to extract main content area
		const mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
			text.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
			text.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
		
		if (mainMatch && mainMatch[1] !== undefined) {
			text = mainMatch[1];
		}

		// Convert HTML to plain text
		text = text
			.replace(/<h[1-6][^>]*>/gi, '\n\n## ')
			.replace(/<\/h[1-6]>/gi, '\n')
			.replace(/<p[^>]*>/gi, '\n')
			.replace(/<\/p>/gi, '\n')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<li[^>]*>/gi, '\n• ')
			.replace(/<\/li>/gi, '')
			.replace(/<[^>]+>/g, '') // Remove remaining tags
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/\n\s*\n\s*\n/g, '\n\n') // Reduce multiple newlines
			.trim();

		return text;
	}

	/**
	 * Analyze content for fact-checking issues
	 */
	private analyzeContentForFactCheck(content: string): string {
		if (!content || content.length < 100) {
			return 'Contenuto originale non disponibile per fact-check.';
		}

		const issues: string[] = [];
		const currentYear = new Date().getFullYear();

		// Check for old years
		const yearMatches = content.match(/\b20\d{2}\b/g);
		if (yearMatches) {
			const oldYears = [...new Set(yearMatches)].filter(y => parseInt(y) < currentYear - 1);
			if (oldYears.length > 0) {
				issues.push(`⚠️ Riferimenti a anni passati: ${oldYears.join(', ')} - Aggiornare solo con dati verificati forniti, altrimenti segnalare con un placeholder`);
			}
		}

		// Check for outdated statistics patterns
		const statPatterns = [
			{ pattern: /\b(\d+(?:\.\d+)?)\s*(?:milioni?|miliardi?)/gi, label: 'statistiche numeriche' },
			{ pattern: /\b(\d+(?:\.\d+)?)%/g, label: 'percentuali' },
			{ pattern: /secondo\s+(?:un\s+)?(?:studio|ricerca|report)/gi, label: 'riferimenti a studi' },
		];

		for (const { pattern, label } of statPatterns) {
			const matches = content.match(pattern);
			if (matches && matches.length > 2) {
				issues.push(`📊 Trovate ${matches.length} ${label} - Verificare attualità delle fonti (non sostituirle con numeri nuovi non verificati)`);
			}
		}

		// Check for missing sources
		if (content.length > 1500 && !content.includes('http') && !content.includes('fonte')) {
			issues.push('📚 Contenuto lungo senza link a fonti - Citare solo fonti verificate fornite, altrimenti un placeholder "fonte necessaria"');
		}

		// Check for potential outdated terminology
		const outdatedTerms = [
			{ old: 'coronavirus', suggestion: 'COVID-19 o post-pandemia' },
			{ old: 'nel 2020', suggestion: 'dati più recenti' },
			{ old: 'nel 2021', suggestion: 'dati più recenti' },
			{ old: 'nel 2022', suggestion: 'dati più recenti' },
			{ old: 'nel 2023', suggestion: 'dati più recenti' },
		];

		for (const { old, suggestion } of outdatedTerms) {
			if (content.toLowerCase().includes(old.toLowerCase())) {
				issues.push(`🔄 Termine potenzialmente obsoleto: "${old}" - Considerare: ${suggestion}`);
			}
		}

		if (issues.length === 0) {
			return 'Nessun problema evidente rilevato. Verificare comunque attualità delle informazioni.';
		}

		return issues.join('\n');
	}

	/**
	 * Stop generation
	 */
	stop(): void {
		this.isRunning = false;
		// Cancel all active jobs
		this.activeJobs.forEach((controller) => controller.abort());
		this.activeJobs.clear();
		this.currentTask = null;
	}

	/**
	 * Get current status
	 */
	getStatus(): AgentStatus {
		return {
			isRunning: this.isRunning,
			currentTask: this.currentTask,
			completedTasks: this.completedTasks,
			totalTasks: this.totalTasks,
			errors: [...this.errors],
		};
	}

	/**
	 * Update status callback
	 */
	private updateStatus(onStatusUpdate?: (status: AgentStatus) => void): void {
		if (onStatusUpdate) {
			onStatusUpdate(this.getStatus());
		}
	}

	/**
	 * Load keyword data in background and update proposal
	 * This enriches the proposal with more specific data for the primary keyword
	 * (the cluster data is the total/average for all keywords in the cluster)
	 */
	private async loadKeywordDataInBackground(
		proposal: ContentProposal,
		project: Project,
		onProposalUpdated: (proposal: ContentProposal) => Promise<void>
	): Promise<void> {
		if (!proposal.primaryKeyword) return;

		// Skip if we already have good data from the cluster
		const hasGoodData = proposal.searchVolume != null && proposal.searchVolume > 0 && proposal.difficulty != null;
		if (hasGoodData) {
			console.log('Proposal already has keyword data from cluster, skipping background load:', {
				searchVolume: proposal.searchVolume,
				difficulty: proposal.difficulty,
			});
			
			// Still load SERP analysis in background for content generation
			try {
				const { getSERPAnalysis } = await import('./dataforseo');
				const serpResults = await getSERPAnalysis(
					proposal.primaryKeyword,
					projectLocationCode(project),
					project.language,
					5
				);
				
				if (serpResults.length > 0) {
					const updatedProposal: ContentProposal = {
						...proposal,
						metadata: {
							...proposal.metadata,
							serpAnalysis: serpResults.map((r) => ({
								title: r.title,
								url: r.url,
								description: r.description,
							})),
							keywordDataLoading: false,
						},
					};
					await onProposalUpdated(updatedProposal);
					console.log('Updated proposal with SERP analysis:', serpResults.length, 'results');
				}
			} catch (error) {
				console.warn('Error loading SERP analysis in background:', error);
			}
			return;
		}

		try {
			console.log('Loading keyword data in background for:', proposal.primaryKeyword);
			
			// Step 1: Get keyword data (volume and difficulty) from DataforSEO for the PRIMARY keyword
			const { getKeywordData } = await import('./dataforseo');
			let searchVolume: number | undefined = proposal.searchVolume;
			let difficulty: number | undefined = proposal.difficulty;
			
			try {
				const keywordData = await getKeywordData([proposal.primaryKeyword], projectLocationCode(project), project.language);
				const primaryData = keywordData?.[0];
				if (primaryData) {
					// Use new data if available, otherwise keep existing
					if (primaryData.search_volume != null && primaryData.search_volume > 0) {
						searchVolume = primaryData.search_volume;
					}
					if (primaryData.difficulty != null) {
						difficulty = primaryData.difficulty;
					}
					console.log('Keyword data loaded for primary keyword:', { 
						keyword: proposal.primaryKeyword,
						searchVolume, 
						difficulty 
					});
				}
			} catch (error) {
				console.warn('Error fetching keyword data in background:', error);
				// Keep existing cluster data if API fails
			}

			// Step 2: Analyze SERP in background
			let serpResults: Array<{ title: string; url: string; description: string }> = [];
			try {
				const { getSERPAnalysis } = await import('./dataforseo');
				serpResults = await getSERPAnalysis(
					proposal.primaryKeyword,
					projectLocationCode(project),
					project.language,
					5
				);
				console.log('SERP analysis completed in background:', serpResults.length, 'results');
			} catch (error) {
				console.warn('Error in SERP analysis in background:', error);
			}

			// Step 3: Update proposal with loaded data (use cluster data as fallback)
			const updatedProposal: ContentProposal = {
				...proposal,
				// Use loaded data if available, otherwise keep cluster data
				searchVolume: searchVolume ?? proposal.searchVolume,
				difficulty: difficulty ?? proposal.difficulty,
				metadata: {
					...proposal.metadata,
					serpAnalysis: serpResults.map((r) => ({
						title: r.title,
						url: r.url,
						description: r.description,
					})),
					keywordDataLoading: false, // Mark as loaded
					// Track data source for debugging
					keywordDataSource: searchVolume !== proposal.searchVolume ? 'dataforseo_primary' : 'cluster',
				},
			};

			// Update proposal in database
			await onProposalUpdated(updatedProposal);
			console.log('Proposal updated with keyword data:', proposal.id, {
				searchVolume: updatedProposal.searchVolume,
				difficulty: updatedProposal.difficulty,
			});
		} catch (error) {
			console.error('Error loading keyword data in background:', error);
			// Mark as loaded even if failed, to prevent infinite loading
			// Keep existing cluster data
			const failedProposal: ContentProposal = {
				...proposal,
				metadata: {
					...proposal.metadata,
					keywordDataLoading: false,
					keywordDataLoadFailed: true, // Flag to indicate failure
				},
			};
			await onProposalUpdated(failedProposal).catch((updateError) => {
				console.error('Error updating proposal after keyword data load failure:', updateError);
				// Ignore update errors - proposal was already saved
			});
		}
	}

	/**
	 * Delay utility
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

// Singleton instance
export const contentAgent = new ContentAgent();


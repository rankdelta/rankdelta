/**
 * OpenAI-compatible content service.
 *
 * All LLM calls route through the `seo-proxy` Edge Function (see ./openrouter `complete`),
 * so the provider key lives server-side as an Edge Function secret and is NEVER bundled into
 * the client. No OpenAI client is constructed in the browser and no key is read here.
 */

import { complete } from './openrouter';
import { isProxyEnabled } from './edgeProxy';
import { contentLocale, normalizeContentLanguage, promptLangName, type ContentLanguage } from '../lib/contentLanguages';
import { addNoteLabel, noFabricationRules, sourceNeededLabel } from '../lib/contentIntegrity';
import { detectSearchIntent, getIntentPromptInstructions } from '../utils/searchIntent';

export interface GenerateBlogPostParams {
	topic: string;
	primaryKeyword: string;
	tone: string;
	length: number;
	language: string;
	serpContext?: string;
	useAdvancedModel?: boolean; // Use GPT-4o for higher quality
	intentSource?: string; // Use this text for intent detection instead of keyword (useful for content updates where title is more indicative)
	// Author profile for E-E-A-T (real author, not fabricated)
	authorName?: string;
	authorBio?: string;
	authorExpertise?: string;
}

const WRITTEN_BY: Record<ContentLanguage, string> = {
	en: 'Written by',
	it: 'Articolo scritto da',
	de: 'Verfasst von',
	fr: 'Rédigé par',
	es: 'Escrito por',
	pt: 'Escrito por',
};

/**
 * Build the system + user prompts for generateBlogPost. Pure (no network) so the no-fabrication
 * contract can be unit-tested. Every claim-bearing element (stats, studies, experts, case studies,
 * author credentials, first-person experience) is either taken from the context passed in
 * `serpContext` (e.g. Perplexity research with sources) or left as a visible placeholder.
 */
export const buildBlogPostPrompts = (
	params: GenerateBlogPostParams,
): { systemPrompt: string; userPrompt: string; intent: string } => {
	const {
		topic,
		primaryKeyword,
		tone,
		length,
		language,
		serpContext,
		intentSource,
		// Author profile - REAL author from project settings
		authorName,
		authorBio,
		authorExpertise,
	} = params;

	// Get current year dynamically - NEVER use hardcoded years
	const currentYear = new Date().getFullYear();
	const lang = promptLangName(language);

	// For intent detection, prefer intentSource (e.g., original title) over keyword
	// This is important for content updates where the title reveals the true intent
	// Example: keyword "Carte Mediolanum" looks navigational, but title
	// "Carte Mediolanum a confronto: caratteristiche e costi" is clearly commercial_investigation
	const textForIntentDetection = intentSource || topic || primaryKeyword;

	// Author line only from REAL author data configured on the project — never invented.
	const hasRealAuthor = Boolean(authorName && authorName.trim().length > 0);
	let authorLine = '';
	if (hasRealAuthor) {
		authorLine = `*${WRITTEN_BY[normalizeContentLanguage(language)]} ${authorName!.trim()}`;
		if (authorBio && authorBio.trim()) authorLine += `. ${authorBio.trim()}`;
		else if (authorExpertise && authorExpertise.trim()) authorLine += ` — ${authorExpertise.trim()}`;
		authorLine += '*';
	}

	const authorInstructions = hasRealAuthor
		? `AUTHOR (real data from the project settings — use it EXACTLY):
Right after the H1 title, insert exactly this line (translate only the "written by" wording if needed, never the name or bio):
${authorLine}
Do not add any credential, title, years of experience or detail that is not in this line.`
		: `AUTHOR: none configured. Do NOT write a byline and do NOT invent an author, name, title, credentials or years of experience. Do not write in the first person about experience you do not have.`;

	const updatedOn = new Date().toLocaleDateString(contentLocale(language));
	const nextReview = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toLocaleDateString(contentLocale(language));

	const systemPrompt = `You are an expert content writer. You write articles that stay useful even after the reader has seen an AI Overview: specific, practical, well structured and honest.

CURRENT YEAR: ${currentYear}. Use this year for anything described as current; never present older years as recent.
OUTPUT LANGUAGE: ${lang}. Write the WHOLE article (headings, body, tables, FAQ, disclaimer, placeholders) in ${lang}.
OUTPUT FORMAT: Markdown.
TONE: ${tone}

${noFabricationRules(language)}

PRODUCTS AND SERVICES:
- Never use placeholder names such as "Product X", "Card Y" or "Service Z".
- Name real products or brands only when you are certain they exist; if unsure, describe the category instead. Do not state prices, fees or specs unless they are given in the context below — otherwise use a "[${sourceNeededLabel(language)}: …]" placeholder.

QUALITY RULES (without fabrication):
1. Practical perspective: explain common mistakes and how to avoid them, typical situations and how to handle them, and advice that goes against common beliefs when it is well established — written as general guidance, not as invented personal experience.
2. Depth: for every recommendation explain WHAT to do, WHY it works (the mechanism, not an invented statistic), WHEN NOT to do it, and HOW to check that it works.
3. Examples: use explicitly illustrative examples ("for example, a small online shop that…") with no invented names, companies, numbers or results. Where a real case study would help, insert "[${addNoteLabel(language)}: …]" describing the case the author should add.
4. Quotable structure: open each H2 section with a one- or two-sentence direct answer or definition.
5. Disclaimer at the end: a short, honest disclaimer suited to the topic (informational purpose; consult a qualified professional where health, legal or financial decisions are involved), followed by the line "*Last updated: ${updatedOn} | Next review: ${nextReview}*" translated into ${lang}.

${authorInstructions}

REMEMBER: an article with placeholders is far better than one with invented facts. Usefulness and honesty come first.`;

	// Detect search intent - prefer intentSource (original title) for more accurate detection
	const intentAnalysis = detectSearchIntent(textForIntentDetection);
	const intentInstructions = getIntentPromptInstructions(intentAnalysis);

	const intentItem =
		intentAnalysis.intent === 'commercial_investigation'
			? '2+ comparisons with a comparison table of real, verifiable criteria (features, plans, availability); no invented ratings or performance numbers'
			: '1-2 illustrative worked examples, explicitly hypothetical, with no invented names or results';
	const sourcesItem =
		intentAnalysis.intent === 'transactional'
			? `Clear next steps and where to buy; prices only if given in the context, otherwise "[${sourceNeededLabel(language)}: …]"`
			: `Cite ONLY sources, studies and figures that appear in the context below, with their source; where a claim needs a source you do not have, add "[${sourceNeededLabel(language)}: …]"`;

	const userPrompt = `Write a complete article of ${length}+ words on "${topic}", in ${lang}.

PRIMARY KEYWORD: "${primaryKeyword}"

${intentInstructions}

BASE STRUCTURE (adapt it to the intent above):
1. H1: title with the keyword
2. ${hasRealAuthor ? 'The author line given in the instructions' : 'No byline'}
3. Intro: a hook on the reader's problem + a specific promise of value
4. 5-7 H2 sections (EACH opening with a quotable definition or direct answer)
5. At least 3 H3 subsections per main section
6. ${intentItem}
7. ${sourcesItem}
8. A "Common mistakes to avoid" section (general guidance, no invented anecdotes)
9. FAQ (5 questions, detailed answers)
10. Key takeaways (7 concrete points)
11. Disclaimer + last-updated line

${serpContext ? `\nCONTEXT (SERP / research — the ONLY facts, figures and sources you may cite):\n${serpContext}\n\nMake the article clearly more complete and useful than these competitors.` : ''}

IMPORTANT: adapt structure and tone to the detected intent "${intentAnalysis.intent}".
${intentAnalysis.intent === 'commercial_investigation' ? 'This is COMPARATIVE content: include tables, pros/cons and a clear recommendation with the reasoning behind it.' : ''}
${intentAnalysis.intent === 'transactional' ? 'This is TRANSACTIONAL content: get to the point, clear next steps, where to buy.' : ''}
${intentAnalysis.intent === 'navigational' ? 'This is NAVIGATIONAL content: direct answer, practical info, useful links.' : ''}

Do not write generic filler: every paragraph must be specific and practical. Never invent facts, sources, experts or experience — use a placeholder instead.`;

	return { systemPrompt, userPrompt, intent: `${intentAnalysis.intent} (${intentAnalysis.subType}) - confidence: ${intentAnalysis.confidence}%` };
};

/**
 * Generate a blog post (GEO-structured, AI-proof) with the no-fabrication rule:
 * - practical perspective and depth from general knowledge
 * - facts, figures and sources ONLY from the context passed in (e.g. verified research)
 * - visible [Source needed: …] / [ADD: …] placeholders where the author must add real data
 * - quotable structure for AI Overviews
 */
export const generateBlogPost = async (params: GenerateBlogPostParams): Promise<string> => {
	if (!isProxyEnabled()) {
		throw new Error('Proxy LLM non abilitato. Imposta VITE_USE_SUPABASE_PROXY=true e configura i secret della Edge Function seo-proxy.');
	}

	const { topic, primaryKeyword, length, intentSource } = params;
	const { systemPrompt, userPrompt, intent } = buildBlogPostPrompts(params);
	console.log(`🎯 Search Intent detected from "${intentSource || topic || primaryKeyword}": ${intent}`);

	try {
		const { useAdvancedModel = true } = params; // Default to advanced model for better quality
		const model = useAdvancedModel ? 'openai/gpt-4o' : 'openai/gpt-4o-mini';

		console.log(`Calling LLM proxy (${model}) with GEO-optimized prompt...`, { topic, primaryKeyword, length });

		// Single generation call (the proxy bounds it with its own timeout). There is deliberately no
		// "enhance" pass that asks the model to add missing stats/experts/case studies: that pass is
		// what produced fabricated facts. Missing real data is left as placeholders instead.
		const content = await complete(
			[{ role: 'user', content: userPrompt }],
			{
				model,
				systemPrompt,
				temperature: 0.7,
				maxTokens: Math.max(Math.floor(length * 2.5), 6000), // Ensure enough tokens
				timeoutMs: 180_000,
			}
		);
		console.log('LLM proxy initial response received');

		if (!content) {
			throw new Error('Il modello ha restituito una risposta vuota');
		}

		if (content.trim().length < 100) {
			throw new Error('Il contenuto generato è troppo corto (minimo 100 caratteri)');
		}

		console.log('GEO-optimized content generated successfully, length:', content.length);
		return content;
	} catch (error) {
		console.error('OpenAI API error:', error);
		// Re-throw with more context
		if (error instanceof Error) {
			// Check for specific OpenAI errors
			if (error.message.includes('API key')) {
				throw new Error('API Key OpenAI non configurata o non valida. Controlla le variabili d\'ambiente.');
			}
			if (error.message.includes('rate limit')) {
				throw new Error('Limite di rate raggiunto per OpenAI. Riprova tra qualche minuto.');
			}
			if (error.message.includes('insufficient_quota')) {
				throw new Error('Quota OpenAI esaurita. Controlla il tuo account OpenAI.');
			}
			throw new Error(`Errore nella generazione del contenuto: ${error.message}`);
		}
		throw new Error('Errore sconosciuto nella generazione del contenuto');
	}
};

/**
 * Generate meta description and title
 */
export const generateMeta = async (
	title: string,
	contentPreview: string,
	keyword: string,
	language: string = 'en',
): Promise<{ metaDescription: string; metaTitle: string }> => {
	if (!isProxyEnabled()) {
		throw new Error('Proxy LLM non abilitato. Imposta VITE_USE_SUPABASE_PROXY=true e configura i secret della Edge Function seo-proxy.');
	}

	const prompt = `Write an SEO meta title (50-60 characters) and meta description (150-160 characters) for this article, in ${promptLangName(language)}.
Describe only what the article actually covers; include the keyword naturally if it fits.

Title: ${title}
Keyword: ${keyword}
Article (excerpt):
${contentPreview}

Reply with JSON only: {"metaTitle": "...", "metaDescription": "..."}`;

	let content: string;
	try {
		content = await complete([{ role: 'user', content: prompt }], {
			model: 'openai/gpt-4o-mini',
			systemPrompt: 'You are an SEO editor. You write accurate, specific meta tags.',
			temperature: 0.4,
			maxTokens: 300,
		});
	} catch (error) {
		console.error('OpenAI API error:', error);
		if (error instanceof Error) {
			throw new Error(`Errore nella generazione del contenuto: ${error.message}`);
		}
		throw new Error('Errore sconosciuto nella generazione del contenuto');
	}

	// Never save raw model text as a meta tag: no parseable JSON → fail this item.
	const jsonMatch = content?.match(/\{[\s\S]*\}/);
	if (!jsonMatch) throw new Error('Meta generation returned no JSON');
	const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
	const metaTitle = typeof parsed['metaTitle'] === 'string' ? parsed['metaTitle'].trim() : '';
	const metaDescription = typeof parsed['metaDescription'] === 'string' ? parsed['metaDescription'].trim() : '';
	if (!metaTitle && !metaDescription) throw new Error('Meta generation returned empty fields');
	return { metaTitle: metaTitle || title, metaDescription };
};

/**
 * Generic OpenAI generation function for content enhancement
 * Used by AI Content Enhancer and other components
 */
export const generateWithOpenAI = async (
	systemPrompt: string,
	userPrompt: string,
	options?: {
		temperature?: number;
		maxTokens?: number;
	}
): Promise<string | null> => {
	if (!isProxyEnabled()) {
		throw new Error('Proxy LLM non abilitato. Imposta VITE_USE_SUPABASE_PROXY=true e configura i secret della Edge Function seo-proxy.');
	}

	try {
		const content = await complete(
			[{ role: 'user', content: userPrompt }],
			{
				model: 'openai/gpt-4o-mini',
				systemPrompt,
				temperature: options?.temperature ?? 0.7,
				maxTokens: options?.maxTokens ?? 4000,
			}
		);
		return content || null;
	} catch (error) {
		console.error('OpenAI API error:', error);
		if (error instanceof Error) {
			throw new Error(`Errore nella generazione del contenuto: ${error.message}`);
		}
		throw new Error('Errore sconosciuto nella generazione del contenuto');
	}
};


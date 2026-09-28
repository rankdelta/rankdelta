/**
 * Advanced Content Scoring Component
 * 
 * Detailed SEO scoring with breakdown by category
 * Based on best practices and industry standards
 * Updated with improved keyword detection
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { calculateReadability } from '../../utils/seo';
import { 
	extractPrimaryKeyword, 
	countKeywordOccurrences, 
	calculateKeywordDensity 
} from '../../utils/keywords';
import type { Content } from '../../types/database';
import { useProject } from '../../hooks/useProjects';

interface AdvancedContentScoringProps {
	content: Content;
}

interface ScoreCategory {
	name: string;
	score: number;
	maxScore: number;
	description: string;
	icon: string;
	color: string;
	suggestions: Array<string>;
	details: Array<string>;
}

export const AdvancedContentScoring = ({ content }: AdvancedContentScoringProps) => {
	const { t } = useTranslation();
	const { data: project } = useProject(content.project_id);
	const projectHost = useMemo(() => {
		const raw = project?.website_url?.trim();
		if (!raw) return null;
		try {
			return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
		} catch {
			return null;
		}
	}, [project?.website_url]);
	const scores = useMemo(() => {
		const body = content.body || '';
		const { keyword: primaryKeyword, source: keywordSource } = extractPrimaryKeyword(
			{
				keywordsUsed: content.keywords_used,
				topic: content.topic,
				metadata: content.metadata as Record<string, unknown> | null,
				title: content.title,
			},
			body
		);
		
		// Calculate base scores
		const readabilityScore = calculateReadability(body);

		// Extract metrics
		const wordCount = body.split(/\s+/).filter((w) => w.trim().length > 0).length;
		const keywordMatches = countKeywordOccurrences(primaryKeyword, body);
		const keywordDensity = calculateKeywordDensity(primaryKeyword, body);
		
		const h1Count = (body.match(/^#\s+[^\n]+/gm) || []).length;
		const h2Count = (body.match(/^##\s+[^\n]+/gm) || []).length;
		const h3Count = (body.match(/^###\s+[^\n]+/gm) || []).length;
		const headings = h1Count + h2Count + h3Count;
		const images = (body.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;
		
		// Remove images from body before counting links to avoid double-counting
		const bodyWithoutImages = body.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
		const allLinks = (bodyWithoutImages.match(/\[[^\]]+\]\([^)]+\)/g) || []);
		
		// Known external domains (stock photos, social media, reference sites)
		const externalDomainPatterns = [
			/wikipedia\.org/i,
			/amazon\./i,
			/google\./i,
			/youtube\./i,
			/facebook\./i,
			/twitter\./i,
			/linkedin\./i,
			/unsplash\.com/i,
			/pexels\.com/i,
			/wikimedia\.org/i,
			/picsum/i,
			/pixabay/i,
		];
		
		// The site's own domain: the project's website URL; older articles without one fall back to
		// the generated "📚 Leggi Anche" related-links block.
		const leggiAncheMatch = body.match(/##\s*📚\s*Leggi Anche[\s\S]*?(?=\n##|$)/i);
		let siteDomain: string | null = projectHost;
		
		if (!siteDomain && leggiAncheMatch && leggiAncheMatch[0]) {
			const leggiAncheLinks = leggiAncheMatch[0].match(/\]\((https?:\/\/([^/)]+))/g) || [];
			if (leggiAncheLinks.length > 0 && leggiAncheLinks[0]) {
				const firstUrl = leggiAncheLinks[0].match(/https?:\/\/([^/)]+)/);
				if (firstUrl && firstUrl[1]) {
					siteDomain = firstUrl[1].toLowerCase();
				}
			}
		}
		
		let internalLinksCount = 0;
		let externalLinksCount = 0;
		
		for (const link of allLinks) {
			const urlMatch = link.match(/\]\(([^)]+)\)/);
			if (!urlMatch || !urlMatch[1]) continue;
			
			const url = urlMatch[1].trim();
			
			// Skip empty or anchor-only links
			if (!url || url.startsWith('#')) continue;
			
			// Relative URL = definitely internal
			if (!url.startsWith('http://') && !url.startsWith('https://')) {
				internalLinksCount++;
				continue;
			}
			
			// Check if it's a known external domain (stock photos, social, etc.)
			if (externalDomainPatterns.some(pattern => pattern.test(url))) {
				externalLinksCount++;
				continue;
			}
			
			// Check if it matches our detected site domain
			if (siteDomain) {
				try {
					const urlDomain = new URL(url).hostname.toLowerCase();
					// Match if domains are the same or subdomain
					if (urlDomain === siteDomain || urlDomain.endsWith('.' + siteDomain) || siteDomain.endsWith('.' + urlDomain)) {
						internalLinksCount++;
						continue;
					}
				} catch {
					// Invalid URL, count as external
				}
			}
			
			// Default: any other HTTPS link is external
			externalLinksCount++;
		}
		
		const internalLinks = internalLinksCount;
		const externalLinks = externalLinksCount;
		
		// Check if keyword is in title/H1
		const h1Match = body.match(/^#\s+(.+)$/m);
		const h1Text = h1Match && h1Match[1] ? h1Match[1] : '';
		const keywordInH1 = primaryKeyword && h1Text ? h1Text.toLowerCase().includes(primaryKeyword.toLowerCase()) : false;
		
		// Check if keyword is in H2s
		const h2Matches = body.match(/^##\s+(.+)$/gm) || [];
		const keywordInH2Count = primaryKeyword 
			? h2Matches.filter((h) => h.toLowerCase().includes(primaryKeyword.toLowerCase())).length 
			: 0;

		// Calculate category scores
		const categories: Array<ScoreCategory> = [];

		// ========================================
		// 1. Keyword Optimization (25 points)
		// ========================================
		let keywordScore = 0;
		const keywordSuggestions: Array<string> = [];
		const keywordDetails: Array<string> = [];

		if (!primaryKeyword) {
			keywordSuggestions.push(`⚠️ ${t('contentTools.scoring.keyword.noKeyword')}`);
			keywordSuggestions.push(t('contentTools.scoring.keyword.addTopic'));
		} else {
			keywordDetails.push(t('contentTools.scoring.keyword.detected', { keyword: primaryKeyword, source: keywordSource }));
			keywordDetails.push(t('contentTools.scoring.keyword.occurrences', { count: keywordMatches }));
			keywordDetails.push(t('contentTools.scoring.keyword.density', { density: keywordDensity.toFixed(2) }));

			// Density scoring (1-3% optimal)
			if (keywordDensity >= 1 && keywordDensity <= 3) {
				keywordScore += 12;
				keywordDetails.push(`✓ ${t('contentTools.scoring.keyword.densityOptimal')}`);
			} else if (keywordDensity >= 0.5 && keywordDensity < 1) {
				keywordScore += 8;
				keywordSuggestions.push(t('contentTools.scoring.keyword.densityLow'));
			} else if (keywordDensity > 3 && keywordDensity <= 5) {
				keywordScore += 8;
				keywordSuggestions.push(t('contentTools.scoring.keyword.densitySlightlyHigh'));
			} else if (keywordDensity > 5) {
				keywordScore += 4;
				keywordSuggestions.push(`⚠️ ${t('contentTools.scoring.keyword.densityTooHigh')}`);
			} else if (keywordDensity > 0) {
				keywordScore += 5;
				keywordSuggestions.push(t('contentTools.scoring.keyword.increaseUsage'));
			}
			
			// Keyword in H1
			if (keywordInH1) {
				keywordScore += 7;
				keywordDetails.push(`✓ ${t('contentTools.scoring.keyword.inH1')}`);
			} else {
				keywordSuggestions.push(t('contentTools.scoring.keyword.addToH1'));
			}
			
			// Keyword in H2s
			if (keywordInH2Count >= 2) {
				keywordScore += 4;
				keywordDetails.push(`✓ ${t('contentTools.scoring.keyword.inH2', { count: keywordInH2Count })}`);
			} else if (keywordInH2Count >= 1) {
				keywordScore += 2;
				keywordSuggestions.push(t('contentTools.scoring.keyword.moreH2'));
			} else {
				keywordSuggestions.push(t('contentTools.scoring.keyword.addToH2'));
			}
			
			// Minimum occurrences
			if (keywordMatches >= 5) {
				keywordScore += 2;
			} else if (keywordMatches < 3) {
				keywordSuggestions.push(t('contentTools.scoring.keyword.minOccurrences', { count: keywordMatches }));
			}
		}

		categories.push({
			name: 'Keyword Optimization',
			score: keywordScore,
			maxScore: 25,
			description: t('contentTools.scoring.keyword.description'),
			icon: '🎯',
			color: keywordScore >= 20 ? 'green' : keywordScore >= 12 ? 'yellow' : 'red',
			suggestions: keywordSuggestions,
			details: keywordDetails,
		});

		// ========================================
		// 2. Content Quality (25 points)
		// ========================================
		let qualityScore = 0;
		const qualitySuggestions: Array<string> = [];
		const qualityDetails: Array<string> = [];
		
		qualityDetails.push(t('contentTools.scoring.quality.wordCount', { words: wordCount.toLocaleString() }));
		qualityDetails.push(t('contentTools.scoring.quality.readability', { score: readabilityScore }));

		// Word count scoring
		if (wordCount >= 2000 && wordCount <= 4000) {
			qualityScore += 10;
			qualityDetails.push(`✓ ${t('contentTools.scoring.quality.lengthOptimal')}`);
		} else if (wordCount >= 1500 && wordCount < 2000) {
			qualityScore += 8;
			qualitySuggestions.push(t('contentTools.scoring.quality.expand'));
		} else if (wordCount >= 1000 && wordCount < 1500) {
			qualityScore += 5;
			qualitySuggestions.push(t('contentTools.scoring.quality.short'));
		} else if (wordCount < 1000) {
			qualityScore += 2;
			qualitySuggestions.push(`⚠️ ${t('contentTools.scoring.quality.tooShort')}`);
		} else {
			qualityScore += 8;
			qualityDetails.push(t('contentTools.scoring.quality.veryLong'));
		}
		
		// Readability scoring
		if (readabilityScore >= 60) {
			qualityScore += 10;
			qualityDetails.push(`✓ ${t('contentTools.scoring.quality.goodReadability')}`);
		} else if (readabilityScore >= 45) {
			qualityScore += 7;
			qualitySuggestions.push(t('contentTools.scoring.quality.improveReadability'));
		} else if (readabilityScore >= 30) {
			qualityScore += 4;
			qualitySuggestions.push(t('contentTools.scoring.quality.lowReadability'));
		} else {
			qualityScore += 2;
			qualitySuggestions.push(`⚠️ ${t('contentTools.scoring.quality.hardToRead')}`);
		}
		
		// Structure scoring
		if (headings >= 6) {
			qualityScore += 5;
			qualityDetails.push(`✓ ${t('contentTools.scoring.quality.goodStructure', { count: headings })}`);
		} else if (headings >= 4) {
			qualityScore += 3;
			qualitySuggestions.push(t('contentTools.scoring.quality.moreHeadings'));
		} else {
			qualityScore += 1;
			qualitySuggestions.push(`⚠️ ${t('contentTools.scoring.quality.fewHeadings')}`);
		}

		categories.push({
			name: 'Content Quality',
			score: qualityScore,
			maxScore: 25,
			description: t('contentTools.scoring.quality.description'),
			icon: '✨',
			color: qualityScore >= 20 ? 'green' : qualityScore >= 12 ? 'yellow' : 'red',
			suggestions: qualitySuggestions,
			details: qualityDetails,
		});

		// ========================================
		// 3. Structure & Formatting (20 points)
		// ========================================
		let structureScore = 0;
		const structureSuggestions: Array<string> = [];
		const structureDetails: Array<string> = [];
		
		structureDetails.push(`H1: ${h1Count}, H2: ${h2Count}, H3: ${h3Count}`);
		structureDetails.push(t('contentTools.scoring.structure.images', { count: images }));

		// H1 check
		if (h1Count === 1) {
			structureScore += 4;
			structureDetails.push(`✓ ${t('contentTools.scoring.structure.singleH1')}`);
		} else if (h1Count === 0) {
			structureSuggestions.push(t('contentTools.scoring.structure.addH1'));
		} else {
			structureScore += 2;
			structureSuggestions.push(t('contentTools.scoring.structure.onlyOneH1', { count: h1Count }));
		}
		
		// H2 check
		if (h2Count >= 5) {
			structureScore += 6;
			structureDetails.push(`✓ ${t('contentTools.scoring.structure.goodH2')}`);
		} else if (h2Count >= 3) {
			structureScore += 4;
			structureSuggestions.push(t('contentTools.scoring.structure.moreH2'));
		} else {
			structureScore += 2;
			structureSuggestions.push(`⚠️ ${t('contentTools.scoring.structure.fewH2')}`);
		}
		
		// H3 check for depth
		if (h3Count >= 3) {
			structureScore += 3;
			structureDetails.push(`✓ ${t('contentTools.scoring.structure.goodH3')}`);
		} else if (h3Count >= 1) {
			structureScore += 2;
		}
		
		// Images check
		if (images >= 3) {
			structureScore += 5;
			structureDetails.push(`✓ ${t('contentTools.scoring.structure.goodImages')}`);
		} else if (images >= 1) {
			structureScore += 3;
			structureSuggestions.push(t('contentTools.scoring.structure.moreImages'));
		} else {
			structureSuggestions.push(t('contentTools.scoring.structure.addImages'));
		}
		
		// Paragraph structure
		const paragraphs = body.split(/\n\n+/).filter((p) => p.trim().length > 50);
		if (paragraphs.length >= 10) {
			structureScore += 2;
		}

		categories.push({
			name: 'Structure & Formatting',
			score: structureScore,
			maxScore: 20,
			description: t('contentTools.scoring.structure.description'),
			icon: '📐',
			color: structureScore >= 15 ? 'green' : structureScore >= 10 ? 'yellow' : 'red',
			suggestions: structureSuggestions,
			details: structureDetails,
		});

		// ========================================
		// 4. Internal & External Linking (15 points)
		// ========================================
		let linkingScore = 0;
		const linkingSuggestions: Array<string> = [];
		const linkingDetails: Array<string> = [];
		
		linkingDetails.push(t('contentTools.scoring.linking.total', { count: allLinks.length }));
		linkingDetails.push(t('contentTools.scoring.linking.split', { internal: internalLinks, external: externalLinks }));

		// Internal links
		if (internalLinks >= 4) {
			linkingScore += 7;
			linkingDetails.push(`✓ ${t('contentTools.scoring.linking.goodInternal')}`);
		} else if (internalLinks >= 2) {
			linkingScore += 5;
			linkingSuggestions.push(t('contentTools.scoring.linking.moreInternal'));
		} else if (internalLinks >= 1) {
			linkingScore += 3;
			linkingSuggestions.push(t('contentTools.scoring.linking.fewInternal'));
		} else {
			linkingSuggestions.push(`⚠️ ${t('contentTools.scoring.linking.noInternal')}`);
		}
		
		// External links
		if (externalLinks >= 3) {
			linkingScore += 8;
			linkingDetails.push(`✓ ${t('contentTools.scoring.linking.goodExternal')}`);
		} else if (externalLinks >= 2) {
			linkingScore += 6;
			linkingSuggestions.push(t('contentTools.scoring.linking.addAuthoritative'));
		} else if (externalLinks >= 1) {
			linkingScore += 4;
			linkingSuggestions.push(t('contentTools.scoring.linking.moreExternal'));
		} else {
			linkingSuggestions.push(t('contentTools.scoring.linking.addExternal'));
		}

		categories.push({
			name: 'Linking Strategy',
			score: linkingScore,
			maxScore: 15,
			description: t('contentTools.scoring.linking.description'),
			icon: '🔗',
			color: linkingScore >= 12 ? 'green' : linkingScore >= 8 ? 'yellow' : 'red',
			suggestions: linkingSuggestions,
			details: linkingDetails,
		});

		// ========================================
		// 5. Meta & Technical (15 points)
		// ========================================
		let metaScore = 0;
		const metaSuggestions: Array<string> = [];
		const metaDetails: Array<string> = [];

		// Title check
		const titleLength = content.title?.length || 0;
		metaDetails.push(t('contentTools.scoring.meta.titleLength', { count: titleLength }));
		
		if (titleLength >= 30 && titleLength <= 65) {
			metaScore += 5;
			metaDetails.push(`✓ ${t('contentTools.scoring.meta.titleOptimal')}`);
		} else if (titleLength > 0 && titleLength < 30) {
			metaScore += 2;
			metaSuggestions.push(t('contentTools.scoring.meta.titleShort'));
		} else if (titleLength > 65) {
			metaScore += 3;
			metaSuggestions.push(t('contentTools.scoring.meta.titleLong'));
		} else {
			metaSuggestions.push(t('contentTools.scoring.meta.addTitle'));
		}
		
		// Keyword in title
		if (primaryKeyword && content.title?.toLowerCase().includes(primaryKeyword.toLowerCase())) {
			metaScore += 3;
			metaDetails.push(`✓ ${t('contentTools.scoring.meta.keywordInTitle')}`);
		} else if (primaryKeyword) {
			metaSuggestions.push(t('contentTools.scoring.meta.addKeywordToTitle'));
		}
		
		// Slug check
		if (content.slug && content.slug.length > 0) {
			metaScore += 2;
			metaDetails.push(t('contentTools.scoring.meta.slug', { slug: content.slug }));
			
			// Check if keyword in slug
			if (primaryKeyword && content.slug.toLowerCase().includes(primaryKeyword.toLowerCase().replace(/\s+/g, '-'))) {
				metaScore += 2;
				metaDetails.push(`✓ ${t('contentTools.scoring.meta.keywordInSlug')}`);
			}
		} else {
			metaSuggestions.push(t('contentTools.scoring.meta.addSlug'));
		}
		
		// Meta description check
		const metadata = content.metadata as Record<string, unknown> | null;
		const metaDesc = metadata?.['metaDescription'] as string | undefined;
		
		if (metaDesc && metaDesc.length >= 120 && metaDesc.length <= 160) {
			metaScore += 3;
			metaDetails.push(`✓ ${t('contentTools.scoring.meta.metaDescOptimal')}`);
		} else if (metaDesc && metaDesc.length > 0) {
			metaScore += 1;
			metaSuggestions.push(t('contentTools.scoring.meta.optimizeMetaDesc'));
		} else {
			metaSuggestions.push(t('contentTools.scoring.meta.addMetaDesc'));
		}

		categories.push({
			name: 'Meta & Technical',
			score: metaScore,
			maxScore: 15,
			description: t('contentTools.scoring.meta.description'),
			icon: '⚙️',
			color: metaScore >= 12 ? 'green' : metaScore >= 7 ? 'yellow' : 'red',
			suggestions: metaSuggestions,
			details: metaDetails,
		});

		// Calculate totals
		const totalScore = categories.reduce((sum, cat) => sum + cat.score, 0);
		const maxTotalScore = categories.reduce((sum, cat) => sum + cat.maxScore, 0);
		const percentage = Math.round((totalScore / maxTotalScore) * 100);

		return {
			totalScore,
			maxTotalScore,
			percentage,
			categories,
			primaryKeyword,
			keywordSource,
			metrics: {
				wordCount,
				keywordMatches,
				keywordDensity: keywordDensity.toFixed(2),
				headings,
				h1Count,
				h2Count,
				h3Count,
				images,
				internalLinks,
				externalLinks,
				readabilityScore,
			},
		};
	}, [content, projectHost, t]);

	const getScoreColor = (percentage: number): string => {
		if (percentage >= 80) return 'text-cosmic-green';
		if (percentage >= 60) return 'text-amber-500';
		return 'text-red-500';
	};

	return (
		<div className="space-y-6">
			{/* Overall Score */}
			<Card>
				<div className="text-center mb-6">
					<div className="relative w-32 h-32 mx-auto mb-4">
						<svg className="transform -rotate-90 w-32 h-32">
							<circle
								className="text-gray-200"
								cx="64"
								cy="64"
								fill="none"
								r="56"
								stroke="currentColor"
								strokeWidth="8"
							/>
							<circle
								className={getScoreColor(scores.percentage)}
								cx="64"
								cy="64"
								fill="none"
								r="56"
								stroke="currentColor"
								strokeDasharray={`${(scores.percentage / 100) * 352} 352`}
								strokeWidth="8"
							/>
						</svg>
						<div className="absolute inset-0 flex items-center justify-center">
							<span className={`text-3xl font-bold ${getScoreColor(scores.percentage)}`}>
								{scores.percentage}
							</span>
						</div>
					</div>
					<h3 className="text-lg font-semibold text-gray-900 mb-2">Advanced SEO Score</h3>
					<p className="text-sm text-gray-500">
						{t('contentTools.scoring.points', { score: scores.totalScore, max: scores.maxTotalScore })}
					</p>
				</div>

				{/* Show detected keyword */}
				{scores.primaryKeyword && (
					<div className="mt-4 p-3 bg-gray-50 rounded-lg">
						<div className="flex items-center justify-between">
							<span className="text-xs text-gray-500">{t('contentTools.scoring.detectedKeyword')}</span>
							<Badge variant="info" size="sm">{scores.keywordSource}</Badge>
						</div>
						<p className="text-sm font-semibold text-gray-900 mt-1">"{scores.primaryKeyword}"</p>
						<p className="text-xs text-gray-500 mt-1">
							{t('contentTools.scoring.keywordSummary', { count: scores.metrics.keywordMatches, density: scores.metrics.keywordDensity })}
						</p>
					</div>
				)}
			</Card>

			{/* Category Breakdown */}
			<div className="space-y-4">
				{scores.categories.map((category) => (
					<Card key={category.name}>
						<div className="flex items-start justify-between mb-3">
							<div className="flex items-center gap-3">
								<span className="text-2xl">{category.icon}</span>
								<div>
									<h4 className="font-semibold text-gray-900">{category.name}</h4>
									<p className="text-xs text-gray-500">{category.description}</p>
								</div>
							</div>
							<div className="text-right">
								<div className="text-2xl font-bold text-gray-900">
									{category.score} / {category.maxScore}
								</div>
								<Badge
									size="sm"
									variant={category.color === 'green' ? 'success' : category.color === 'yellow' ? 'warning' : 'error'}
								>
									{Math.round((category.score / category.maxScore) * 100)}%
								</Badge>
							</div>
						</div>

						{/* Progress Bar */}
						<div className="w-full bg-gray-200 rounded-full h-2 mb-3">
							<div
								className={`h-2 rounded-full transition-all ${
									category.color === 'green'
										? 'bg-cosmic-green'
										: category.color === 'yellow'
										? 'bg-amber-500'
										: 'bg-red-500'
								}`}
								style={{ width: `${(category.score / category.maxScore) * 100}%` }}
							/>
						</div>

						{/* Details (what was found) */}
						{category.details.length > 0 && (
							<div className="mb-3 p-2 bg-blue-50 rounded-lg border border-blue-200">
								<p className="text-xs font-semibold text-blue-700 mb-1">{t('contentTools.scoring.detectedHeading')}</p>
								<ul className="space-y-0.5">
									{category.details.map((detail, index) => (
										<li key={index} className="text-xs text-blue-600">
											{detail}
										</li>
									))}
								</ul>
							</div>
						)}

						{/* Suggestions */}
						{category.suggestions.length > 0 && (
							<div className="pt-3 border-t border-gray-200">
								<p className="text-xs font-semibold text-gray-700 mb-2">{t('contentTools.scoring.suggestionsHeading')}</p>
								<ul className="space-y-1">
									{category.suggestions.map((suggestion, index) => (
										<li key={index} className="text-xs text-gray-600 flex items-start gap-2">
											<span className={suggestion.startsWith('⚠️') ? 'text-red-500' : 'text-amber-500'}>•</span>
											<span>{suggestion}</span>
										</li>
									))}
								</ul>
							</div>
						)}
					</Card>
				))}
			</div>

			{/* Metrics Summary */}
			<Card>
				<h4 className="font-semibold text-gray-900 mb-3">{t('contentTools.scoring.metricsHeading')}</h4>
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
					<div>
						<div className="text-xs text-gray-500 mb-1">{t('contentTools.scoring.metrics.words')}</div>
						<div className="text-lg font-bold text-gray-900">{scores.metrics.wordCount.toLocaleString()}</div>
					</div>
					<div>
						<div className="text-xs text-gray-500 mb-1">Keyword Density</div>
						<div className="text-lg font-bold text-gray-900">{scores.metrics.keywordDensity}%</div>
					</div>
					<div>
						<div className="text-xs text-gray-500 mb-1">Keyword Count</div>
						<div className="text-lg font-bold text-gray-900">{scores.metrics.keywordMatches}</div>
					</div>
					<div>
						<div className="text-xs text-gray-500 mb-1">Readability</div>
						<div className="text-lg font-bold text-gray-900">{scores.metrics.readabilityScore}/100</div>
					</div>
					<div>
						<div className="text-xs text-gray-500 mb-1">Heading</div>
						<div className="text-lg font-bold text-gray-900">
							{scores.metrics.h1Count}H1 • {scores.metrics.h2Count}H2 • {scores.metrics.h3Count}H3
						</div>
					</div>
					<div>
						<div className="text-xs text-gray-500 mb-1">{t('contentTools.scoring.metrics.images')}</div>
						<div className="text-lg font-bold text-gray-900">{scores.metrics.images}</div>
					</div>
					<div>
						<div className="text-xs text-gray-500 mb-1">{t('contentTools.scoring.metrics.internalLinks')}</div>
						<div className="text-lg font-bold text-gray-900">{scores.metrics.internalLinks}</div>
					</div>
					<div>
						<div className="text-xs text-gray-500 mb-1">{t('contentTools.scoring.metrics.externalLinks')}</div>
						<div className="text-lg font-bold text-gray-900">{scores.metrics.externalLinks}</div>
					</div>
				</div>
			</Card>
		</div>
	);
};

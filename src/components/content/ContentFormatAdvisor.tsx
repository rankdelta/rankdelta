/**
 * Content Format Advisor Component
 * 
 * Analizza il contenuto e suggerisce formati alternativi basati sui trend 2025.
 * Liz Reid ha evidenziato che gli utenti preferiscono:
 * - Short-form video invece di articoli lunghi
 * - Forum e UGC invece di siti tradizionali
 * - Podcast invece di contenuti scritti
 * - YouTube per ricette invece di food blog
 * 
 * Questo componente analizza il tipo di contenuto e suggerisce formati complementari.
 */

import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { Content } from '../../types/database';
import { uiLocaleTag } from '../../common/uiLocale';

interface ContentFormatAdvisorProps {
	content: Content;
}

interface FormatSuggestion {
	format: 'video' | 'short_video' | 'podcast' | 'infographic' | 'interactive' | 'ugc' | 'newsletter';
	name: string;
	icon: string;
	relevanceScore: number;
	reason: string;
	platforms: Array<string>;
	tips: Array<string>;
}

interface ContentAnalysis {
	type: 'how_to' | 'listicle' | 'guide' | 'review' | 'news' | 'opinion' | 'technical' | 'general';
	hasSteps: boolean;
	hasVisualPotential: boolean;
	hasDataHeavyContent: boolean;
	wordCount: number;
	estimatedReadTime: number;
}

export const ContentFormatAdvisor = ({ content }: ContentFormatAdvisorProps): ReactElement => {
	const { t } = useTranslation();
	const analysis = useMemo((): { contentType: ContentAnalysis; suggestions: Array<FormatSuggestion> } => {
		const body = content.body || '';
		const title = (content.title || '').toLowerCase();
		const wordCount = body.split(/\s+/).filter((w) => w.trim().length > 0).length;
		
		// Analyze content type
		const hasSteps = /step\s*\d|step\s*(one|two|three|1|2|3)|passo\s*\d|passaggio\s*\d/i.test(body) || 
						/\d+\.\s+[A-Z]/m.test(body) ||
						/(first|second|third|then|next|finally|innanzitutto|poi|successivamente|infine),?\s/i.test(body);
		
		const hasVisualPotential = /image|picture|photo|visual|diagram|chart|graph|screenshot|example/i.test(body);
		
		const hasDataHeavyContent = /\d+%|\d+\s*(users|customers|people)|statistic|data|research|study|survey/i.test(body);
		
		// Determine content type
		let type: ContentAnalysis['type'] = 'general';
		if (/how to|tutorial|guide|learn|come\s+\w+|guida|impara/i.test(title)) {
			type = 'how_to';
		} else if (/\d+\s+(best|top|ways|tips|reasons|things|migliori|modi|consigli|motivi|cose|idee)/i.test(title)) {
			type = 'listicle';
		} else if (/ultimate guide|complete guide|comprehensive|guida completa|guida definitiva/i.test(title)) {
			type = 'guide';
		} else if (/review|comparison|vs\.|versus|recensione|confronto/i.test(title)) {
			type = 'review';
		} else if (/news|update|announce|launch|novità|aggiornamento|annuncio|lancio/i.test(title)) {
			type = 'news';
		} else if (/opinion|think|believe|should|opinione|perché dovresti/i.test(title)) {
			type = 'opinion';
		} else if (/api|code|technical|developer|programming/i.test(title)) {
			type = 'technical';
		}
		
		const contentType: ContentAnalysis = {
			type,
			hasSteps,
			hasVisualPotential,
			hasDataHeavyContent,
			wordCount,
			estimatedReadTime: Math.ceil(wordCount / 200),
		};
		
		// Generate format suggestions based on content analysis
		const suggestions: Array<FormatSuggestion> = [];
		
		// Short Video (always high for how-to content)
		if (type === 'how_to' || hasSteps) {
			suggestions.push({
				format: 'short_video',
				name: 'Short-Form Video (TikTok/Reels)',
				icon: '📱',
				relevanceScore: 95,
				reason: t('contentTools.formatAdvisor.shortVideo.reason'),
				platforms: ['TikTok', 'Instagram Reels', 'YouTube Shorts'],
				tips: [
					t('contentTools.formatAdvisor.shortVideo.tip1'),
					t('contentTools.formatAdvisor.shortVideo.tip2'),
					t('contentTools.formatAdvisor.shortVideo.tip3'),
					t('contentTools.formatAdvisor.shortVideo.tip4'),
				],
			});
		}
		
		// Long-form Video
		if (type === 'guide' || type === 'how_to' || wordCount > 1500) {
			suggestions.push({
				format: 'video',
				name: t('contentTools.formatAdvisor.video.name'),
				icon: '🎬',
				relevanceScore: type === 'guide' ? 90 : 75,
				reason: t('contentTools.formatAdvisor.video.reason'),
				platforms: ['YouTube'],
				tips: [
					t('contentTools.formatAdvisor.video.tip1'),
					t('contentTools.formatAdvisor.video.tip2'),
					t('contentTools.formatAdvisor.video.tip3'),
					t('contentTools.formatAdvisor.video.tip4'),
				],
			});
		}
		
		// Podcast
		if (type === 'opinion' || type === 'guide' || wordCount > 2000) {
			suggestions.push({
				format: 'podcast',
				name: t('contentTools.formatAdvisor.podcast.name'),
				icon: '🎙️',
				relevanceScore: type === 'opinion' ? 85 : 70,
				reason: t('contentTools.formatAdvisor.podcast.reason'),
				platforms: ['Spotify', 'Apple Podcasts', 'Google Podcasts'],
				tips: [
					t('contentTools.formatAdvisor.podcast.tip1'),
					t('contentTools.formatAdvisor.podcast.tip2'),
					t('contentTools.formatAdvisor.podcast.tip3'),
					t('contentTools.formatAdvisor.podcast.tip4'),
				],
			});
		}
		
		// Infographic
		if (hasDataHeavyContent || type === 'listicle') {
			suggestions.push({
				format: 'infographic',
				name: t('contentTools.formatAdvisor.infographic.name'),
				icon: '📊',
				relevanceScore: hasDataHeavyContent ? 88 : 72,
				reason: t('contentTools.formatAdvisor.infographic.reason'),
				platforms: ['Pinterest', 'LinkedIn', 'Blog embed'],
				tips: [
					t('contentTools.formatAdvisor.infographic.tip1'),
					t('contentTools.formatAdvisor.infographic.tip2'),
					t('contentTools.formatAdvisor.infographic.tip3'),
					t('contentTools.formatAdvisor.infographic.tip4'),
				],
			});
		}
		
		// Interactive Content
		if (type === 'how_to' || type === 'review') {
			suggestions.push({
				format: 'interactive',
				name: t('contentTools.formatAdvisor.interactive.name'),
				icon: '🛠️',
				relevanceScore: 82,
				reason: t('contentTools.formatAdvisor.interactive.reason'),
				platforms: [t('contentTools.formatAdvisor.platformWebsite'), 'Web app'],
				tips: [
					t('contentTools.formatAdvisor.interactive.tip1'),
					t('contentTools.formatAdvisor.interactive.tip2'),
					t('contentTools.formatAdvisor.interactive.tip3'),
					t('contentTools.formatAdvisor.interactive.tip4'),
				],
			});
		}
		
		// UGC / Community
		if (type === 'how_to' || type === 'opinion') {
			suggestions.push({
				format: 'ugc',
				name: t('contentTools.formatAdvisor.ugc.name'),
				icon: '💬',
				relevanceScore: 78,
				reason: t('contentTools.formatAdvisor.ugc.reason'),
				platforms: ['Reddit', 'Quora', 'Community Discord'],
				tips: [
					t('contentTools.formatAdvisor.ugc.tip1'),
					t('contentTools.formatAdvisor.ugc.tip2'),
					t('contentTools.formatAdvisor.ugc.tip3'),
					t('contentTools.formatAdvisor.ugc.tip4'),
				],
			});
		}
		
		// Newsletter
		suggestions.push({
			format: 'newsletter',
			name: 'Newsletter Segment',
			icon: '📧',
			relevanceScore: 70,
			reason: t('contentTools.formatAdvisor.newsletter.reason'),
			platforms: ['Substack', 'Beehiiv', 'ConvertKit'],
			tips: [
				t('contentTools.formatAdvisor.newsletter.tip1'),
				t('contentTools.formatAdvisor.newsletter.tip2'),
				t('contentTools.formatAdvisor.newsletter.tip3'),
				t('contentTools.formatAdvisor.newsletter.tip4'),
			],
		});
		
		// Sort by relevance score
		suggestions.sort((a, b) => b.relevanceScore - a.relevanceScore);
		
		return { contentType, suggestions: suggestions.slice(0, 5) };
	}, [content, t]);
	
	const getScoreColor = (score: number): string => {
		if (score >= 85) return 'bg-cosmic-green text-white';
		if (score >= 70) return 'bg-cosmic-cyan text-white';
		return 'bg-gray-300 text-gray-700';
	};
	
	return (
		<div className="space-y-6">
			{/* Header */}
			<Card className="bg-gradient-to-r from-pink-500/20 to-purple-500/20 border-pink-500/30">
				<div className="flex items-center gap-4 mb-4">
					<div className="text-4xl">🎨</div>
					<div>
						<h3 className="text-xl font-bold text-gray-900">Content Format Advisor</h3>
						<p className="text-sm text-gray-600">
							{t('contentTools.formatAdvisor.subtitle')}
						</p>
					</div>
				</div>
				<p className="text-xs text-gray-500 leading-relaxed">
					{t('contentTools.formatAdvisor.intro')}
				</p>
			</Card>
			
			{/* Content Analysis */}
			<Card>
				<h4 className="font-bold text-gray-900 mb-3">{t('contentTools.formatAdvisor.analysisTitle')}</h4>
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
					<div className="text-center p-3 bg-gray-50 rounded-lg">
						<div className="text-2xl font-bold text-gray-900">{analysis.contentType.wordCount.toLocaleString(uiLocaleTag())}</div>
						<div className="text-xs text-gray-500">{t('contentTools.formatAdvisor.words')}</div>
					</div>
					<div className="text-center p-3 bg-gray-50 rounded-lg">
						<div className="text-2xl font-bold text-gray-900">{analysis.contentType.estimatedReadTime}</div>
						<div className="text-xs text-gray-500">{t('contentTools.formatAdvisor.readMinutes')}</div>
					</div>
					<div className="text-center p-3 bg-gray-50 rounded-lg">
						<div className="text-2xl font-bold text-gray-900 capitalize">{analysis.contentType.type.replace('_', ' ')}</div>
						<div className="text-xs text-gray-500">{t('contentTools.formatAdvisor.type')}</div>
					</div>
					<div className="text-center p-3 bg-gray-50 rounded-lg">
						<div className="text-2xl font-bold text-gray-900">{analysis.suggestions.length}</div>
						<div className="text-xs text-gray-500">{t('contentTools.formatAdvisor.suggestedFormats')}</div>
					</div>
				</div>
			</Card>
			
			{/* Format Suggestions */}
			<div className="space-y-4">
				<h4 className="font-bold text-gray-900">{t('contentTools.formatAdvisor.recommendedTitle')}</h4>
				{analysis.suggestions.map((suggestion) => (
					<Card key={suggestion.format} className="hover:border-cosmic-cyan/50 transition-all">
						<div className="flex items-start gap-4">
							<div className="text-3xl">{suggestion.icon}</div>
							<div className="flex-1">
								<div className="flex items-center gap-3 mb-2">
									<h4 className="font-semibold text-gray-900">{suggestion.name}</h4>
									<Badge variant={getScoreColor(suggestion.relevanceScore) as any}>
										{suggestion.relevanceScore}% match
									</Badge>
								</div>
								<p className="text-sm text-gray-600 mb-3">{suggestion.reason}</p>
								
								{/* Platforms */}
								<div className="flex flex-wrap gap-2 mb-3">
									{suggestion.platforms.map((platform) => (
										<span key={platform} className="text-xs px-2 py-1 bg-gray-100 rounded-full text-gray-600">
											{platform}
										</span>
									))}
								</div>
								
								{/* Tips */}
								<div className="bg-gray-50 rounded-lg p-3">
									<p className="text-xs font-semibold text-gray-700 mb-2">{t('contentTools.formatAdvisor.tipsLabel')}</p>
									<ul className="text-xs text-gray-600 space-y-1">
										{suggestion.tips.map((tip, tipIndex) => (
											<li key={tipIndex}>• {tip}</li>
										))}
									</ul>
								</div>
							</div>
						</div>
					</Card>
				))}
			</div>
			
			{/* Call to Action */}
			<Card className="bg-gradient-to-r from-cosmic-purple/10 to-cosmic-cyan/10 border-cosmic-purple/30">
				<h4 className="font-bold text-gray-900 mb-2">{t('contentTools.formatAdvisor.strategyTitle')}</h4>
				<p className="text-xs text-gray-600 mb-3">
					{t('contentTools.formatAdvisor.strategyIntro')}
				</p>
				<div className="grid grid-cols-3 gap-3 text-center text-xs">
					<div className="p-2 bg-white rounded-lg">
						<div className="text-lg mb-1">📄</div>
						<div className="font-semibold text-gray-900">{t('contentTools.formatAdvisor.strategyArticle')}</div>
						<div className="text-gray-500">SEO Long-tail</div>
					</div>
					<div className="p-2 bg-white rounded-lg">
						<div className="text-lg mb-1">📱</div>
						<div className="font-semibold text-gray-900">Video</div>
						<div className="text-gray-500">Discovery</div>
					</div>
					<div className="p-2 bg-white rounded-lg">
						<div className="text-lg mb-1">💬</div>
						<div className="font-semibold text-gray-900">Social</div>
						<div className="text-gray-500">Engagement</div>
					</div>
				</div>
			</Card>
		</div>
	);
};


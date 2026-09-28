/**
 * Content Ideation Engine Component
 * 
 * Generates content ideas based on trends, competitor analysis, and topical gaps
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getSERPAnalysis, getPeopleAlsoAsk, getRelatedSearches, getKeywordSuggestions } from '../../services/dataforseo';
import { projectResearchLocale } from '../../lib/seoMarkets';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useToast } from '../../hooks/useToast';
import { Toast } from '../ui/Toast';
import { EmptyState } from '../ui/EmptyState';
import type { Project } from '../../types/database';
import { uiLocaleTag } from '../../common/uiLocale';

interface ContentIdeationEngineProps {
	project: Project;
}

interface ContentIdea {
	id: string;
	title: string;
	description: string;
	keyword: string;
	searchVolume?: number;
	difficulty?: number;
	source: 'trend' | 'competitor' | 'paa' | 'related' | 'gap';
	priority: 'high' | 'medium' | 'low';
	reason: string;
}

export const ContentIdeationEngine = ({ project }: ContentIdeationEngineProps) => {
	const { t } = useTranslation();
	const [primaryKeyword, setPrimaryKeyword] = useState(project.primary_keyword || '');
	const [isGenerating, setIsGenerating] = useState(false);
	const [ideas, setIdeas] = useState<ContentIdea[]>([]);
	const { toast, showToast, hideToast } = useToast();

	const handleGenerateIdeas = async () => {
		if (!primaryKeyword.trim()) {
			showToast(t('contentTools.ideation.toastNoKeyword'), 'warning');
			return;
		}

		setIsGenerating(true);
		setIdeas([]);
		const { locationCode } = projectResearchLocale(project);

		try {
			const generatedIdeas: ContentIdea[] = [];

			// Source 1: People Also Ask (domande reali degli utenti)
			try {
				const paaQuestions = await getPeopleAlsoAsk(primaryKeyword, locationCode, project.language);
				paaQuestions.forEach((paa, index) => {
					generatedIdeas.push({
						id: `idea-paa-${index}`,
						title: paa.question,
						description: t('contentTools.ideation.paaDescription', { answer: paa.answer.substring(0, 150) }),
						keyword: paa.question,
						source: 'paa',
						priority: index < 5 ? 'high' : 'medium',
						reason: t('contentTools.ideation.paaReason'),
					});
				});
			} catch (error) {
				console.warn('Error getting PAA:', error);
			}

			// Source 2: Related Searches
			try {
				const relatedSearches = await getRelatedSearches(primaryKeyword, locationCode, project.language);
				relatedSearches.slice(0, 10).forEach((search, index) => {
					generatedIdeas.push({
						id: `idea-related-${index}`,
						title: t('contentTools.ideation.relatedTitle', { search }),
						description: t('contentTools.ideation.relatedDescription', { search }),
						keyword: search,
						source: 'related',
						priority: index < 3 ? 'high' : 'medium',
						reason: t('contentTools.ideation.relatedReason'),
					});
				});
			} catch (error) {
				console.warn('Error getting related searches:', error);
			}

			// Source 3: Competitor Analysis (topics they cover)
			try {
				const serpResults = await getSERPAnalysis(primaryKeyword, locationCode, project.language, 15);
				serpResults.slice(0, 10).forEach((result, index) => {
					generatedIdeas.push({
						id: `idea-competitor-${index}`,
						title: result.title,
						description: t('contentTools.ideation.competitorDescription'),
						keyword: result.title.substring(0, 50),
						source: 'competitor',
						priority: index < 5 ? 'high' : 'medium',
						reason: t('contentTools.ideation.competitorReason', { position: index + 1 }),
					});
				});
			} catch (error) {
				console.warn('Error getting SERP:', error);
			}

			// Source 4: Keyword Suggestions (trending/related)
			try {
				const keywordSuggestions = await getKeywordSuggestions(primaryKeyword, locationCode, project.language, 20);
				keywordSuggestions.slice(0, 10).forEach((keyword, index) => {
					generatedIdeas.push({
						id: `idea-trend-${index}`,
						title: t('contentTools.ideation.trendTitle', { keyword }),
						description: t('contentTools.ideation.trendDescription'),
						keyword,
						source: 'trend',
						priority: index < 3 ? 'high' : 'low',
						reason: t('contentTools.ideation.trendReason'),
					});
				});
			} catch (error) {
				console.warn('Error getting keyword suggestions:', error);
			}

			// Remove duplicates and sort
			const uniqueIdeas = generatedIdeas.filter((idea, index, self) =>
				index === self.findIndex((i) => i.title === idea.title || i.keyword === idea.keyword)
			);

			uniqueIdeas.sort((a, b) => {
				const priorityOrder = { high: 3, medium: 2, low: 1 };
				return priorityOrder[b.priority] - priorityOrder[a.priority];
			});

			setIdeas(uniqueIdeas.slice(0, 30)); // Top 30 ideas
			showToast(t('contentTools.ideation.toastDone', { count: uniqueIdeas.length }), 'success');
		} catch (error) {
			console.error('Error generating ideas:', error);
			showToast(t('contentTools.ideation.toastError'), 'error');
		} finally {
			setIsGenerating(false);
		}
	};

	const getSourceIcon = (source: ContentIdea['source']) => {
		const icons = {
			trend: '📈',
			competitor: '⚔️',
			paa: '❓',
			related: '🔗',
			gap: '🔍',
		};
		return icons[source];
	};

	const getSourceLabel = (source: ContentIdea['source']) => {
		const labels = {
			trend: 'Trend',
			competitor: 'Competitor',
			paa: 'People Also Ask',
			related: 'Related Search',
			gap: 'Content Gap',
		};
		return labels[source];
	};

	const getPriorityColor = (priority: ContentIdea['priority']) => {
		const colors = {
			high: 'error',
			medium: 'warning',
			low: 'default',
		};
		return colors[priority];
	};

	return (
		<div className="space-y-6">
			<Card>
				<h3 className="text-lg font-bold text-white mb-4">Content Ideation Engine</h3>
				<div className="space-y-4">
					<div>
						<label className="block text-sm font-medium text-gray-300 mb-2">
							{t('contentTools.ideation.primaryKeyword')}
						</label>
						<input
							type="text"
							value={primaryKeyword}
							onChange={(e) => setPrimaryKeyword(e.target.value)}
							placeholder={project.primary_keyword || t('contentTools.ideation.keywordPlaceholder')}
							className="w-full px-4 py-2 bg-cosmic-dark border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-cosmic-cyan text-white"
							disabled={isGenerating}
						/>
					</div>
					<Button
						onClick={handleGenerateIdeas}
						variant="primary"
						fullWidth
						loading={isGenerating}
						disabled={!primaryKeyword.trim() || isGenerating}
					>
						{isGenerating ? t('contentTools.ideation.generating') : t('contentTools.ideation.generateButton')}
					</Button>
					<p className="text-xs text-gray-400">
						{t('contentTools.ideation.description')}
					</p>
				</div>
			</Card>

			{/* Ideas List */}
			{ideas.length > 0 && (
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<h3 className="text-lg font-bold text-white">
							Content Ideas ({ideas.length})
						</h3>
						<div className="flex gap-2">
							<Badge variant="info" size="sm">
								{t('contentTools.ideation.highPriorityCount', { count: ideas.filter((i) => i.priority === 'high').length })}
							</Badge>
							<Badge variant="success" size="sm">
								{ideas.filter((i) => i.source === 'paa').length} PAA
							</Badge>
						</div>
					</div>

					{ideas.map((idea) => (
						<Card key={idea.id} className="border-l-4 border-l-cosmic-cyan">
							<div className="flex items-start justify-between gap-4">
								<div className="flex-1">
									<div className="flex items-center gap-3 mb-2 flex-wrap">
										<span className="text-2xl">{getSourceIcon(idea.source)}</span>
										<h4 className="font-semibold text-white">{idea.title}</h4>
										<Badge variant="default" size="sm">
											{getSourceLabel(idea.source)}
										</Badge>
										<Badge variant={getPriorityColor(idea.priority) as any} size="sm">
											{idea.priority === 'high' ? t('contentTools.ideation.priorityHigh') : idea.priority === 'medium' ? t('contentTools.ideation.priorityMedium') : t('contentTools.ideation.priorityLow')}
										</Badge>
									</div>
									<p className="text-sm text-gray-400 mb-2">{idea.description}</p>
									<div className="flex items-center gap-4 text-xs text-gray-500">
										<span>Keyword: <strong className="text-cosmic-cyan">{idea.keyword}</strong></span>
										{idea.searchVolume && (
											<span>Volume: <strong>{t('contentTools.ideation.perMonth', { volume: idea.searchVolume.toLocaleString(uiLocaleTag()) })}</strong></span>
										)}
										{idea.difficulty && (
											<span>Difficulty: <strong>{Math.round(idea.difficulty)}/100</strong></span>
										)}
									</div>
									<p className="text-xs text-gray-500 mt-2">💡 {idea.reason}</p>
								</div>
								<Button
									variant="secondary"
									size="sm"
									onClick={() => {
										// Navigate to proposals with keyword
										window.location.href = `/proposals?keyword=${encodeURIComponent(idea.keyword)}`;
									}}
								>
									{t('contentTools.ideation.generate')}
								</Button>
							</div>
						</Card>
					))}
				</div>
			)}

			{ideas.length === 0 && !isGenerating && (
				<EmptyState
					icon="💡"
					title={t('emptyStates.noIdeasTitle')}
					description={t('emptyStates.noIdeasDesc')}
					variant="minimal"
				/>
			)}

			<Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={hideToast} />
		</div>
	);
};


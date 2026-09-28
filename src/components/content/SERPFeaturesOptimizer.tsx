/**
 * SERP Features Optimization Component
 * 
 * Optimizes content for SERP features: Featured Snippets, People Also Ask, etc.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPeopleAlsoAsk, getSERPAnalysis } from '../../services/dataforseo';
import { projectResearchLocale } from '../../lib/seoMarkets';
import { useProject } from '../../hooks/useProjects';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useToast } from '../../hooks/useToast';
import { Toast } from '../ui/Toast';
import type { Content } from '../../types/database';

interface SERPFeaturesOptimizerProps {
	content: Content;
	onContentUpdated?: () => void;
}

interface SERPFeature {
	type: 'featured_snippet' | 'people_also_ask' | 'related_searches' | 'knowledge_panel';
	title: string;
	content: string;
	optimization: string;
	priority: 'high' | 'medium' | 'low';
}

export const SERPFeaturesOptimizer = ({ content }: SERPFeaturesOptimizerProps) => {
	const { t } = useTranslation();
	const [isAnalyzing, setIsAnalyzing] = useState(false);
	const [features, setFeatures] = useState<SERPFeature[]>([]);
	const { toast, showToast, hideToast } = useToast();
	const { data: project } = useProject(content.project_id);

	const primaryKeyword = content.keywords_used?.[0] || content.topic || '';

	const handleAnalyze = async () => {
		if (!primaryKeyword) {
			showToast(t('contentTools.serpFeatures.toastNoKeyword'), 'warning');
			return;
		}

		setIsAnalyzing(true);
		setFeatures([]);

		try {
			// Get SERP features
			// The project's own market/language (US/English when unset) — never a hardcoded country.
			const { locationCode, languageCode } = projectResearchLocale(project ?? {});
			const serpResults = await getSERPAnalysis(primaryKeyword, locationCode, languageCode, 10);
			const paaQuestions = await getPeopleAlsoAsk(primaryKeyword, locationCode, languageCode);

			const optimizations: SERPFeature[] = [];

			// Featured Snippet Optimization
			const topResult = serpResults[0];
			if (topResult) {
				optimizations.push({
					type: 'featured_snippet',
					title: 'Featured Snippet Optimization',
					content: t('contentTools.serpFeatures.snippetContent', { title: topResult.title }),
					optimization: t('contentTools.serpFeatures.snippetOptimization'),
					priority: 'high',
				});
			}

			// People Also Ask Optimization
			paaQuestions.forEach((paa, index) => {
				const questionLower = paa.question.toLowerCase();
				const hasAnswer = content.body.toLowerCase().includes(questionLower.substring(0, 20));

				if (!hasAnswer) {
					optimizations.push({
						type: 'people_also_ask',
						title: `PAA: ${paa.question}`,
						content: t('contentTools.serpFeatures.paaContent', { answer: paa.answer.substring(0, 150) }),
						optimization: t('contentTools.serpFeatures.paaOptimization', { question: paa.question, answer: paa.answer.substring(0, 200) }),
						priority: index < 3 ? 'high' : 'medium',
					});
				}
			});

			// Content Structure for SERP
			const hasH1 = content.body.match(/^#\s+/m);
			const h2Count = (content.body.match(/^##\s+/gm) || []).length;
			const hasList = content.body.match(/^[-*]\s+/m) || content.body.match(/^\d+\.\s+/m);

			if (!hasH1) {
				optimizations.push({
					type: 'featured_snippet',
					title: t('contentTools.serpFeatures.missingH1Title'),
					content: t('contentTools.serpFeatures.missingH1Content'),
					optimization: t('contentTools.serpFeatures.missingH1Optimization'),
					priority: 'high',
				});
			}

			if (h2Count < 3) {
				optimizations.push({
					type: 'featured_snippet',
					title: t('contentTools.serpFeatures.fewHeadingsTitle'),
					content: t('contentTools.serpFeatures.fewHeadingsContent', { count: h2Count }),
					optimization: t('contentTools.serpFeatures.fewHeadingsOptimization'),
					priority: 'medium',
				});
			}

			if (!hasList) {
				optimizations.push({
					type: 'featured_snippet',
					title: t('contentTools.serpFeatures.noListsTitle'),
					content: t('contentTools.serpFeatures.noListsContent'),
					optimization: t('contentTools.serpFeatures.noListsOptimization'),
					priority: 'medium',
				});
			}

			setFeatures(optimizations);
			showToast(t('contentTools.serpFeatures.toastDone', { count: optimizations.length }), 'success');
		} catch (error) {
			console.error('Error analyzing SERP features:', error);
			showToast(t('contentTools.serpFeatures.toastError'), 'error');
		} finally {
			setIsAnalyzing(false);
		}
	};

	const getFeatureIcon = (type: SERPFeature['type']) => {
		const icons = {
			featured_snippet: '⭐',
			people_also_ask: '❓',
			related_searches: '🔍',
			knowledge_panel: '📊',
		};
		return icons[type];
	};

	const getPriorityColor = (priority: SERPFeature['priority']) => {
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
				<h3 className="text-lg font-bold text-white mb-4">SERP Features Optimization</h3>
				<div className="space-y-4">
					<p className="text-sm text-gray-400">
						{t('contentTools.serpFeatures.description')}
					</p>
					<Button
						onClick={handleAnalyze}
						variant="primary"
						fullWidth
						loading={isAnalyzing}
						disabled={!primaryKeyword || isAnalyzing}
					>
						{isAnalyzing ? t('contentTools.serpFeatures.analyzing') : t('contentTools.serpFeatures.analyzeButton')}
					</Button>
				</div>
			</Card>

			{/* Features List */}
			{features.length > 0 && (
				<div className="space-y-4">
					<h3 className="text-lg font-bold text-white">
						{t('contentTools.serpFeatures.foundTitle', { count: features.length })}
					</h3>

					{features.map((feature, index) => (
						<Card key={index} className="border-l-4 border-l-cosmic-cyan">
							<div className="flex items-start justify-between gap-4">
								<div className="flex-1">
									<div className="flex items-center gap-3 mb-2">
										<span className="text-2xl">{getFeatureIcon(feature.type)}</span>
										<h4 className="font-semibold text-white">{feature.title}</h4>
										<Badge variant={getPriorityColor(feature.priority) as any} size="sm">
											{feature.priority === 'high' ? t('contentTools.serpFeatures.priorityHigh') : feature.priority === 'medium' ? t('contentTools.serpFeatures.priorityMedium') : t('contentTools.serpFeatures.priorityLow')}
										</Badge>
									</div>
									<p className="text-sm text-gray-400 mb-3">{feature.content}</p>
									<div className="p-3 bg-cosmic-cyan/10 border border-cosmic-cyan/30 rounded-lg">
										<p className="text-xs text-gray-400 mb-1">{t('contentTools.serpFeatures.suggestedOptimization')}</p>
										<p className="text-sm text-cosmic-cyan whitespace-pre-wrap">{feature.optimization}</p>
									</div>
								</div>
							</div>
						</Card>
					))}
				</div>
			)}

			{features.length === 0 && !isAnalyzing && (
				<Card>
					<p className="text-center text-gray-400 py-8">
						{t('contentTools.serpFeatures.emptyHint')}
					</p>
				</Card>
			)}

			<Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={hideToast} />
		</div>
	);
};


/**
 * Content Recommendations Engine Component
 * 
 * Intelligent content recommendations based on performance and competitor analysis
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabaseClient';
import { getSERPAnalysis } from '../../services/dataforseo';
import { projectResearchLocale } from '../../lib/seoMarkets';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useToast } from '../../hooks/useToast';
import { Toast } from '../ui/Toast';
import { EmptyState } from '../ui/EmptyState';
import type { Project } from '../../types/database';
import type { Content } from '../../types/database';

interface ContentRecommendationsProps {
	project: Project;
}

interface Recommendation {
	id: string;
	type: 'expand' | 'improve' | 'create' | 'optimize' | 'refresh';
	title: string;
	description: string;
	contentId?: string;
	keyword?: string;
	priority: 'high' | 'medium' | 'low';
	reason: string;
	action: string;
}

export const ContentRecommendations = ({ project }: ContentRecommendationsProps) => {
	const { t } = useTranslation();
	const [isAnalyzing, setIsAnalyzing] = useState(false);
	const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
	const { toast, showToast, hideToast } = useToast();

	// Get project content
	const { data: projectContent } = useQuery({
		queryKey: ['content', 'project', project.id],
		queryFn: async () => {
			const { data, error } = await supabase
				.from('content')
				.select('*')
				.eq('project_id', project.id)
				.order('generated_date', { ascending: false });

			if (error) throw error;
			return (data || []) as Content[];
		},
	});

	const handleAnalyze = async () => {
		if (!project.primary_keyword) {
			showToast(t('contentTools.recommendations.toastNoKeyword'), 'warning');
			return;
		}

		setIsAnalyzing(true);
		setRecommendations([]);

		try {
			const recs: Recommendation[] = [];

			// Get SERP analysis
			const serpResults = await getSERPAnalysis(
				project.primary_keyword,
				projectResearchLocale(project).locationCode,
				project.language,
				10,
			);

			// Analyze existing content
			if (projectContent && projectContent.length > 0) {
				// Recommendation 1: Improve low-scoring content
				projectContent
					.filter((c) => (c.seo_score || 0) < 60)
					.slice(0, 5)
					.forEach((content) => {
						recs.push({
							id: `rec-improve-${content.id}`,
							type: 'improve',
							title: t('contentTools.recommendations.improveTitle', { title: content.title }),
							description: t('contentTools.recommendations.improveDescription', { score: content.seo_score || 0 }),
							contentId: content.id,
							priority: 'high',
							reason: t('contentTools.recommendations.improveReason'),
							action: t('contentTools.recommendations.improveAction'),
						});
					});

				// Recommendation 2: Expand short content
				projectContent
					.filter((c) => {
						const wordCount = c.body.split(/\s+/).length;
						return wordCount < 1000;
					})
					.slice(0, 5)
					.forEach((content) => {
						recs.push({
							id: `rec-expand-${content.id}`,
							type: 'expand',
							title: t('contentTools.recommendations.expandTitle', { title: content.title }),
							description: t('contentTools.recommendations.expandDescription', { count: content.body.split(/\s+/).length }),
							contentId: content.id,
							priority: 'medium',
							reason: t('contentTools.recommendations.expandReason'),
							action: t('contentTools.recommendations.expandAction'),
						});
					});

				// Recommendation 3: Refresh old content
				const sixMonthsAgo = new Date();
				sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
				projectContent
					.filter((c) => new Date(c.generated_date) < sixMonthsAgo)
					.slice(0, 5)
					.forEach((content) => {
						recs.push({
							id: `rec-refresh-${content.id}`,
							type: 'refresh',
							title: t('contentTools.recommendations.refreshTitle', { title: content.title }),
							description: t('contentTools.recommendations.refreshDescription', { count: Math.floor((Date.now() - new Date(content.generated_date).getTime()) / (1000 * 60 * 60 * 24 * 30)) }),
							contentId: content.id,
							priority: 'medium',
							reason: t('contentTools.recommendations.refreshReason'),
							action: t('contentTools.recommendations.refreshAction'),
						});
					});
			}

			// Recommendation 4: Create content for competitor topics
			serpResults.slice(0, 5).forEach((result, index) => {
				const isCovered = projectContent?.some((c) =>
					c.title.toLowerCase().includes(result.title.toLowerCase().substring(0, 20))
				);

				if (!isCovered) {
					recs.push({
						id: `rec-create-${index}`,
						type: 'create',
						title: t('contentTools.recommendations.createTitle', { title: result.title.substring(0, 60) }),
						description: t('contentTools.recommendations.createDescription'),
						keyword: result.title,
						priority: index < 3 ? 'high' : 'medium',
						reason: t('contentTools.recommendations.createReason'),
						action: t('contentTools.recommendations.createAction'),
					});
				}
			});

			// Recommendation 5: Optimize for featured snippets
			projectContent
				?.filter((c) => (c.seo_score || 0) >= 70)
				.slice(0, 3)
				.forEach((content) => {
					recs.push({
						id: `rec-optimize-${content.id}`,
						type: 'optimize',
						title: t('contentTools.recommendations.optimizeTitle', { title: content.title }),
						description: t('contentTools.recommendations.optimizeDescription'),
						contentId: content.id,
						priority: 'medium',
						reason: t('contentTools.recommendations.optimizeReason'),
						action: t('contentTools.recommendations.optimizeAction'),
					});
				});

			// Sort by priority
			recs.sort((a, b) => {
				const priorityOrder = { high: 3, medium: 2, low: 1 };
				return priorityOrder[b.priority] - priorityOrder[a.priority];
			});

			setRecommendations(recs.slice(0, 20));
			showToast(t('contentTools.recommendations.toastDone', { count: recs.length }), 'success');
		} catch (error) {
			console.error('Error analyzing recommendations:', error);
			showToast(t('contentTools.recommendations.toastError'), 'error');
		} finally {
			setIsAnalyzing(false);
		}
	};

	const getTypeIcon = (type: Recommendation['type']) => {
		const icons = {
			expand: '📈',
			improve: '✨',
			create: '➕',
			optimize: '⭐',
			refresh: '🔄',
		};
		return icons[type];
	};

	const getTypeLabel = (type: Recommendation['type']) => {
		const labels = {
			expand: t('contentTools.recommendations.typeExpand'),
			improve: t('contentTools.recommendations.typeImprove'),
			create: t('contentTools.recommendations.typeCreate'),
			optimize: t('contentTools.recommendations.typeOptimize'),
			refresh: t('contentTools.recommendations.typeRefresh'),
		};
		return labels[type];
	};

	const getPriorityColor = (priority: Recommendation['priority']) => {
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
				<h3 className="text-lg font-bold text-white mb-4">Content Recommendations Engine</h3>
				<div className="space-y-4">
					<p className="text-sm text-gray-400">
						{t('contentTools.recommendations.description')}
					</p>
					<Button
						onClick={handleAnalyze}
						variant="primary"
						fullWidth
						loading={isAnalyzing}
						disabled={!project.primary_keyword || isAnalyzing}
					>
						{isAnalyzing ? t('contentTools.recommendations.analyzing') : t('contentTools.recommendations.analyzeButton')}
					</Button>
				</div>
			</Card>

			{/* Recommendations List */}
			{recommendations.length > 0 && (
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<h3 className="text-lg font-bold text-white">
							{t('contentTools.recommendations.listTitle', { count: recommendations.length })}
						</h3>
						<Badge variant="info" size="sm">
							{t('contentTools.recommendations.highPriorityCount', { count: recommendations.filter((r) => r.priority === 'high').length })}
						</Badge>
					</div>

					{recommendations.map((rec) => (
						<Card key={rec.id} className="border-l-4 border-l-cosmic-cyan">
							<div className="flex items-start justify-between gap-4">
								<div className="flex-1">
									<div className="flex items-center gap-3 mb-2 flex-wrap">
										<span className="text-2xl">{getTypeIcon(rec.type)}</span>
										<h4 className="font-semibold text-white">{rec.title}</h4>
										<Badge variant="default" size="sm">
											{getTypeLabel(rec.type)}
										</Badge>
										<Badge variant={getPriorityColor(rec.priority) as any} size="sm">
											{rec.priority === 'high' ? t('contentTools.recommendations.priorityHigh') : rec.priority === 'medium' ? t('contentTools.recommendations.priorityMedium') : t('contentTools.recommendations.priorityLow')}
										</Badge>
									</div>
									<p className="text-sm text-gray-400 mb-2">{rec.description}</p>
									<p className="text-xs text-gray-500">💡 {rec.reason}</p>
								</div>
								<Button
									variant="secondary"
									size="sm"
									onClick={() => {
										if (rec.contentId) {
											window.location.href = `/content/${rec.contentId}`;
										} else if (rec.keyword) {
											window.location.href = `/proposals?keyword=${encodeURIComponent(rec.keyword)}`;
										}
									}}
								>
									{rec.action}
								</Button>
							</div>
						</Card>
					))}
				</div>
			)}

			{recommendations.length === 0 && !isAnalyzing && (
				<EmptyState
					icon="💡"
					title={t('emptyStates.noRecommendationsTitle')}
					description={t('emptyStates.noRecommendationsDesc')}
					variant="minimal"
				/>
			)}

			<Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={hideToast} />
		</div>
	);
};


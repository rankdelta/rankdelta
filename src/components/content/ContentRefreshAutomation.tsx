/**
 * Content Refresh Automation Component
 * 
 * UI for managing automatic content refresh
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { findContentToRefresh, refreshContent, suggestedChangeLabel } from '../../services/contentRefresh';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { useToast } from '../../hooks/useToast';
import { Toast } from '../ui/Toast';
import { EmptyState } from '../ui/EmptyState';
import type { Project } from '../../types/database';
import type { ContentRefreshCandidate } from '../../services/contentRefresh';

interface ContentRefreshAutomationProps {
	project: Project;
}

export const ContentRefreshAutomation = ({ project }: ContentRefreshAutomationProps) => {
	const { t } = useTranslation();
	const [isRefreshing, setIsRefreshing] = useState<string | null>(null);
	const { toast, showToast, hideToast } = useToast();

	const { data: candidates, isLoading, refetch } = useQuery({
		queryKey: ['content-refresh-candidates', project.id],
		queryFn: () => findContentToRefresh(project.id),
		enabled: !!project.id,
	});

	const handleRefresh = async (candidate: ContentRefreshCandidate) => {
		setIsRefreshing(candidate.content.id);

		try {
			await refreshContent(candidate.content, project, candidate.suggestedChanges);
			showToast(t('contentTools.refreshAutomation.refreshed', { title: candidate.content.title }), 'success');
			refetch();
		} catch (error) {
			console.error('Error refreshing content:', error);
			showToast(t('contentTools.refreshAutomation.refreshError'), 'error');
		} finally {
			setIsRefreshing(null);
		}
	};

	const getReasonLabel = (reason: ContentRefreshCandidate['reason']) => {
		const labels = {
			outdated: t('contentTools.refreshAutomation.reasons.outdated'),
			low_score: t('contentTools.refreshAutomation.reasons.low_score'),
			competitor_improved: t('contentTools.refreshAutomation.reasons.competitor_improved'),
			missing_updates: t('contentTools.refreshAutomation.reasons.missing_updates'),
		};
		return labels[reason];
	};

	const getReasonIcon = (reason: ContentRefreshCandidate['reason']) => {
		const icons = {
			outdated: '📅',
			low_score: '📉',
			competitor_improved: '⚔️',
			missing_updates: '🔄',
		};
		return icons[reason];
	};

	const getPriorityColor = (priority: ContentRefreshCandidate['priority']) => {
		const colors = {
			high: 'error',
			medium: 'warning',
			low: 'default',
		};
		return colors[priority];
	};

	if (isLoading) {
		return <LoadingSpinner text={t('contentTools.refreshAutomation.analyzing')} />;
	}

	return (
		<div className="space-y-6">
			<Card>
				<h3 className="text-lg font-bold text-white mb-4">{t('contentTools.refreshAutomation.title')}</h3>
				<div className="space-y-4">
					<p className="text-sm text-gray-400">
						{t('contentTools.refreshAutomation.description')}
					</p>
					<Button onClick={() => refetch()} variant="secondary" fullWidth>
						{t('contentTools.refreshAutomation.reloadAnalysis')}
					</Button>
				</div>
			</Card>

			{/* Candidates List */}
			{candidates && candidates.length > 0 ? (
				<div className="space-y-4">
					<div className="flex items-center justify-between">
						<h3 className="text-lg font-bold text-white">
							{t('contentTools.refreshAutomation.toRefresh', { count: candidates.length })}
						</h3>
						<Badge variant="info" size="sm">
							{t('contentTools.refreshAutomation.highPriorityCount', { count: candidates.filter((c) => c.priority === 'high').length })}
						</Badge>
					</div>

					{candidates.map((candidate) => (
						<Card key={candidate.content.id} className="border-l-4 border-l-cosmic-cyan">
							<div className="flex items-start justify-between gap-4">
								<div className="flex-1">
									<div className="flex items-center gap-3 mb-2 flex-wrap">
										<span className="text-2xl">{getReasonIcon(candidate.reason)}</span>
										<h4 className="font-semibold text-white">{candidate.content.title}</h4>
										<Badge variant="default" size="sm">
											{getReasonLabel(candidate.reason)}
										</Badge>
										<Badge variant={getPriorityColor(candidate.priority) as any} size="sm">
											{candidate.priority === 'high' ? t('contentTools.refreshAutomation.priority.high') : candidate.priority === 'medium' ? t('contentTools.refreshAutomation.priority.medium') : t('contentTools.refreshAutomation.priority.low')}
										</Badge>
									</div>
									<div className="flex items-center gap-4 text-sm text-gray-400 mb-3">
										<span>{t('contentTools.refreshAutomation.lastUpdated', { count: candidate.daysSinceUpdate })}</span>
										{candidate.content.seo_score && (
											<span>{t('contentTools.refreshAutomation.seoScore', { score: candidate.content.seo_score })}</span>
										)}
									</div>
									<div className="p-3 bg-gray-800 rounded-lg">
										<p className="text-xs text-gray-400 mb-2">{t('contentTools.refreshAutomation.suggestedChanges')}</p>
										<ul className="space-y-1">
											{candidate.suggestedChanges.map((change, index) => (
												<li key={index} className="text-xs text-cosmic-cyan flex items-start gap-2">
													<span>•</span>
													<span>{suggestedChangeLabel(change, t)}</span>
												</li>
											))}
										</ul>
									</div>
								</div>
								<Button
									variant="primary"
									size="sm"
									onClick={() => handleRefresh(candidate)}
									loading={isRefreshing === candidate.content.id}
									disabled={!!isRefreshing}
								>
									{isRefreshing === candidate.content.id ? t('contentTools.refreshAutomation.refreshing') : t('contentTools.refreshAutomation.refresh')}
								</Button>
							</div>
						</Card>
					))}
				</div>
			) : (
				<EmptyState
					icon="✅"
					title={t('contentTools.refreshAutomation.emptyTitle')}
					description={t('contentTools.refreshAutomation.emptyDescription')}
					variant="minimal"
				/>
			)}

			<Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={hideToast} />
		</div>
	);
};


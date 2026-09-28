/**
 * Topical Map Progress Component
 * 
 * Visualizes the progress of topical map generation for SEO topical authority.
 * Shows incremental results, time estimates, and coverage metrics.
 * 
 * Based on Matt Diggity & Kyle Roof methodology:
 * - Complete topical coverage = Topical Authority
 * - 6-10 clusters minimum for semantic completeness
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { uiLocaleTag } from '../../common/uiLocale';

export interface TopicalClusterStatus {
	name: string;
	status: 'pending' | 'generating' | 'completed' | 'error';
	proposalId?: string;
	proposalTitle?: string;
	searchVolume?: number;
	difficulty?: number;
	error?: string;
}

interface TopicalMapProgressProps {
	clusters: TopicalClusterStatus[];
	currentClusterIndex: number;
	totalClusters: number;
	isGenerating: boolean;
	startTime?: Date;
	onViewProposal?: (proposalId: string) => void;
}

/**
 * Calculate topical authority coverage percentage
 * 100% = all clusters completed = full topical authority
 */
const calculateAuthorityCoverage = (clusters: TopicalClusterStatus[]): number => {
	if (clusters.length === 0) return 0;
	const completed = clusters.filter((c) => c.status === 'completed').length;
	return Math.round((completed / clusters.length) * 100);
};

/**
 * Get authority level based on coverage
 */
const getAuthorityLevel = (coverage: number, t: TFunction): { level: string; color: string; description: string } => {
	if (coverage >= 90) return { level: t('contentTools.topicalMap.levelExcellent'), color: 'text-cosmic-green', description: t('contentTools.topicalMap.levelExcellentDesc') };
	if (coverage >= 70) return { level: t('contentTools.topicalMap.levelGood'), color: 'text-cosmic-cyan', description: t('contentTools.topicalMap.levelGoodDesc') };
	if (coverage >= 50) return { level: t('contentTools.topicalMap.levelPartial'), color: 'text-status-warning', description: t('contentTools.topicalMap.levelPartialDesc') };
	if (coverage >= 25) return { level: t('contentTools.topicalMap.levelInitial'), color: 'text-orange-400', description: t('contentTools.topicalMap.levelInitialDesc') };
	return { level: t('contentTools.topicalMap.levelLow'), color: 'text-status-error', description: t('contentTools.topicalMap.levelLowDesc') };
};

/**
 * Estimate remaining time based on progress
 */
const estimateRemainingTime = (
	currentIndex: number,
	total: number,
	startTime?: Date
): string => {
	if (!startTime || currentIndex === 0) {
		// Initial estimate: ~30-60 seconds per cluster
		const remaining = total - currentIndex;
		const minMinutes = Math.ceil(remaining * 0.5);
		const maxMinutes = remaining;
		return `~${minMinutes}-${maxMinutes} min`;
	}

	const elapsedMs = Date.now() - startTime.getTime();
	const msPerCluster = elapsedMs / currentIndex;
	const remainingClusters = total - currentIndex;
	const remainingMs = msPerCluster * remainingClusters;
	
	if (remainingMs < 60000) {
		return `~${Math.ceil(remainingMs / 1000)} sec`;
	}
	return `~${Math.ceil(remainingMs / 60000)} min`;
};

export const TopicalMapProgress = ({
	clusters,
	currentClusterIndex,
	totalClusters,
	isGenerating,
	startTime,
	onViewProposal,
}: TopicalMapProgressProps) => {
	const { t } = useTranslation();
	const coverage = calculateAuthorityCoverage(clusters);
	const authorityLevel = getAuthorityLevel(coverage, t);
	const completedCount = clusters.filter((c) => c.status === 'completed').length;
	const errorCount = clusters.filter((c) => c.status === 'error').length;

	return (
		<Card className="border-cosmic-purple/30 bg-gradient-to-br from-cosmic-dark to-cosmic-purple/10">
			{/* Header */}
			<div className="flex items-center justify-between mb-4">
				<div>
					<h3 className="text-lg font-bold text-white flex items-center gap-2">
						🗺️ Topical Map Progress
						{isGenerating && <LoadingSpinner size="sm" />}
					</h3>
					<p className="text-sm text-gray-400">
						{t('contentTools.topicalMap.subtitle')}
					</p>
				</div>
				<div className="text-right">
					<div className={`text-2xl font-bold ${authorityLevel.color}`}>
						{coverage}%
					</div>
					<div className="text-xs text-gray-500">{t('contentTools.topicalMap.coverage')}</div>
				</div>
			</div>

			{/* Progress Bar */}
			<div className="mb-4">
				<div className="flex items-center justify-between text-sm mb-2">
					<span className="text-gray-400">
						{t('contentTools.topicalMap.clustersCompleted', { done: completedCount, total: totalClusters })}
					</span>
					{isGenerating && (
						<span className="text-cosmic-cyan">
							{t('contentTools.topicalMap.remaining', { time: estimateRemainingTime(currentClusterIndex, totalClusters, startTime) })}
						</span>
					)}
				</div>
				<div className="h-3 bg-cosmic-dark rounded-full overflow-hidden">
					<motion.div
						className="h-full bg-gradient-to-r from-cosmic-purple via-cosmic-cyan to-cosmic-green"
						initial={{ width: 0 }}
						animate={{ width: `${coverage}%` }}
						transition={{ duration: 0.5, ease: 'easeOut' }}
					/>
				</div>
			</div>

			{/* Authority Level */}
			<div className="mb-4 p-3 rounded-lg bg-cosmic-dark/50 border border-gray-700">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<span className="text-sm text-gray-400">Topical Authority:</span>
						<Badge variant={coverage >= 70 ? 'success' : coverage >= 40 ? 'warning' : 'error'}>
							{authorityLevel.level}
						</Badge>
					</div>
					<span className="text-xs text-gray-500">{authorityLevel.description}</span>
				</div>
			</div>

			{/* Clusters List */}
			<div className="space-y-2 max-h-64 overflow-y-auto">
				<AnimatePresence>
					{clusters.map((cluster, index) => (
						<motion.div
							key={cluster.name}
							initial={{ opacity: 0, x: -20 }}
							animate={{ opacity: 1, x: 0 }}
							transition={{ delay: index * 0.05 }}
							className={`p-3 rounded-lg border ${
								cluster.status === 'generating'
									? 'border-cosmic-cyan bg-cosmic-cyan/10'
									: cluster.status === 'completed'
									? 'border-cosmic-green/50 bg-cosmic-green/5'
									: cluster.status === 'error'
									? 'border-status-error/50 bg-status-error/5'
									: 'border-gray-700 bg-cosmic-dark/30'
							}`}
						>
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-3">
									{/* Status Icon */}
									<div className="w-6 h-6 flex items-center justify-center">
										{cluster.status === 'generating' ? (
											<LoadingSpinner size="sm" />
										) : cluster.status === 'completed' ? (
											<span className="text-cosmic-green">✓</span>
										) : cluster.status === 'error' ? (
											<span className="text-status-error">✗</span>
										) : (
											<span className="text-gray-500">○</span>
										)}
									</div>
									
									{/* Cluster Info */}
									<div>
										<div className="font-medium text-white text-sm">
											{cluster.proposalTitle || cluster.name}
										</div>
										{cluster.status === 'completed' && (
											<div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
												{cluster.searchVolume != null && (
													<span>
														📊 {t('contentTools.topicalMap.perMonth', { volume: cluster.searchVolume.toLocaleString(uiLocaleTag()) })}
													</span>
												)}
												{cluster.difficulty != null && (
													<span>
														🎯 Diff: {Math.round(cluster.difficulty)}
													</span>
												)}
											</div>
										)}
										{cluster.status === 'error' && cluster.error && (
											<div className="text-xs text-status-error mt-1">
												{cluster.error}
											</div>
										)}
									</div>
								</div>

								{/* Actions */}
								{cluster.status === 'completed' && cluster.proposalId && onViewProposal && (
									<button
										onClick={() => onViewProposal(cluster.proposalId!)}
										className="text-xs text-cosmic-cyan hover:text-cosmic-cyan/80 transition-colors"
									>
										{t('contentTools.topicalMap.view')}
									</button>
								)}
							</div>
						</motion.div>
					))}
				</AnimatePresence>
			</div>

			{/* Footer Stats */}
			{errorCount > 0 && (
				<div className="mt-4 p-2 rounded bg-status-error/10 border border-status-error/30">
					<span className="text-sm text-status-error">
						⚠️ {t('contentTools.topicalMap.errorsNotice', { count: errorCount })}
					</span>
				</div>
			)}

			{/* SEO Tips */}
			{!isGenerating && coverage < 100 && (
				<div className="mt-4 p-3 rounded-lg bg-cosmic-purple/10 border border-cosmic-purple/30">
					<div className="text-sm text-cosmic-purple font-medium mb-1">
						💡 {t('contentTools.topicalMap.tipTitle')}
					</div>
					<p className="text-xs text-gray-400">
						<Trans i18nKey="contentTools.topicalMap.tipBody" components={{ strong: <strong /> }} />
					</p>
				</div>
			)}
		</Card>
	);
};

export default TopicalMapProgress;


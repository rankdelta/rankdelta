/**
 * Competitor Analysis Component
 * 
 * Analyzes competitor rankings and performance
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MagnifyingGlassIcon, LightBulbIcon } from '@heroicons/react/24/outline';
import { useCompareCompetitors } from '../../hooks/useRankTracking';
import { useCompetitorBrands } from '../../hooks/useVisibilityTracker';
import { resolveLocale } from '../../services/dataforseo';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useToast } from '../../hooks/useToast';
import { Toast } from '../ui/Toast';
import { motion } from 'framer-motion';
import type { Project } from '../../types/database';
import { hrefOf } from '../../lib/seoUrls';

interface CompetitorAnalysisProps {
	project: Project;
}

export const CompetitorAnalysis = ({ project }: CompetitorAnalysisProps) => {
	const [keyword, setKeyword] = useState(project.primary_keyword || '');
	const [competitorUrls, setCompetitorUrls] = useState('');
	const [results, setResults] = useState<Array<{ url: string; position: number | null }>>([]);
	const { t } = useTranslation();
	const compareCompetitors = useCompareCompetitors();
	const { toast, showToast, hideToast } = useToast();
	const { data: storedCompetitors } = useCompetitorBrands(project.id);

	// Pre-fill the competitor list with the ones already configured for this project (onboarding /
	// Visibilità AI) so the user doesn't have to re-type domains we already know.
	useEffect(() => {
		if (!storedCompetitors?.length) return;
		const domains = storedCompetitors
			.map((c) => c.domain?.trim())
			.filter((d): d is string => !!d)
			.map((d) => (d.startsWith('http') ? d : `https://${d.replace(/^\/+/, '')}`));
		if (domains.length === 0) return;
		setCompetitorUrls((current) => (current.trim().length > 0 ? current : domains.join('\n')));
	}, [storedCompetitors]);

	const handleAnalyze = async () => {
		if (!keyword) {
			showToast(t('competitorTab.errKeyword'), 'error');
			return;
		}

		const urls = competitorUrls
			.split(/[,\n]/)
			.map((u) => u.trim())
			.filter((u) => u.length > 0 && u.startsWith('http'));

		if (urls.length === 0) {
			showToast(t('competitorTab.errAtLeastOneUrl'), 'error');
			return;
		}

		try {
			const { locationCode, languageCode } = resolveLocale(project.market, project.language);
			const comparison = await compareCompetitors.mutateAsync({
				keyword,
				competitorUrls: urls,
				locationCode,
				languageCode,
			});
			setResults(comparison);
			showToast(t('competitorTab.toastComplete'), 'success');
		} catch (error) {
			showToast(t('competitorTab.errAnalysis'), 'error');
		}
	};

	return (
		<div className="space-y-6">
			<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
				<h3 className="text-lg font-bold text-white mb-4">{t('competitorTab.title')}</h3>
				<div className="space-y-4">
					<div>
						<label className="block text-sm font-medium text-white/70 mb-2">
							{t('competitorTab.keywordLabel')}
						</label>
						<input
							type="text"
							value={keyword}
							onChange={(e) => setKeyword(e.target.value)}
							placeholder={t('competitorTab.keywordPlaceholder')}
							className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.1] rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-violet-500/30 focus:border-violet-500/50"
						/>
					</div>
					<div>
						<label className="block text-sm font-medium text-white/70 mb-2">
							{t('competitorTab.urlsLabel')}
						</label>
						<textarea
							value={competitorUrls}
							onChange={(e) => setCompetitorUrls(e.target.value)}
							placeholder="https://competitor1.com&#10;https://competitor2.com"
							rows={4}
							className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.1] rounded-xl text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-violet-500/30 focus:border-violet-500/50 font-mono text-sm resize-y"
						/>
						<p className="flex items-center gap-1.5 text-xs text-white/40 mt-2">
							<LightBulbIcon className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />
							{t('competitorTab.urlsHint')}
						</p>
					</div>
					<Button
						onClick={handleAnalyze}
						loading={compareCompetitors.isPending}
						variant="primary"
						fullWidth
					>
						<MagnifyingGlassIcon className="w-4 h-4" strokeWidth={1.8} /> {t('competitorTab.analyzeButton')}
					</Button>
				</div>
			</div>

			{results.length > 0 && (
				<div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
					<h3 className="text-lg font-bold text-white mb-4">{t('competitorTab.resultsFor', { keyword })}</h3>
					<div className="space-y-3">
						{results.map((result, index) => (
							<motion.div
								key={index}
								initial={{ opacity: 0, y: 10 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ delay: index * 0.05 }}
								className="bg-white/[0.02] border border-white/[0.08] rounded-xl p-4 flex items-center justify-between hover:border-white/[0.08] transition-colors"
							>
								<div className="flex-1">
									<p className="text-xs text-white/40 mb-1 font-medium">{t('competitorTab.competitorN', { n: index + 1 })}</p>
									<a
										href={hrefOf(result.url) ?? undefined}
										target="_blank"
										rel="noopener noreferrer"
										className="text-violet-300 hover:text-violet-200 text-sm hover:underline"
									>
										{result.url}
									</a>
								</div>
								<div className="ml-4">
									{result.position ? (
										<Badge variant={result.position <= 10 ? 'success' : result.position <= 30 ? 'warning' : 'default'}>
											{t('competitorTab.positionN', { n: result.position })}
										</Badge>
									) : (
										<Badge variant="default">{t('competitorTab.notInTop100')}</Badge>
									)}
								</div>
							</motion.div>
						))}
					</div>
				</div>
			)}

			<Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={hideToast} />
		</div>
	);
};


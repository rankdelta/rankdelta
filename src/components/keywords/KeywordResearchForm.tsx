/**
 * Keyword Research Form Component
 * 
 * Form for inputting keywords and triggering clustering analysis.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clusterKeywords } from '../../services/clustering';
import { getKeywordData } from '../../services/dataforseo';
import { isValidKeyword, sanitizeString, checkRateLimit } from '../../utils/validation';
import type { Cluster } from '../../services/clustering';

interface KeywordResearchFormProps {
	projectId?: string;
	onClustersGenerated?: (clusters: Cluster[]) => void;
}

// Suppress unused parameter warning - projectId may be used for future features
export const KeywordResearchForm = ({ projectId: _projectId, onClustersGenerated }: KeywordResearchFormProps) => {
	const { t } = useTranslation();

	const [keywords, setKeywords] = useState('');
	const [isProcessing, setIsProcessing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [clusters, setClusters] = useState<Cluster[]>([]);
	const [isEnriching, setIsEnriching] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsProcessing(true);

		// Rate limiting check
		if (!checkRateLimit('keyword-research', 10, 60000)) {
			setError(t('contentGen.errorRateLimit'));
			setIsProcessing(false);
			return;
		}

		try {
			// Sanitize and parse keywords
			const sanitizedInput = sanitizeString(keywords);
			const keywordList = sanitizedInput
				.split(/[,\n]/)
				.map((k) => sanitizeString(k.trim()))
				.filter((k) => k.length > 0 && isValidKeyword(k));

			if (keywordList.length === 0) {
				throw new Error(t('keywordResearch.errorAtLeastOne'));
			}

			if (keywordList.length > 100) {
				throw new Error(t('keywordResearch.errorMax100'));
			}

			setIsEnriching(true);
			
			// Enrich with DataforSEO data
			try {
				const keywordData = await getKeywordData(keywordList);
				console.log('Keyword data enriched:', keywordData);
			} catch (enrichError) {
				console.warn('DataforSEO enrichment failed, continuing with basic clustering:', enrichError);
			}

			const result = await clusterKeywords(keywordList);
			setClusters(result);
			onClustersGenerated?.(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : t('keywordResearch.errorClustering'));
		} finally {
			setIsProcessing(false);
			setIsEnriching(false);
		}
	};

	return (
		<div className="space-y-6">
			<form onSubmit={handleSubmit} className="space-y-4">
				<div>
					<label htmlFor="keywords" className="block text-sm font-medium text-gray-300 mb-2">
						{t('keywordResearch.label')}
					</label>
					<textarea
						id="keywords"
						value={keywords}
						onChange={(e) => setKeywords(e.target.value)}
						required
						rows={8}
						className="w-full px-4 py-2 bg-cosmic-dark border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-cosmic-cyan text-white font-mono text-sm"
						placeholder={t('keywordResearch.placeholder')}
					/>
					<p className="mt-2 text-xs text-gray-400">
						{t('keywordResearch.hint')}
					</p>
				</div>

				{error && (
					<div className="p-3 bg-status-error/20 border border-status-error rounded-lg text-status-error text-sm">
						{error}
					</div>
				)}

				<button
					type="submit"
					disabled={isProcessing}
					className="w-full py-3 bg-cosmic-cyan text-cosmic-dark font-semibold rounded-lg hover:bg-cosmic-green transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
				>
					{isEnriching ? (
						<>
							<svg
								className="animate-spin h-5 w-5"
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
							>
								<circle
									className="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									strokeWidth="4"
								></circle>
								<path
									className="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								></path>
							</svg>
							{t('keywordResearch.enriching')}
						</>
					) : isProcessing ? (
						t('keywordResearch.analyzing')
					) : (
						t('keywordResearch.analyze')
					)}
				</button>
			</form>

			{clusters.length > 0 && (
				<div className="mt-8">
					<h3 className="text-lg font-bold text-white mb-4">{t('keywordResearch.clustersFound', { count: clusters.length })}</h3>
					<div className="space-y-3">
						{clusters.map((cluster, index) => (
							<div
								key={index}
								className="bg-cosmic-dark border border-cosmic-cyan/20 rounded-lg p-4"
							>
								<div className="flex items-start justify-between mb-2">
									<h4 className="font-semibold text-cosmic-cyan">{cluster.name}</h4>
									<div className="flex gap-3 text-xs text-gray-400">
										{cluster.search_volume !== undefined && (
											<span>{t('keywordResearch.volumeLabel')} {cluster.search_volume.toLocaleString()}</span>
										)}
										{cluster.difficulty !== undefined && (
											<span>{t('keywordResearch.difficultyLabel')} {cluster.difficulty}/100</span>
										)}
									</div>
								</div>
								<div className="flex flex-wrap gap-2">
									{cluster.keywords.map((keyword, kIndex) => (
										<span
											key={kIndex}
											className="px-2 py-1 bg-cosmic-dark-soft text-sm text-gray-300 rounded"
										>
											{keyword}
										</span>
									))}
								</div>
								{cluster.gap_analysis && (
									<p className="mt-2 text-sm text-gray-400">{cluster.gap_analysis}</p>
								)}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
};


import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '../ui/Button';
import { useCompareCompetitors } from '../../hooks/useRankTracking';
import { useCompetitorBrands } from '../../hooks/useVisibilityTracker';
import { resolveLocale } from '../../services/dataforseo';
import type { Project } from '../../types/database';

export function CompareKeywordModal({
	project,
	keyword,
	onClose,
}: {
	project: Project;
	keyword: string;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const compareCompetitors = useCompareCompetitors();
	const { data: storedCompetitors } = useCompetitorBrands(project.id);
	const [results, setResults] = useState<Array<{ url: string; position: number | null }>>([]);

	const competitorUrls = (storedCompetitors ?? [])
		.map((c) => c.domain?.trim())
		.filter((d): d is string => !!d)
		.map((d) => (d.startsWith('http') ? d : `https://${d.replace(/^\/+/, '')}`));

	const handleCompare = async () => {
		if (competitorUrls.length === 0) return;
		const { locationCode, languageCode } = resolveLocale(project.market, project.language);
		const comparison = await compareCompetitors.mutateAsync({
			keyword,
			competitorUrls,
			locationCode,
			languageCode,
		});
		setResults(comparison);
	};

	return (
		<>
			<button type="button" className="fixed inset-0 z-[300] bg-black/60" onClick={onClose} aria-label={t('common.close')} />
			<div
				role="dialog"
				className="fixed left-1/2 top-1/2 z-[310] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/[0.1] bg-[#141414] p-6 shadow-2xl"
			>
				<div className="flex items-start justify-between gap-3 mb-4">
					<div>
						<p className="text-white/40 text-xs uppercase tracking-wide">{t('rankings.compareTitle')}</p>
						<h3 className="text-lg font-bold text-white mt-0.5">{keyword}</h3>
					</div>
					<button type="button" onClick={onClose} className="text-white/40 hover:text-white p-1">
						<XMarkIcon className="w-5 h-5" />
					</button>
				</div>

				{competitorUrls.length === 0 ? (
					<p className="text-sm text-white/50 mb-4">{t('rankings.compareNoCompetitors')}</p>
				) : (
					<>
						<p className="text-sm text-white/50 mb-4">{t('rankings.compareDesc', { count: competitorUrls.length })}</p>
						<Button
							variant="primary"
							loading={compareCompetitors.isPending}
							onClick={() => void handleCompare()}
							fullWidth
						>
							{t('rankings.compareRun')}
						</Button>
						{results.length > 0 && (
							<div className="mt-4 rounded-xl border border-white/[0.08] overflow-hidden">
								<table className="w-full text-sm">
									<thead className="bg-white/[0.02] text-white/50 text-xs uppercase">
										<tr>
											<th className="px-3 py-2 text-left">{t('rankings.compareColUrl')}</th>
											<th className="px-3 py-2 text-right">{t('rankings.compareColPosition')}</th>
										</tr>
									</thead>
									<tbody>
										{results.map((r) => (
											<tr key={r.url} className="border-t border-white/[0.06]">
												<td className="px-3 py-2 text-white/70 text-xs truncate max-w-[14rem]">{r.url}</td>
												<td className="px-3 py-2 text-right text-white tabular-nums">
													{r.position != null ? `#${r.position}` : '—'}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</>
				)}

				<div className="mt-4 flex gap-2">
					<Button
						variant="secondary"
						fullWidth
						onClick={() =>
							navigate({
								to: '/agent/$projectId',
								params: { projectId: project.id },
								search: { mode: 'generate', topic: keyword },
							})
						}
					>
						{t('rankings.actionGenerate')}
					</Button>
					<Button variant="ghost" fullWidth onClick={onClose}>
						{t('common.close')}
					</Button>
				</div>
			</div>
		</>
	);
}

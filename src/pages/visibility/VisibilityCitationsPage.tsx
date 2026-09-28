import { useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useVisibilityCitations, useTrackedBrands, useCompetitorBrands } from '../../hooks/useVisibilityTracker';
import { normalizeDomain, isSameOrSubdomain, toHref } from '../../lib/domains';
import { Badge } from '../../components/ui/Badge';

export const VisibilityCitationsPage = () => {
	const { t } = useTranslation();
	const { projectId } = useParams({ strict: false }) as { projectId: string };
	const { data: citations = [], isLoading } = useVisibilityCitations(projectId);
	const { data: brands = [] } = useTrackedBrands(projectId);
	const { data: competitors = [] } = useCompetitorBrands(projectId);
	const [domainFilter, setDomainFilter] = useState('');

	// Label each source domain so the user sees where THEY stand among the sites AI trusts: their own
	// site ("You"), a named competitor, or a neutral third-party source.
	const labelForDomain = useMemo(() => {
		const brandDomains = brands.map((b) => b.domain).filter(Boolean) as string[];
		const compEntries = competitors
			.map((c) => ({ name: c.name, domain: c.domain }))
			.filter((c): c is { name: string; domain: string } => !!c.domain);
		return (domain: string): { kind: 'you' | 'competitor'; name: string } | null => {
			const d = normalizeDomain(domain);
			if (!d) return null;
			if (brandDomains.some((bd) => isSameOrSubdomain(d, bd))) return { kind: 'you', name: t('visibility.citationsYouBadge') };
			const comp = compEntries.find((c) => isSameOrSubdomain(d, c.domain));
			if (comp) return { kind: 'competitor', name: comp.name };
			return null;
		};
	}, [brands, competitors, t]);

	const byDomain = useMemo(() => {
		const m = new Map<string, number>();
		for (const c of citations) {
			const d = c.source_domain || c.source_url || 'unknown';
			m.set(d, (m.get(d) || 0) + 1);
		}
		return [...m.entries()].sort((a, b) => b[1] - a[1]);
	}, [citations]);

	const needle = domainFilter.trim().toLowerCase();
	const filteredDomains = useMemo(() => {
		if (!needle) return byDomain;
		return byDomain.filter(([d]) => d.toLowerCase().includes(needle));
	}, [byDomain, needle]);

	const downloadCsv = () => {
		const header = 'domain_or_url,citation_count\n';
		const body = filteredDomains.map(([d, n]) => `"${String(d).replace(/"/g, '""')}",${n}`).join('\n');
		const blob = new Blob(['\ufeff' + header + body], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `rankdelta-citations-${projectId.slice(0, 8)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className="space-y-6">
			<header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
				<div className="space-y-1">
					<h2 className="text-lg font-semibold text-white tracking-tight">{t('visibility.citationsTitle')}</h2>
					<p className="text-sm text-white/60 max-w-2xl leading-relaxed">{t('visibility.citationsSubtitle')}</p>
				</div>
				{byDomain.length > 0 && (
					<Button type="button" variant="secondary" size="sm" onClick={downloadCsv} className="shrink-0">
						{t('visibility.exportCsv')}
					</Button>
				)}
			</header>

			{byDomain.length > 0 && (
				<div className="rounded-2xl p-4 sm:p-5 border border-white/[0.08] shadow-none">
					<div className="flex flex-col sm:flex-row gap-3 sm:items-end">
						<div className="flex-1 min-w-[200px]">
							<label className="sr-only" htmlFor="citations-domain-filter">
								{t('visibility.citationsFilterLabel')}
							</label>
							<Input
								id="citations-domain-filter"
								type="search"
								value={domainFilter}
								onChange={(e) => setDomainFilter(e.target.value)}
								placeholder={t('visibility.citationsFilterPlaceholder')}
								autoComplete="off"
							/>
						</div>
						{needle !== '' && (
							<Button type="button" variant="ghost" size="sm" onClick={() => setDomainFilter('')}>
								{t('visibility.clearSearch')}
							</Button>
						)}
					</div>
					<p className="text-sm text-white/60 mt-3">
						{t('visibility.citationsShowing', { shown: filteredDomains.length, total: byDomain.length })}
					</p>
				</div>
			)}

			<div className="rounded-2xl overflow-hidden border border-white/[0.08] shadow-none">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<caption className="sr-only">{t('visibility.citationsTableCaption')}</caption>
						<thead className="bg-white/[0.02] border-b border-white/[0.08] text-left text-white/60">
							<tr>
								<th scope="col" className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide">
									{t('visibility.colDomain')}
								</th>
								<th
									scope="col"
									className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wide text-right"
								>
									{t('visibility.colCites')}
								</th>
							</tr>
						</thead>
						<tbody>
							{isLoading ? (
								<tr>
									<td colSpan={2} className="px-4 py-8 text-center text-white/40">
										{t('common.loading')}
									</td>
								</tr>
							) : byDomain.length === 0 ? (
								<tr>
									<td colSpan={2} className="px-4 py-8 text-center text-white/40">
										{t('visibility.noCitations')}
									</td>
								</tr>
							) : filteredDomains.length === 0 ? (
								<tr>
									<td colSpan={2} className="px-4 py-8 text-center text-white/40">
										{t('visibility.citationsNoMatches')}
									</td>
								</tr>
							) : (
								filteredDomains.map(([domain, count]) => {
									const label = labelForDomain(domain);
									const href = toHref(domain);
									return (
										<tr
											key={domain}
											className={`border-t border-white/[0.06] transition-colors ${
												label?.kind === 'you' ? 'bg-emerald-500/[0.06] hover:bg-emerald-500/[0.1]' : 'hover:bg-white/[0.02]'
											}`}
										>
											<td className="px-4 py-3">
												<div className="flex items-center gap-2 flex-wrap">
													{href ? (
														<a
															href={href}
															target="_blank"
															rel="noopener noreferrer"
															className="font-mono text-xs text-white/80 hover:text-violet-300 underline-offset-2 hover:underline break-all"
														>
															{domain}
														</a>
													) : (
														<span className="font-mono text-xs text-white/80 break-all">{domain}</span>
													)}
													{label?.kind === 'you' && (
														<Badge variant="success" size="sm">{label.name}</Badge>
													)}
													{label?.kind === 'competitor' && (
														<Badge variant="primary" size="sm">{label.name}</Badge>
													)}
												</div>
											</td>
											<td className="px-4 py-3 text-right font-semibold text-white tabular-nums">{count}</td>
										</tr>
									);
								})
							)}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
};

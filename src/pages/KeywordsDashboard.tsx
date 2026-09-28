/**
 * Keywords Dashboard
 * 
 * Inspired by RankPill's keyword management interface
 * Shows keyword statistics, recommended keywords, and keyword table
 */

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { useProjects } from '../hooks/useProjects';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Sidebar } from '../components/layout/Sidebar';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { EmptyState } from '../components/ui/EmptyState';
import type { Keyword } from '../types/database';

interface KeywordStats {
	allKeywords: number;
	recommended: number;
	starred: number;
	queued: number;
	generated: number;
}

interface KeywordWithMetrics extends Keyword {
	opportunity: 'High' | 'Medium' | 'Low';
	starred: boolean;
	inCalendar: boolean;
}

export const KeywordsDashboard = () => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { data: projects, isLoading: isLoadingProjects } = useProjects();
	const [searchQuery, setSearchQuery] = useState('');
	const [sortBy, setSortBy] = useState<'keyword' | 'opportunity' | 'difficulty' | 'volume' | 'cpc'>('volume');
	const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

	// Get all keywords from all projects
	const { data: allKeywords, isLoading: isLoadingKeywords } = useQuery({
		queryKey: ['keywords', 'all'],
		queryFn: async () => {
			if (!projects || projects.length === 0) return [];

			const projectIds = projects.map((p) => p.id);
			const { data, error } = await supabase
				.from('keywords')
				.select('*')
				.in('project_id', projectIds)
				.order('created_at', { ascending: false });

			if (error) throw error;
			return (data || []) as Keyword[];
		},
		enabled: !!projects && projects.length > 0,
	});

	// Get all content to check which keywords are generated
	const { data: allContent } = useQuery({
		// Distinct key from useAllContent's ['content','all'] — this select() returns a different shape.
		queryKey: ['content', 'all', 'keywords-used'],
		queryFn: async () => {
			if (!projects || projects.length === 0) return [];

			const projectIds = projects.map((p) => p.id);
			const { data, error } = await supabase
				.from('content')
				.select('keywords_used')
				.in('project_id', projectIds);

			if (error) throw error;
			return data || [];
		},
		enabled: !!projects && projects.length > 0,
	});

	// Process keywords with metrics
	const keywords: KeywordWithMetrics[] = useMemo(() => {
		if (!allKeywords) return [];

		const generatedKeywords = new Set<string>();
		if (allContent) {
			allContent.forEach((content: { keywords_used?: string[] | null }) => {
				if (content.keywords_used) {
					content.keywords_used.forEach((kw) => generatedKeywords.add(kw.toLowerCase()));
				}
			});
		}

		return allKeywords.map((kw) => {
			const difficulty = kw.difficulty || 0;
			const volume = kw.search_volume || 0;

			// Calculate opportunity based on volume/difficulty ratio
			let opportunity: 'High' | 'Medium' | 'Low' = 'Low';
			if (volume > 1000 && difficulty < 30) {
				opportunity = 'High';
			} else if (volume > 500 && difficulty < 50) {
				opportunity = 'Medium';
			}

			return {
				...kw,
				opportunity,
				starred: false, // TODO: Add starred functionality
				inCalendar: generatedKeywords.has(kw.keyword.toLowerCase()),
			};
		});
	}, [allKeywords, allContent]);

	// Calculate stats
	const stats: KeywordStats = useMemo(() => {
		if (!keywords) {
			return {
				allKeywords: 0,
				recommended: 0,
				starred: 0,
				queued: 0,
				generated: 0,
			};
		}

		const recommended = keywords.filter((k) => k.opportunity === 'High').length;
		const starred = keywords.filter((k) => k.starred).length;
		const generated = keywords.filter((k) => k.inCalendar).length;
		const queued = 0; // TODO: Track queued content proposals

		return {
			allKeywords: keywords.length,
			recommended,
			starred,
			queued,
			generated,
		};
	}, [keywords]);

	const filteredKeywords = useMemo(() => {
		return keywords.filter((k) =>
			k.keyword.toLowerCase().includes(searchQuery.toLowerCase())
		);
	}, [keywords, searchQuery]);

	const sortedKeywords = useMemo(() => {
		return [...filteredKeywords].sort((a, b) => {
		let aVal: number | string = 0;
		let bVal: number | string = 0;

		switch (sortBy) {
			case 'keyword':
				aVal = a.keyword;
				bVal = b.keyword;
				break;
			case 'opportunity': {
				const oppOrder = { High: 3, Medium: 2, Low: 1 };
				aVal = oppOrder[a.opportunity];
				bVal = oppOrder[b.opportunity];
				break;
			}
			case 'difficulty':
				aVal = a.difficulty ?? 0;
				bVal = b.difficulty ?? 0;
				break;
			case 'volume':
				aVal = a.search_volume ?? 0;
				bVal = b.search_volume ?? 0;
				break;
			case 'cpc':
				aVal = 0;
				bVal = 0;
				break;
		}

		if (typeof aVal === 'string' && typeof bVal === 'string') {
			return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
		}

		return sortOrder === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
		});
	}, [filteredKeywords, sortBy, sortOrder]);

	const handleSort = (column: typeof sortBy) => {
		if (sortBy === column) {
			setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
		} else {
			setSortBy(column);
			setSortOrder('desc');
		}
	};

	if (isLoadingProjects || isLoadingKeywords) {
		return (
			<div className="flex min-h-screen bg-gray-50">
				<Sidebar />
				<div className="flex-1 flex items-center justify-center">
					<LoadingSpinner size="lg" text={t('common.loading')} />
				</div>
			</div>
		);
	}

	// Show empty state if no projects
	if (!projects || projects.length === 0) {
		return (
			<div className="flex min-h-screen bg-gray-50">
				<Sidebar />
				<div className="flex-1 flex items-center justify-center">
					<EmptyState
						icon="🔑"
						title={t('keywordsDashboard.noProjectsTitle')}
						description={[
							t('keywordsDashboard.noProjectsDesc1'),
							t('keywordsDashboard.noProjectsDesc2'),
						]}
						primaryAction={{
							label: t('keywordsDashboard.createProject'),
							onClick: () => navigate({ to: '/projects/new' as any }),
							icon: '➕',
						}}
					/>
				</div>
			</div>
		);
	}

	// Show empty state if no keywords
	if (!allKeywords || allKeywords.length === 0) {
		return (
			<div className="flex min-h-screen bg-gray-50">
				<Sidebar />
				<div className="flex-1">
					<div className="max-w-7xl mx-auto px-6 py-8">
						<div className="mb-8">
							<h1 className="text-3xl font-bold text-gray-900 mb-2">{t('keywordsDashboard.title')}</h1>
							<p className="text-gray-500">{t('keywordsDashboard.subtitle')}</p>
						</div>
						<EmptyState
							icon="🔑"
							title={t('keywordsDashboard.noKeywordsTitle')}
							description={[
								t('keywordsDashboard.noKeywordsDesc1'),
								t('keywordsDashboard.noKeywordsDesc2'),
							]}
							primaryAction={{
								label: t('keywordsDashboard.goToProjects'),
								onClick: () => navigate({ to: '/projects' as any }),
								icon: '📁',
							}}
							secondaryAction={{
								label: t('keywordsDashboard.createNewProject'),
								onClick: () => navigate({ to: '/projects/new' as any }),
							}}
						/>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen bg-gray-50">
			<Sidebar />
			<div className="flex-1">
				<div className="max-w-7xl mx-auto px-6 py-8">
					{/* Header */}
					<div className="mb-8">
						<h1 className="text-3xl font-bold text-gray-900 mb-2">{t('keywordsDashboard.title')}</h1>
						<p className="text-gray-500">{t('keywordsDashboard.subtitle')}</p>
					</div>

				{/* Stats Cards */}
				<div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
					<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
						<Card className="hover:border-cosmic-cyan/40 transition-all">
							<div className="text-sm text-gray-500 mb-1">{t('keywordsDashboard.statAllKeywords')}</div>
							<div className="text-3xl font-bold text-gray-900">{stats.allKeywords}</div>
							<div className="text-xs text-gray-500 mt-1">{t('keywordsDashboard.statAllKeywordsDesc')}</div>
						</Card>
					</motion.div>
					<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
						<Card className="hover:border-cosmic-green/40 transition-all">
							<div className="text-sm text-gray-500 mb-1">{t('keywordsDashboard.statRecommended')}</div>
							<div className="text-3xl font-bold text-cosmic-green">{stats.recommended}</div>
							<div className="text-xs text-gray-500 mt-1">{t('keywordsDashboard.statRecommendedDesc')}</div>
						</Card>
					</motion.div>
					<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
						<Card className="hover:border-cosmic-purple/40 transition-all">
							<div className="text-sm text-gray-500 mb-1">{t('keywordsDashboard.statStarred')}</div>
							<div className="text-3xl font-bold text-cosmic-purple">{stats.starred}</div>
							<div className="text-xs text-gray-500 mt-1">{t('keywordsDashboard.statStarredDesc')}</div>
						</Card>
					</motion.div>
					<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
						<Card className="hover:border-status-warning/40 transition-all">
							<div className="text-sm text-gray-500 mb-1">{t('keywordsDashboard.statQueued')}</div>
							<div className="text-3xl font-bold text-amber-600">{stats.queued}</div>
							<div className="text-xs text-gray-500 mt-1">{t('keywordsDashboard.statQueuedDesc')}</div>
						</Card>
					</motion.div>
					<motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
						<Card className="hover:border-cosmic-cyan/40 transition-all">
							<div className="text-sm text-gray-500 mb-1">{t('keywordsDashboard.statGenerated')}</div>
							<div className="text-3xl font-bold text-cosmic-cyan">{stats.generated}</div>
							<div className="text-xs text-gray-500 mt-1">{t('keywordsDashboard.statGeneratedDesc')}</div>
						</Card>
					</motion.div>
				</div>

				{/* Recommended Description */}
				<Card className="mb-6 bg-green-50 border-green-200">
					<p className="text-sm text-gray-700 leading-relaxed">
						<strong className="text-cosmic-green">{t('keywordsDashboard.recommendedBannerStrong')}</strong>{t('keywordsDashboard.recommendedBannerText')}
					</p>
				</Card>

				{/* Actions Bar */}
				<div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
					<Button variant="primary">
						<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
						</svg>
						{t('keywordsDashboard.addKeywords')}
					</Button>

					<div className="flex-1 max-w-md">
						<div className="relative">
							<input
								type="text"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder={t('keywordsDashboard.searchPlaceholder')}
								className="w-full px-4 py-2 pl-10 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cosmic-cyan focus:border-cosmic-cyan text-gray-900 placeholder-gray-400"
							/>
							<svg
								className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
							</svg>
						</div>
					</div>

					<div className="flex items-center gap-4 text-sm text-gray-500">
						<span>{t('keywordsDashboard.showingCount', { shown: sortedKeywords.length, total: keywords.length })}</span>
						<a href="#" className="text-cosmic-cyan hover:text-cosmic-green transition-colors">
							{t('keywordsDashboard.metricsGuide')}
						</a>
					</div>
				</div>

				{/* Keywords Table */}
				<Card className="overflow-hidden p-0">
					<div className="overflow-x-auto">
						<table className="w-full">
							<thead className="bg-gray-50 border-b border-gray-200">
								<tr>
									{[
										{ key: 'keyword', label: t('keywordsDashboard.colKeyword') },
										{ key: 'opportunity', label: t('keywordsDashboard.colOpportunity') },
										{ key: 'difficulty', label: t('keywordsDashboard.colDifficulty') },
										{ key: 'volume', label: t('keywordsDashboard.colVolume') },
										{ key: 'cpc', label: t('keywordsDashboard.colCpc') },
									].map((col) => (
										<th
											key={col.key}
											className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:text-cosmic-cyan transition-colors"
											onClick={() => handleSort(col.key as typeof sortBy)}
										>
											<div className="flex items-center gap-2">
												{col.label}
												<svg
													className={`w-4 h-4 transition-transform ${
														sortBy === col.key ? 'text-cosmic-cyan' : 'text-gray-600'
													}`}
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														strokeLinecap="round"
														strokeLinejoin="round"
														strokeWidth={2}
														d={sortOrder === 'asc' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'}
													/>
												</svg>
											</div>
										</th>
									))}
									<th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
										{t('keywordsDashboard.colActions')}
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-200 bg-white">
								{sortedKeywords.map((keyword) => (
									<motion.tr
										key={keyword.id}
										initial={{ opacity: 0 }}
										animate={{ opacity: 1 }}
										className="hover:bg-gray-50 transition-colors"
									>
										<td className="px-6 py-4">
											<div className="flex items-center gap-3">
												<button className="text-yellow-500 hover:text-yellow-600 transition-colors">
													<svg className="w-5 h-5" fill={keyword.starred ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
													</svg>
												</button>
												<span className="font-medium text-gray-900">{keyword.keyword}</span>
											</div>
										</td>
										<td className="px-6 py-4">
											<span className={`px-2 py-1 rounded text-xs font-semibold ${
												keyword.opportunity === 'High'
													? 'bg-cosmic-green/20 text-cosmic-green'
													: keyword.opportunity === 'Medium'
													? 'bg-status-warning/20 text-status-warning'
													: 'bg-gray-700 text-gray-400'
											}`}>
												{keyword.opportunity}
											</span>
										</td>
									<td className="px-6 py-4 text-gray-700">{keyword.difficulty || 'N/A'}</td>
									<td className="px-6 py-4 text-gray-700">{(keyword.search_volume || 0).toLocaleString()}</td>
									<td className="px-6 py-4 text-gray-700">N/A</td>
										<td className="px-6 py-4">
											<div className="flex items-center gap-2">
												<Button
													variant={keyword.inCalendar ? 'secondary' : 'primary'}
													size="sm"
												>
													{keyword.inCalendar ? t('keywordsDashboard.removeFromCalendar') : t('keywordsDashboard.addToCalendar')}
												</Button>
												<button className="text-gray-400 hover:text-white transition-colors">
													<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
													</svg>
												</button>
											</div>
										</td>
									</motion.tr>
								))}
							</tbody>
						</table>
					</div>
				</Card>
				</div>
			</div>
		</div>
	);
};


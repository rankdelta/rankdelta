/**
 * Content Library Component
 * 
 * Table view of all generated content with filtering and actions.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useContentList, useDeleteContent } from '../../hooks/useContent';
import { useNavigate } from '@tanstack/react-router';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';
import { exportContentListToCSV, exportContentToPDF, exportContentToDOCX } from '../../utils/export';

interface ContentLibraryProps {
	projectId: string;
}

export const ContentLibrary = ({ projectId }: ContentLibraryProps) => {
	const { t, i18n } = useTranslation();
	const { data: contentList, isLoading } = useContentList(projectId);
	const deleteContent = useDeleteContent();
	const navigate = useNavigate();
	const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'generated' | 'published' | 'archived'>('all');
	const [searchQuery, setSearchQuery] = useState('');

	const filteredContent = contentList?.filter((content) => {
		const matchesStatus = filterStatus === 'all' || content.status === filterStatus;
		const matchesSearch =
			searchQuery === '' ||
			content.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
			content.topic?.toLowerCase().includes(searchQuery.toLowerCase());
		return matchesStatus && matchesSearch;
	});

	const handleDelete = async (contentId: string, e: React.MouseEvent) => {
		e.stopPropagation();
		if (confirm(t('contentTools.library.confirmDelete'))) {
			try {
				await deleteContent.mutateAsync(contentId);
			} catch (error) {
				console.error('Error deleting content:', error);
			}
		}
	};

	const handleView = (contentId: string) => {
		navigate({ to: `/content/${contentId}` as any });
	};

	if (isLoading) {
		return (
			<div className="text-center py-12 text-gray-400">
				<svg
					className="animate-spin h-8 w-8 mx-auto mb-4 text-cosmic-cyan"
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
				>
					<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
					<path
						className="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					></path>
				</svg>
				{t('common.loading')}
			</div>
		);
	}

	if (!contentList || contentList.length === 0) {
		return (
			<EmptyState
				icon="📝"
				title={t('emptyStates.noContentGeneratedTitle')}
				description={[
					t('emptyStates.noContentGeneratedDesc1'),
					t('emptyStates.noContentGeneratedDesc2'),
				]}
				primaryAction={{
					label: t('emptyStates.generateFirst'),
					onClick: () => {
						// Navigate to generate tab - this will be handled by parent
						window.location.hash = '#generate';
					},
					icon: '✍️',
				}}
			/>
		);
	}

	return (
		<div className="space-y-4">
			{/* Filters and Export */}
			<div className="flex flex-col sm:flex-row gap-4">
				<div className="flex-1">
					<input
						type="text"
						placeholder={t('emptyStates.searchPlaceholder')}
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="w-full px-4 py-2 bg-cosmic-dark border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-cosmic-cyan text-white placeholder-gray-500"
					/>
				</div>
				<div className="flex flex-wrap gap-2">
					{(['all', 'draft', 'generated', 'published', 'archived'] as const).map((status) => (
						<button
							key={status}
							onClick={() => setFilterStatus(status)}
							className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
								filterStatus === status
									? 'bg-cosmic-cyan text-cosmic-dark shadow-lg shadow-cosmic-cyan/20'
									: 'bg-cosmic-dark-soft text-gray-300 hover:bg-gray-700 hover:scale-105'
							}`}
						>
							{t(`contentLibrary.filter.${status}`)}
						</button>
					))}
				</div>
				{filteredContent && filteredContent.length > 0 && (
					<div className="flex gap-2">
						<Button
							variant="secondary"
							size="sm"
							onClick={() => exportContentListToCSV(filteredContent)}
						>
							📥 Export CSV
						</Button>
					</div>
				)}
			</div>

			{/* Content Table */}
			<div className="bg-cosmic-dark-soft border border-cosmic-cyan/20 rounded-lg overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full">
						<thead className="bg-cosmic-dark border-b border-gray-600">
							<tr>
								<th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
									{t('contentTools.library.colTitle')}
								</th>
								<th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
									Topic
								</th>
								<th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
									Status
								</th>
								<th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
									SEO Score
								</th>
								<th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
									{t('contentTools.library.colDate')}
								</th>
								<th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
									{t('contentTools.library.colActions')}
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-600">
							{filteredContent?.map((content) => (
								<tr
									key={content.id}
									onClick={() => handleView(content.id)}
									className="hover:bg-cosmic-dark cursor-pointer transition-colors"
								>
									<td className="px-6 py-4 whitespace-nowrap">
										<div className="text-sm font-medium text-white">{content.title}</div>
									</td>
									<td className="px-6 py-4 whitespace-nowrap">
										<div className="text-sm text-gray-300">{content.topic || '-'}</div>
									</td>
									<td className="px-6 py-4 whitespace-nowrap">
										<span
											className={`px-2 py-1 text-xs font-semibold rounded-full ${
												content.status === 'published'
													? 'bg-status-success/20 text-status-success'
													: content.status === 'draft'
														? 'bg-status-warning/20 text-status-warning'
														: content.status === 'generated'
															? 'bg-cosmic-cyan/20 text-cosmic-cyan'
															: 'bg-gray-600 text-gray-300'
											}`}
										>
											{t(`contentLibrary.status.${['draft', 'generated', 'published', 'archived'].includes(content.status) ? content.status : 'archived'}`)}
										</span>
									</td>
									<td className="px-6 py-4 whitespace-nowrap">
										<div className="text-sm text-gray-300">
											{content.seo_score !== null ? (
												<span className={`font-semibold ${content.seo_score >= 70 ? 'text-cosmic-green' : content.seo_score >= 50 ? 'text-status-warning' : 'text-status-error'}`}>
													{content.seo_score}/100
												</span>
											) : (
												'-'
											)}
										</div>
									</td>
									<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
										{new Date(content.generated_date).toLocaleDateString(i18n.language)}
									</td>
									<td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
										<div className="flex items-center justify-end gap-2">
											<button
												onClick={async () => {
													await exportContentToPDF(content);
												}}
												className="text-cosmic-cyan hover:text-cosmic-green transition-colors text-xs"
												title={t('emptyStates.exportPdf')}
											>
												📄
											</button>
											<button
												onClick={async () => {
													await exportContentToDOCX(content);
												}}
												className="text-cosmic-cyan hover:text-cosmic-green transition-colors text-xs"
												title={t('emptyStates.exportDocx')}
											>
												📝
											</button>
										<button
											onClick={(e) => handleDelete(content.id, e)}
											className="text-status-error hover:text-red-400 transition-colors"
										>
											{t('common.delete')}
										</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>

			{filteredContent && filteredContent.length === 0 && (
				<EmptyState
					icon="🔍"
					title={t('emptyStates.noContentFoundTitle')}
					description={t('emptyStates.noContentFoundDesc')}
					variant="minimal"
				/>
			)}
		</div>
	);
};


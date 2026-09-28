/**
 * Calendar Content Component
 * 
 * Hub di gestione contenuti SEO con:
 * - Calendario visivo per schedulare articoli
 * - Pannello laterale per gestire articoli (genera, modifica, ottimizza, rifiuta)
 * - Workflow chiaro: Proposta → Approvata → Generata → Pubblicata
 */

import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { DndContext, DragOverlay, closestCenter, useDroppable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useContentList } from '../../hooks/useContent';
import { useAllContent } from '../../hooks/useAllContent';
import { useContentProposals, useGenerateContentFromProposal, useUpdateProposalScheduledDate, useRejectContentProposal } from '../../hooks/useContentProposals';
import { useUpdateContent, useDeleteContent } from '../../hooks/useContent';
import { useToast } from '../../hooks/useToast';
import { Toast } from '../ui/Toast';
import { EmptyState } from '../ui/EmptyState';
import { formatCalendarDate, parseLocalDate, isSameLocalDay, toCalendarTimestamp } from '../../utils/calendar';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import type { Content } from '../../types/database';
import type { ContentProposal } from '../../services/contentAgent';
import { uiLocaleTag } from '../../common/uiLocale';

interface GenerateContentResult {
	content: Content | null;
	isNew: boolean;
}

interface CalendarArticle {
	id: string;
	date: Date;
	title: string;
	description: string;
	body?: string;
	status: 'published' | 'draft' | 'queued' | 'approved' | 'refresh';
	volume?: number;
	keyword?: string;
	contentId?: string;
	proposalId?: string;
	projectId?: string;
	seoScore?: number;
	readabilityScore?: number;
	isContentRefresh?: boolean;
	originalUrl?: string;
}

// Status badge colors and labels - will be translated in component
const STATUS_CONFIG = {
	published: { color: 'bg-green-100 text-green-700 border-green-300', labelKey: 'content.published', icon: '✅' },
	draft: { color: 'bg-teal-100 text-teal-700 border-teal-300', labelKey: 'content.draft', icon: '📝' },
	approved: { color: 'bg-purple-100 text-purple-700 border-purple-300', labelKey: 'dashboard.toGenerate', icon: '⏳' },
	refresh: { color: 'bg-orange-100 text-orange-700 border-orange-300', labelKey: 'dashboard.updates', icon: '🔄' },
	queued: { color: 'bg-amber-100 text-amber-700 border-amber-300', labelKey: 'content.queued', icon: '📋' },
};

// Compact Article Card in Calendar
const ArticleCard = ({ 
	article, 
	isSelected,
	onClick, 
}: { 
	article: CalendarArticle; 
	isSelected: boolean;
	onClick: () => void;
}): ReactElement => {
	const { t } = useTranslation();
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: article.id,
	});

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	const statusConfig = STATUS_CONFIG[article.status];

	return (
		<div ref={setNodeRef} style={style} {...attributes}>
			<motion.div
				whileHover={{ scale: 1.02 }}
				className={`p-2 rounded-lg border text-xs cursor-pointer transition-all ${statusConfig.color} ${
					isSelected ? 'ring-2 ring-teal-500 shadow-lg' : ''
				}`}
				onClick={onClick}
			>
				<div className="flex items-center gap-1 mb-1">
					{/* Drag handle */}
						<div
						className="cursor-move text-gray-400 hover:text-gray-600"
							title={t('calendar.dragToMove')}
						onClick={(e) => e.stopPropagation()}
							{...listeners}
						>
						<svg fill="currentColor" height="10" viewBox="0 0 10 10" width="10">
							<circle cx="2" cy="2" r="1"/><circle cx="5" cy="2" r="1"/><circle cx="8" cy="2" r="1"/>
							<circle cx="2" cy="5" r="1"/><circle cx="5" cy="5" r="1"/><circle cx="8" cy="5" r="1"/>
							<circle cx="2" cy="8" r="1"/><circle cx="5" cy="8" r="1"/><circle cx="8" cy="8" r="1"/>
							</svg>
						</div>
					<span className="text-[9px] font-bold uppercase flex-1">
						{statusConfig.icon} {t(statusConfig.labelKey as any)}
					</span>
					{article.seoScore && (
						<span className={`text-[9px] font-bold ${article.seoScore >= 70 ? 'text-green-600' : article.seoScore >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
							{article.seoScore}
						</span>
					)}
				</div>
				<p className="font-medium truncate text-gray-900">{article.title}</p>
				{article.keyword && (
					<p className="text-[9px] text-gray-500 truncate mt-0.5">🔑 {article.keyword}</p>
				)}
			</motion.div>
		</div>
	);
};

// Droppable Day Cell
const DayCell = ({ 
	day, 
	dayArticles, 
	isCurrentDay, 
	isInCurrentMonth, 
	selectedArticleId,
	onArticleClick,
	activeId 
}: { 
	day: Date; 
	dayArticles: Array<CalendarArticle>; 
	isCurrentDay: boolean; 
	isInCurrentMonth: boolean;
	selectedArticleId: string | null;
	onArticleClick: (article: CalendarArticle) => void;
	activeId: string | null;
}): ReactElement => {
	const dayId = `date-${formatCalendarDate(day)}`;
	const { setNodeRef, isOver } = useDroppable({ id: dayId });

	return (
		<div
			ref={setNodeRef}
			className={`min-h-[100px] bg-white p-1.5 border-r border-b border-gray-200 transition-all ${
				!isInCurrentMonth ? 'opacity-40 bg-gray-50' : ''
			} ${isCurrentDay ? 'ring-2 ring-teal-500 ring-inset bg-teal-50' : ''} ${
				isOver ? 'bg-teal-50 ring-2 ring-teal-500' : ''
			} ${activeId ? 'hover:bg-teal-50' : ''}`}
		>
			<div className="flex items-center justify-between mb-1">
				<span className={`text-xs font-medium ${
					isCurrentDay ? 'text-teal-700 font-bold' : isInCurrentMonth ? 'text-gray-700' : 'text-gray-400'
				}`}>
					{day.getDate()}
				</span>
				{dayArticles.length > 0 && (
					<span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-bold">
						{dayArticles.length}
					</span>
				)}
			</div>

			<SortableContext items={dayArticles.map((a) => a.id)} strategy={verticalListSortingStrategy}>
				<div className="space-y-1">
					{dayArticles.map((article) => (
						<ArticleCard
							key={article.id}
							article={article}
							isSelected={selectedArticleId === article.id}
							onClick={() => onArticleClick(article)}
						/>
					))}
				</div>
			</SortableContext>
		</div>
	);
};

// Article Detail Panel (Right Sidebar)
const ArticleDetailPanel = ({
	article,
	onClose,
	onGenerate,
	onEdit,
	onReject,
	onPublish,
	onArchive,
	isGenerating,
}: {
	article: CalendarArticle;
	onClose: () => void;
	onGenerate: () => void;
	onEdit: () => void;
	onReject: () => void;
	onPublish: () => void;
	onArchive: () => void;
	isGenerating: boolean;
}): ReactElement => {
	const { t } = useTranslation();
	const statusConfig = STATUS_CONFIG[article.status];
	const isProposal = article.status === 'approved' || article.status === 'queued' || article.status === 'refresh';
	const isContent = article.status === 'published' || article.status === 'draft';
	const isRefresh = article.status === 'refresh' || article.isContentRefresh;

	return (
		<motion.div
			initial={{ x: 400, opacity: 0 }}
			animate={{ x: 0, opacity: 1 }}
			exit={{ x: 400, opacity: 0 }}
			className="w-96 bg-white border-l border-gray-200 h-full overflow-y-auto shadow-xl"
		>
			{/* Header */}
			<div className="sticky top-0 bg-white border-b border-gray-200 p-4 z-10">
				<div className="flex items-center justify-between mb-3">
					<span className={`px-3 py-1 rounded-full text-xs font-bold border ${statusConfig.color}`}>
						{statusConfig.icon} {t(statusConfig.labelKey as any)}
					</span>
					<button
						onClick={onClose}
						className="p-1 hover:bg-gray-100 rounded transition-colors"
					>
						<svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<h2 className="text-lg font-bold text-gray-900 leading-tight">{article.title}</h2>
				<p className="text-sm text-gray-500 mt-1">
					📅 {article.date.toLocaleDateString(uiLocaleTag(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
				</p>
			</div>

			{/* Content */}
			<div className="p-4 space-y-4">
				{/* Keyword & Volume */}
				{(article.keyword || article.volume) && (
					<div className="bg-gray-50 rounded-lg p-3">
						<h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{t('appPages.calendar.targetKeyword')}</h3>
						<p className="font-medium text-gray-900">{article.keyword || 'N/A'}</p>
						{article.volume && (
							<p className="text-sm text-gray-500 mt-1">
								{t('appPages.calendar.searchesPerMonth', { volume: article.volume.toLocaleString() })}
							</p>
						)}
					</div>
				)}

				{/* SEO Scores */}
				{(article.seoScore || article.readabilityScore) && (
					<div className="bg-gray-50 rounded-lg p-3">
						<h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{t('appPages.calendar.seoMetrics')}</h3>
						<div className="grid grid-cols-2 gap-3">
							{article.seoScore && (
								<div>
									<p className="text-xs text-gray-500">SEO Score</p>
									<p className={`text-2xl font-bold ${
										article.seoScore >= 70 ? 'text-green-600' : 
										article.seoScore >= 50 ? 'text-amber-500' : 'text-red-500'
									}`}>
										{article.seoScore}
									</p>
								</div>
							)}
							{article.readabilityScore && (
								<div>
									<p className="text-xs text-gray-500">{t('appPages.calendar.readability')}</p>
									<p className={`text-2xl font-bold ${
										article.readabilityScore >= 70 ? 'text-green-600' : 
										article.readabilityScore >= 50 ? 'text-amber-500' : 'text-red-500'
									}`}>
										{article.readabilityScore}
									</p>
								</div>
							)}
						</div>
					</div>
				)}

				{/* Original URL for Refresh Proposals */}
				{isRefresh && article.originalUrl && (
					<div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
						<h3 className="text-xs font-semibold text-orange-700 uppercase mb-2">{t('appPages.calendar.originalUrlToUpdate')}</h3>
						<a 
							href={article.originalUrl} 
							target="_blank" 
							rel="noopener noreferrer"
							className="text-sm text-orange-600 hover:underline break-all"
						>
							{article.originalUrl}
						</a>
						<p className="text-xs text-orange-500 mt-2">
							{t('appPages.calendar.originalUrlHint')}
						</p>
					</div>
				)}

				{/* Description/Preview */}
				{article.description && (
					<div className="bg-gray-50 rounded-lg p-3">
						<h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{t('appPages.calendar.description')}</h3>
						<p className="text-sm text-gray-700">{article.description}</p>
					</div>
				)}

				{/* Body Preview (if content) */}
				{article.body && (
					<div className="bg-gray-50 rounded-lg p-3">
						<h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">{t('appPages.calendar.preview')}</h3>
						<div className="text-sm text-gray-700 max-h-40 overflow-y-auto prose prose-sm">
							{article.body.substring(0, 500)}...
						</div>
					</div>
				)}

				{/* Workflow Status */}
				<div className={`rounded-lg p-3 ${isRefresh ? 'bg-gradient-to-r from-orange-50 to-teal-50' : 'bg-gradient-to-r from-purple-50 to-teal-50'}`}>
					<h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">
						{isRefresh ? t('appPages.calendar.refreshWorkflow') : 'Workflow'}
					</h3>
					{isRefresh ? (
						// Refresh workflow
						<div className="flex items-center justify-between text-xs">
							<div className={`flex flex-col items-center ${article.status === 'refresh' ? 'text-orange-600 font-bold' : 'text-gray-400'}`}>
								<span className="text-lg">🔄</span>
								<span>{t('appPages.calendar.stepApproved')}</span>
							</div>
							<div className="flex-1 h-0.5 bg-gray-200 mx-1" />
							<div className={`flex flex-col items-center ${article.status === 'draft' ? 'text-teal-600 font-bold' : 'text-gray-400'}`}>
								<span className="text-lg">📝</span>
								<span>{t('appPages.calendar.stepGenerated')}</span>
							</div>
							<div className="flex-1 h-0.5 bg-gray-200 mx-1" />
							<div className={`flex flex-col items-center ${article.status === 'published' ? 'text-green-600 font-bold' : 'text-gray-400'}`}>
								<span className="text-lg">✅</span>
								<span>{t('appPages.calendar.stepPublished')}</span>
							</div>
						</div>
					) : (
						// Standard workflow
					<div className="flex items-center justify-between text-xs">
						<div className={`flex flex-col items-center ${article.status === 'queued' ? 'text-purple-600 font-bold' : 'text-gray-400'}`}>
							<span className="text-lg">📋</span>
							<span>{t('appPages.calendar.stepQueued')}</span>
						</div>
						<div className="flex-1 h-0.5 bg-gray-200 mx-1" />
						<div className={`flex flex-col items-center ${article.status === 'approved' ? 'text-purple-600 font-bold' : 'text-gray-400'}`}>
							<span className="text-lg">⏳</span>
							<span>{t('appPages.calendar.stepApprovedProposal')}</span>
						</div>
						<div className="flex-1 h-0.5 bg-gray-200 mx-1" />
						<div className={`flex flex-col items-center ${article.status === 'draft' ? 'text-teal-600 font-bold' : 'text-gray-400'}`}>
							<span className="text-lg">📝</span>
							<span>{t('appPages.calendar.stepDraft')}</span>
						</div>
						<div className="flex-1 h-0.5 bg-gray-200 mx-1" />
						<div className={`flex flex-col items-center ${article.status === 'published' ? 'text-green-600 font-bold' : 'text-gray-400'}`}>
							<span className="text-lg">✅</span>
							<span>{t('appPages.calendar.stepPublished')}</span>
						</div>
					</div>
					)}
				</div>
			</div>

			{/* Actions Footer */}
			<div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 space-y-2">
				{/* Primary Actions based on status */}
				{article.status === 'approved' && (
					<>
						<Button
							variant="primary"
							className="w-full"
							onClick={onGenerate}
							loading={isGenerating}
							disabled={isGenerating}
						>
							{isGenerating ? t('appPages.calendar.generating') : t('appPages.calendar.generateWithAi')}
						</Button>
						<p className="text-xs text-gray-500 text-center">
							{t('appPages.calendar.generateHint')}
						</p>
					</>
				)}

				{article.status === 'refresh' && (
					<>
						<Button
							variant="primary"
							className="w-full bg-orange-500 hover:bg-orange-600"
							onClick={onGenerate}
							loading={isGenerating}
							disabled={isGenerating}
						>
							{isGenerating ? t('appPages.calendar.updating') : t('appPages.calendar.generateUpdated')}
						</Button>
						<p className="text-xs text-orange-600 text-center">
							{t('appPages.calendar.generateUpdatedHint')}
						</p>
					</>
				)}

				{article.status === 'queued' && (
					<Button
						variant="primary"
						className="w-full"
						onClick={onEdit}
					>
						{t('appPages.calendar.approveAndSchedule')}
					</Button>
				)}

				{isContent && (
					<Button
						variant="primary"
						className="w-full"
						onClick={onEdit}
					>
						{t('appPages.calendar.editInEditor')}
					</Button>
				)}

				{article.status === 'draft' && (
					<Button
						variant="secondary"
						className="w-full"
						onClick={onPublish}
					>
						{t('appPages.calendar.publish')}
					</Button>
				)}

				{/* Secondary Actions */}
				<div className="flex gap-2 pt-2">
					{isProposal && (
						<Button
							variant="danger"
							size="sm"
							className="flex-1"
							onClick={onReject}
						>
							{t('appPages.calendar.reject')}
						</Button>
					)}
					{isContent && (
						<Button
							variant="secondary"
							size="sm"
							className="flex-1"
							onClick={onArchive}
						>
							{t('appPages.calendar.archive')}
						</Button>
					)}
				</div>
			</div>
		</motion.div>
	);
};

interface CalendarContentProps {
	projectId?: string;
}

export const CalendarContent = ({ projectId }: CalendarContentProps): ReactElement => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	
	// Data hooks
	const { data: projectContent, isLoading: isLoadingContent } = useContentList(projectId);
	const { data: allContent, isLoading: isLoadingAllContent } = useAllContent();
	const { data: projectProposals, isLoading: isLoadingProposals } = useContentProposals(projectId);
	
	// Mutation hooks
	const updateContent = useUpdateContent();
	const deleteContent = useDeleteContent();
	const updateProposalDate = useUpdateProposalScheduledDate();
	const generateContent = useGenerateContentFromProposal();
	const rejectProposal = useRejectContentProposal();
	
	// UI state
	const { toast, showToast, hideToast } = useToast();
	const [currentMonth, setCurrentMonth] = useState(new Date());
	const [activeId, setActiveId] = useState<string | null>(null);
	const [draggedArticle, setDraggedArticle] = useState<CalendarArticle | null>(null);
	const [selectedArticle, setSelectedArticle] = useState<CalendarArticle | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);

	// Use project-specific content if projectId is provided
	const content = projectId ? projectContent : allContent;
	const isLoading = projectId 
		? (isLoadingContent || isLoadingProposals)
		: (isLoadingAllContent || isLoadingProposals);

	// Combine content and proposals into calendar articles
	const articles: Array<CalendarArticle> = useMemo(() => {
		const articlesList: Array<CalendarArticle> = [];

		// Add content items
		if (content) {
			content.forEach((contentItem: Content) => {
				if (projectId && contentItem.project_id !== projectId) return;
				
				const dateString = contentItem.published_date || contentItem.generated_date;
				if (!dateString) return;
					
				// Use parseLocalDate to handle date-only strings correctly
				const date = parseLocalDate(dateString);
				if (isNaN(date.getTime())) return;

					articlesList.push({
					id: contentItem.id,
						date,
					title: contentItem.title,
					description: contentItem.topic || '',
					body: contentItem.body,
					status: contentItem.status as 'published' | 'draft',
					keyword: contentItem.keywords_used?.[0],
					contentId: contentItem.id,
					projectId: contentItem.project_id,
					seoScore: contentItem.seo_score ?? undefined,
					readabilityScore: contentItem.readability_score ?? undefined,
				});
			});
		}

		// Add approved proposals (ready to generate)
		if (projectProposals) {
			projectProposals
				.filter((p: ContentProposal) => p.status === 'approved' && p.scheduledDate)
				.forEach((proposal: ContentProposal) => {
					if (!proposal.scheduledDate) return;
					// Use parseLocalDate to handle date strings correctly
					const date = parseLocalDate(proposal.scheduledDate);
					if (isNaN(date.getTime())) return;

					// Check if this is a content refresh proposal
					const metadata = proposal.metadata as Record<string, unknown>;
					const isContentRefresh = metadata?.['isContentRefresh'] === true;
					const originalUrl = metadata?.['originalUrl'] as string | undefined;

						articlesList.push({
							id: `proposal-${proposal.id}`,
							date,
							title: proposal.title,
							description: proposal.clusterName || proposal.primaryKeyword || '',
						body: proposal.body,
							status: isContentRefresh ? 'refresh' : 'approved',
							keyword: proposal.primaryKeyword || proposal.clusterKeywords[0],
							volume: proposal.searchVolume,
							proposalId: proposal.id,
						projectId: proposal.projectId,
						seoScore: proposal.seoScore,
						readabilityScore: proposal.readabilityScore,
						isContentRefresh,
						originalUrl,
					});
				});
		}

		return articlesList;
	}, [content, projectProposals, projectId]);

	// Calculate month statistics
	const monthStats = useMemo(() => {
		const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
		const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
		
		const monthArticles = articles.filter((article) => {
			const articleDate = new Date(article.date);
			return articleDate >= monthStart && articleDate <= monthEnd;
		});

		return {
			total: monthArticles.length,
			published: monthArticles.filter((a) => a.status === 'published').length,
			draft: monthArticles.filter((a) => a.status === 'draft').length,
			approved: monthArticles.filter((a) => a.status === 'approved').length,
			refresh: monthArticles.filter((a) => a.status === 'refresh').length,
		};
	}, [articles, currentMonth]);

	// Generate calendar days
	const days = useMemo(() => {
	const monthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
	const monthEnd = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
	const startDate = new Date(monthStart);
		// Start from Monday (1) instead of Sunday (0)
		const dayOfWeek = startDate.getDay();
		startDate.setDate(startDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

		const daysArray: Date[] = [];
	const currentDate = new Date(startDate);
		let maxDays = 42; // 6 weeks max
		
		while (maxDays > 0) {
			daysArray.push(new Date(currentDate));
		currentDate.setDate(currentDate.getDate() + 1);
		maxDays--;
			// Stop after we've passed month end and completed the week
			if (currentDate > monthEnd && daysArray.length % 7 === 0) break;
		}

		return daysArray;
	}, [currentMonth]);

	// Loading state
	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-16">
				<LoadingSpinner size="lg" text={t('appPages.calendar.loadingCalendar')} />
			</div>
		);
	}

	// Helper functions
	const getArticlesForDate = (date: Date): Array<CalendarArticle> => {
		return articles.filter((article) => {
			return isSameLocalDay(article.date, date);
		});
	};

	const isToday = (date: Date): boolean => {
		const today = new Date();
		return date.getDate() === today.getDate() &&
			date.getMonth() === today.getMonth() &&
			date.getFullYear() === today.getFullYear();
	};

	const isCurrentMonthDate = (date: Date): boolean => {
		return date.getMonth() === currentMonth.getMonth();
	};

	// Drag handlers
	const handleDragStart = (event: DragStartEvent): void => {
		setActiveId(event.active.id as string);
		const article = articles.find((a) => a.id === event.active.id);
		setDraggedArticle(article || null);
	};

	const handleDragEnd = async (event: DragEndEvent): Promise<void> => {
		const { active, over } = event;
		setActiveId(null);
		setDraggedArticle(null);

		if (!over || active.id === over.id) return;

		const article = articles.find((a) => a.id === active.id);
		if (!article) return;

		// Get target date
		let localTargetDate: Date;
		const targetId = over.id as string;
		
		if (targetId.startsWith('date-')) {
			// Dropped on an empty day cell
			const dateString = targetId.replace('date-', '');
			const [year, month, day] = dateString.split('-').map(Number);
			if (!year || !month || !day) return;
			localTargetDate = new Date(year, month - 1, day);
		} else {
			// Dropped on an existing article - use that article's date
			const targetArticle = articles.find((a) => a.id === targetId);
			if (!targetArticle) return;
			// Create a new date at midnight local time for the target day
			localTargetDate = new Date(
				targetArticle.date.getFullYear(),
				targetArticle.date.getMonth(),
				targetArticle.date.getDate()
			);
		}
		// Both columns are TIMESTAMPTZ: write local noon so the calendar day survives any timezone
		const newDateISO = toCalendarTimestamp(localTargetDate);

		try {
			if (article.contentId) {
				await updateContent.mutateAsync({
					id: article.contentId,
					published_date: newDateISO,
				});
				await queryClient.invalidateQueries({ queryKey: ['content'] });
				await queryClient.invalidateQueries({ queryKey: ['content', 'all'] });
				showToast(t('appPages.calendar.toastMoved', { date: localTargetDate.toLocaleDateString(uiLocaleTag()) }), 'success');
			} else if (article.proposalId && article.projectId) {
				await updateProposalDate.mutateAsync({
					proposalId: article.proposalId,
					projectId: article.projectId,
					scheduledDate: newDateISO, // Proposals table uses timestamp
				});
				await queryClient.invalidateQueries({ queryKey: ['content-proposals'] });
				await queryClient.invalidateQueries({ queryKey: ['content-proposals', 'all'] });
				showToast(t('appPages.calendar.toastMoved', { date: localTargetDate.toLocaleDateString(uiLocaleTag()) }), 'success');
			}
			
			// Update selected article if it was moved
			if (selectedArticle?.id === article.id) {
				setSelectedArticle({ ...selectedArticle, date: localTargetDate });
			}
		} catch (error) {
			console.error('Error moving article:', error);
			showToast(t('appPages.calendar.toastMoveError'), 'error');
		}
	};

	// Action handlers
	const handleArticleClick = (article: CalendarArticle): void => {
		setSelectedArticle(article);
	};

	const handleGenerate = async (): Promise<void> => {
		if (!selectedArticle?.proposalId || !selectedArticle?.projectId) return;
		
		setIsGenerating(true);
		try {
			showToast(t('appPages.calendar.toastGenerating'), 'info');
			const result = await generateContent.mutateAsync({ 
				proposalId: selectedArticle.proposalId, 
				projectId: selectedArticle.projectId 
			}) as GenerateContentResult;
			
			if (result.content) {
				showToast(t('appPages.calendar.toastGenerated'), 'success');
				await queryClient.invalidateQueries({ queryKey: ['content'] });
				await queryClient.invalidateQueries({ queryKey: ['content-proposals'] });
				
				// Navigate to editor
					setTimeout(() => {
					void navigate({ to: `/content/${result.content!.id}` });
				}, 500);
			}
		} catch (error) {
			console.error('Error generating content:', error);
			showToast(t('appPages.calendar.toastGenerateError'), 'error');
		} finally {
			setIsGenerating(false);
		}
	};

	const handleEdit = (): void => {
		if (selectedArticle?.contentId) {
			void navigate({ to: `/content/${selectedArticle.contentId}` });
		} else if (selectedArticle?.proposalId) {
			void navigate({ to: '/proposals' });
		}
	};

	const handleReject = async (): Promise<void> => {
		if (!selectedArticle?.proposalId || !selectedArticle?.projectId) return;
		
		try {
			await rejectProposal.mutateAsync({
				proposalId: selectedArticle.proposalId,
				projectId: selectedArticle.projectId,
			});
			await queryClient.invalidateQueries({ queryKey: ['content-proposals'] });
			showToast(t('appPages.calendar.toastRejected'), 'info');
			setSelectedArticle(null);
		} catch (error) {
			console.error('Error rejecting proposal:', error);
			showToast(t('appPages.calendar.toastRejectError'), 'error');
		}
	};

	const handlePublish = async (): Promise<void> => {
		if (!selectedArticle?.contentId) return;
		
		try {
			await updateContent.mutateAsync({
				id: selectedArticle.contentId,
				status: 'published',
			});
			await queryClient.invalidateQueries({ queryKey: ['content'] });
			showToast(t('appPages.calendar.toastPublished'), 'success');
			setSelectedArticle({ ...selectedArticle, status: 'published' });
		} catch (error) {
			console.error('Error publishing:', error);
			showToast(t('appPages.calendar.toastPublishError'), 'error');
		}
	};

	const handleArchive = async (): Promise<void> => {
		if (!selectedArticle?.contentId) return;
		
		try {
			await deleteContent.mutateAsync(selectedArticle.contentId);
			await queryClient.invalidateQueries({ queryKey: ['content'] });
			showToast(t('appPages.calendar.toastArchived'), 'info');
			setSelectedArticle(null);
		} catch (error) {
			console.error('Error archiving:', error);
			showToast(t('appPages.calendar.toastArchiveError'), 'error');
		}
	};

	const navigateMonth = (direction: 'prev' | 'next'): void => {
		setCurrentMonth((prev) => {
			const newDate = new Date(prev);
			newDate.setMonth(prev.getMonth() + (direction === 'next' ? 1 : -1));
			return newDate;
		});
	};

	const monthName = currentMonth.toLocaleDateString(uiLocaleTag(), { month: 'long', year: 'numeric' });

	return (
		<div className="flex h-full">
			{/* Main Calendar Area */}
			<div className={`flex-1 transition-all ${selectedArticle ? 'mr-96' : ''}`}>
			<DndContext
				collisionDetection={closestCenter}
				onDragEnd={handleDragEnd}
				onDragStart={handleDragStart}
			>
					{/* Stats Row */}
					<div className="grid grid-cols-5 gap-3 mb-4">
						<Card className="p-3" padding="none">
							<div className="text-xs text-gray-500">{t('dashboard.totalMonth')}</div>
							<div className="text-xl font-bold text-gray-900">{monthStats.total}</div>
						</Card>
						<Card className="p-3" padding="none">
							<div className="text-xs text-gray-500">{t('dashboard.published')}</div>
							<div className="text-xl font-bold text-green-600">{monthStats.published}</div>
						</Card>
						<Card className="p-3" padding="none">
							<div className="text-xs text-gray-500">{t('dashboard.drafts')}</div>
							<div className="text-xl font-bold text-teal-600">{monthStats.draft}</div>
						</Card>
						<Card className="p-3" padding="none">
							<div className="text-xs text-gray-500">{t('dashboard.toGenerate')}</div>
							<div className="text-xl font-bold text-purple-600">{monthStats.approved}</div>
						</Card>
						<Card className="p-3" padding="none">
							<div className="text-xs text-gray-500">{t('dashboard.updates')}</div>
							<div className="text-xl font-bold text-orange-500">{monthStats.refresh}</div>
						</Card>
					</div>

					{/* Month Navigation */}
					<div className="flex items-center justify-between mb-4">
						<div className="flex items-center gap-3">
							<Button size="sm" variant="ghost" onClick={() => navigateMonth('prev')}>
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
						</svg>
					</Button>
							<Button size="sm" variant="ghost" onClick={() => navigateMonth('next')}>
								<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
						</svg>
					</Button>
							<Button size="sm" variant="secondary" onClick={() => setCurrentMonth(new Date())}>
								{t('appPages.calendar.today')}
							</Button>
							<h2 className="text-lg font-bold text-gray-900 capitalize">{monthName}</h2>
						</div>
					<Button
						size="sm"
							variant="primary"
							onClick={() => void navigate({ to: '/proposals' })}
					>
							✨ {t('proposals.newProposals')}
					</Button>
			</div>

			{/* Calendar Grid */}
					{articles.length === 0 ? (
						<EmptyState
							icon="📅"
							title={t('calendar.emptyTitle')}
							description={[
								t('calendar.emptyDesc1'),
								t('calendar.emptyDesc2')
							]}
							primaryAction={{
								label: t('calendar.goToProposals'),
								onClick: () => void navigate({ to: '/proposals' }),
								icon: '✨',
							}}
						/>
					) : (
			<Card className="p-0 overflow-hidden">
							<div className="grid grid-cols-7 bg-gray-100">
								{[t('calendar.dayMon'), t('calendar.dayTue'), t('calendar.dayWed'), t('calendar.dayThu'), t('calendar.dayFri'), t('calendar.daySat'), t('calendar.daySun')].map((day) => (
									<div key={day} className="p-2 text-center border-r border-b border-gray-200 last:border-r-0">
										<span className="text-xs font-semibold text-gray-500 uppercase">{day}</span>
						</div>
					))}
							</div>
							<div className="grid grid-cols-7">
								{days.map((day, index) => (
									<DayCell
								key={index}
									day={day}
										dayArticles={getArticlesForDate(day)}
										isCurrentDay={isToday(day)}
										isInCurrentMonth={isCurrentMonthDate(day)}
										selectedArticleId={selectedArticle?.id || null}
									onArticleClick={handleArticleClick}
										activeId={activeId}
								/>
								))}
				</div>
			</Card>
					)}

			<DragOverlay>
						{draggedArticle && (
							<div className="p-2 rounded-lg border text-xs bg-white shadow-xl max-w-[180px]">
								<span className={`text-[9px] font-bold uppercase ${
									draggedArticle.status === 'published' ? 'text-green-600' :
									draggedArticle.status === 'draft' ? 'text-teal-600' : 'text-purple-600'
								}`}>
									{STATUS_CONFIG[draggedArticle.status].icon} {t(STATUS_CONFIG[draggedArticle.status].labelKey as any)}
							</span>
								<p className="font-medium truncate text-gray-900 mt-1">{draggedArticle.title}</p>
							</div>
						)}
					</DragOverlay>
				</DndContext>
						</div>

			{/* Article Detail Panel */}
			<AnimatePresence>
				{selectedArticle && (
					<div className="fixed right-0 top-0 h-full z-50">
						<ArticleDetailPanel
							article={selectedArticle}
							onClose={() => setSelectedArticle(null)}
							onGenerate={handleGenerate}
							onEdit={handleEdit}
							onReject={handleReject}
							onPublish={handlePublish}
							onArchive={handleArchive}
							isGenerating={isGenerating}
						/>
					</div>
				)}
			</AnimatePresence>

			<Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={hideToast} />
		</div>
	);
};

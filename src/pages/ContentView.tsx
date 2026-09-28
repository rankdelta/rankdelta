/**
 * Content Editor Page
 * 
 * Full-featured content editor with WYSIWYG and Markdown support
 * - Beautiful, user-friendly interface inspired by Notion/Medium
 * - Collapsible sidebar with organized tools
 * - Smooth transitions and animations
 */

import { useParams, useNavigate } from '@tanstack/react-router';
import { useContent, useUpdateContent, useDeleteContent } from '../hooks/useContent';
import { useAuth } from '../hooks/useAuth';
import { getDefaultAuthenticatedHomePath } from '../config/productMode';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useMemo, useRef, lazy, Suspense, useCallback, useDeferredValue } from 'react';
import { parseLocalDate, toCalendarTimestamp } from '../utils/calendar';
import { Sidebar } from '../components/layout/Sidebar';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { calculateSEOScore, calculateReadability } from '../utils/seo';
import { exportContentToMarkdown, exportContentToHTML, exportContentToPDF, exportContentToDOCX } from '../utils/export';
import { ContentExpansion } from '../components/content/ContentExpansion';
import { AdvancedContentScoring } from '../components/content/AdvancedContentScoring';
import { SERPFeaturesOptimizer } from '../components/content/SERPFeaturesOptimizer';
import { SchemaMarkupGenerator } from '../components/content/SchemaMarkupGenerator';
import { ContentVersioning } from '../components/content/ContentVersioning';
import { GEOOptimizer } from '../components/content/GEOOptimizer';
import { AIContentEnhancer } from '../components/content/AIContentEnhancer';
import { InlineCitationOptimizer } from '../components/content/InlineCitationOptimizer';
import { ContentFormatAdvisor } from '../components/content/ContentFormatAdvisor';
// Lazy-loaded: the TipTap/ProseMirror editor is ~386 KB — defer it off first paint so it only
// downloads when a content view actually opens the editor.
const RichTextEditor = lazy(() => import('../components/editor/RichTextEditor'));
import { motion, AnimatePresence } from 'framer-motion';
import { uiLocaleTag } from '../common/uiLocale';
import { ensureMarkdownFormat } from '../utils/contentFormat';

// Collapsible Section Component
interface CollapsibleSectionProps {
	title: string;
	icon: React.ReactNode;
	children: React.ReactNode;
	defaultOpen?: boolean;
	badge?: string | number;
	variant?: 'default' | 'highlight' | 'warning';
}

const CollapsibleSection = ({ title, icon, children, defaultOpen = false, badge, variant = 'default' }: CollapsibleSectionProps) => {
	const [isOpen, setIsOpen] = useState(defaultOpen);
	
	const variantStyles = {
		default: 'bg-white border-gray-200',
		highlight: 'bg-gradient-to-br from-teal-50/50 to-cyan-50/50 border-teal-200',
		warning: 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200',
	};
	
	return (
		<div className={`rounded-xl border overflow-hidden transition-all duration-300 ${variantStyles[variant]}`}>
			<button
				onClick={() => setIsOpen(!isOpen)}
				className="w-full flex items-center justify-between p-4 hover:bg-gray-50/50 transition-colors"
			>
				<div className="flex items-center gap-3">
					<span className="text-gray-500">{icon}</span>
					<span className="font-medium text-gray-900 text-sm">{title}</span>
								{badge !== undefined && (
									<span className="px-2 py-0.5 bg-teal-100 text-teal-700 text-xs font-medium rounded-full">
										{badge}
									</span>
								)}
				</div>
				<motion.svg
					animate={{ rotate: isOpen ? 180 : 0 }}
					transition={{ duration: 0.2 }}
					className="w-4 h-4 text-gray-400"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
				</motion.svg>
			</button>
			<AnimatePresence>
				{isOpen && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: 'auto', opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2 }}
						className="overflow-hidden"
					>
						<div className="p-4 pt-0 border-t border-gray-100">
							{children}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
};

// Score Ring Component
const ScoreRing = ({ score, size = 'md', label }: { score: number; size?: 'sm' | 'md' | 'lg'; label?: string }) => {
	const sizes = {
		sm: { ring: 48, stroke: 4, text: 'text-sm' },
		md: { ring: 80, stroke: 5, text: 'text-xl' },
		lg: { ring: 100, stroke: 6, text: 'text-2xl' },
	};
	
	const { ring, stroke, text } = sizes[size];
	const radius = (ring - stroke) / 2;
	const circumference = 2 * Math.PI * radius;
	const progress = (score / 100) * circumference;
	
	const scoreColor = score >= 80 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-red-600';
	const strokeColor = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
	
	return (
		<div className="flex flex-col items-center">
			<div className="relative" style={{ width: ring, height: ring }}>
				<svg className="transform -rotate-90" width={ring} height={ring}>
					<circle
						cx={ring / 2}
						cy={ring / 2}
						r={radius}
						stroke="#e5e7eb"
						strokeWidth={stroke}
						fill="none"
					/>
					<circle
						cx={ring / 2}
						cy={ring / 2}
						r={radius}
						stroke={strokeColor}
						strokeWidth={stroke}
						fill="none"
						strokeDasharray={circumference}
						strokeDashoffset={circumference - progress}
						strokeLinecap="round"
						className="transition-all duration-500 ease-out"
					/>
				</svg>
				<div className="absolute inset-0 flex items-center justify-center">
					<span className={`font-bold ${text} ${scoreColor}`}>{score}</span>
				</div>
			</div>
			{label && <span className="text-xs text-gray-500 mt-1">{label}</span>}
		</div>
	);
};

// Metric Row Component
const MetricRow = ({ label, value, status = 'success' }: { label: string; value: string | number; status?: 'success' | 'warning' | 'error' }) => {
	const statusColors = {
		success: 'bg-emerald-500',
		warning: 'bg-amber-500',
		error: 'bg-red-500',
	};
	
	return (
		<div className="flex items-center justify-between py-2">
			<span className="text-sm text-gray-500">{label}</span>
			<div className="flex items-center gap-2">
				<span className="text-sm font-semibold text-gray-900">{value}</span>
				<span className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
			</div>
		</div>
	);
};

// Quick Action Button
const QuickAction = ({ icon, label, onClick, variant = 'default' }: { 
	icon: React.ReactNode; 
	label: string; 
	onClick: () => void;
	variant?: 'default' | 'primary' | 'danger';
}) => {
	const variants = {
		default: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
		primary: 'bg-teal-50 text-teal-700 hover:bg-teal-100',
		danger: 'bg-red-50 text-red-600 hover:bg-red-100',
	};
	
	return (
		<button
			onClick={onClick}
			className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${variants[variant]}`}
		>
			{icon}
			{label}
		</button>
	);
};

export const ContentView = () => {
	const params = useParams({ strict: false });
	const contentId = ('contentId' in params ? params.contentId : undefined) as string | undefined;
	const navigate = useNavigate();
	const { t } = useTranslation();
	const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
	const { data: content, isLoading } = useContent(contentId);
	const updateContent = useUpdateContent();
	const deleteContent = useDeleteContent();
	
	const [editedBody, setEditedBody] = useState('');
	const [editedTitle, setEditedTitle] = useState('');
	const [editedSlug, setEditedSlug] = useState('');
	const [publishedDate, setPublishedDate] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [lastSaved, setLastSaved] = useState<Date | null>(null);
	// A failed save must be visible — otherwise the editor looks saved while the DB has the old text.
	const [saveFailed, setSaveFailed] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [showExportMenu, setShowExportMenu] = useState(false);

	// What the editor last synced from / saved to the server. While the local edits differ from
	// this (unsaved = dirty), a query refetch must NOT overwrite them.
	const syncedRef = useRef({ body: '', title: '', slug: '' });
	const editsRef = useRef({ body: '', title: '', slug: '' });
	editsRef.current = { body: editedBody, title: editedTitle, slug: editedSlug };

	useEffect(() => {
		if (content) {
			const e = editsRef.current;
			const s = syncedRef.current;
			const dirty = e.body !== s.body || e.title !== s.title || e.slug !== s.slug;
			if (dirty) return; // keep unsaved local edits; they'll be synced after the next save
			syncedRef.current = { body: content.body || '', title: content.title || '', slug: content.slug || '' };
			setEditedBody(content.body || '');
			setEditedTitle(content.title || '');
			setEditedSlug(content.slug || '');
			setPublishedDate(content.published_date || null);
			setLastSaved(new Date());
		}
	}, [content]);

	// The article as the user sees it now (including edits autosave hasn't written yet): tools,
	// scoring and export must work on this, not on the last server copy.
	const liveContent = useMemo(
		() => (content ? { ...content, body: editedBody, title: editedTitle, slug: editedSlug } : content),
		[content, editedBody, editedTitle, editedSlug],
	);

	// Read-only analyzers parse Markdown; agent articles are stored as (Gutenberg) HTML, which made
	// them report "no H1", 0 headings/links and no FAQ. Give them a Markdown view of the draft —
	// tools that SAVE the body keep getting liveContent so the stored format never changes.
	const deferredBody = useDeferredValue(editedBody);
	const analysisContent = useMemo(
		() => (content ? { ...content, body: ensureMarkdownFormat(deferredBody), title: editedTitle, slug: editedSlug } : content),
		[content, deferredBody, editedTitle, editedSlug],
	);

	// A tool saved a new body on the server: show it and treat it as synced, so neither a refetch
	// nor autosave puts the previous text back (and no page reload throws away other edits).
	const applyServerBody = useCallback((body: string) => {
		setEditedBody(body);
		syncedRef.current = { ...syncedRef.current, body };
		setLastSaved(new Date());
	}, []);

	// Calculate metrics
	const metrics = useMemo(() => {
		if (!editedBody || !content) return null;

		const primaryKeyword = content.keywords_used?.[0] || '';
		const seoScore = calculateSEOScore(editedBody, primaryKeyword);
		const readabilityScore = calculateReadability(editedBody);

		const wordCount = editedBody.split(/\s+/).filter((w) => w.trim().length > 0).length;
		const keywordMatches = primaryKeyword
			? (editedBody.toLowerCase().match(new RegExp(primaryKeyword.toLowerCase(), 'g')) || []).length
			: 0;
		const keywordDensity = wordCount > 0 ? ((keywordMatches / wordCount) * 100).toFixed(1) : '0';
		
		const headings = (editedBody.match(/^#+\s+/gm) || []).length;
		const images = (editedBody.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || []).length;
		const internalLinks = (editedBody.match(/\[([^\]]+)\]\([^)]+\)/g) || []).length;
		const externalLinks = (editedBody.match(/\[([^\]]+)\]\(https?:\/\//g) || []).length;

		return {
			seoScore,
			readabilityScore,
			wordCount,
			keywordDensity,
			headings,
			images,
			internalLinks,
			externalLinks,
			primaryKeyword,
		};
	}, [editedBody, content]);

	// Optimization suggestions
	const suggestions = useMemo(() => {
		if (!metrics || !content) return [];

		const suggestions: Array<{ type: 'success' | 'warning' | 'error'; message: string }> = [];

		if (metrics.seoScore >= 80) {
			suggestions.push({
				type: 'success',
				message: t('contentTools.contentView.suggestionWellOptimized'),
			});
		}

		if (parseFloat(metrics.keywordDensity) < 1) {
			suggestions.push({
				type: 'warning',
				message: t('contentTools.contentView.suggestionDensityLow', { density: metrics.keywordDensity }),
			});
		}

		if (parseFloat(metrics.keywordDensity) > 5) {
			suggestions.push({
				type: 'error',
				message: t('contentTools.contentView.suggestionDensityHigh', { density: metrics.keywordDensity }),
			});
		}

		if (metrics.headings < 5) {
			suggestions.push({
				type: 'warning',
				message: t('contentTools.contentView.suggestionMoreHeadings', { count: metrics.headings }),
			});
		}

		if (metrics.images < 3) {
			suggestions.push({
				type: 'warning',
				message: t('contentTools.contentView.suggestionMoreImages', { count: metrics.images }),
			});
		}

		if (metrics.internalLinks < 3) {
			suggestions.push({
				type: 'warning',
				message: t('contentTools.contentView.suggestionMoreInternalLinks', { count: metrics.internalLinks }),
			});
		}

		return suggestions;
	}, [metrics, content, t]);

	// Auto-save
	useEffect(() => {
		if (!content || !contentId) return;

		const bodyChanged = editedBody !== (content.body || '');
		const titleChanged = editedTitle !== (content.title || '');
		const slugChanged = editedSlug !== (content.slug || '');

		if (!bodyChanged && !titleChanged && !slugChanged) return;

		const timer = setTimeout(async () => {
			setIsSaving(true);
			try {
				await updateContent.mutateAsync({
					id: contentId,
					body: editedBody,
					title: editedTitle,
					slug: editedSlug,
				});
				syncedRef.current = { body: editedBody, title: editedTitle, slug: editedSlug };
				setLastSaved(new Date());
				setSaveFailed(false);
			} catch (error) {
				console.error('Auto-save error:', error);
				setSaveFailed(true);
			} finally {
				setIsSaving(false);
			}
		}, 2000);

		return () => clearTimeout(timer);
	}, [editedBody, editedTitle, editedSlug, contentId, content, updateContent]);

	if (!isAuthLoading && !isAuthenticated) {
		navigate({ to: '/login' as any });
		return null;
	}

	if (isLoading) {
		return (
			<div className="flex min-h-screen bg-gray-50">
				<Sidebar />
				<div className="flex-1 flex items-center justify-center">
					<LoadingSpinner size="lg" text={t('contentTools.contentView.loading')} />
				</div>
			</div>
		);
	}

	if (!content) {
		return (
			<div className="flex min-h-screen bg-gray-50">
				<Sidebar />
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center">
						<div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
							<svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
						</div>
						<p className="text-gray-600 mb-4">{t('contentTools.contentView.notFound')}</p>
						<Button onClick={() => navigate({ to: getDefaultAuthenticatedHomePath() as any })}>
							{t('navigation.backToDashboard')}
						</Button>
					</div>
				</div>
			</div>
		);
	}

	const handleSave = async () => {
		if (!contentId) return;
		setIsSaving(true);
		try {
			await updateContent.mutateAsync({
				id: contentId,
				body: editedBody,
				title: editedTitle,
				slug: editedSlug,
				published_date: publishedDate ?? null,
				status: publishedDate ? 'published' : 'draft',
			});
			syncedRef.current = { body: editedBody, title: editedTitle, slug: editedSlug };
			setLastSaved(new Date());
			setSaveFailed(false);
		} catch (error) {
			console.error('Error updating content:', error);
			setSaveFailed(true);
		} finally {
			setIsSaving(false);
		}
	};

	const handleDelete = async () => {
		if (!contentId) return;
		if (confirm(t('contentTools.contentView.confirmDelete'))) {
			try {
				await deleteContent.mutateAsync(contentId);
				navigate({ to: getDefaultAuthenticatedHomePath() as any });
			} catch (error) {
				console.error('Error deleting content:', error);
			}
		}
	};

	const handleSchedule = async (date: string | null) => {
		// The date picker yields YYYY-MM-DD; published_date is TIMESTAMPTZ → write local noon so
		// the calendar day is stable across timezones (see utils/calendar).
		const stamp = date ? toCalendarTimestamp(parseLocalDate(date)) : null;
		setPublishedDate(stamp);
		if (contentId) {
			try {
				await updateContent.mutateAsync({
					id: contentId,
					// null (not undefined) so "remove schedule" actually clears the column.
					published_date: stamp,
					status: stamp ? 'published' : 'draft',
				});
				setLastSaved(new Date());
				setSaveFailed(false);
			} catch (error) {
				console.error('Error scheduling content:', error);
				setSaveFailed(true);
				setPublishedDate(content?.published_date || null);
			}
		}
	};

	const scrollToSection = (sectionId: string) => {
		const section = document.getElementById(sectionId);
		if (section) {
			section.scrollIntoView({ behavior: 'smooth' });
		}
	};

	return (
		<div className="flex min-h-screen bg-gray-50">
			<Sidebar />

			{/* Main Content Area */}
			<div className="flex-1 flex flex-col bg-white min-w-0">
				{/* Sticky Header */}
				<header className="bg-white/80 backdrop-blur-lg border-b border-gray-200 sticky top-0 z-40">
					<div className="px-6 py-4">
						{/* Top row: Navigation and actions */}
						<div className="flex items-center justify-between mb-4">
							<button
								onClick={() => navigate({ to: getDefaultAuthenticatedHomePath() as any })}
								className="flex items-center gap-2 text-gray-500 hover:text-gray-900 text-sm transition-colors group"
							>
								<svg className="w-4 h-4 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
								</svg>
								<span>{t('navigation.backToDashboard')}</span>
							</button>
							
							<div className="flex items-center gap-3">
								{/* Save button - Primary action */}
								<button
									onClick={handleSave}
									disabled={isSaving}
									className={`
										flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm
										transition-all duration-200 shadow-sm
										${isSaving 
											? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
											: 'bg-gradient-to-r from-teal-500 to-cyan-500 text-white hover:from-teal-600 hover:to-cyan-600 hover:shadow-md active:scale-95'
										}
									`}
								>
									{isSaving ? (
										<>
											<svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
												<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
												<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
											</svg>
											<span>{t('content.saving')}</span>
										</>
									) : (
										<>
											<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
											</svg>
											<span>{t('content.save')}</span>
										</>
									)}
								</button>
								
								{/* Save status indicator */}
								{saveFailed && !isSaving && (
									<div role="alert" className="flex items-center gap-1.5 text-xs font-medium text-red-600">
										<span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
										<span>{t('content.saveFailed')}</span>
									</div>
								)}
								{lastSaved && !isSaving && !saveFailed && (
									<div className="flex items-center gap-1.5 text-xs text-gray-500">
										<span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
										<span>{lastSaved.toLocaleTimeString(uiLocaleTag(), { hour: '2-digit', minute: '2-digit' })}</span>
									</div>
								)}

								{/* Export dropdown */}
								<div className="relative">
									<button
										onClick={() => setShowExportMenu(!showExportMenu)}
										className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
									>
										<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
										</svg>
										{t('contentTools.contentView.export')}
										<svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
										</svg>
									</button>
									
									<AnimatePresence>
										{showExportMenu && (
											<motion.div
												initial={{ opacity: 0, y: -10 }}
												animate={{ opacity: 1, y: 0 }}
												exit={{ opacity: 0, y: -10 }}
												className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-200 py-2 z-50"
											>
												{[
													{ label: 'Markdown', ext: 'MD', action: () => exportContentToMarkdown(liveContent!) },
													{ label: 'HTML', ext: 'HTML', action: async () => await exportContentToHTML(liveContent!) },
													{ label: 'PDF', ext: 'PDF', action: async () => await exportContentToPDF(liveContent!) },
													{ label: 'Word', ext: 'DOCX', action: async () => await exportContentToDOCX(liveContent!) },
												].map((item) => (
													<button
														key={item.ext}
														onClick={() => {
															item.action();
															setShowExportMenu(false);
														}}
														className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
													>
														<span>{item.label}</span>
														<span className="text-xs text-gray-400">.{item.ext.toLowerCase()}</span>
													</button>
												))}
											</motion.div>
										)}
									</AnimatePresence>
								</div>

								{/* Toggle sidebar */}
								<button
									onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
									className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors lg:hidden"
								>
									<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
									</svg>
								</button>

								{/* Delete */}
								<button
									onClick={handleDelete}
									className="p-2 text-gray-400 hover:text-status-error hover:bg-status-error/10 rounded-lg transition-colors"
									title={t('contentView.deleteContent')}
								>
									<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
									</svg>
								</button>
							</div>
						</div>

						{/* Title input */}
						<input
							type="text"
							value={editedTitle}
							onChange={(e) => setEditedTitle(e.target.value)}
							className="text-3xl font-bold bg-transparent border-none outline-none text-gray-900 w-full placeholder-gray-300"
							placeholder={t('contentView.titlePlaceholder')}
						/>
					</div>
				</header>

				{/* Editor Layout */}
				<div className="flex-1 flex overflow-hidden">
					{/* Editor */}
					<div className="flex-1 flex flex-col overflow-hidden min-w-0">
						<div className="flex-1 overflow-y-auto bg-white">
							<Suspense fallback={<div className="h-full w-full animate-pulse bg-gray-50" aria-hidden />}>
								<RichTextEditor
									className="h-full border-0 rounded-none"
									minHeight="calc(100vh - 200px)"
									onChange={(value) => setEditedBody(value)}
									placeholder={t('contentView.bodyPlaceholder')}
									value={editedBody}
								/>
							</Suspense>
						</div>
					</div>

					{/* Analytics Sidebar */}
					<motion.div 
						initial={false}
						animate={{ 
							width: sidebarCollapsed ? 0 : 320,
							opacity: sidebarCollapsed ? 0 : 1 
						}}
						transition={{ duration: 0.3, ease: 'easeInOut' }}
						className="bg-gray-50 border-l border-gray-200 overflow-hidden flex-shrink-0 hidden lg:block"
					>
						<div className="w-80 h-full overflow-y-auto">
							<div className="p-4 space-y-4">
								{/* SEO Score Card */}
								<div className="bg-white rounded-xl border border-gray-200 p-4">
									<div className="flex items-center justify-between mb-4">
										<h3 className="font-semibold text-gray-900">{t('contentTools.contentView.seoScore')}</h3>
											<button
												onClick={() => scrollToSection('advanced-scoring')}
												className="text-xs text-teal-600 hover:underline font-medium"
											>
												{t('contentTools.contentView.details')}
											</button>
									</div>
									<div className="flex items-center gap-6">
										<ScoreRing score={metrics?.seoScore || 0} size="md" />
										<div className="flex-1 space-y-2">
											<div className="flex items-center justify-between text-sm">
												<span className="text-gray-500">{t('contentTools.contentView.readability')}</span>
												<span className="font-medium">{metrics?.readabilityScore || 0}/100</span>
											</div>
											<div className="w-full bg-gray-200 rounded-full h-1.5">
												<div 
													className="bg-gradient-to-r from-teal-500 to-cyan-500 h-1.5 rounded-full transition-all duration-500"
													style={{ width: `${metrics?.readabilityScore || 0}%` }}
												/>
											</div>
										</div>
									</div>
								</div>

								{/* Quick Suggestions */}
								{suggestions.length > 0 && (
									<CollapsibleSection
										title={t('contentView.suggestions')}
										icon={
											<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
											</svg>
										}
										badge={suggestions.filter(s => s.type !== 'success').length}
										defaultOpen={true}
									>
										<div className="space-y-2">
											{suggestions.map((suggestion, index) => (
												<div
													key={index}
													className={`flex items-start gap-2 p-2.5 rounded-lg text-sm ${
														suggestion.type === 'success'
															? 'bg-emerald-50 text-emerald-700'
															: suggestion.type === 'warning'
															? 'bg-amber-50 text-amber-700'
															: 'bg-red-50 text-red-700'
													}`}
												>
													{suggestion.type === 'success' && <span>✓</span>}
													{suggestion.type === 'warning' && <span>⚠️</span>}
													{suggestion.type === 'error' && <span>✗</span>}
													<span>{suggestion.message}</span>
												</div>
											))}
										</div>
									</CollapsibleSection>
								)}

								{/* Article Metrics */}
								<CollapsibleSection
									title={t('contentView.articleMetrics')}
									icon={
										<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
										</svg>
									}
									defaultOpen={true}
								>
									<div className="space-y-1">
										<MetricRow
											label={t('contentView.metricWords')}
											value={metrics?.wordCount?.toLocaleString() || '0'} 
											status={metrics && metrics.wordCount > 300 ? 'success' : 'warning'}
										/>
										<MetricRow
											label={t('contentView.metricKeywordDensity')}
											value={`${metrics?.keywordDensity || '0'}%`}
											status={
												metrics && parseFloat(metrics.keywordDensity) >= 1 && parseFloat(metrics.keywordDensity) <= 3 
													? 'success' 
													: 'warning'
											}
										/>
										<MetricRow label={t('contentView.metricHeadings')} value={metrics?.headings || 0} status={metrics && metrics.headings >= 5 ? 'success' : 'warning'} />
										<MetricRow label={t('contentView.metricImages')} value={metrics?.images || 0} status={metrics && metrics.images >= 3 ? 'success' : 'warning'} />
										<MetricRow label={t('contentView.metricInternalLinks')} value={metrics?.internalLinks || 0} />
										<MetricRow label={t('contentView.metricExternalLinks')} value={metrics?.externalLinks || 0} />
									</div>
									
									{metrics?.primaryKeyword && (
										<div className="mt-4 p-3 bg-gray-100 rounded-lg">
											<div className="text-xs text-gray-500 mb-1">Target Keyword</div>
											<div className="font-medium text-gray-900">{metrics.primaryKeyword}</div>
										</div>
									)}
								</CollapsibleSection>

								{/* URL Slug */}
								<CollapsibleSection
									title="URL Slug"
									icon={
										<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
										</svg>
									}
								>
									<input
										type="text"
										value={editedSlug}
										onChange={(e) => setEditedSlug(e.target.value)}
										className="w-full px-3 py-2.5 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-teal-500/20 focus:border-teal-500 text-gray-900 text-sm transition-all"
										placeholder="article-slug"
									/>
									<p className="text-xs text-gray-400 mt-2">{t('contentTools.contentView.slugHint')}</p>
								</CollapsibleSection>

								{/* Schedule */}
								<CollapsibleSection
									title={t('contentTools.contentView.schedule')}
									icon={
										<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
										</svg>
									}
								>
									{publishedDate ? (
										<div className="space-y-3">
											<div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
												<svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
												</svg>
												<div>
													<div className="text-sm font-medium text-gray-900">{t('contentTools.contentView.scheduled')}</div>
													<div className="text-xs text-gray-500">
														{new Date(publishedDate).toLocaleDateString(uiLocaleTag(), {
															weekday: 'long',
															year: 'numeric',
															month: 'long',
															day: 'numeric',
														})}
													</div>
												</div>
											</div>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => handleSchedule(null)}
												fullWidth
											>
												{t('contentTools.contentView.removeSchedule')}
											</Button>
										</div>
									) : (
										<div className="space-y-3">
											<input
												type="date"
												value={publishedDate || ''}
												onChange={(e) => handleSchedule(e.target.value || null)}
												className="w-full px-3 py-2.5 bg-white border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-teal-500/20 focus:border-teal-500 text-gray-900 text-sm transition-all"
											/>
											<p className="text-xs text-gray-400">{t('contentTools.contentView.scheduleHint')}</p>
										</div>
									)}
								</CollapsibleSection>

								{/* AI Tools */}
								<CollapsibleSection
									title={t('contentTools.contentView.aiTools')}
									icon={
										<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
										</svg>
									}
									variant="highlight"
									defaultOpen={true}
								>
									<div className="space-y-2">
										<QuickAction
											icon={<span>✨</span>}
											label={t('contentTools.contentView.expandRewrite')}
											onClick={() => scrollToSection('content-expansion')}
											variant="primary"
										/>
										<QuickAction
											icon={<span>🎯</span>}
											label="GEO Analyzer"
											onClick={() => scrollToSection('geo-optimizer')}
										/>
										<QuickAction
											icon={<span>🤖</span>}
											label="AI Enhancer"
											onClick={() => scrollToSection('ai-enhancer')}
										/>
										<QuickAction
											icon={<span>📎</span>}
											label="Citation Optimizer"
											onClick={() => scrollToSection('citation-optimizer')}
										/>
										<QuickAction
											icon={<span>🎨</span>}
											label="Format Advisor"
											onClick={() => scrollToSection('format-advisor')}
										/>
									</div>
								</CollapsibleSection>

								{/* SEO Tools */}
								<CollapsibleSection
									title={t('contentTools.contentView.seoTools')}
									icon={
										<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
										</svg>
									}
								>
									<div className="space-y-2">
										<QuickAction
											icon={<span>📊</span>}
											label={t('contentTools.contentView.advancedAnalysis')}
											onClick={() => scrollToSection('advanced-scoring')}
										/>
										<QuickAction
											icon={<span>🔍</span>}
											label="SERP Features"
											onClick={() => scrollToSection('serp-optimization')}
										/>
										<QuickAction
											icon={<span>🏷️</span>}
											label="Schema Markup"
											onClick={() => scrollToSection('schema-markup')}
										/>
										<QuickAction
											icon={<span>📜</span>}
											label={t('contentTools.contentView.versions')}
											onClick={() => scrollToSection('versioning')}
										/>
									</div>
								</CollapsibleSection>
							</div>
						</div>
					</motion.div>
				</div>

				{/* Tool Sections */}
				<div className="bg-gray-50">
					{/* Advanced Scoring Section */}
					{content && (
						<div id="advanced-scoring" className="border-t border-gray-200 p-6">
							<div className="max-w-5xl mx-auto">
								<AdvancedContentScoring content={analysisContent!} />
							</div>
						</div>
					)}

					{/* SERP Features Optimization Section */}
					{content && (
						<div id="serp-optimization" className="border-t border-gray-200 p-6">
							<div className="max-w-5xl mx-auto">
								<SERPFeaturesOptimizer content={analysisContent!} />
							</div>
						</div>
					)}

					{/* Schema Markup Generator Section */}
					{content && (
						<div id="schema-markup" className="border-t border-gray-200 p-6">
							<div className="max-w-5xl mx-auto">
								<SchemaMarkupGenerator content={analysisContent!} />
							</div>
						</div>
					)}

					{/* Content Versioning Section */}
					{content && (
						<div id="versioning" className="border-t border-gray-200 p-6">
							<div className="max-w-5xl mx-auto">
								<ContentVersioning content={liveContent!} onVersionRestored={applyServerBody} />
							</div>
						</div>
					)}

					{/* Content Expansion Section */}
					{content && (
						<div id="content-expansion" className="border-t border-gray-200 p-6 bg-gradient-to-b from-gray-50 to-white">
							<div className="max-w-5xl mx-auto">
								<ContentExpansion content={liveContent!} onContentUpdated={applyServerBody} />
							</div>
						</div>
					)}

					{/* GEO Optimizer Section */}
					{content && (
						<div id="geo-optimizer" className="border-t border-gray-200 p-6 bg-gradient-to-b from-white to-gray-50">
							<div className="max-w-5xl mx-auto">
								<GEOOptimizer content={analysisContent!} />
							</div>
						</div>
					)}

					{/* AI Content Enhancer Section */}
					{content && (
						<div id="ai-enhancer" className="border-t border-gray-200 p-6">
							<div className="max-w-5xl mx-auto">
								<AIContentEnhancer content={liveContent!} onContentUpdated={applyServerBody} />
							</div>
						</div>
					)}

					{/* Inline Citation Optimizer Section */}
					{content && (
						<div id="citation-optimizer" className="border-t border-gray-200 p-6 bg-gradient-to-b from-gray-50 to-white">
							<div className="max-w-5xl mx-auto">
								<InlineCitationOptimizer content={analysisContent!} />
							</div>
						</div>
					)}

					{/* Content Format Advisor Section */}
					{content && (
						<div id="format-advisor" className="border-t border-gray-200 p-6">
							<div className="max-w-5xl mx-auto">
								<ContentFormatAdvisor content={analysisContent!} />
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

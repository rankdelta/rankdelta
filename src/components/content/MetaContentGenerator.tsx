/**
 * Meta Content Generator Component
 * 
 * Bulk generation of meta descriptions, titles, alt text, FAQ, etc.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabaseClient';
import { generateMeta, generateWithOpenAI } from '../../services/openai';
import { useProject } from '../../hooks/useProjects';
import { promptLangName } from '../../lib/contentLanguages';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { useToast } from '../../hooks/useToast';
import { Toast } from '../ui/Toast';
import { EmptyState } from '../ui/EmptyState';
import { Tooltip } from '../ui/Tooltip';
import type { Content } from '../../types/database';

interface MetaContentGeneratorProps {
	projectId: string;
}

type MetaType = 'meta_description' | 'meta_title' | 'og_title' | 'og_description' | 'twitter_title' | 'twitter_description' | 'faq';

/** Where each result lands in content.metadata — the keys export, schema and publishing read. */
const METADATA_KEY: Record<MetaType, string> = {
	meta_description: 'metaDescription',
	meta_title: 'metaTitle',
	og_title: 'ogTitle',
	og_description: 'ogDescription',
	twitter_title: 'twitterTitle',
	twitter_description: 'twitterDescription',
	faq: 'faq',
};

/** Plain text of a Markdown or HTML body, bounded for the prompt. */
function articleExcerpt(body: string, max = 6000): string {
	return body
		.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);
}

export const MetaContentGenerator = ({ projectId }: MetaContentGeneratorProps) => {
	const { t } = useTranslation();
	const [selectedContentIds, setSelectedContentIds] = useState<Set<string>>(new Set());
	const [selectedMetaType, setSelectedMetaType] = useState<MetaType>('meta_description');
	const [isGenerating, setIsGenerating] = useState(false);
	const { toast, showToast, hideToast } = useToast();
	const queryClient = useQueryClient();
	const { data: project } = useProject(projectId);

	// Get all content for the project
	const { data: contentList, isLoading } = useQuery({
		queryKey: ['content', 'project', projectId],
		queryFn: async () => {
			const { data, error } = await supabase
				.from('content')
				.select('*')
				.eq('project_id', projectId)
				.order('generated_date', { ascending: false });

			if (error) throw error;
			return (data || []) as Content[];
		},
	});

	const metaTypes: Array<{ value: MetaType; label: string; description: string; icon: string }> = [
		{ value: 'meta_description', label: 'Meta Description', description: t('contentTools.meta.descMetaDescription'), icon: '📝' },
		{ value: 'meta_title', label: 'Meta Title', description: t('contentTools.meta.descMetaTitle'), icon: '🏷️' },
		{ value: 'og_title', label: 'OG Title', description: t('contentTools.meta.descOgTitle'), icon: '📘' },
		{ value: 'og_description', label: 'OG Description', description: t('contentTools.meta.descOgDescription'), icon: '📘' },
		{ value: 'twitter_title', label: 'Twitter Title', description: t('contentTools.meta.descTwitterTitle'), icon: '🐦' },
		{ value: 'twitter_description', label: 'Twitter Description', description: t('contentTools.meta.descTwitterDescription'), icon: '🐦' },
		{ value: 'faq', label: 'FAQ', description: t('contentTools.meta.descFaq'), icon: '❓' },
	];

	const handleSelectAll = () => {
		if (contentList) {
			setSelectedContentIds(new Set(contentList.map((c) => c.id)));
		}
	};

	const handleDeselectAll = () => {
		setSelectedContentIds(new Set());
	};

	const toggleContent = (contentId: string) => {
		setSelectedContentIds((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(contentId)) {
				newSet.delete(contentId);
			} else {
				newSet.add(contentId);
			}
			return newSet;
		});
	};

	const handleGenerate = async () => {
		if (selectedContentIds.size === 0) {
			showToast(t('contentTools.meta.toastSelectOne'), 'warning');
			return;
		}

		setIsGenerating(true);
		let successCount = 0;
		let errorCount = 0;

		try {
			const selectedContent = contentList?.filter((c) => selectedContentIds.has(c.id)) || [];

			const language = project?.language || 'en';
			for (const content of selectedContent) {
				try {
					const primaryKeyword = content.keywords_used?.[0] || content.topic || '';
					const excerpt = articleExcerpt(content.body);
					let value: unknown;

					if (selectedMetaType === 'faq') {
						// Questions the article itself answers — never invented ones (Google FAQ rules).
						const faqText =
							(await generateWithOpenAI(
								`You are an SEO editor. Write in ${promptLangName(language)}. Only use questions the article actually answers, with answers taken from the article. Never invent facts.`,
								`Write 5-7 FAQ pairs for this article as a JSON array: [{"question": "...", "answer": "..."}]. Reply with JSON only.\n\nArticle:\n${excerpt}`,
								{ temperature: 0.3, maxTokens: 1500 },
							)) || '';
						const jsonMatch = faqText.match(/\[[\s\S]*\]/);
						if (!jsonMatch) throw new Error('FAQ generation returned no JSON');
						const faqs = (JSON.parse(jsonMatch[0]) as Array<{ question?: unknown; answer?: unknown }>)
							.filter((f) => typeof f.question === 'string' && typeof f.answer === 'string' && f.question && f.answer)
							.map((f) => ({ question: String(f.question).trim(), answer: String(f.answer).trim() }));
						if (faqs.length === 0) throw new Error('FAQ generation returned no pairs');
						value = faqs;
					} else {
						const meta = await generateMeta(content.title, excerpt, primaryKeyword, language);
						value = selectedMetaType.endsWith('title') ? meta.metaTitle : meta.metaDescription;
						if (!value) throw new Error('empty meta');
					}

					// Merge into the CURRENT metadata (another tool may have written since the list loaded).
					const { data: fresh, error: readErr } = await supabase.from('content').select('metadata').eq('id', content.id).single();
					if (readErr) throw readErr;
					const { error: writeErr } = await supabase
						.from('content')
						.update({ metadata: { ...((fresh?.metadata as Record<string, unknown> | null) ?? {}), [METADATA_KEY[selectedMetaType]]: value } })
						.eq('id', content.id);
					if (writeErr) throw writeErr;

					successCount++;
				} catch (error) {
					console.error(`Error generating meta for content ${content.id}:`, error);
					errorCount++;
				}
			}
			void queryClient.invalidateQueries({ queryKey: ['content'] });

			showToast(
				t('contentTools.meta.toastDone', { success: successCount, errors: errorCount }),
				errorCount === 0 ? 'success' : 'warning'
			);
			setSelectedContentIds(new Set());
		} catch (error) {
			console.error('Error in bulk generation:', error);
			showToast(t('contentTools.meta.toastError'), 'error');
		} finally {
			setIsGenerating(false);
		}
	};

	if (isLoading) {
		return <LoadingSpinner text={t('contentTools.meta.loading')} />;
	}

	if (!contentList || contentList.length === 0) {
		return (
			<EmptyState
				icon="📝"
				title={t('emptyStates.noContentAvailableTitle')}
				description={t('emptyStates.noContentAvailableDesc')}
				variant="minimal"
			/>
		);
	}

	return (
		<div className="space-y-6">
			<Card>
				<h3 className="text-lg font-bold text-white mb-4">{t('contentTools.meta.title')}</h3>
				<div className="space-y-4">
					{/* Meta Type Selector */}
					<div>
						<label className="block text-sm font-medium text-gray-300 mb-2">{t('contentTools.meta.typeLabel')}</label>
						<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
							{metaTypes.map((type) => (
								<Tooltip key={type.value} content={type.description} position="top">
									<button
										onClick={() => setSelectedMetaType(type.value)}
										className={`p-4 rounded-lg border-2 transition-all text-left ${
											selectedMetaType === type.value
												? 'border-cosmic-cyan bg-cosmic-cyan/10'
												: 'border-gray-600 hover:border-gray-500'
										}`}
									>
										<div className="text-2xl mb-2">{type.icon}</div>
										<div className={`text-sm font-medium ${selectedMetaType === type.value ? 'text-cosmic-cyan' : 'text-gray-400'}`}>
											{type.label}
										</div>
									</button>
								</Tooltip>
							))}
						</div>
					</div>

					{/* Selection Actions */}
					<div className="flex items-center justify-between">
						<div className="text-sm text-gray-400">
							{t('contentTools.meta.selectedCount', { selected: selectedContentIds.size, total: contentList.length })}
						</div>
						<div className="flex gap-2">
							<Button variant="ghost" size="sm" onClick={handleSelectAll}>
								{t('contentTools.meta.selectAll')}
							</Button>
							<Button variant="ghost" size="sm" onClick={handleDeselectAll}>
								{t('contentTools.meta.deselectAll')}
							</Button>
						</div>
					</div>

					{/* Generate Button */}
					<Button
						onClick={handleGenerate}
						loading={isGenerating}
						variant="primary"
						fullWidth
						disabled={selectedContentIds.size === 0}
					>
						{isGenerating ? t('contentTools.meta.generating') : t('contentTools.meta.generateFor', { type: metaTypes.find((m) => m.value === selectedMetaType)?.label, count: selectedContentIds.size })}
					</Button>
				</div>
			</Card>

			{/* Content List */}
			<Card>
				<h3 className="text-lg font-bold text-white mb-4">{t('contentTools.meta.selectContent')}</h3>
				<div className="space-y-2 max-h-[400px] overflow-y-auto">
					{contentList.map((content) => {
						const isSelected = selectedContentIds.has(content.id);
						return (
							<div
								key={content.id}
								onClick={() => toggleContent(content.id)}
								className={`p-4 rounded-lg border cursor-pointer transition-all ${
									isSelected ? 'border-cosmic-cyan bg-cosmic-cyan/10' : 'border-gray-600 hover:border-gray-500'
								}`}
							>
								<div className="flex items-start gap-3">
									<input
										type="checkbox"
										checked={isSelected}
										onChange={() => toggleContent(content.id)}
										className="mt-1"
									/>
									<div className="flex-1">
										<h4 className="font-semibold text-white mb-1">{content.title}</h4>
										<p className="text-sm text-gray-400 line-clamp-2">{content.body.substring(0, 150)}...</p>
										<div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
											<span>Status: {content.status}</span>
											{content.seo_score && <span>SEO: {content.seo_score}/100</span>}
										</div>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</Card>

			<Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={hideToast} />
		</div>
	);
};


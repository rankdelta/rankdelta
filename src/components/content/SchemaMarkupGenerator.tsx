/**
 * Schema Markup Generator Component
 * 
 * Generates schema.org structured data for content
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useToast } from '../../hooks/useToast';
import { Toast } from '../ui/Toast';
import { useUpdateContent } from '../../hooks/useContent';
import { useProject } from '../../hooks/useProjects';
import type { Content } from '../../types/database';

interface SchemaMarkupGeneratorProps {
	content: Content;
	onContentUpdated?: () => void;
}

type SchemaType = 'Article' | 'FAQPage' | 'HowTo' | 'BreadcrumbList' | 'Organization';

export const SchemaMarkupGenerator = ({ content, onContentUpdated }: SchemaMarkupGeneratorProps) => {
	const { t } = useTranslation();
	const [selectedSchema, setSelectedSchema] = useState<SchemaType>('Article');
	const [generatedSchema, setGeneratedSchema] = useState<string | null>(null);
	const updateContent = useUpdateContent();
	const { toast, showToast, hideToast } = useToast();
	const { data: project } = useProject(content.project_id);
	// Real site identity from the project — schema with placeholder URLs is worse than none.
	const rawSite = project?.website_url?.trim() ?? '';
	const siteUrl = rawSite ? (/^https?:\/\//i.test(rawSite) ? rawSite : `https://${rawSite}`).replace(/\/+$/, '') : null;
	const siteName = project?.name?.trim() || null;
	const pageUrl = siteUrl && content.slug ? `${siteUrl}/${content.slug.replace(/^\/+/, '')}` : undefined;

	const schemaTypes: Array<{ value: SchemaType; label: string; description: string; icon: string }> = [
		{ value: 'Article', label: 'Article', description: t('contentTools.schema.types.Article'), icon: '📰' },
		{ value: 'FAQPage', label: 'FAQ Page', description: t('contentTools.schema.types.FAQPage'), icon: '❓' },
		{ value: 'HowTo', label: 'HowTo', description: t('contentTools.schema.types.HowTo'), icon: '📋' },
		{ value: 'BreadcrumbList', label: 'Breadcrumb', description: t('contentTools.schema.types.BreadcrumbList'), icon: '🍞' },
		{ value: 'Organization', label: 'Organization', description: t('contentTools.schema.types.Organization'), icon: '🏢' },
	];

	const generateSchema = () => {
		const primaryKeyword = content.keywords_used?.[0] || content.topic || '';
		const publishedDate = content.published_date || content.generated_date;
		const modifiedDate = content.updated_at || content.generated_date;

		let schema: Record<string, unknown> = {};

		switch (selectedSchema) {
			case 'Article':
				schema = {
					'@context': 'https://schema.org',
					'@type': 'Article',
					headline: content.title,
					description: content.metadata && typeof content.metadata === 'object' && 'metaDescription' in content.metadata
						? String(content.metadata['metaDescription'])
						: content.body.substring(0, 160),
					image: content.metadata && typeof content.metadata === 'object' && 'image' in content.metadata
						? String(content.metadata['image'])
						: undefined,
					datePublished: publishedDate,
					dateModified: modifiedDate,
					author: project?.author_name?.trim()
						? { '@type': 'Person', name: project.author_name.trim() }
						: undefined,
					publisher: siteName ? { '@type': 'Organization', name: siteName, url: siteUrl ?? undefined } : undefined,
					mainEntityOfPage: pageUrl ? { '@type': 'WebPage', '@id': pageUrl } : undefined,
					keywords: content.keywords_used?.join(', ') || primaryKeyword,
				};
				break;

			case 'FAQPage': {
				// Extract FAQ from content or metadata
				const faqs: Array<{ question: string; answer: string }> = [];
				
				// Try to extract from metadata
				if (content.metadata && typeof content.metadata === 'object' && 'faq' in content.metadata) {
					const faqData = content.metadata['faq'];
					if (Array.isArray(faqData)) {
						for (const item of faqData) {
							if (
								item && typeof item === 'object' &&
								'question' in item && 'answer' in item
							) {
								faqs.push({
									question: String((item as { question: unknown }).question),
									answer: String((item as { answer: unknown }).answer),
								});
							}
						}
					}
				}

				// Extract from content (look for Q: and A: patterns)
				const qaMatches = content.body.match(/Q:\s*(.+?)\nA:\s*(.+?)(?=\n\n|$)/gs);
				if (qaMatches) {
					qaMatches.forEach((match) => {
						const qMatch = match.match(/Q:\s*(.+?)\n/);
						const aMatch = match.match(/A:\s*(.+)/);
						if (qMatch?.[1] && aMatch?.[1]) {
							faqs.push({
								question: qMatch[1].trim(),
								answer: aMatch[1].trim().substring(0, 500),
							});
						}
					});
				}

				// Google only accepts FAQ markup for questions actually on the page — never invent one.
				if (faqs.length === 0) {
					showToast(t('contentTools.schema.noFaq'), 'error');
					return;
				}

				schema = {
					'@context': 'https://schema.org',
					'@type': 'FAQPage',
					mainEntity: faqs.map((faq) => ({
						'@type': 'Question',
						name: faq.question,
						acceptedAnswer: {
							'@type': 'Answer',
							text: faq.answer,
						},
					})),
				};
				break;
			}

			case 'HowTo': {
				// Extract steps from content
				const steps: Array<{ name: string; text: string }> = [];
				const stepMatches = content.body.match(/^\d+\.\s+(.+?)$/gm);
				if (stepMatches) {
					stepMatches.forEach((step, index) => {
						steps.push({
							name: `Step ${index + 1}`,
							text: step.replace(/^\d+\.\s+/, '').trim(),
						});
					});
				}

				if (steps.length === 0) {
					// Fall back to H2 sections, using each section's first paragraph as the step text.
					for (const section of content.body.split(/^##\s+/m).slice(1)) {
						const [heading = '', ...rest] = section.split('\n');
						const text = rest.join('\n').split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#'));
						if (heading.trim() && text) steps.push({ name: heading.trim(), text: text.substring(0, 500) });
					}
				}
				if (steps.length === 0) {
					showToast(t('contentTools.schema.noSteps'), 'error');
					return;
				}

				schema = {
					'@context': 'https://schema.org',
					'@type': 'HowTo',
					name: content.title,
					description: content.body.substring(0, 200),
					step: steps.map((step, index) => ({
						'@type': 'HowToStep',
						position: index + 1,
						name: step.name,
						text: step.text,
					})),
				};
				break;
			}

			case 'BreadcrumbList': {
				if (!siteUrl || !pageUrl) {
					showToast(t('contentTools.schema.breadcrumbMissing'), 'error');
					return;
				}
				const breadcrumbs = [
					{ name: 'Home', url: siteUrl },
					{ name: content.title, url: pageUrl },
				];

				schema = {
					'@context': 'https://schema.org',
					'@type': 'BreadcrumbList',
					itemListElement: breadcrumbs.map((crumb, index) => ({
						'@type': 'ListItem',
						position: index + 1,
						name: crumb.name,
						item: crumb.url,
					})),
				};
				break;
			}

			case 'Organization':
				if (!siteName || !siteUrl) {
					showToast(t('contentTools.schema.organizationMissing'), 'error');
					return;
				}
				schema = {
					'@context': 'https://schema.org',
					'@type': 'Organization',
					name: siteName,
					url: siteUrl,
				};
				break;
		}

		// Remove undefined values
		const cleanSchema = JSON.parse(JSON.stringify(schema));
		setGeneratedSchema(JSON.stringify(cleanSchema, null, 2));
		showToast(t('contentTools.schema.generated'), 'success');
	};

	const handleSave = async () => {
		if (!generatedSchema) return;

		try {
			await updateContent.mutateAsync({
				id: content.id,
				metadata: {
					...(content.metadata ?? {}),
					schema_markup: JSON.parse(generatedSchema),
					schema_type: selectedSchema,
				},
			});
			showToast(t('contentTools.schema.saved'), 'success');
			onContentUpdated?.();
		} catch (error) {
			console.error('Error saving schema:', error);
			showToast(t('contentTools.schema.saveError'), 'error');
		}
	};

	return (
		<div className="space-y-6">
			<Card>
				<h3 className="text-lg font-bold text-white mb-4">Schema Markup Generator</h3>
				<div className="space-y-4">
					<div>
						<label className="block text-sm font-medium text-gray-300 mb-2">{t('contentTools.schema.schemaType')}</label>
						<div className="grid grid-cols-2 md:grid-cols-3 gap-3">
							{schemaTypes.map((type) => (
								<button
									key={type.value}
									onClick={() => setSelectedSchema(type.value)}
									className={`p-4 rounded-lg border-2 transition-all text-left ${
										selectedSchema === type.value
											? 'border-cosmic-cyan bg-cosmic-cyan/10'
											: 'border-gray-600 hover:border-gray-500'
									}`}
								>
									<div className="text-2xl mb-2">{type.icon}</div>
									<div className={`text-sm font-medium ${selectedSchema === type.value ? 'text-cosmic-cyan' : 'text-gray-400'}`}>
										{type.label}
									</div>
									<p className="text-xs text-gray-500 mt-1">{type.description}</p>
								</button>
							))}
						</div>
					</div>

					<Button onClick={generateSchema} variant="primary" fullWidth>
						{t('contentTools.schema.generate')}
					</Button>
				</div>
			</Card>

			{/* Generated Schema */}
			{generatedSchema && (
				<Card>
					<div className="flex items-center justify-between mb-4">
						<h3 className="text-lg font-bold text-white">{t('contentTools.schema.generatedTitle')}</h3>
						<div className="flex gap-2">
							<Button
								variant="secondary"
								size="sm"
								onClick={() => {
									navigator.clipboard.writeText(generatedSchema);
									showToast(t('contentTools.schema.copied'), 'success');
								}}
							>
								{t('contentTools.schema.copy')}
							</Button>
							<Button variant="primary" size="sm" onClick={handleSave} loading={updateContent.isPending}>
								{t('contentTools.schema.saveToContent')}
							</Button>
						</div>
					</div>
					<div className="bg-cosmic-dark border border-gray-600 rounded-lg p-4 max-h-[400px] overflow-y-auto">
						<pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap">
							{generatedSchema}
						</pre>
					</div>
					<div className="mt-4 p-3 bg-cosmic-cyan/10 border border-cosmic-cyan/30 rounded-lg">
						<p className="text-xs text-cosmic-cyan">
							{t('contentTools.schema.insertHint')}
						</p>
					</div>
				</Card>
			)}

			<Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={hideToast} />
		</div>
	);
};


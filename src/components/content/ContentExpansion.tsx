/**
 * Content Expansion & Rewriting Component
 * 
 * Tools to expand or rewrite existing content
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { complete } from '../../services/openrouter';
import { looksTruncated, saveRevisionBeforeAiEdit } from '../../services/contentRevisions';
import { buildRevisionPrompt, REVISION_SYSTEM_PROMPT, type ExpansionMode } from './contentRevisionPrompt';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { useToast } from '../../hooks/useToast';
import { Toast } from '../ui/Toast';
import { useUpdateContent } from '../../hooks/useContent';
import type { Content } from '../../types/database';

interface ContentExpansionProps {
	content: Content;
	/** Receives the body that was just saved. */
	onContentUpdated?: (newBody: string) => void;
}

export const ContentExpansion = ({ content, onContentUpdated }: ContentExpansionProps) => {
	const { t } = useTranslation();
	const [mode, setMode] = useState<ExpansionMode>('expand');
	const [instructions, setInstructions] = useState('');
	const [isProcessing, setIsProcessing] = useState(false);
	const [preview, setPreview] = useState<string | null>(null);
	const updateContent = useUpdateContent();
	const { toast, showToast, hideToast } = useToast();
	const contentMetadata = (content.metadata ?? {}) as Record<string, unknown>;
	const toneFromMetadata = contentMetadata['tone'];
	const fallbackTone =
		typeof toneFromMetadata === 'string' && toneFromMetadata.trim().length > 0 ? toneFromMetadata : 'professional';

	const modes: Array<{ value: ExpansionMode; label: string; description: string; icon: string }> = [
		{ value: 'expand', label: t('contentExpansion.modeExpand'), description: t('contentExpansion.modeExpandDesc'), icon: '📈' },
		{ value: 'rewrite', label: t('contentExpansion.modeRewrite'), description: t('contentExpansion.modeRewriteDesc'), icon: '✍️' },
		{ value: 'improve', label: t('contentExpansion.modeImprove'), description: t('contentExpansion.modeImproveDesc'), icon: '✨' },
		{ value: 'shorten', label: t('contentExpansion.modeShorten'), description: t('contentExpansion.modeShortenDesc'), icon: '✂️' },
	];

	const handleProcess = async () => {
		setIsProcessing(true);
		setPreview(null);

		try {
			const primaryKeyword = content.keywords_used?.[0] || content.topic || '';
			const { prompt, targetLength } = buildRevisionPrompt({
				mode,
				body: content.body,
				primaryKeyword,
				tone: fallbackTone,
				instructions,
			});

			const expandedContent = (
				await complete([{ role: 'user', content: prompt }], {
					model: 'openai/gpt-4o',
					temperature: 0.5,
					maxTokens: Math.max(Math.floor(targetLength * 2.5), 6000),
					timeoutMs: 180_000,
					systemPrompt: REVISION_SYSTEM_PROMPT,
				})
			).trim();
			if (!expandedContent) throw new Error('empty completion');
			// Only "shorten" may shrink the article; anything else shorter means the output was cut off.
			if (mode !== 'shorten' && looksTruncated(content.body, expandedContent)) {
				showToast(t('contentExpansion.toastTruncated'), 'error');
				return;
			}

			setPreview(expandedContent);
			showToast(t('contentExpansion.toastProcessed'), 'success');
		} catch (error) {
			console.error('Error processing content:', error);
			showToast(t('contentExpansion.toastProcessError'), 'error');
		} finally {
			setIsProcessing(false);
		}
	};

	const handleSave = async () => {
		if (!preview) return;

		try {
			await saveRevisionBeforeAiEdit({ contentId: content.id, before: content.body, after: preview, tool: `content_expansion:${mode}` });
			await updateContent.mutateAsync({
				id: content.id,
				body: preview,
				metadata: {
					...contentMetadata,
					last_expanded: new Date().toISOString(),
					expansion_mode: mode,
				},
			});
			showToast(t('contentExpansion.toastUpdated'), 'success');
			setPreview(null);
			onContentUpdated?.(preview);
		} catch (error) {
			console.error('Error saving content:', error);
			showToast(t('contentExpansion.toastSaveError'), 'error');
		}
	};

	return (
		<div className="space-y-6">
			<Card>
				<h3 className="text-lg font-bold text-white mb-4">{t('contentExpansion.title')}</h3>
				<div className="space-y-4">
					{/* Mode Selector */}
					<div>
						<label className="block text-sm font-medium text-gray-300 mb-2">{t('contentExpansion.modeLabel')}</label>
						<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
							{modes.map((m) => (
								<button
									key={m.value}
									onClick={() => setMode(m.value)}
									className={`p-4 rounded-lg border-2 transition-all text-left ${
										mode === m.value
											? 'border-cosmic-cyan bg-cosmic-cyan/10'
											: 'border-gray-600 hover:border-gray-500'
									}`}
								>
									<div className="text-2xl mb-2">{m.icon}</div>
									<div className={`text-sm font-medium ${mode === m.value ? 'text-cosmic-cyan' : 'text-gray-400'}`}>
										{m.label}
									</div>
									<p className="text-xs text-gray-500 mt-1">{m.description}</p>
								</button>
							))}
						</div>
					</div>

					{/* Additional Instructions */}
					<div>
						<label className="block text-sm font-medium text-gray-300 mb-2">
							{t('contentExpansion.instructionsLabel')}
						</label>
						<Input
							value={instructions}
							onChange={(e) => setInstructions(e.target.value)}
							placeholder={t('contentExpansion.instructionsPlaceholder')}
							type="textarea"
							rows={3}
						/>
					</div>

					{/* Process Button */}
					<Button
						onClick={handleProcess}
						loading={isProcessing}
						variant="primary"
						fullWidth
					>
						{isProcessing ? t('contentExpansion.processing') : `🚀 ${t('contentExpansion.processCta', { mode: modes.find((m) => m.value === mode)?.label })}`}
					</Button>
				</div>
			</Card>

			{/* Preview */}
			{preview && (
				<Card>
					<div className="flex items-center justify-between mb-4">
						<h3 className="text-lg font-bold text-white">{t('contentExpansion.previewTitle')}</h3>
						<div className="flex gap-2">
							<Button variant="secondary" size="sm" onClick={() => setPreview(null)}>
								{t('common.cancel')}
							</Button>
							<Button variant="primary" size="sm" onClick={handleSave} loading={updateContent.isPending}>
								{t('contentExpansion.saveChanges')}
							</Button>
						</div>
					</div>
					<div className="bg-cosmic-dark border border-gray-600 rounded-lg p-4 max-h-[600px] overflow-y-auto">
						<pre className="whitespace-pre-wrap text-sm text-gray-300 font-mono">
							{preview}
						</pre>
					</div>
				</Card>
			)}

			<Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={hideToast} />
		</div>
	);
};


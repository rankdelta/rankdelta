/**
 * AI Content Enhancer
 *
 * Improves an existing article for AI answers and E-E-A-T without inventing anything: the model
 * may restructure, clarify and deepen what is already true, and marks the places where the
 * author's own data, experience or examples belong as `[ADD: …]` notes to fill in by hand.
 * Every applied change is snapshotted in `revisions` first, so it can be restored.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useToast } from '../../hooks/useToast';
import { Toast } from '../ui/Toast';
import { useUpdateContent } from '../../hooks/useContent';
import { generateWithOpenAI } from '../../services/openai';
import { looksTruncated, saveRevisionBeforeAiEdit, wordCount } from '../../services/contentRevisions';
import type { Content } from '../../types/database';

interface AIContentEnhancerProps {
	content: Content;
	onContentUpdated?: (newBody: string) => void;
}

type EnhancementType =
	| 'human_perspective'
	| 'unique_data'
	| 'concrete_examples'
	| 'citability'
	| 'eeat_signals'
	| 'depth_expansion'
	| 'ai_proof';

interface Enhancement {
	id: EnhancementType;
	icon: string;
	prompt: string;
}

/** Ground rules every enhancement inherits. */
export const ENHANCER_SYSTEM_PROMPT = `You are a senior SEO editor specialised in GEO (being cited in AI answers).
You improve an existing article. Hard rules:
- Write in the same language as the article.
- Keep the Markdown format. Do not remove existing content; you may reorganise and add.
- NEVER invent facts: no made-up statistics, percentages, surveys, test results, case studies, customer names, quotes, experts, studies or sources, and no first-person experience the article does not already state.
- Where the article would be stronger with the author's own data, experience, example or source, insert a short note in square brackets starting with "ADD:" in the article's language (e.g. "[ADD: your conversion rate before/after]"), so the author fills it with something real.
- Return only the revised article, no preamble or comments.`;

const ENHANCEMENTS: Enhancement[] = [
	{
		id: 'human_perspective',
		icon: '🧠',
		prompt: `Make the article read like it was written by a practitioner. Sharpen the advice with the reasoning behind it, trade-offs and common mistakes. Where first-hand experience would help (what the author tested, learned or got wrong), add 3-5 [ADD: …] notes that ask the author for it — do not write the experience yourself.`,
	},
	{
		id: 'unique_data',
		icon: '📊',
		prompt: `Find the 4-6 claims in the article that would be much stronger with a number (results, benchmarks, before/after, frequencies). Next to each, insert an [ADD: …] note saying exactly which figure the author should add from their own data. Keep any figures the article already cites. Do not create numbers.`,
	},
	{
		id: 'concrete_examples',
		icon: '💡',
		prompt: `Replace generic statements with concrete, verifiable illustrations: step-by-step walk-throughs, sample inputs/outputs, templates, checklists. Where a real case study or customer story belongs, insert an [ADD: …] note describing the case to add — never invent one.`,
	},
	{
		id: 'citability',
		icon: '📝',
		prompt: `Make the article easy for AI answers to quote: open each main section with a one- or two-sentence direct answer or definition, add a short Q&A for the implicit questions, and end with a "Key takeaways" list. Only attribute a statement to a source the article already names; otherwise state it plainly or add an [ADD: source] note.`,
	},
	{
		id: 'eeat_signals',
		icon: '🏆',
		prompt: `Strengthen E-E-A-T honestly: precise terminology, reasons behind recommendations, limitations and when the advice does not apply, and a clear methodology where the article makes claims. For experience, credentials or sources the article lacks, add [ADD: …] notes (e.g. "[ADD: how long you have done this / your qualification]").`,
	},
	{
		id: 'depth_expansion',
		icon: '🔬',
		prompt: `Go deeper than an AI summary: add H3 subsections that explain the "why", edge cases, pros and cons, and considerations for different situations — all from general, well-established knowledge. Add roughly 30-50% more words.`,
	},
	{
		id: 'ai_proof',
		icon: '🛡️',
		prompt: `Apply all of the following while keeping the existing structure: direct answers at the top of each section, a Key takeaways list, deeper H3 subsections (the why, edge cases, pros and cons), concrete walk-throughs, honest limitations — and [ADD: …] notes wherever the author's own data, experience, examples or sources would make the article unique.`,
	},
];

const COPY = {
	en: {
		names: {
			human_perspective: 'Practitioner voice',
			unique_data: 'Mark where your data belongs',
			concrete_examples: 'Concrete examples',
			citability: 'Optimise for AI citations',
			eeat_signals: 'Strengthen E-E-A-T',
			depth_expansion: 'Expand in depth',
			ai_proof: 'Full AI-proof pass',
		},
		descriptions: {
			human_perspective: 'Sharper reasoning and trade-offs; asks you for your real experience',
			unique_data: 'Flags the claims that need your own numbers — never invents them',
			concrete_examples: 'Walk-throughs, templates and checklists instead of generic advice',
			citability: 'Direct answers, Q&A and key takeaways AI answers can quote',
			eeat_signals: 'Reasons, limitations and methodology; asks for your credentials',
			depth_expansion: 'Adds the why, edge cases and pros/cons (+30-50%)',
			ai_proof: 'All of the above in one pass',
		},
		title: 'AI Content Enhancer',
		subtitle: 'Improve the article for AI answers without inventing anything',
		note: 'Nothing is made up: where the article needs your own data, experience or sources you will find [ADD: …] notes to fill in before publishing.',
		empty: 'The article is empty — write something first',
		ready: 'Preview ready — review it, then apply.',
		truncated: 'The AI response was cut off (shorter than your article), so it was not used. Try a shorter article or a single enhancement.',
		failed: 'The enhancement failed. Please try again.',
		applied: 'Article updated — the previous version is saved in Versioning.',
		saveFailed: 'Could not save. Nothing was changed.',
		discarded: 'Changes discarded',
		preview: 'Preview',
		apply: 'Apply changes',
		discard: 'Discard',
		previewCut: '[Preview shortened]',
		stats: (w: number, c: number, notes: number) => `Words: ${w.toLocaleString('en-US')} · Characters: ${c.toLocaleString('en-US')} · [ADD] notes to fill: ${notes}`,
		working: 'Working…',
		run: 'Apply',
		runAll: 'Run the full pass',
		tipsTitle: 'Before you publish',
		tips: [
			'Fill every [ADD: …] note with something real, or delete it.',
			'Read the whole article — the AI is an assistant, not the author.',
			'Check every claim you keep.',
		],
	},
	it: {
		names: {
			human_perspective: 'Voce da professionista',
			unique_data: 'Segna dove servono i tuoi dati',
			concrete_examples: 'Esempi concreti',
			citability: 'Ottimizza per le citazioni AI',
			eeat_signals: 'Rafforza E-E-A-T',
			depth_expansion: 'Espandi in profondità',
			ai_proof: 'Passata AI-proof completa',
		},
		descriptions: {
			human_perspective: 'Ragionamenti e compromessi più chiari; ti chiede la tua esperienza reale',
			unique_data: 'Indica le affermazioni che richiedono i tuoi numeri — non li inventa mai',
			concrete_examples: 'Procedure, modelli e checklist al posto dei consigli generici',
			citability: 'Risposte dirette, Q&A e punti chiave citabili dalle AI',
			eeat_signals: 'Motivazioni, limiti e metodo; ti chiede le tue credenziali',
			depth_expansion: 'Aggiunge il perché, i casi limite e pro/contro (+30-50%)',
			ai_proof: 'Tutto quanto sopra in una sola passata',
		},
		title: 'AI Content Enhancer',
		subtitle: 'Migliora l’articolo per le risposte AI senza inventare nulla',
		note: 'Nulla viene inventato: dove servono i tuoi dati, la tua esperienza o le tue fonti troverai note [ADD: …] da compilare prima di pubblicare.',
		empty: 'L’articolo è vuoto — scrivi prima qualcosa',
		ready: 'Anteprima pronta — controllala, poi applica.',
		truncated: 'La risposta dell’AI si è interrotta (più corta del tuo articolo), quindi non è stata usata. Prova con un articolo più corto o un solo miglioramento.',
		failed: 'Miglioramento non riuscito. Riprova.',
		applied: 'Articolo aggiornato — la versione precedente è salvata in Versioni.',
		saveFailed: 'Salvataggio non riuscito. Nessuna modifica applicata.',
		discarded: 'Modifiche scartate',
		preview: 'Anteprima',
		apply: 'Applica modifiche',
		discard: 'Scarta',
		previewCut: '[Anteprima abbreviata]',
		stats: (w: number, c: number, notes: number) => `Parole: ${w.toLocaleString('it-IT')} · Caratteri: ${c.toLocaleString('it-IT')} · Note [ADD] da compilare: ${notes}`,
		working: 'In corso…',
		run: 'Applica',
		runAll: 'Esegui la passata completa',
		tipsTitle: 'Prima di pubblicare',
		tips: [
			'Compila ogni nota [ADD: …] con qualcosa di reale, oppure eliminala.',
			'Rileggi tutto l’articolo — l’AI è un assistente, non l’autore.',
			'Verifica ogni affermazione che tieni.',
		],
	},
} as const;

const countAddNotes = (text: string): number => (text.match(/\[ADD:/g) ?? []).length;

export const AIContentEnhancer = ({ content, onContentUpdated }: AIContentEnhancerProps) => {
	const { i18n } = useTranslation();
	const c = COPY[(i18n.language ?? 'en').startsWith('it') ? 'it' : 'en'];
	const [isEnhancing, setIsEnhancing] = useState(false);
	const [activeEnhancement, setActiveEnhancement] = useState<EnhancementType | null>(null);
	const [previewContent, setPreviewContent] = useState<string | null>(null);
	const [isApplying, setIsApplying] = useState(false);
	const updateContent = useUpdateContent();
	const { toast, showToast, hideToast } = useToast();

	const handleEnhance = async (enhancement: Enhancement) => {
		if (!content.body?.trim()) {
			showToast(c.empty, 'warning');
			return;
		}

		setIsEnhancing(true);
		setActiveEnhancement(enhancement.id);
		setPreviewContent(null);

		try {
			const userPrompt = `${enhancement.prompt}

ARTICLE:
---
${content.body}
---`;
			// Room for the whole article plus the additions (≈1.6 tokens per word); gpt-4o-mini caps at 16k.
			const maxTokens = Math.min(16_000, Math.max(4_000, Math.ceil(wordCount(content.body) * 2.4) + 1_500));
			const enhanced = (await generateWithOpenAI(ENHANCER_SYSTEM_PROMPT, userPrompt, { temperature: 0.4, maxTokens }))?.trim();
			if (!enhanced) throw new Error('empty completion');
			if (looksTruncated(content.body, enhanced)) {
				showToast(c.truncated, 'error');
				return;
			}
			setPreviewContent(enhanced);
			showToast(c.ready, 'success');
		} catch (error) {
			console.error('Enhancement error:', error);
			showToast(c.failed, 'error');
		} finally {
			setIsEnhancing(false);
			setActiveEnhancement(null);
		}
	};

	const handleApplyEnhancement = async () => {
		if (!previewContent || !content.id) return;
		setIsApplying(true);
		try {
			await saveRevisionBeforeAiEdit({
				contentId: content.id,
				before: content.body,
				after: previewContent,
				tool: 'ai_content_enhancer',
			});
			await updateContent.mutateAsync({ id: content.id, body: previewContent });
			showToast(c.applied, 'success');
			onContentUpdated?.(previewContent);
			setPreviewContent(null);
		} catch (error) {
			console.error('Error applying enhancement:', error);
			showToast(c.saveFailed, 'error');
		} finally {
			setIsApplying(false);
		}
	};

	const handleDiscardEnhancement = () => {
		setPreviewContent(null);
		showToast(c.discarded, 'info');
	};

	return (
		<div className="space-y-6">
			<Card className="bg-gradient-to-r from-cosmic-cyan/20 to-cosmic-green/20 border-cosmic-cyan/30">
				<div className="flex items-center gap-4 mb-4">
					<div className="text-4xl">✨</div>
					<div>
						<h3 className="text-xl font-bold text-gray-900">{c.title}</h3>
						<p className="text-sm text-gray-600">{c.subtitle}</p>
					</div>
				</div>
				<p className="text-xs text-gray-500">{c.note}</p>
			</Card>

			{previewContent && (
				<Card className="border-2 border-cosmic-green/50 bg-cosmic-green/5">
					<div className="flex items-center justify-between mb-4">
						<h4 className="font-bold text-gray-900">📝 {c.preview}</h4>
						<div className="flex gap-2">
							<Button variant="primary" size="sm" onClick={handleApplyEnhancement} loading={isApplying} disabled={isApplying}>
								✅ {c.apply}
							</Button>
							<Button variant="secondary" size="sm" onClick={handleDiscardEnhancement} disabled={isApplying}>
								❌ {c.discard}
							</Button>
						</div>
					</div>
					<div className="max-h-96 overflow-y-auto p-4 bg-white rounded-lg border border-gray-200">
						<pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
							{previewContent.substring(0, 2000)}
							{previewContent.length > 2000 && `...\n\n${c.previewCut}`}
						</pre>
					</div>
					<p className="text-xs text-gray-500 mt-2">
						{c.stats(wordCount(previewContent), previewContent.length, countAddNotes(previewContent))}
					</p>
				</Card>
			)}

			<div className="grid md:grid-cols-2 gap-4">
				{ENHANCEMENTS.map((enhancement) => (
					<Card
						key={enhancement.id}
						className={`cursor-pointer transition-all hover:border-cosmic-cyan/50 ${
							enhancement.id === 'ai_proof'
								? 'md:col-span-2 bg-gradient-to-r from-cosmic-purple/10 to-cosmic-cyan/10 border-cosmic-purple/30'
								: ''
						}`}
					>
						<div className="flex items-start gap-3">
							<span className="text-2xl">{enhancement.icon}</span>
							<div className="flex-1">
								<h4 className="font-semibold text-gray-900 mb-1">{c.names[enhancement.id]}</h4>
								<p className="text-xs text-gray-500 mb-3">{c.descriptions[enhancement.id]}</p>
								<Button
									variant={enhancement.id === 'ai_proof' ? 'primary' : 'secondary'}
									size="sm"
									onClick={() => handleEnhance(enhancement)}
									loading={isEnhancing && activeEnhancement === enhancement.id}
									disabled={isEnhancing}
									fullWidth={enhancement.id === 'ai_proof'}
								>
									{isEnhancing && activeEnhancement === enhancement.id
										? c.working
										: enhancement.id === 'ai_proof'
											? `🚀 ${c.runAll}`
											: c.run}
								</Button>
							</div>
						</div>
					</Card>
				))}
			</div>

			<Card className="bg-gray-50">
				<h4 className="font-bold text-gray-900 mb-2">💡 {c.tipsTitle}</h4>
				<ul className="text-xs text-gray-600 space-y-1">
					{c.tips.map((tip) => (
						<li key={tip}>• {tip}</li>
					))}
				</ul>
			</Card>

			<Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={hideToast} />
		</div>
	);
};

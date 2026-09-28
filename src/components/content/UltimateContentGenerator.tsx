/**
 * Ultimate Content Generator - SEO & GEO 2025 Ready
 * 
 * Genera contenuti già ottimizzati per:
 * - AI Overviews (Google, Perplexity, ChatGPT)
 * - SEO tradizionale
 * - E-E-A-T signals
 * - Citabilità e prospettiva umana
 * 
 * Un solo click = contenuto pronto per pubblicare
 */

import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { useToast } from '../../hooks/useToast';
import { Toast } from '../ui/Toast';
import { generateWithOpenAI } from '../../services/openai';
import { getSERPAnalysis, getPeopleAlsoAsk } from '../../services/dataforseo';
import { projectResearchLocale } from '../../lib/seoMarkets';
import { calculateSEOScore, calculateGEOScore, calculateEEATScore, calculateCitabilityScore, calculateReadability } from '../../utils/seo';
import { useCreateContent } from '../../hooks/useContent';
import type { Project } from '../../types/database';
import { promptLangName } from '../../lib/contentLanguages';
import { noFabricationRules } from '../../lib/contentIntegrity';
import { uiLocaleTag } from '../../common/uiLocale';

interface UltimateContentGeneratorProps {
	project: Project;
	onContentGenerated?: (contentId: string) => void;
}

interface GenerationStep {
	id: string;
	name: string;
	status: 'pending' | 'in_progress' | 'completed' | 'error';
	icon: string;
}

interface ContentScores {
	seo: number;
	geo: number;
	eeat: number;
	citability: number;
	readability: number;
}

// The master prompt that creates AI-proof content
const ULTIMATE_GENERATION_PROMPT = `Sei un esperto SEO e content strategist specializzato nella creazione di contenuti che:
1. SUPERANO gli AI summaries (contenuto che gli utenti VOGLIONO leggere dopo l'AI Overview)
2. Sono CITABILI dagli AI Overviews di Google
3. Dimostrano E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness)

REGOLE CRITICHE per contenuto AI-proof 2025:

## 1. PROSPETTIVA DA PROFESSIONISTA
- Spiega il ragionamento, i compromessi e gli errori comuni come farebbe un esperto
- NON scrivere esperienze personali, test o risultati che non ti sono stati forniti: dove servirebbero, inserisci un segnaposto [ADD: …] per l'autore

## 2. DATI E STATISTICHE
- Usa solo dati forniti in questo prompt (SERP, PAA, contesto): NON inventare statistiche, percentuali, sondaggi o benchmark
- Dove un numero rafforzerebbe il testo, inserisci un segnaposto [Source needed: …] (nella lingua dell'articolo) invece del numero

## 3. ESEMPI CONCRETI
- Procedure passo-passo, modelli, checklist ed esempi illustrativi chiaramente ipotetici ("per esempio, un negozio che…")
- NON inventare case study, clienti, aziende o persone: dove servirebbe un caso reale, inserisci un segnaposto [ADD: …]

## 4. STRUTTURA CITABILE (obbligatorio)
- INIZIA ogni sezione H2 con una definizione chiara e quotabile
- Includi affermazioni esperte che possono essere estratte come citazioni
- Aggiungi una sezione "Key Takeaways" o "Punti Chiave" alla fine
- Attribuisci un'affermazione a una fonte solo se la fonte ti è stata fornita; mai "According to [Expert]" inventato

## 5. E-E-A-T SIGNALS
- Motivazioni, limiti e casi in cui il consiglio non vale; disclaimer dove appropriato
- NON inventare credenziali, anni di esperienza, revisori o fonti: dove servono, inserisci segnaposto [ADD: …] / [Source needed: …]

## 6. PROFONDITÀ OLTRE L'AI (obbligatorio)
- Aggiungi sottosezioni H3 dettagliate
- Spiega il "PERCHÉ" dietro ogni consiglio
- Includi avvertenze e casi edge
- Aggiungi considerazioni per contesti specifici
- Pro e contro dettagliati dove appropriato

## 7. FORMATTAZIONE
- Usa Markdown
- H1 per titolo, H2 per sezioni principali (almeno 5), H3 per sottosezioni
- Liste bullet e numerate dove appropriato
- Grassetto per concetti chiave
- Citazioni blockquote per affermazioni importanti

## 8. STRUTTURA ARTICOLO
1. Hook coinvolgente (non generico)
2. Promessa di valore specifica
3. Contenuto principale con sezioni H2
4. Esempi concreti (senza case study inventati)
5. Limiti e avvertenze
6. FAQ section (almeno 3 domande)
7. Key Takeaways
8. CTA finale

LUNGHEZZA: ${'{WORD_COUNT}'} parole minimo
LINGUA: ${'{LANGUAGE}'}
TONO: ${'{TONE}'}

${'{NO_FABRICATION}'}`;

export const UltimateContentGenerator = ({ project, onContentGenerated }: UltimateContentGeneratorProps): ReactElement => {
	const { t } = useTranslation();
	const [topic, setTopic] = useState(project.main_topic || '');
	const [primaryKeyword, setPrimaryKeyword] = useState(project.primary_keyword || '');
	const [secondaryKeywords, setSecondaryKeywords] = useState('');
	const [authorName, setAuthorName] = useState('');
	const [authorCredentials, setAuthorCredentials] = useState('');
	const [isGenerating, setIsGenerating] = useState(false);
	const [generatedContent, setGeneratedContent] = useState<string | null>(null);
	const [scores, setScores] = useState<ContentScores | null>(null);
	const [steps, setSteps] = useState<Array<GenerationStep>>([
		{ id: 'serp', name: t('ultimateGen.stepSerp'), status: 'pending', icon: '🔍' },
		{ id: 'paa', name: t('ultimateGen.stepPaa'), status: 'pending', icon: '❓' },
		{ id: 'outline', name: t('ultimateGen.stepOutline'), status: 'pending', icon: '📝' },
		{ id: 'content', name: t('ultimateGen.stepContent'), status: 'pending', icon: '✍️' },
		{ id: 'enhance', name: t('ultimateGen.stepEnhance'), status: 'pending', icon: '🚀' },
		{ id: 'score', name: t('ultimateGen.stepScore'), status: 'pending', icon: '📊' },
	]);
	
	const { toast, showToast, hideToast } = useToast();
	const createContent = useCreateContent();

	const updateStep = (stepId: string, status: GenerationStep['status']): void => {
		setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, status } : s)));
	};

	const handleGenerate = async (): Promise<void> => {
		if (!topic.trim() || !primaryKeyword.trim()) {
			showToast(t('ultimateGen.toastMissingInput'), 'warning');
			return;
		}

		setIsGenerating(true);
		setGeneratedContent(null);
		setScores(null);
		setSteps((prev) => prev.map((s) => ({ ...s, status: 'pending' })));

		const { locationCode } = projectResearchLocale(project);

		try {
			// Step 1: SERP Analysis
			updateStep('serp', 'in_progress');
			let serpContext = '';
			let paaQuestions: Array<{ question: string; answer: string }> = [];
			
			try {
				const serpResults = await getSERPAnalysis(primaryKeyword, locationCode, project.language, 5);
				if (serpResults.length > 0) {
					serpContext = `\n\n## ANALISI COMPETITOR (Top ${serpResults.length} risultati Google):\n`;
					serpResults.forEach((r, i) => {
						serpContext += `${i + 1}. "${r.title}"\n   Snippet: ${r.description}\n`;
					});
					serpContext += '\nCrea contenuto MIGLIORE e PIÙ APPROFONDITO di questi competitor.\n';
				}
				updateStep('serp', 'completed');
			} catch {
				updateStep('serp', 'completed'); // Continue even if SERP fails
			}

			// Step 2: People Also Ask
			updateStep('paa', 'in_progress');
			try {
				paaQuestions = await getPeopleAlsoAsk(primaryKeyword, locationCode, project.language);
				if (paaQuestions.length > 0) {
					serpContext += `\n\n## PEOPLE ALSO ASK (domande frequenti da Google):\n`;
					paaQuestions.slice(0, 5).forEach((paa, i) => {
						serpContext += `${i + 1}. ${paa.question}\n`;
					});
					serpContext += '\nRISPONDI a queste domande nel contenuto (crea sezioni dedicate o FAQ).\n';
				}
				updateStep('paa', 'completed');
			} catch {
				updateStep('paa', 'completed');
			}

			// Step 3: Create Outline
			updateStep('outline', 'in_progress');
			
			const outlinePrompt = `Crea un OUTLINE dettagliato per un articolo su "${topic}" con keyword "${primaryKeyword}".

L'outline deve includere:
- H1 (titolo accattivante con keyword)
- 5-7 sezioni H2 (ognuna con breve descrizione)
- 2-3 H3 per sezione
- Sezione FAQ
- Key Takeaways

${serpContext}

Rispondi SOLO con l'outline in formato Markdown.`;

			const outline = await generateWithOpenAI(
				'Sei un content strategist esperto. Crea outline dettagliati per contenuti SEO.',
				outlinePrompt,
				{ temperature: 0.7, maxTokens: 1500 }
			);
			updateStep('outline', 'completed');

			// Step 4: Generate Content
			updateStep('content', 'in_progress');
			
			const authorInfo = authorName 
				? `\n\nAUTORE: ${authorName}${authorCredentials ? ` - ${authorCredentials}` : ''}\nMenziona queste credenziali all'inizio dell'articolo.`
				: '';
			
			const secondaryKws = secondaryKeywords.trim()
				? `\n\nKEYWORD SECONDARIE da includere naturalmente: ${secondaryKeywords}`
				: '';

			const mainPrompt = ULTIMATE_GENERATION_PROMPT
				.replace('{WORD_COUNT}', String(project.content_length || 2000))
				.replace('{LANGUAGE}', promptLangName(project.language || 'en'))
				.replace('{TONE}', project.tone || 'professional')
				.replace('{NO_FABRICATION}', noFabricationRules(project.language || 'en'));

			const contentPrompt = `${mainPrompt}

## TOPIC: ${topic}
## KEYWORD PRINCIPALE: ${primaryKeyword}
${secondaryKws}
${authorInfo}

## OUTLINE DA SEGUIRE:
${outline || 'Crea una struttura logica per il topic'}

${serpContext}

---

Genera l'articolo COMPLETO seguendo TUTTE le regole sopra. 
Il contenuto deve essere IMPOSSIBILE da replicare con un semplice AI summary.
Deve contenere valore UNICO che richiede click-through anche dopo aver letto l'AI Overview.

OUTPUT: Articolo completo in Markdown, pronto per pubblicazione.`;

			const content = await generateWithOpenAI(
				'Sei il miglior content writer SEO al mondo. Crei contenuti che superano qualsiasi competitor e sono impossibili da replicare con AI.',
				contentPrompt,
				{ temperature: 0.8, maxTokens: 8000 }
			);

			if (!content || content.length < 500) {
				throw new Error(t('ultimateGen.errorTooShort'));
			}
			updateStep('content', 'completed');

			// Step 5: Enhance for GEO
			updateStep('enhance', 'in_progress');
			
			const enhancePrompt = `Improve this article for GEO (being cited in AI answers). Write in ${promptLangName(project.language || 'en')}.

ADD if missing:
1. A clear, quotable definition or direct answer at the start of each H2 section
2. A "Key takeaways" section
3. [ADD: …] placeholders where the author's own experience, data or example would help (never write them yourself)

${noFabricationRules(project.language || 'en')}

CONTENUTO:
${content}

---

Rispondi SOLO con il contenuto migliorato in Markdown. NON aggiungere commenti.`;

			const enhancedContent = await generateWithOpenAI(
				'Sei un esperto GEO (Generative Engine Optimization). Ottimizzi contenuti per essere citati dagli AI.',
				enhancePrompt,
				{ temperature: 0.6, maxTokens: 10000 }
			);
			updateStep('enhance', 'completed');

			const finalContent = enhancedContent || content;

			// Step 6: Calculate Scores
			updateStep('score', 'in_progress');
			
			const seoScore = calculateSEOScore(finalContent, primaryKeyword);
			const geoScore = calculateGEOScore(finalContent);
			const eeatResult = calculateEEATScore(finalContent);
			const citabilityScore = calculateCitabilityScore(finalContent);
			const readabilityScore = calculateReadability(finalContent);

			setScores({
				seo: seoScore,
				geo: geoScore,
				eeat: eeatResult.total,
				citability: citabilityScore,
				readability: readabilityScore,
			});
			updateStep('score', 'completed');

			setGeneratedContent(finalContent);
			showToast(t('ultimateGen.toastSuccess'), 'success');

		} catch (error) {
			console.error('Generation error:', error);
			showToast(t('ultimateGen.errorPrefix', { message: error instanceof Error ? error.message : t('ultimateGen.errorGenerationFailed') }), 'error');
			
			// Mark current step as error
			setSteps((prev) => prev.map((s) => (s.status === 'in_progress' ? { ...s, status: 'error' } : s)));
		} finally {
			setIsGenerating(false);
		}
	};

	const handleSaveContent = async (): Promise<void> => {
		if (!generatedContent) return;

		try {
			// Extract title from content (first H1)
			const titleMatch = generatedContent.match(/^#\s+(.+)$/m);
			const title = titleMatch?.[1] ?? topic;

			const result = await createContent.mutateAsync({
				project_id: project.id,
				title,
				body: generatedContent,
				topic,
				status: 'draft',
				keywords_used: [primaryKeyword, ...secondaryKeywords.split(',').map((k) => k.trim()).filter(Boolean)],
				seo_score: scores?.seo || 0,
			});

			showToast(t('ultimateGen.toastSaved'), 'success');
			onContentGenerated?.(result.id);
		} catch (error) {
			showToast(t('ultimateGen.toastSaveError'), 'error');
		}
	};

	const getScoreColor = (score: number): string => {
		if (score >= 80) return 'text-cosmic-green';
		if (score >= 60) return 'text-amber-500';
		return 'text-red-500';
	};

	const getScoreBadge = (score: number): 'success' | 'warning' | 'error' => {
		if (score >= 80) return 'success';
		if (score >= 60) return 'warning';
		return 'error';
	};

	return (
		<div className="space-y-6">
			{/* Header */}
			<Card className="bg-gradient-to-r from-cosmic-purple via-cosmic-cyan/50 to-cosmic-green/50 border-0">
				<div className="flex items-center gap-4 mb-4">
					<div className="text-5xl">🚀</div>
					<div>
						<h2 className="text-2xl font-bold text-white">{t('ultimateGen.title')}</h2>
						<p className="text-white/80">
							{t('ultimateGen.subtitle')}
						</p>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<Badge variant="info">✨ AI-Proof</Badge>
					<Badge variant="info">📊 E-E-A-T Optimized</Badge>
					<Badge variant="info">🎯 {t('ultimateGen.badgeCitable')}</Badge>
					<Badge variant="info">🔍 SERP Analysis</Badge>
					<Badge variant="info">❓ PAA Integration</Badge>
				</div>
			</Card>

			{/* Input Form */}
			<Card>
				<h3 className="text-lg font-bold text-gray-900 mb-4">{t('ultimateGen.configTitle')}</h3>
				<div className="space-y-4">
					<div className="grid md:grid-cols-2 gap-4">
						<div>
							<label className="block text-sm font-medium text-gray-700 mb-1">
								{t('ultimateGen.topicLabel')} *
							</label>
							<input
								className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cosmic-cyan focus:border-cosmic-cyan"
								disabled={isGenerating}
								onChange={(e) => setTopic(e.target.value)}
								placeholder={t('ultimateGen.topicPlaceholder')}
								type="text"
								value={topic}
							/>
						</div>
						<div>
							<label className="block text-sm font-medium text-gray-700 mb-1">
								{t('ultimateGen.keywordLabel')} *
							</label>
							<input
								className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cosmic-cyan focus:border-cosmic-cyan"
								disabled={isGenerating}
								onChange={(e) => setPrimaryKeyword(e.target.value)}
								placeholder={t('ultimateGen.keywordPlaceholder')}
								type="text"
								value={primaryKeyword}
							/>
						</div>
					</div>
					
					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">
							{t('ultimateGen.secondaryLabel')}
						</label>
						<input
							className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cosmic-cyan focus:border-cosmic-cyan"
							disabled={isGenerating}
							onChange={(e) => setSecondaryKeywords(e.target.value)}
							placeholder={t('ultimateGen.secondaryPlaceholder')}
							type="text"
							value={secondaryKeywords}
						/>
					</div>

					<div className="grid md:grid-cols-2 gap-4">
						<div>
							<label className="block text-sm font-medium text-gray-700 mb-1">
								{t('ultimateGen.authorNameLabel')}
							</label>
							<input
								className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cosmic-cyan focus:border-cosmic-cyan"
								disabled={isGenerating}
								onChange={(e) => setAuthorName(e.target.value)}
								placeholder={t('ultimateGen.authorNamePlaceholder')}
								type="text"
								value={authorName}
							/>
						</div>
						<div>
							<label className="block text-sm font-medium text-gray-700 mb-1">
								{t('ultimateGen.authorCredentialsLabel')}
							</label>
							<input
								className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cosmic-cyan focus:border-cosmic-cyan"
								disabled={isGenerating}
								onChange={(e) => setAuthorCredentials(e.target.value)}
								placeholder={t('ultimateGen.authorCredentialsPlaceholder')}
								type="text"
								value={authorCredentials}
							/>
						</div>
					</div>

					{/* Project Settings */}
					<div className="p-4 bg-gray-50 rounded-lg">
						<p className="text-xs text-gray-500 mb-2">{t('ultimateGen.projectSettings')}</p>
						<div className="flex flex-wrap gap-4 text-sm">
							<span><strong>{t('ultimateGen.settingsLength')}</strong> {t('ultimateGen.settingsWords', { count: project.content_length || 2000 })}</span>
							<span><strong>{t('ultimateGen.settingsTone')}</strong> {project.tone || 'professional'}</span>
							<span><strong>{t('ultimateGen.settingsLanguage')}</strong> {project.language?.toUpperCase() || 'EN'}</span>
						</div>
					</div>

					<Button
						disabled={isGenerating || !topic.trim() || !primaryKeyword.trim()}
						fullWidth
						loading={isGenerating}
						onClick={handleGenerate}
						variant="primary"
					>
						{isGenerating ? t('ultimateGen.generating') : t('ultimateGen.generateCta')}
					</Button>
				</div>
			</Card>

			{/* Generation Steps */}
			{isGenerating && (
				<Card>
					<h3 className="text-lg font-bold text-gray-900 mb-4">{t('ultimateGen.processTitle')}</h3>
					<div className="space-y-3">
						{steps.map((step) => (
							<div 
								key={step.id}
								className={`flex items-center gap-3 p-3 rounded-lg ${
									step.status === 'completed' ? 'bg-cosmic-green/10' :
									step.status === 'in_progress' ? 'bg-cosmic-cyan/10' :
									step.status === 'error' ? 'bg-red-500/10' : 'bg-gray-50'
								}`}
							>
								<span className="text-2xl">{step.icon}</span>
								<span className="flex-1 text-gray-700">{step.name}</span>
								{step.status === 'in_progress' && <LoadingSpinner size="sm" />}
								{step.status === 'completed' && <span className="text-cosmic-green">✓</span>}
								{step.status === 'error' && <span className="text-red-500">✗</span>}
							</div>
						))}
					</div>
				</Card>
			)}

			{/* Scores */}
			{scores && (
				<Card className="bg-gradient-to-br from-gray-50 to-white">
					<h3 className="text-lg font-bold text-gray-900 mb-4">{t('ultimateGen.scoresTitle')}</h3>
					<div className="grid grid-cols-2 md:grid-cols-5 gap-4">
						{[
							{ label: 'SEO', score: scores.seo, icon: '🎯' },
							{ label: 'GEO', score: scores.geo, icon: '🤖' },
							{ label: 'E-E-A-T', score: scores.eeat, icon: '🏆' },
							{ label: 'Citability', score: scores.citability, icon: '📝' },
							{ label: 'Readability', score: scores.readability, icon: '📖' },
						].map((metric) => (
							<div key={metric.label} className="text-center p-4 bg-white rounded-lg border border-gray-200">
								<div className="text-2xl mb-1">{metric.icon}</div>
								<div className={`text-3xl font-bold ${getScoreColor(metric.score)}`}>
									{metric.score}
								</div>
								<div className="text-xs text-gray-500">{metric.label}</div>
								<Badge size="sm" variant={getScoreBadge(metric.score)}>
									{metric.score >= 80 ? t('ultimateGen.scoreExcellent') : metric.score >= 60 ? t('ultimateGen.scoreGood') : t('ultimateGen.scoreNeedsWork')}
								</Badge>
							</div>
						))}
					</div>
				</Card>
			)}

			{/* Generated Content */}
			{generatedContent && (
				<Card>
					<div className="flex items-center justify-between mb-4">
						<h3 className="text-lg font-bold text-gray-900">{t('ultimateGen.generatedTitle')}</h3>
						<div className="flex gap-2">
							<Button
								onClick={() => {
									navigator.clipboard.writeText(generatedContent);
									showToast(t('ultimateGen.toastCopied'), 'success');
								}}
								size="sm"
								variant="secondary"
							>
								{t('ultimateGen.copy')}
							</Button>
							<Button
								loading={createContent.isPending}
								onClick={handleSaveContent}
								size="sm"
								variant="primary"
							>
								{t('ultimateGen.saveDraft')}
							</Button>
						</div>
					</div>
					<div className="max-h-[600px] overflow-y-auto p-4 bg-gray-50 rounded-lg border border-gray-200">
						<pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono">
							{generatedContent}
						</pre>
					</div>
					<p className="text-xs text-gray-500 mt-2">
						{t('ultimateGen.statsWords')} {generatedContent.split(/\s+/).length.toLocaleString(uiLocaleTag())} |
						{t('ultimateGen.statsChars')} {generatedContent.length.toLocaleString(uiLocaleTag())}
					</p>
				</Card>
			)}

			{/* What's Included */}
			<Card className="bg-gray-50">
				<h4 className="font-bold text-gray-900 mb-3">{t('ultimateGen.includedTitle')}</h4>
				<div className="grid md:grid-cols-3 gap-4 text-xs">
					<div>
						<p className="font-semibold text-cosmic-purple mb-2">{t('ultimateGen.includedHumanTitle')}</p>
						<ul className="space-y-1 text-gray-600">
							<li>• {t('ultimateGen.includedHuman1')}</li>
							<li>• {t('ultimateGen.includedHuman2')}</li>
							<li>• {t('ultimateGen.includedHuman3')}</li>
						</ul>
					</div>
					<div>
						<p className="font-semibold text-cosmic-cyan mb-2">{t('ultimateGen.includedDataTitle')}</p>
						<ul className="space-y-1 text-gray-600">
							<li>• {t('ultimateGen.includedData1')}</li>
							<li>• {t('ultimateGen.includedData2')}</li>
							<li>• {t('ultimateGen.includedData3')}</li>
						</ul>
					</div>
					<div>
						<p className="font-semibold text-cosmic-green mb-2">{t('ultimateGen.includedOptTitle')}</p>
						<ul className="space-y-1 text-gray-600">
							<li>• {t('ultimateGen.includedOpt1')}</li>
							<li>• {t('ultimateGen.includedOpt2')}</li>
							<li>• {t('ultimateGen.includedOpt3')}</li>
						</ul>
					</div>
				</div>
			</Card>

			<Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={hideToast} />
		</div>
	);
};


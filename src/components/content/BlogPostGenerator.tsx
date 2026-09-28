/**
 * Blog Post Generator Component
 * 
 * Interface for generating blog posts using OpenAI GPT-4o-mini.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generateBlogPost } from '../../services/openai';
import { calculateSEOScore, calculateReadability } from '../../utils/seo';
import { isValidKeyword, sanitizeString, checkRateLimit } from '../../utils/validation';
import type { Project } from '../../types/database';

interface BlogPostGeneratorProps {
	project: Project;
	onContentGenerated?: (content: string, seoScore: number, readability: number) => void;
}

export const BlogPostGenerator = ({ project, onContentGenerated }: BlogPostGeneratorProps) => {
	const { t } = useTranslation();
	const [topic, setTopic] = useState(project.main_topic || '');
	const [primaryKeyword, setPrimaryKeyword] = useState(project.primary_keyword || '');
	const [isGenerating, setIsGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [generatedContent, setGeneratedContent] = useState<string | null>(null);
	const [seoScore, setSeoScore] = useState<number | null>(null);
	const [readabilityScore, setReadabilityScore] = useState<number | null>(null);

	const handleGenerate = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsGenerating(true);
		setGeneratedContent(null);

		// Rate limiting check
		if (!checkRateLimit('blog-generation', 5, 60000)) {
			setError(t('contentGen.errorRateLimit'));
			setIsGenerating(false);
			return;
		}

		try {
			// Validate and sanitize input
			const sanitizedTopic = sanitizeString(topic);
			const sanitizedKeyword = sanitizeString(primaryKeyword);

			if (!sanitizedTopic || sanitizedTopic.length < 3) {
				throw new Error(t('contentGen.errorTopicTooShort'));
			}

			if (!sanitizedKeyword || !isValidKeyword(sanitizedKeyword)) {
				throw new Error(t('contentGen.errorInvalidKeyword'));
			}

			const content = await generateBlogPost({
				topic: sanitizedTopic,
				primaryKeyword: sanitizedKeyword,
				tone: project.tone,
				length: project.content_length,
				language: project.language,
			});

			const seo = calculateSEOScore(content, sanitizedKeyword);
			const readability = calculateReadability(content);

			setGeneratedContent(content);
			setSeoScore(seo);
			setReadabilityScore(readability);
			onContentGenerated?.(content, seo, readability);
		} catch (err) {
			setError(err instanceof Error ? err.message : t('contentGen.errorGeneration'));
		} finally {
			setIsGenerating(false);
		}
	};

	return (
		<div className="space-y-6">
			<form onSubmit={handleGenerate} className="space-y-4">
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div>
						<label htmlFor="topic" className="block text-sm font-medium text-gray-300 mb-2">
							{t('contentGen.topicLabel')} *
						</label>
						<input
							id="topic"
							type="text"
							value={topic}
							onChange={(e) => setTopic(e.target.value)}
							required
							className="w-full px-4 py-2 bg-cosmic-dark border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-cosmic-cyan text-white"
							placeholder={t('contentGen.topicPlaceholder')}
						/>
					</div>

					<div>
						<label htmlFor="primaryKeyword" className="block text-sm font-medium text-gray-300 mb-2">
							{t('contentGen.keywordLabel')} *
						</label>
						<input
							id="primaryKeyword"
							type="text"
							value={primaryKeyword}
							onChange={(e) => setPrimaryKeyword(e.target.value)}
							required
							className="w-full px-4 py-2 bg-cosmic-dark border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-cosmic-cyan text-white"
							placeholder={t('contentGen.keywordPlaceholder')}
						/>
					</div>
				</div>

				<div className="bg-cosmic-dark-soft border border-cosmic-cyan/20 rounded-lg p-4">
					<div className="grid grid-cols-3 gap-4 text-sm">
						<div>
							<span className="text-gray-400">{t('contentGen.toneLabel')}</span>
							<span className="ml-2 text-white capitalize">{project.tone}</span>
						</div>
						<div>
							<span className="text-gray-400">{t('contentGen.lengthLabel')}</span>
							<span className="ml-2 text-white">{t('contentGen.wordsUnit', { count: project.content_length })}</span>
						</div>
						<div>
							<span className="text-gray-400">{t('contentGen.languageLabel')}</span>
							<span className="ml-2 text-white uppercase">{project.language}</span>
						</div>
					</div>
				</div>

				{error && (
					<div className="p-3 bg-status-error/20 border border-status-error rounded-lg text-status-error text-sm">
						{error}
					</div>
				)}

				<button
					type="submit"
					disabled={isGenerating}
					className="w-full py-3 bg-cosmic-cyan text-cosmic-dark font-semibold rounded-lg hover:bg-cosmic-green transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
				>
					{isGenerating ? (
						<>
							<svg
								className="animate-spin h-5 w-5"
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
							>
								<circle
									className="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									strokeWidth="4"
								></circle>
								<path
									className="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								></path>
							</svg>
							{t('contentGen.generating')}
						</>
					) : (
						t('contentGen.generate')
					)}
				</button>
			</form>

			{generatedContent && (
				<div className="mt-8 space-y-4">
					<div className="flex items-center gap-4">
						{seoScore !== null && (
							<div className="bg-cosmic-dark-soft border border-cosmic-cyan/20 rounded-lg p-4">
								<div className="text-sm text-gray-400 mb-1">SEO Score</div>
								<div className="text-2xl font-bold text-cosmic-cyan">{seoScore}/100</div>
							</div>
						)}
						{readabilityScore !== null && (
							<div className="bg-cosmic-dark-soft border border-cosmic-cyan/20 rounded-lg p-4">
								<div className="text-sm text-gray-400 mb-1">Readability</div>
								<div className="text-2xl font-bold text-cosmic-green">{readabilityScore}/100</div>
							</div>
						)}
					</div>

					<div className="bg-cosmic-dark-soft border border-cosmic-cyan/20 rounded-lg p-6">
						<div className="flex items-center justify-between mb-4">
							<h3 className="text-lg font-bold text-white">{t('contentGen.generatedTitle')}</h3>
							<button
								onClick={() => {
									navigator.clipboard.writeText(generatedContent);
								}}
								className="px-4 py-2 bg-cosmic-cyan text-cosmic-dark text-sm font-semibold rounded-lg hover:bg-cosmic-green transition-colors"
							>
								{t('contentGen.copy')}
							</button>
						</div>
						<pre className="whitespace-pre-wrap text-sm text-gray-300 font-mono max-h-[600px] overflow-y-auto">
							{generatedContent}
						</pre>
					</div>
				</div>
			)}
		</div>
	);
};


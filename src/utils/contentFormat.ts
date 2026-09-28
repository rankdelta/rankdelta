/**
 * Content Format Utilities
 * 
 * Gestisce la conversione tra formati di contenuto.
 * 
 * STRATEGIA:
 * - AI genera contenuto in Markdown (più facile per l'AI)
 * - Convertiamo SUBITO in HTML dopo la generazione
 * - L'editor lavora nativamente in HTML
 * - Salvataggio in HTML
 * - Export opzionale in Markdown
 */

import { marked } from 'marked';
import TurndownService from 'turndown';

// Configure marked for clean HTML output
marked.setOptions({
	gfm: true,
	breaks: true,
});

// Configure Turndown for clean Markdown output
const turndownService = new TurndownService({
	headingStyle: 'atx',
	codeBlockStyle: 'fenced',
	bulletListMarker: '-',
	emDelimiter: '*',
	strongDelimiter: '**',
});

// Custom rules for better Markdown output
turndownService.addRule('strikethrough', {
	filter: ['del', 's', 'strike'],
	replacement: (content) => `~~${content}~~`,
});

// Preserve image alt text and credits
turndownService.addRule('image', {
	filter: 'img',
	replacement: (_content, node) => {
		const alt = typeof node['alt'] === 'string' ? node['alt'] : '';
		const src = typeof node['src'] === 'string' ? node['src'] : '';
		return `![${alt}](${src})`;
	},
});

// ============================================
// MARKDOWN → HTML
// ============================================

/**
 * Convert Markdown to HTML
 * Use this right after content generation
 */
export const markdownToHtml = (markdown: string): string => {
	if (!markdown || markdown.trim().length === 0) {
		return '';
	}
	
	try {
		// Parse markdown to HTML
		const html = marked.parse(markdown) as string;
		
		// Clean up the HTML
		return cleanHtml(html);
	} catch (error) {
		console.error('Error converting Markdown to HTML:', error);
		return `<p>${markdown}</p>`;
	}
};

/**
 * Clean HTML output
 */
const cleanHtml = (html: string): string => {
	return html
		// Remove empty paragraphs
		.replace(/<p>\s*<\/p>/g, '')
		// Ensure proper spacing
		.replace(/>\s+</g, '>\n<')
		// Trim
		.trim();
};

// ============================================
// HTML → MARKDOWN
// ============================================

/**
 * Convert HTML to Markdown
 * Use for export or when user switches to Markdown mode
 */
export const htmlToMarkdown = (html: string): string => {
	if (!html || html.trim().length === 0) {
		return '';
	}
	
	try {
		return turndownService.turndown(html);
	} catch (error) {
		console.error('Error converting HTML to Markdown:', error);
		// Strip HTML tags as fallback
		return html.replace(/<[^>]+>/g, '');
	}
};

// ============================================
// FORMAT DETECTION
// ============================================

/**
 * Detect if content is HTML or Markdown
 */
export const detectContentFormat = (content: string): 'html' | 'markdown' | 'unknown' => {
	if (!content || content.trim().length === 0) {
		return 'unknown';
	}
	
	const trimmed = content.trim();
	
	// Check for HTML indicators
	const htmlPatterns = [
		/^<[a-z]/i,           // Starts with HTML tag
		/<\/[a-z]+>/i,        // Has closing tags
		/<p>|<div>|<h[1-6]>|<ul>|<ol>|<blockquote>/i,  // Common HTML elements
	];
	
	for (const pattern of htmlPatterns) {
		if (pattern.test(trimmed)) {
			return 'html';
		}
	}
	
	// Check for Markdown indicators
	const markdownPatterns = [
		/^#+ /m,              // Markdown headings
		/^\* |^- |^\+ /m,     // Markdown lists
		/\[.+\]\(.+\)/,       // Markdown links
		/!\[.+\]\(.+\)/,      // Markdown images
		/```[\s\S]*```/,      // Code blocks
		/^\*\*.+\*\*/m,       // Bold
	];
	
	for (const pattern of markdownPatterns) {
		if (pattern.test(trimmed)) {
			return 'markdown';
		}
	}
	
	return 'unknown';
};

/**
 * Ensure content is in HTML format
 * Converts from Markdown if necessary
 */
export const ensureHtmlFormat = (content: string): string => {
	if (!content || content.trim().length === 0) {
		return '';
	}
	
	const format = detectContentFormat(content);
	
	if (format === 'html') {
		return content;
	}
	
	// Convert from Markdown (or unknown, treated as Markdown)
	return markdownToHtml(content);
};

/**
 * Ensure content is in Markdown format
 * Converts from HTML if necessary
 */
export const ensureMarkdownFormat = (content: string): string => {
	if (!content || content.trim().length === 0) {
		return '';
	}
	
	const format = detectContentFormat(content);
	
	if (format === 'markdown') {
		return content;
	}
	
	if (format === 'html') {
		return htmlToMarkdown(content);
	}
	
	// Unknown format, return as is
	return content;
};

// ============================================
// CONTENT PROCESSING
// ============================================

/**
 * Process generated content for storage
 * Converts Markdown to HTML and performs any necessary cleanup
 */
export const processGeneratedContent = (markdownContent: string): string => {
	// Convert to HTML
	let html = markdownToHtml(markdownContent);
	
	// Add target="_blank" to external links
	html = html.replace(
		/<a href="(https?:\/\/[^"]+)">/g,
		'<a href="$1" target="_blank" rel="noopener noreferrer">'
	);
	
	// Ensure internal links stay internal
	html = html.replace(
		/<a href="(\/content\/[^"]+)">/g,
		'<a href="$1">'
	);
	
	return html;
};

/**
 * Prepare content for export
 */
export const prepareForExport = (content: string, format: 'html' | 'markdown'): string => {
	if (format === 'markdown') {
		return ensureMarkdownFormat(content);
	}
	return ensureHtmlFormat(content);
};


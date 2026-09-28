/**
 * Export Utilities
 * 
 * Functions to export data in various formats (CSV, JSON, PDF, DOCX, HTML, etc.)
 */

// jspdf + docx are heavy (~hundreds of KB) and only needed when the user exports → dynamic-imported
// inside the export functions so they never weigh down the initial bundle. Types stay (erased at build).
import type { Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import i18next from 'i18next';
import { marked } from 'marked';
import type { RankData } from '../services/rankTracking';
import type { Content } from '../types/database';
import { sanitizeArticleHtml } from './sanitizeHtml';

/**
 * Escape a single CSV cell: double inner quotes and neutralise leading formula
 * characters (= + - @, and tab/CR which some spreadsheets also treat as formula
 * starters) so a crafted keyword/title cannot become a spreadsheet formula.
 */
export const csvCell = (value: unknown): string => {
	let cell = value === null || value === undefined ? '' : String(value);
	if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
	return `"${cell.replace(/"/g, '""')}"`;
};

/** Minimal HTML escaper for text interpolated into exported markup. */
export const escapeHtml = (value: unknown): string =>
	String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

/**
 * Export rankings to CSV
 */
export const exportRankingsToCSV = (rankings: RankData[], filename: string = 'rankings.csv') => {
	const headers = ['Keyword', 'Position', 'URL', 'Search Volume', 'Difficulty', 'Change', 'Last Checked'];
	const rows = rankings.map((r) => [
		r.keyword,
		r.position?.toString() || 'N/A',
		r.url || 'N/A',
		r.searchVolume?.toString() || 'N/A',
		r.difficulty?.toString() || 'N/A',
		r.change.toString(),
		new Date(r.lastChecked).toLocaleDateString(i18next.language),
	]);

	const csvContent = [
		headers.join(','),
		...rows.map((row) => row.map(csvCell).join(',')),
	].join('\n');

	const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
	const link = document.createElement('a');
	const url = URL.createObjectURL(blob);
	link.setAttribute('href', url);
	link.setAttribute('download', filename);
	link.style.visibility = 'hidden';
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
};

/**
 * Export rankings to JSON
 */
export const exportRankingsToJSON = (rankings: RankData[], filename: string = 'rankings.json') => {
	const jsonContent = JSON.stringify(rankings, null, 2);
	const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
	const link = document.createElement('a');
	const url = URL.createObjectURL(blob);
	link.setAttribute('href', url);
	link.setAttribute('download', filename);
	link.style.visibility = 'hidden';
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
};

/**
 * Export content to Markdown
 */
export const exportContentToMarkdown = (content: Content, filename?: string) => {
	const mdFilename = filename || `${content.slug || content.id}.md`;
	const markdown = `# ${content.title}\n\n${content.body}`;
	const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
	const link = document.createElement('a');
	const url = URL.createObjectURL(blob);
	link.setAttribute('href', url);
	link.setAttribute('download', mdFilename);
	link.style.visibility = 'hidden';
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
};

/** `<html lang>` of an exported article: its stored language if any, else the UI language (English by default). */
function exportLang(content: Content): string {
	const stored = content.metadata && typeof content.metadata === 'object' ? content.metadata['language'] : undefined;
	const code = (typeof stored === 'string' && stored ? stored : i18next.language || 'en').slice(0, 2).toLowerCase();
	return /^[a-z]{2}$/.test(code) ? code : 'en';
}

/**
 * Export content to HTML (improved with proper markdown parsing)
 */
export const exportContentToHTML = async (content: Content, filename?: string) => {
	const htmlFilename = filename || `${content.slug || content.id}.html`;
	
	// Convert markdown to HTML using marked
	const htmlBody = sanitizeArticleHtml(await marked(content.body));
	
	// Get meta information
	const metaDescription = content.metadata && typeof content.metadata === 'object' && 'metaDescription' in content.metadata
		? String(content.metadata['metaDescription'])
		: content.body.substring(0, 160);
	
	const html = `<!DOCTYPE html>
<html lang="${exportLang(content)}">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta name="description" content="${escapeHtml(metaDescription)}">
	<title>${escapeHtml(content.title)}</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
			max-width: 800px;
			margin: 0 auto;
			padding: 2rem;
			line-height: 1.8;
			color: #1a1a1a;
			background: #fff;
		}
		h1 {
			font-size: 2.5rem;
			margin-top: 0;
			margin-bottom: 1.5rem;
			color: #0f1729;
			border-bottom: 3px solid #00d9ff;
			padding-bottom: 1rem;
		}
		h2 {
			font-size: 1.8rem;
			margin-top: 2.5rem;
			margin-bottom: 1rem;
			color: #0f1729;
		}
		h3 {
			font-size: 1.4rem;
			margin-top: 2rem;
			margin-bottom: 0.8rem;
			color: #1a2a4d;
		}
		p {
			margin-bottom: 1.2rem;
		}
		ul, ol {
			margin-left: 2rem;
			margin-bottom: 1.2rem;
		}
		li {
			margin-bottom: 0.5rem;
		}
		strong {
			font-weight: 600;
			color: #0f1729;
		}
		em {
			font-style: italic;
		}
		a {
			color: #00d9ff;
			text-decoration: none;
		}
		a:hover {
			text-decoration: underline;
		}
		code {
			background: #f4f4f4;
			padding: 0.2rem 0.4rem;
			border-radius: 3px;
			font-family: 'Fira Code', monospace;
			font-size: 0.9em;
		}
		blockquote {
			border-left: 4px solid #00d9ff;
			padding-left: 1rem;
			margin-left: 0;
			color: #666;
			font-style: italic;
		}
		img {
			max-width: 100%;
			height: auto;
			border-radius: 8px;
			margin: 1.5rem 0;
		}
		.metadata {
			background: #f8f9fa;
			padding: 1rem;
			border-radius: 8px;
			margin-bottom: 2rem;
			font-size: 0.9rem;
			color: #666;
		}
		.metadata strong {
			color: #0f1729;
		}
	</style>
</head>
<body>
	<div class="metadata">
		<strong>${i18next.language?.startsWith('it') ? 'Titolo' : 'Title'}:</strong> ${escapeHtml(content.title)}<br>
		${content.topic ? `<strong>Topic:</strong> ${escapeHtml(content.topic)}<br>` : ''}
		${content.seo_score !== null ? `<strong>SEO Score:</strong> ${content.seo_score}/100<br>` : ''}
		${content.readability_score !== null ? `<strong>Readability:</strong> ${content.readability_score}/100<br>` : ''}
		${content.keywords_used && content.keywords_used.length > 0 ? `<strong>Keywords:</strong> ${escapeHtml(content.keywords_used.join(', '))}<br>` : ''}
		<strong>${i18next.language?.startsWith('it') ? 'Data' : 'Date'}:</strong> ${new Date(content.generated_date).toLocaleDateString(i18next.language)}
	</div>
	<div class="content">
		${htmlBody}
	</div>
</body>
</html>`;
	
	const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
	saveAs(blob, htmlFilename);
};

/**
 * Export content to PDF
 */
export const exportContentToPDF = async (content: Content, filename?: string) => {
	const { default: jsPDF } = await import('jspdf');
	const pdfFilename = filename || `${content.slug || content.id}.pdf`;

	// Create PDF
	const doc = new jsPDF({
		orientation: 'portrait',
		unit: 'mm',
		format: 'a4',
	});
	
	// Set font
	doc.setFont('helvetica');
	
	// Title
	doc.setFontSize(20);
	doc.setTextColor(15, 23, 41); // cosmic-dark
	doc.text(content.title, 20, 30);
	
	// Metadata
	doc.setFontSize(10);
	doc.setTextColor(100, 100, 100);
	let yPos = 40;
	
	if (content.topic) {
		doc.text(`Topic: ${content.topic}`, 20, yPos);
		yPos += 7;
	}
	if (content.seo_score !== null) {
		doc.text(`SEO Score: ${content.seo_score}/100`, 20, yPos);
		yPos += 7;
	}
	if (content.readability_score !== null) {
		doc.text(`Readability: ${content.readability_score}/100`, 20, yPos);
		yPos += 7;
	}
	if (content.keywords_used && content.keywords_used.length > 0) {
		doc.text(`Keywords: ${content.keywords_used.join(', ')}`, 20, yPos);
		yPos += 7;
	}
	
	// Add separator
	yPos += 5;
	doc.setDrawColor(0, 217, 255); // cosmic-cyan
	doc.line(20, yPos, 190, yPos);
	yPos += 10;
	
	// Convert markdown to plain text for PDF (simplified)
	const plainText = content.body
		.replace(/^#+\s+/gm, '') // Remove markdown headers
		.replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
		.replace(/\*(.*?)\*/g, '$1') // Remove italic
		.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Remove links
		.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '') // Remove images
		.replace(/\n{3,}/g, '\n\n'); // Normalize line breaks
	
	// Split text into pages
	doc.setFontSize(11);
	doc.setTextColor(26, 26, 26);
	
	const pageWidth = 170; // A4 width minus margins
	const pageHeight = 250; // A4 height minus margins
	const lineHeight = 7;

	const lines = doc.splitTextToSize(plainText, pageWidth);

	for (let i = 0; i < lines.length; i++) {
		if (yPos > pageHeight) {
			doc.addPage();
			yPos = 20;
		}
		doc.text(lines[i], 20, yPos);
		yPos += lineHeight;
	}
	
	// Save PDF
	doc.save(pdfFilename);
};

/**
 * Export content to DOCX (Word document)
 */
export const exportContentToDOCX = async (content: Content, filename?: string) => {
	const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
	const docxFilename = filename || `${content.slug || content.id}.docx`;

	// Parse markdown to paragraphs
	const paragraphs: Paragraph[] = [];
	
	// Title
	paragraphs.push(
		new Paragraph({
			text: content.title,
			heading: HeadingLevel.HEADING_1,
			spacing: { after: 400 },
		})
	);
	
	// Metadata
	if (content.topic || content.seo_score !== null || content.readability_score !== null) {
		const metadataText: TextRun[] = [];
		if (content.topic) {
			metadataText.push(new TextRun({ text: `Topic: ${content.topic}`, bold: true }));
			metadataText.push(new TextRun({ text: ' | ' }));
		}
		if (content.seo_score !== null) {
			metadataText.push(new TextRun({ text: `SEO Score: ${content.seo_score}/100`, bold: true }));
			metadataText.push(new TextRun({ text: ' | ' }));
		}
		if (content.readability_score !== null) {
			metadataText.push(new TextRun({ text: `Readability: ${content.readability_score}/100`, bold: true }));
		}
		if (metadataText.length > 0) {
			paragraphs.push(
				new Paragraph({
					children: metadataText,
					spacing: { after: 200 },
				})
			);
		}
	}
	
	// Convert markdown body to paragraphs
	const lines = content.body.split('\n');
	for (const line of lines) {
		if (line.trim() === '') {
			paragraphs.push(new Paragraph({ text: '', spacing: { after: 200 } }));
			continue;
		}
		
		// Headers
		if (line.startsWith('# ')) {
			paragraphs.push(
				new Paragraph({
					text: line.substring(2),
					heading: HeadingLevel.HEADING_1,
					spacing: { after: 300 },
				})
			);
		} else if (line.startsWith('## ')) {
			paragraphs.push(
				new Paragraph({
					text: line.substring(3),
					heading: HeadingLevel.HEADING_2,
					spacing: { after: 250 },
				})
			);
		} else if (line.startsWith('### ')) {
			paragraphs.push(
				new Paragraph({
					text: line.substring(4),
					heading: HeadingLevel.HEADING_3,
					spacing: { after: 200 },
				})
			);
		} else {
			// Regular paragraph - parse bold and italic
			const textRuns: TextRun[] = [];
			let currentText = line;
			
			// Simple markdown parsing
			currentText = currentText
				.replace(/\*\*(.*?)\*\*/g, (_match, text) => {
					textRuns.push(new TextRun({ text: text, bold: true }));
					return '';
				})
				.replace(/\*(.*?)\*/g, (_match, text) => {
					textRuns.push(new TextRun({ text: text, italics: true }));
					return '';
				});
			
			if (textRuns.length === 0) {
				textRuns.push(new TextRun({ text: currentText }));
			}
			
			paragraphs.push(
				new Paragraph({
					children: textRuns,
					spacing: { after: 200 },
				})
			);
		}
	}
	
	// Create document
	const doc = new Document({
		sections: [
			{
				properties: {},
				children: paragraphs,
			},
		],
	});
	
	// Generate and save
	const blob = await Packer.toBlob(doc);
	saveAs(blob, docxFilename);
};

/**
 * Export HTML string to PDF
 */
export const exportToPDF = async (html: string, filename: string = 'document.pdf') => {
	const { default: html2canvas } = await import('html2canvas-pro');
	const { default: jsPDF } = await import('jspdf');
	
	// Create a temporary container for the HTML
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = sanitizeArticleHtml(html);
	tempDiv.style.position = 'absolute';
	tempDiv.style.left = '-9999px';
	tempDiv.style.width = '1200px';
	document.body.appendChild(tempDiv);
	
	try {
		// Convert HTML to canvas
		const canvas = await html2canvas(tempDiv, {
			scale: 2,
			useCORS: true,
			logging: false,
		});
		
		// Convert canvas to image
		const imgData = canvas.toDataURL('image/png');
		
		// Create PDF
		const pdf = new jsPDF({
			orientation: 'portrait',
			unit: 'mm',
			format: 'a4',
		});
		
		const imgWidth = 210; // A4 width in mm
		const pageHeight = 297; // A4 height in mm
		const imgHeight = (canvas.height * imgWidth) / canvas.width;
		let heightLeft = imgHeight;
		let position = 0;
		
		// Add first page
		pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
		heightLeft -= pageHeight;
		
		// Add additional pages if needed
		while (heightLeft > 0) {
			position = heightLeft - imgHeight;
			pdf.addPage();
			pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
			heightLeft -= pageHeight;
		}
		
		// Save PDF
		pdf.save(filename);
	} finally {
		// Clean up
		document.body.removeChild(tempDiv);
	}
};

/**
 * Export multiple content items to CSV
 */
export const exportContentListToCSV = (contentList: Content[], filename: string = 'content-list.csv') => {
	const headers = ['Title', 'Topic', 'Status', 'SEO Score', 'Readability Score', 'Generated Date', 'Published Date'];
	const rows = contentList.map((c) => [
		c.title,
		c.topic || 'N/A',
		c.status,
		c.seo_score?.toString() || 'N/A',
		c.readability_score?.toString() || 'N/A',
		new Date(c.generated_date).toLocaleDateString(i18next.language),
		c.published_date ? new Date(c.published_date).toLocaleDateString(i18next.language) : 'N/A',
	]);

	const csvContent = [
		headers.join(','),
		...rows.map((row) => row.map(csvCell).join(',')),
	].join('\n');

	const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
	const link = document.createElement('a');
	const url = URL.createObjectURL(blob);
	link.setAttribute('href', url);
	link.setAttribute('download', filename);
	link.style.visibility = 'hidden';
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
};


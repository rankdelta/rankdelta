/**
 * Reports Generation Service
 * 
 * Generates automatic PDF/HTML reports with analytics
 */

import { supabase } from '../lib/supabaseClient';
import { exportToPDF } from '../utils/export';
import type { Project } from '../types/database';
import type { Content } from '../types/database';
import type { Ranking } from '../types/database';

/** Escape untrusted DB strings (project names, content titles, keywords, recommendations) before
 *  HTML interpolation — the report HTML is later parsed via innerHTML in exportToPDF, so an
 *  unescaped title like `<img onerror=...>` would execute in the user's browser (stored XSS). */
const esc = (v: unknown): string =>
	String(v ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

export type ReportLocale = 'en' | 'it';

/** Report copy per locale (the downloadable HTML/PDF follows the UI language; English by default). */
const REPORT_COPY = {
	en: {
		tag: 'en-US',
		recLowSeo: (score: number) => `Raise the average SEO score of your content (currently ${score}/100)`,
		recDrafts: (n: number) => `Publish your ${n} draft${n === 1 ? '' : 's'} to increase visibility`,
		recDeclines: 'Focus on keywords losing rank — consider updating existing content',
		recMoreContent: 'Create more content to broaden topic coverage',
		title: 'Performance Report',
		content: 'Content',
		totalContent: 'Total content',
		published: 'Published',
		drafts: 'Drafts',
		avgSeo: 'Average SEO score',
		topPerforming: 'Top performing content',
		titleCol: 'Title',
		trackedKeywords: 'Tracked keywords',
		improved: 'Improved',
		declined: 'Declined',
		position: 'Position',
		volume: 'Volume',
		change: 'Change',
		recommendations: 'Recommendations',
		generated: (when: string) => `Generated on ${when} by Rankdelta.ai`,
	},
	it: {
		tag: 'it-IT',
		recLowSeo: (score: number) => `Migliora il SEO score medio dei contenuti (attualmente ${score}/100)`,
		recDrafts: (n: number) => `Pubblica ${n} contenuti in bozza per aumentare la visibilità`,
		recDeclines: 'Focus su keyword con ranking in calo - considera aggiornare contenuti esistenti',
		recMoreContent: 'Genera più contenuti per aumentare la copertura del topic',
		title: 'Report Performance',
		content: 'Contenuti',
		totalContent: 'Totale Contenuti',
		published: 'Pubblicati',
		drafts: 'Bozze',
		avgSeo: 'SEO Score Medio',
		topPerforming: 'Top Performing Content',
		titleCol: 'Titolo',
		trackedKeywords: 'Keyword Tracciate',
		improved: 'Migliorate',
		declined: 'Peggiorate',
		position: 'Posizione',
		volume: 'Volume',
		change: 'Cambiamento',
		recommendations: 'Raccomandazioni',
		generated: (when: string) => `Generato il ${when} da Rankdelta.ai`,
	},
} as const;

export function reportLocaleFrom(language?: string | null): ReportLocale {
	return (language ?? 'en').startsWith('it') ? 'it' : 'en';
}

export interface ReportData {
	project: Project;
	period: {
		start: Date;
		end: Date;
	};
	content: {
		total: number;
		published: number;
		draft: number;
		avgSeoScore: number;
		topPerforming: Content[];
	};
	rankings: {
		total: number;
		improved: number;
		declined: number;
		topKeywords: Ranking[];
	};
	recommendations: string[];
}

/**
 * Generate report data for a project
 */
export const generateReportData = async (
	projectId: string,
	startDate: Date,
	endDate: Date,
	locale: ReportLocale = 'en',
): Promise<ReportData> => {
	const L = REPORT_COPY[locale];
	// Get project
	const { data: project, error: projectError } = await supabase
		.from('projects')
		.select('*')
		.eq('id', projectId)
		.single();

	if (projectError) throw projectError;

	// Get content (capped: counts/averages below are approximate beyond 2000 rows in the period)
	const { data: contentList } = await supabase
		.from('content')
		.select('*')
		.eq('project_id', projectId)
		.gte('generated_date', startDate.toISOString())
		.lte('generated_date', endDate.toISOString())
		.limit(2000);

	const content = contentList || [];
	const published = content.filter((c) => c.status === 'published');
	const draft = content.filter((c) => c.status === 'draft');
	const avgSeoScore =
		content.length > 0
			? content.reduce((sum, c) => sum + (c.seo_score || 0), 0) / content.length
			: 0;

	// Top performing content (by SEO score)
	const topPerforming = [...content]
		.sort((a, b) => (b.seo_score || 0) - (a.seo_score || 0))
		.slice(0, 5) as Content[];

	// Get rankings (capped: improved/declined counts are approximate beyond 2000 rows in the period)
	const { data: rankingsList } = await supabase
		.from('rankings')
		.select('*')
		.eq('project_id', projectId)
		.gte('checked_at', startDate.toISOString())
		.lte('checked_at', endDate.toISOString())
		.limit(2000);

	const rankings = rankingsList || [];
	const improved = rankings.filter((r) => r.change > 0).length;
	const declined = rankings.filter((r) => r.change < 0).length;

	// Top keywords (by search volume)
	const topKeywords = [...rankings]
		.filter((r) => r.search_volume && r.search_volume > 0)
		.sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))
		.slice(0, 10) as Ranking[];

	// Generate recommendations
	const recommendations: string[] = [];
	if (avgSeoScore < 60) {
		recommendations.push(L.recLowSeo(Math.round(avgSeoScore)));
	}
	if (draft.length > published.length) {
		recommendations.push(L.recDrafts(draft.length));
	}
	if (declined > improved) {
		recommendations.push(L.recDeclines);
	}
	if (content.length < 10) {
		recommendations.push(L.recMoreContent);
	}

	return {
		project: project as Project,
		period: { start: startDate, end: endDate },
		content: {
			total: content.length,
			published: published.length,
			draft: draft.length,
			avgSeoScore: Math.round(avgSeoScore),
			topPerforming,
		},
		rankings: {
			total: rankings.length,
			improved,
			declined,
			topKeywords,
		},
		recommendations,
	};
};

/**
 * Generate HTML report
 */
export const generateHTMLReport = (reportData: ReportData, locale: ReportLocale = 'en'): string => {
	const { project, period, content, rankings, recommendations } = reportData;
	const L = REPORT_COPY[locale];

	return `
<!DOCTYPE html>
<html lang="${locale}">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Report - ${project.name}</title>
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			line-height: 1.6;
			color: #333;
			max-width: 1200px;
			margin: 0 auto;
			padding: 20px;
			background: #f5f5f5;
		}
		.header {
			background: linear-gradient(135deg, #00d4ff 0%, #7c3aed 100%);
			color: white;
			padding: 40px;
			border-radius: 12px;
			margin-bottom: 30px;
		}
		.header h1 {
			margin: 0;
			font-size: 2.5em;
		}
		.header p {
			margin: 10px 0 0 0;
			opacity: 0.9;
		}
		.section {
			background: white;
			padding: 30px;
			border-radius: 12px;
			margin-bottom: 20px;
			box-shadow: 0 2px 4px rgba(0,0,0,0.1);
		}
		.section h2 {
			color: #00d4ff;
			margin-top: 0;
			border-bottom: 2px solid #00d4ff;
			padding-bottom: 10px;
		}
		.stats {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
			gap: 20px;
			margin: 20px 0;
		}
		.stat-card {
			background: #f8f9fa;
			padding: 20px;
			border-radius: 8px;
			text-align: center;
		}
		.stat-value {
			font-size: 2em;
			font-weight: bold;
			color: #00d4ff;
		}
		.stat-label {
			color: #666;
			margin-top: 5px;
		}
		.table {
			width: 100%;
			border-collapse: collapse;
			margin: 20px 0;
		}
		.table th, .table td {
			padding: 12px;
			text-align: left;
			border-bottom: 1px solid #ddd;
		}
		.table th {
			background: #f8f9fa;
			font-weight: 600;
		}
		.recommendations {
			list-style: none;
			padding: 0;
		}
		.recommendations li {
			padding: 10px;
			margin: 5px 0;
			background: #fff3cd;
			border-left: 4px solid #ffc107;
			border-radius: 4px;
		}
		.footer {
			text-align: center;
			color: #666;
			margin-top: 40px;
			padding-top: 20px;
			border-top: 1px solid #ddd;
		}
	</style>
</head>
<body>
	<div class="header">
		<h1>📊 ${L.title}</h1>
		<p>${esc(project.name)} - ${period.start.toLocaleDateString(L.tag)} → ${period.end.toLocaleDateString(L.tag)}</p>
	</div>

	<div class="section">
		<h2>📝 ${L.content}</h2>
		<div class="stats">
			<div class="stat-card">
				<div class="stat-value">${content.total}</div>
				<div class="stat-label">${L.totalContent}</div>
			</div>
			<div class="stat-card">
				<div class="stat-value">${content.published}</div>
				<div class="stat-label">${L.published}</div>
			</div>
			<div class="stat-card">
				<div class="stat-value">${content.draft}</div>
				<div class="stat-label">${L.drafts}</div>
			</div>
			<div class="stat-card">
				<div class="stat-value">${content.avgSeoScore}/100</div>
				<div class="stat-label">${L.avgSeo}</div>
			</div>
		</div>
		${content.topPerforming.length > 0 ? `
		<h3>${L.topPerforming}</h3>
		<table class="table">
			<thead>
				<tr>
					<th>${L.titleCol}</th>
					<th>SEO Score</th>
					<th>Status</th>
				</tr>
			</thead>
			<tbody>
				${content.topPerforming.map((c) => `
				<tr>
					<td>${esc(c.title)}</td>
					<td>${c.seo_score || 0}/100</td>
					<td>${esc(c.status)}</td>
				</tr>
				`).join('')}
			</tbody>
		</table>
		` : ''}
	</div>

	<div class="section">
		<h2>📈 Rankings</h2>
		<div class="stats">
			<div class="stat-card">
				<div class="stat-value">${rankings.total}</div>
				<div class="stat-label">${L.trackedKeywords}</div>
			</div>
			<div class="stat-card">
				<div class="stat-value" style="color: #10b981;">+${rankings.improved}</div>
				<div class="stat-label">${L.improved}</div>
			</div>
			<div class="stat-card">
				<div class="stat-value" style="color: #ef4444;">${rankings.declined}</div>
				<div class="stat-label">${L.declined}</div>
			</div>
		</div>
		${rankings.topKeywords.length > 0 ? `
		<h3>Top Keywords</h3>
		<table class="table">
			<thead>
				<tr>
					<th>Keyword</th>
					<th>${L.position}</th>
					<th>${L.volume}</th>
					<th>${L.change}</th>
				</tr>
			</thead>
			<tbody>
				${rankings.topKeywords.map((r) => `
				<tr>
					<td>${esc(r.keyword)}</td>
					<td>${r.position || 'N/A'}</td>
					<td>${r.search_volume?.toLocaleString(L.tag) || 'N/A'}</td>
					<td>${r.change > 0 ? '+' : ''}${r.change}</td>
				</tr>
				`).join('')}
			</tbody>
		</table>
		` : ''}
	</div>

	<div class="section">
		<h2>💡 ${L.recommendations}</h2>
		<ul class="recommendations">
			${recommendations.map((r) => `<li>${esc(r)}</li>`).join('')}
		</ul>
	</div>

	<div class="footer">
		<p>${L.generated(new Date().toLocaleString(L.tag))}</p>
	</div>
</body>
</html>
	`.trim();
};

/**
 * Generate and download report
 */
export const generateAndDownloadReport = async (
	projectId: string,
	startDate: Date,
	endDate: Date,
	format: 'html' | 'pdf' = 'html',
	locale: ReportLocale = 'en',
): Promise<void> => {
	const reportData = await generateReportData(projectId, startDate, endDate, locale);

	if (format === 'html') {
		const html = generateHTMLReport(reportData, locale);
		const blob = new Blob([html], { type: 'text/html' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `report-${reportData.project.name}-${startDate.toISOString().split('T')[0]}.html`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	} else {
		// PDF generation
		const html = generateHTMLReport(reportData, locale);
		await exportToPDF(html, `report-${reportData.project.name}-${startDate.toISOString().split('T')[0]}.pdf`);
	}
};


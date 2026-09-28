/**
 * Reports Page
 * 
 * Generate and download analytics reports
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useProjects } from '../hooks/useProjects';
import { generateAndDownloadReport, generateReportData, reportLocaleFrom } from '../services/reports';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/ui/Toast';
import { EmptyState } from '../components/ui/EmptyState';

export const ReportsPage = () => {
	const { t, i18n } = useTranslation();
	const reportLocale = reportLocaleFrom(i18n.language);
	const { user } = useAuth();
	const { data: projects } = useProjects();
	const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
	const [startDate, setStartDate] = useState(() => {
		const date = new Date();
		date.setMonth(date.getMonth() - 1);
		return date.toISOString().slice(0, 10);
	});
	const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
	const [isGenerating, setIsGenerating] = useState(false);
	const { toast, showToast, hideToast } = useToast();


	const { data: reportPreview, isLoading: previewLoading } = useQuery({
		queryKey: ['report-preview', selectedProjectId, startDate, endDate, reportLocale],
		queryFn: () => {
			if (!selectedProjectId) throw new Error('No project selected');
			return generateReportData(selectedProjectId, new Date(startDate), new Date(endDate), reportLocale);
		},
		enabled: !!selectedProjectId,
	});

	const handleGenerateReport = async (format: 'html' | 'pdf') => {
		if (!selectedProjectId) {
			showToast(t('appPages.reports.selectProject'), 'warning');
			return;
		}

		setIsGenerating(true);
		try {
			await generateAndDownloadReport(
				selectedProjectId,
				new Date(startDate),
				new Date(endDate),
				format,
				reportLocale,
			);
			showToast(t('appPages.reports.reportDownloaded', { format: format.toUpperCase() }), 'success');
		} catch (error) {
			console.error('Error generating report:', error);
			showToast(t('appPages.reports.generateError'), 'error');
		} finally {
			setIsGenerating(false);
		}
	};

	if (!user) {
		return (
			<div className="flex items-center justify-center h-screen">
				<LoadingSpinner text={t('common.loading')} />
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-gray-50">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
				{/* Header */}
				<div className="mb-8">
					<h1 className="text-3xl font-bold text-gray-900 mb-2">Reports</h1>
					<p className="text-gray-600">
						{t('appPages.reports.subtitle')}
					</p>
				</div>

				{/* Report Configuration */}
				<Card className="mb-6">
					<h3 className="text-lg font-bold text-white mb-4">{t('appPages.reports.configTitle')}</h3>
					<div className="space-y-4">
						<div>
							<label className="block text-sm font-medium text-gray-300 mb-2">{t('appPages.reports.project')}</label>
							<select
								value={selectedProjectId || ''}
								onChange={(e) => setSelectedProjectId(e.target.value || null)}
								className="w-full px-4 py-2 bg-cosmic-dark border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-cosmic-cyan text-white"
							>
								<option value="">{t('appPages.reports.selectProjectOption')}</option>
								{projects?.map((project) => (
									<option key={project.id} value={project.id}>
										{project.name}
									</option>
								))}
							</select>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div>
								<label className="block text-sm font-medium text-gray-300 mb-2">{t('appPages.reports.startDate')}</label>
								<input
									type="date"
									value={startDate}
									onChange={(e) => setStartDate(e.target.value)}
									className="w-full px-4 py-2 bg-cosmic-dark border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-cosmic-cyan text-white"
								/>
							</div>
							<div>
								<label className="block text-sm font-medium text-gray-300 mb-2">{t('appPages.reports.endDate')}</label>
								<input
									type="date"
									value={endDate}
									onChange={(e) => setEndDate(e.target.value)}
									className="w-full px-4 py-2 bg-cosmic-dark border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-cosmic-cyan text-white"
								/>
							</div>
						</div>
						<div className="flex gap-2">
							<Button
								variant="primary"
								onClick={() => handleGenerateReport('html')}
								loading={isGenerating}
								disabled={!selectedProjectId || isGenerating}
							>
								{t('appPages.reports.generateHtml')}
							</Button>
							<Button
								variant="secondary"
								onClick={() => handleGenerateReport('pdf')}
								loading={isGenerating}
								disabled={!selectedProjectId || isGenerating}
							>
								{t('appPages.reports.generatePdf')}
							</Button>
						</div>
					</div>
				</Card>

				{/* Report Preview */}
				{previewLoading && <LoadingSpinner text={t('appPages.reports.loadingPreview')} />}

				{reportPreview && (
					<Card>
						<h3 className="text-lg font-bold text-white mb-4">{t('appPages.reports.previewTitle')}</h3>
						<div className="space-y-6">
							<div>
								<h4 className="text-md font-semibold text-gray-300 mb-2">{t('appPages.reports.content')}</h4>
								<div className="grid grid-cols-4 gap-4">
									<div className="p-4 bg-gray-800 rounded-lg">
										<div className="text-2xl font-bold text-cosmic-cyan">{reportPreview.content.total}</div>
										<div className="text-sm text-gray-400">{t('appPages.reports.total')}</div>
									</div>
									<div className="p-4 bg-gray-800 rounded-lg">
										<div className="text-2xl font-bold text-cosmic-green">{reportPreview.content.published}</div>
										<div className="text-sm text-gray-400">{t('dashboard.published')}</div>
									</div>
									<div className="p-4 bg-gray-800 rounded-lg">
										<div className="text-2xl font-bold text-cosmic-purple">{reportPreview.content.draft}</div>
										<div className="text-sm text-gray-400">{t('dashboard.drafts')}</div>
									</div>
									<div className="p-4 bg-gray-800 rounded-lg">
										<div className="text-2xl font-bold text-cosmic-cyan">{reportPreview.content.avgSeoScore}/100</div>
										<div className="text-sm text-gray-400">{t('appPages.reports.avgSeoScore')}</div>
									</div>
								</div>
							</div>

							<div>
								<h4 className="text-md font-semibold text-gray-300 mb-2">{t('appPages.reports.rankings')}</h4>
								<div className="grid grid-cols-3 gap-4">
									<div className="p-4 bg-gray-800 rounded-lg">
										<div className="text-2xl font-bold text-cosmic-cyan">{reportPreview.rankings.total}</div>
										<div className="text-sm text-gray-400">{t('appPages.reports.trackedKeywords')}</div>
									</div>
									<div className="p-4 bg-gray-800 rounded-lg">
										<div className="text-2xl font-bold text-cosmic-green">+{reportPreview.rankings.improved}</div>
										<div className="text-sm text-gray-400">{t('appPages.reports.improved')}</div>
									</div>
									<div className="p-4 bg-gray-800 rounded-lg">
										<div className="text-2xl font-bold text-red-500">{reportPreview.rankings.declined}</div>
										<div className="text-sm text-gray-400">{t('appPages.reports.declined')}</div>
									</div>
								</div>
							</div>

							{reportPreview.recommendations.length > 0 && (
								<div>
									<h4 className="text-md font-semibold text-gray-300 mb-2">{t('appPages.reports.recommendations')}</h4>
									<ul className="space-y-2">
										{reportPreview.recommendations.map((rec, index) => (
											<li key={index} className="p-3 bg-cosmic-cyan/10 border border-cosmic-cyan/30 rounded-lg text-sm text-cosmic-cyan">
												{rec}
											</li>
										))}
									</ul>
								</div>
							)}
						</div>
					</Card>
				)}

				{!selectedProjectId && (
					<EmptyState
						icon="📊"
						title={t('appPages.reports.selectProject')}
						description={t('appPages.reports.emptyDescription')}
						variant="minimal"
					/>
				)}
			</div>

			<Toast message={toast.message} type={toast.type} isVisible={toast.isVisible} onClose={hideToast} />
		</div>
	);
};


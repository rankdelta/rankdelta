/**
 * Calendar View Page
 * 
 * Calendar interface for planning and scheduling articles
 * Inspired by RankPill's calendar view
 */

import { useState, useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Sidebar } from '../components/layout/Sidebar';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { CalendarContent } from '../components/calendar/CalendarContent';
import { useProjects } from '../hooks/useProjects';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { useNavigate } from '@tanstack/react-router';
import { getDefaultAuthenticatedHomePath } from '../config/productMode';

export const CalendarView = (): ReactElement => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { data: projects, isLoading: isLoadingProjects } = useProjects();
	const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

	// Auto-select first project if none selected and projects exist
	useEffect(() => {
		if (!selectedProjectId && projects && projects.length > 0 && projects[0]) {
			setSelectedProjectId(projects[0].id);
		}
	}, [projects, selectedProjectId]);

	const selectedProject = projects?.find((p) => p.id === selectedProjectId);

	if (isLoadingProjects) {
		return (
			<div className="flex min-h-screen bg-gray-50">
				<Sidebar />
				<div className="flex-1 flex items-center justify-center">
					<LoadingSpinner size="lg" text="Caricamento progetti..." />
				</div>
			</div>
		);
	}

	// If no projects exist, show empty state
	if (!projects || projects.length === 0) {
		return (
			<div className="flex min-h-screen bg-gray-50">
				<Sidebar />
				<div className="flex-1">
					<div className="max-w-7xl mx-auto px-6 py-8">
						<EmptyState
							icon="📅"
							title={t('calendar.noProjectTitle')}
							variant="large"
							description={[
								t('calendar.noProjectDesc1'),
								t('calendar.noProjectDesc2')
							]}
							primaryAction={{
								icon: '🚀',
								label: t('calendar.createFirstProject'),
								onClick: () => {
									void navigate({ to: '/projects/new' });
								},
							}}
							secondaryAction={{
								label: t('calendar.goHome'),
								onClick: () => {
									void navigate({ to: getDefaultAuthenticatedHomePath() });
								},
							}}
						/>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen bg-gray-50">
			<Sidebar />
			<div className="flex-1 flex flex-col">
				{/* Header with Project Selector */}
				<header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
					<div className="max-w-7xl mx-auto px-6 py-4">
						<div className="flex items-center justify-between mb-4">
							<div>
								<h1 className="text-2xl font-bold text-gray-900">Calendario</h1>
								<p className="text-sm text-gray-500">Pianifica e programma i tuoi articoli</p>
							</div>
						</div>
						
						{/* Project Selector */}
						<Card className="p-4">
							<div className="flex items-center gap-4">
								<label className="text-sm font-medium text-gray-700 whitespace-nowrap">
									Progetto:
								</label>
								<select
									className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cosmic-cyan focus:border-transparent"
									value={selectedProjectId || ''}
									onChange={(event) => {
										setSelectedProjectId(event.target.value || null);
									}}
								>
									{projects.map((project) => (
										<option key={project.id} value={project.id}>
											{project.name} {project.website_url ? `(${project.website_url})` : ''}
										</option>
									))}
								</select>
								{selectedProject && (
									<button
										className="px-4 py-2 text-sm text-cosmic-cyan hover:text-cosmic-cyan-dark border border-cosmic-cyan/20 rounded-lg hover:bg-cosmic-cyan/5 transition-colors whitespace-nowrap"
										type="button"
										onClick={() => {
											void navigate({ to: `/projects/${selectedProject.id}` });
										}}
									>
										📁 Dettagli Progetto
									</button>
								)}
							</div>
						</Card>
					</div>
				</header>

				{/* Calendar Content */}
				<main className="flex-1 overflow-y-auto">
					<div className="max-w-7xl mx-auto px-6 py-8">
						{selectedProjectId ? (
							<CalendarContent projectId={selectedProjectId} />
						) : (
							<EmptyState
								description={t('calendar.selectProjectDesc')}
								icon="📅"
								title={t('calendar.selectProjectTitle')}
								variant="minimal"
							/>
						)}
				</div>
				</main>
			</div>
		</div>
	);
};


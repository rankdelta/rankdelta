/**
 * New Content Page
 * 
 * Pagina dedicata alla generazione di nuovi contenuti SEO/GEO optimized.
 * Usa l'UltimateContentGenerator per creare articoli AI-proof in un click.
 */

import { useNavigate, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { getDefaultAuthenticatedHomePath } from '../config/productMode';
import { useProjects } from '../hooks/useProjects';
import { useAuth } from '../hooks/useAuth';
import { Sidebar } from '../components/layout/Sidebar';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { EmptyState } from '../components/ui/EmptyState';
import { UltimateContentGenerator } from '../components/content/UltimateContentGenerator';
import { useState, type ReactElement } from 'react';

export const NewContentPage = (): ReactElement => {
	const { t } = useTranslation();
	const params = useParams({ strict: false });
	const projectIdFromParams = ('projectId' in params ? params.projectId : undefined) as string | undefined;
	const navigate = useNavigate();
	const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
	const { data: projects, isLoading: projectsLoading } = useProjects();
	const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectIdFromParams || null);

	// Auto-select first project if none selected
	if (!selectedProjectId && projects && projects.length > 0 && !projectIdFromParams) {
		const firstProject = projects[0];
		if (firstProject) {
			setSelectedProjectId(firstProject.id);
		}
	}

	const selectedProject = projects?.find((p) => p.id === selectedProjectId);

	if (!isAuthLoading && !isAuthenticated) {
		void navigate({ to: '/login' });
		return <></>;
	}

	if (projectsLoading) {
		return (
			<div className="flex min-h-screen bg-gray-50">
				<Sidebar />
				<div className="flex-1 flex items-center justify-center">
					<LoadingSpinner size="lg" text={t('appPages.newContent.loadingProjects')} />
				</div>
			</div>
		);
	}

	if (!projects || projects.length === 0) {
		return (
			<div className="flex min-h-screen bg-gray-50">
				<Sidebar />
				<div className="flex-1 p-8">
					<EmptyState
						description={t('newContentPage.noProjectDesc')}
						icon="📁"
						primaryAction={{
							label: t('newContentPage.createProject'),
							onClick: () => { void navigate({ to: '/projects/new' }); },
						}}
						title={t('newContentPage.noProjectTitle')}
					/>
				</div>
			</div>
		);
	}

	const handleContentGenerated = (contentId: string): void => {
		// Navigate to the content editor
		void navigate({ to: `/content/${contentId}` });
	};

	return (
		<div className="flex min-h-screen bg-gray-50">
			<Sidebar />
			
			<div className="flex-1 overflow-y-auto">
				{/* Header */}
				<header className="bg-white border-b border-gray-200 sticky top-0 z-30">
					<div className="px-8 py-6">
						<div className="flex items-center justify-between">
							<div>
								<h1 className="text-2xl font-bold text-gray-900">{t('appPages.newContent.title')}</h1>
								<p className="text-gray-600 mt-1">
									{t('appPages.newContent.subtitle')}
								</p>
							</div>
							<Button
								onClick={() => { void navigate({ to: getDefaultAuthenticatedHomePath() }); }}
								variant="secondary"
							>
								← {t('navigation.backToDashboard')}
							</Button>
						</div>

						{/* Project Selector */}
						{projects && projects.length > 1 && (
							<div className="mt-4">
								<label className="block text-sm font-medium text-gray-700 mb-2">
									{t('appPages.newContent.selectProject')}
								</label>
								<select
									className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cosmic-cyan focus:border-cosmic-cyan"
									onChange={(e) => { setSelectedProjectId(e.target.value); }}
									value={selectedProjectId || ''}
								>
									{projects.map((project) => (
										<option key={project.id} value={project.id}>
											{project.name} ({project.primary_keyword || project.main_topic})
										</option>
									))}
								</select>
							</div>
						)}
					</div>
				</header>

				{/* Main Content */}
				<main className="p-8">
					{selectedProject ? (
						<UltimateContentGenerator
							onContentGenerated={handleContentGenerated}
							project={selectedProject}
						/>
					) : (
						<Card>
							<p className="text-center text-gray-500 py-8">
								{t('newContentPage.selectProjectPrompt')}
							</p>
						</Card>
					)}
				</main>
			</div>
		</div>
	);
};


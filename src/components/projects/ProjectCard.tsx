/**
 * Project Card Component
 * 
 * Displays a project in a card format with quick actions.
 */

import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useDeleteProject } from '../../hooks/useProjects';
import { motion } from 'framer-motion';
import type { Project } from '../../types/database';
import { isLegacyAgentUiAvailable } from '../../config/productMode';

interface ProjectCardProps {
	project: Project;
}

export const ProjectCard = ({ project }: ProjectCardProps) => {
	const navigate = useNavigate();
	const { t } = useTranslation();
	const deleteProject = useDeleteProject();
	const visibilityFirst = !isLegacyAgentUiAvailable();

	const handleDelete = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (confirm(visibilityFirst ? t('projects.deleteConfirmStore') : t('projects.deleteConfirmProject'))) {
			try {
				await deleteProject.mutateAsync(project.id);
			} catch (error) {
				console.error('Error deleting project:', error);
			}
		}
	};

	const handleClick = () => {
		if (!isLegacyAgentUiAvailable()) {
			void navigate({ to: `/visibility/${project.id}/` } as Parameters<typeof navigate>[0]);
			return;
		}
		void navigate({ to: `/projects/${project.id}/` as any });
	};

	return (
		<motion.div
			whileHover={{ y: -4 }}
			onClick={handleClick}
			className="bg-white border border-gray-200 rounded-lg p-6 hover:border-cosmic-cyan/40 transition-all cursor-pointer group shadow-sm hover:shadow-md"
		>
			<div className="flex items-start justify-between mb-4">
				<h3 className="text-xl font-bold text-gray-900 group-hover:text-cosmic-cyan transition-colors">
					{project.name}
				</h3>
				<button
					onClick={handleDelete}
					className="text-gray-400 hover:text-status-error transition-colors opacity-0 group-hover:opacity-100"
					title={visibilityFirst ? t('projects.deleteStoreTitle') : t('projects.deleteProjectTitle')}
				>
					<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
						/>
					</svg>
				</button>
			</div>

			{project.website_url && (
				<p className="text-sm text-gray-500 mb-2 truncate">{project.website_url}</p>
			)}

			{project.primary_keyword && (
				<div className="flex items-center gap-2 mb-2">
					<span className="text-xs text-gray-500">Keyword:</span>
					<span className="text-sm text-cosmic-cyan">{project.primary_keyword}</span>
				</div>
			)}

			<div className="flex items-center gap-4 mt-4 text-xs text-gray-500">
				{visibilityFirst ? (
					<span className="text-teal-700 font-medium">{t('projects.cardOpenPulse')}</span>
				) : (
					<>
						<span className="capitalize">{project.tone}</span>
						<span>•</span>
						<span>{project.content_length} parole</span>
						<span>•</span>
						<span className="uppercase">{project.language}</span>
					</>
				)}
			</div>
		</motion.div>
	);
};


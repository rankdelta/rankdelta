/**
 * Projects list — "I miei siti" — dark theme, unified AppShell.
 */

import { useNavigate } from '@tanstack/react-router';
import { useProjects, useDeleteProject } from '../hooks/useProjects';
import { useSubscription } from '../hooks/useSubscription';
import { useUpgradeModal } from '../components/subscription/UpgradeModal';
import { AppShell } from '../components/layout/AppShell';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { isLegacyAgentUiAvailable } from '../config/productMode';
import {
  PlusIcon,
  TrashIcon,
  ChevronRightIcon,
  SignalIcon,
} from '@heroicons/react/24/outline';
import type { Project } from '../types/database';

// ─── Dark project card (self-contained, avoids light ProjectCard) ─────────────

function DarkProjectCard({ project, index }: { project: Project; index: number }) {
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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
      whileHover={{ y: -3 }}
      onClick={handleClick}
      className="rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:border-violet-500/30 hover:bg-white/[0.04] transition-all cursor-pointer group p-6"
    >
      <div className="flex items-start justify-between mb-3">
        {/* avatar */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
            {project.name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <h3 className="text-base font-semibold text-white group-hover:text-violet-300 transition-colors truncate">
            {project.name}
          </h3>
        </div>
        <button
          onClick={handleDelete}
          className="text-white/20 hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-white/[0.05] flex-shrink-0"
          title={visibilityFirst ? t('projects.deleteStoreTitle') : t('projects.deleteProjectTitle')}
        >
          <TrashIcon className="w-4 h-4" strokeWidth={1.8} />
        </button>
      </div>

      {project.website_url && (
        <p className="text-xs text-white/30 mb-3 truncate">
          {project.website_url.replace(/^https?:\/\//, '')}
        </p>
      )}

      {project.primary_keyword && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] text-white/30">keyword</span>
          <span className="text-xs text-violet-300 font-medium truncate">{project.primary_keyword}</span>
        </div>
      )}

      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-white/[0.05]">
        {visibilityFirst ? (
          <span className="text-xs text-violet-400 font-medium">{t('projects.cardOpenPulse')}</span>
        ) : (
          <>
            <span className="text-[11px] text-white/30 capitalize">{project.tone}</span>
            <span className="text-white/20">·</span>
            <span className="text-[11px] text-white/30">{project.content_length} parole</span>
            <span className="text-white/20">·</span>
            <span className="text-[11px] text-white/30 uppercase">{project.language}</span>
          </>
        )}
        <span className="ml-auto flex items-center gap-1 text-xs text-white/20 group-hover:text-violet-400 transition-colors">
          Apri <ChevronRightIcon className="w-3 h-3" strokeWidth={2.5} />
        </span>
      </div>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export const ProjectsListPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: projects, isLoading } = useProjects();
  const { checkCanCreateProject } = useSubscription();
  const { openForProjectLimit, UpgradeModal } = useUpgradeModal();
  const visibilityFirst = !isLegacyAgentUiAvailable();

  const handleCreateProject = async () => {
    const gate = await checkCanCreateProject();
    if (!gate.canCreate) {
      openForProjectLimit();
      return;
    }
    navigate({ to: '/projects/new' as any });
  };

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-white/40 text-xs tracking-[0.18em] uppercase mb-1.5">{t('projects.listEyebrow')}</p>
          <h1 className="text-3xl font-bold text-white">
            {visibilityFirst ? t('projects.listTitleVisibility') : t('projects.title')}
          </h1>
          <p className="text-white/40 mt-1.5 max-w-2xl leading-relaxed">
            {visibilityFirst ? t('projects.listSubtitleVisibility') : t('projects.listSubtitleLegacy')}
          </p>
          {visibilityFirst && (
            <button
              onClick={() => navigate({ to: '/visibility' as any })}
              className="inline-flex items-center gap-1 mt-3 text-sm font-semibold text-violet-400 hover:text-violet-300 transition-colors"
            >
              {t('projects.openVisibilityHub')}
              <ChevronRightIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
            </button>
          )}
        </div>

        <button
          onClick={handleCreateProject}
          className="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black font-semibold text-sm hover:bg-white/90 transition-all"
        >
          <PlusIcon className="w-4 h-4" strokeWidth={2.5} />
          {visibilityFirst ? t('projects.newWorkspace') : t('projects.createNew')}
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-32">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : projects && projects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((project, index) => (
            <DarkProjectCard key={project.id} project={project} index={index} />
          ))}
        </div>
      ) : (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="w-16 h-16 rounded-2xl border border-white/[0.08] bg-white/[0.02] flex items-center justify-center mb-6">
            <SignalIcon className="w-8 h-8 text-violet-300/60" strokeWidth={1.5} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">
            {visibilityFirst ? t('projects.emptyTitleVisibility') : t('projects.emptyState')}
          </h2>
          <p className="text-white/40 text-sm max-w-sm leading-relaxed mb-8">
            {visibilityFirst
              ? `${t('projects.emptyDescriptionVisibility1')} ${t('projects.emptyDescriptionVisibility2')}`
              : t('projects.emptyStateDescription')}
          </p>
          <button
            onClick={handleCreateProject}
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-white text-black font-semibold hover:bg-white/90 transition-all"
          >
            <PlusIcon className="w-4 h-4" strokeWidth={2.5} />
            {visibilityFirst ? t('projects.newWorkspace') : t('projects.createNew')}
          </button>
        </div>
      )}
      <UpgradeModal />
    </AppShell>
  );
};

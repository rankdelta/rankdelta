/**
 * Projects Page — create / edit a site.
 * Dark theme via AppShell. Key onboarding step — keep it clean and inviting.
 */

import { useEffect } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ProjectForm } from '../components/projects/ProjectForm';
import { useAuth } from '../hooks/useAuth';
import { useActiveProject } from '../hooks/useActiveProject';
import { AppShell } from '../components/layout/AppShell';
import { getDefaultAuthenticatedHomePath, isLegacyAgentUiAvailable } from '../config/productMode';
import { useTranslation } from 'react-i18next';

export const ProjectsPage = () => {
  const params = useParams({ strict: false });
  const projectId = ('projectId' in params ? params.projectId : undefined) as string | undefined;
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { t } = useTranslation();
  const legacyAgent = isLegacyAgentUiAvailable();
  const { setActive } = useActiveProject();

  // Sync sidebar to the project being edited
  useEffect(() => {
    if (projectId) {
      setActive(projectId);
    }
  }, [projectId, setActive]);

  if (!isAuthLoading && !isAuthenticated) {
    navigate({ to: '/login' });
    return null;
  }

  const handleSuccess = (savedId?: string) => {
    if (savedId) {
      if (!legacyAgent) {
        // New project → land on the Comando (salute generale) so the user starts from the health
        // dashboard + guided "Prossima mossa" (the first move: run the diagnosis), not an empty page.
        setActive(savedId);
        void navigate({ to: '/home' as any });
      } else {
        void navigate({ to: `/projects/${savedId}/` as any });
      }
    } else {
      void navigate({ to: getDefaultAuthenticatedHomePath() as any });
    }
  };

  const handleCancel = () => {
    navigate({ to: getDefaultAuthenticatedHomePath() as any });
  };

  const pageTitle = projectId
    ? legacyAgent
      ? t('projects.pageEditTitleLegacy')
      : t('projects.pageEditTitle')
    : legacyAgent
      ? t('projects.pageNewTitleLegacy')
      : t('projects.pageNewTitle');

  return (
    <AppShell maxWidth="5xl">
      {/* Page header */}
      <div className="mb-8">
        <p className="text-white/40 text-xs tracking-[0.18em] uppercase mb-1.5">
          {projectId ? 'Modifica sito' : 'Nuovo sito'}
        </p>
        <h1 className="text-3xl font-bold text-white">{pageTitle}</h1>
        {!projectId && (
          <p className="text-white/40 mt-1.5">
            Configura il tuo sito per attivare il loop: audit, contenuti, pubblicazione e visibilità AI.
          </p>
        )}
      </div>

      {/* Form card */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8">
        <ProjectForm projectId={projectId} onSuccess={handleSuccess} onCancel={handleCancel} />
      </div>
    </AppShell>
  );
};

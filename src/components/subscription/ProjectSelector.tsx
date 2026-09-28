/**
 * Project Selector Component
 * 
 * Dropdown/modal for selecting and managing projects.
 * Shows project limit based on subscription plan.
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useSubscription } from '../../hooks/useSubscription';
import { useProjects } from '../../hooks/useProjects';
import { useUpgradeModal } from './UpgradeModal';
import type { Project } from '../../types/database';

interface ProjectSelectorProps {
  currentProjectId?: string;
  onSelectProject?: (project: Project) => void;
  variant?: 'dropdown' | 'sidebar' | 'header';
  className?: string;
}

export const ProjectSelector: React.FC<ProjectSelectorProps> = ({
  currentProjectId,
  onSelectProject,
  variant = 'dropdown',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { t } = useTranslation();
  
  const { usageStats, checkCanCreateProject } = useSubscription();
  const { data: projects, isLoading } = useProjects();
  const { openForProjectLimit, UpgradeModal } = useUpgradeModal();
  
  const currentProject = projects?.find(p => p.id === currentProjectId);
  const projectCount = projects?.length ?? 0;
  const projectLimit = usageStats?.projectsLimit ?? 1;
  const canCreateMore = projectLimit === Infinity || projectCount < projectLimit;
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const handleSelectProject = (project: Project) => {
    setIsOpen(false);
    if (onSelectProject) {
      onSelectProject(project);
    } else {
      navigate({ to: '/projects/$projectId', params: { projectId: project.id } });
    }
  };
  
  const handleCreateProject = async () => {
    setIsOpen(false);
    
    const result = await checkCanCreateProject();
    if (!result.canCreate) {
      openForProjectLimit();
      return;
    }
    
    navigate({ to: '/projects/new' });
  };
  
  if (isLoading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="h-10 w-48 bg-gray-200 rounded-lg" />
      </div>
    );
  }
  
  // Header variant - compact dropdown
  if (variant === 'header') {
    return (
      <>
        <div ref={dropdownRef} className={`relative ${className}`}>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
          >
            {/* Project icon */}
            <div className="w-6 h-6 rounded bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold">
              {currentProject?.name?.charAt(0).toUpperCase() ?? 'P'}
            </div>
            
            <span className="text-sm font-medium text-gray-700 max-w-[120px] truncate">
              {currentProject?.name ?? t('appPages.projectSelector.selectProject')}
            </span>
            
            <svg 
              className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {/* Dropdown */}
          {isOpen && (
            <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50">
              {/* Projects list */}
              <div className="max-h-64 overflow-y-auto">
                {projects?.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => handleSelectProject(project)}
                    className={`
                      w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-gray-50 transition-colors
                      ${project.id === currentProjectId ? 'bg-purple-50' : ''}
                    `}
                  >
                    <div className={`
                      w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold
                      ${project.id === currentProjectId 
                        ? 'bg-gradient-to-br from-purple-500 to-indigo-600' 
                        : 'bg-gray-400'
                      }
                    `}>
                      {project.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium truncate ${project.id === currentProjectId ? 'text-purple-700' : 'text-gray-900'}`}>
                        {project.name}
                      </div>
                      {project.website_url && (
                        <div className="text-xs text-gray-500 truncate">
                          {project.website_url.replace(/^https?:\/\//, '')}
                        </div>
                      )}
                    </div>
                    {project.id === currentProjectId && (
                      <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
              
              {/* Divider */}
              <div className="border-t border-gray-100 my-2" />
              
              {/* Create new project */}
              <button
                onClick={handleCreateProject}
                className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-gray-900">{t('appPages.projectSelector.newProject')}</span>
                
                {!canCreateMore && (
                  <span className="ml-auto text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                    Upgrade
                  </span>
                )}
              </button>
              
              {/* Project count */}
              <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500 rounded-b-xl">
                {t('appPages.projectSelector.projectCount', { used: projectCount, limit: projectLimit === Infinity ? '∞' : projectLimit })}
              </div>
            </div>
          )}
        </div>
        <UpgradeModal />
      </>
    );
  }
  
  // Sidebar variant - vertical list
  if (variant === 'sidebar') {
    return (
      <>
        <div className={className}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {t('appPages.projectSelector.projects')}
            </h3>
            <span className="text-xs text-gray-400">
              {projectCount}/{projectLimit === Infinity ? '∞' : projectLimit}
            </span>
          </div>
          
          <div className="space-y-1">
            {projects?.map((project) => (
              <button
                key={project.id}
                onClick={() => handleSelectProject(project)}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors
                  ${project.id === currentProjectId 
                    ? 'bg-purple-100 text-purple-900' 
                    : 'hover:bg-gray-100 text-gray-700'
                  }
                `}
              >
                <div className={`
                  w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold
                  ${project.id === currentProjectId 
                    ? 'bg-gradient-to-br from-purple-500 to-indigo-600' 
                    : 'bg-gray-400'
                  }
                `}>
                  {project.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-medium truncate">
                  {project.name}
                </span>
              </button>
            ))}
            
            {/* Add project button */}
            <button
              onClick={handleCreateProject}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors
                ${canCreateMore 
                  ? 'hover:bg-emerald-50 text-emerald-700' 
                  : 'hover:bg-amber-50 text-amber-700'
                }
              `}
            >
              <div className={`
                w-8 h-8 rounded-lg flex items-center justify-center
                ${canCreateMore ? 'bg-emerald-100' : 'bg-amber-100'}
              `}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <span className="text-sm font-medium">
                {canCreateMore ? t('appPages.projectSelector.newProject') : t('appPages.projectSelector.upgradeForMore')}
              </span>
            </button>
          </div>
        </div>
        <UpgradeModal />
      </>
    );
  }
  
  // Default dropdown variant
  return (
    <>
      <div ref={dropdownRef} className={`relative ${className}`}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-xl hover:border-gray-300 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white font-bold">
              {currentProject?.name?.charAt(0).toUpperCase() ?? '?'}
            </div>
            <div className="text-left">
              <div className="font-medium text-gray-900">
                {currentProject?.name ?? t('appPages.projectSelector.noProjectSelected')}
              </div>
              {currentProject?.website_url && (
                <div className="text-sm text-gray-500">
                  {currentProject.website_url.replace(/^https?:\/\//, '')}
                </div>
              )}
            </div>
          </div>
          
          <svg 
            className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50">
            <div className="max-h-64 overflow-y-auto">
              {projects?.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleSelectProject(project)}
                  className={`
                    w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors
                    ${project.id === currentProjectId ? 'bg-purple-50' : ''}
                  `}
                >
                  <div className={`
                    w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold
                    ${project.id === currentProjectId 
                      ? 'bg-gradient-to-br from-purple-500 to-indigo-600' 
                      : 'bg-gray-400'
                    }
                  `}>
                    {project.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{project.name}</div>
                    {project.website_url && (
                      <div className="text-sm text-gray-500">
                        {project.website_url.replace(/^https?:\/\//, '')}
                      </div>
                    )}
                  </div>
                  {project.id === currentProjectId && (
                    <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
            
            <div className="border-t border-gray-100 mt-2 pt-2">
              <button
                onClick={handleCreateProject}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
              >
                <div className={`
                  w-10 h-10 rounded-lg flex items-center justify-center
                  ${canCreateMore ? 'bg-emerald-100' : 'bg-amber-100'}
                `}>
                  <svg 
                    className={`w-6 h-6 ${canCreateMore ? 'text-emerald-600' : 'text-amber-600'}`} 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <div>
                  <div className="font-medium text-gray-900">
                    {canCreateMore ? t('appPages.projectSelector.createNewProject') : t('appPages.projectSelector.limitReached')}
                  </div>
                  <div className="text-sm text-gray-500">
                    {t('appPages.projectSelector.projectsUsed', { used: projectCount, limit: projectLimit === Infinity ? '∞' : projectLimit })}
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>
      <UpgradeModal />
    </>
  );
};

export default ProjectSelector;


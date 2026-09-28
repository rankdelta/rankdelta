/**
 * Progress Tracker Component
 *
 * Shows user progress through onboarding milestones.
 */

import { motion } from 'framer-motion';
import {
  SparklesIcon,
  FolderIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  RocketLaunchIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';
import type { OnboardingProgress } from '../../hooks/useOnboarding';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

interface ProgressTrackerProps {
  progress: OnboardingProgress;
  onClick?: () => void;
  compact?: boolean;
}

const milestones: Array<{
  id: string;
  label: string;
  Icon: IconType;
  description: string;
}> = [
  {
    id: 'wizard',
    label: 'Benvenuto',
    Icon: SparklesIcon,
    description: 'Completa la guida introduttiva',
  },
  {
    id: 'project',
    label: 'Primo Progetto',
    Icon: FolderIcon,
    description: 'Crea il tuo primo progetto',
  },
  {
    id: 'research',
    label: 'Keyword Research',
    Icon: MagnifyingGlassIcon,
    description: 'Fai la tua prima ricerca keyword',
  },
  {
    id: 'content',
    label: 'Primo Contenuto',
    Icon: PencilSquareIcon,
    description: 'Genera il tuo primo articolo',
  },
];

export const ProgressTracker = ({ progress, onClick, compact = false }: ProgressTrackerProps) => {
  const getMilestoneStatus = (id: string) => {
    switch (id) {
      case 'wizard':   return progress.hasCompletedWizard;
      case 'project':  return progress.hasCreatedProject;
      case 'research': return progress.hasDoneKeywordResearch;
      case 'content':  return progress.hasGeneratedContent;
      default:         return false;
    }
  };

  const completedCount = milestones.filter((m) => getMilestoneStatus(m.id)).length;
  const progressPercentage = (completedCount / milestones.length) * 100;

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 cursor-pointer hover:border-violet-500/30 transition-colors"
        onClick={onClick}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-white">Progresso Onboarding</span>
          <span className="text-xs text-violet-300">{completedCount}/{milestones.length}</span>
        </div>
        <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-violet-500 to-emerald-400 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progressPercentage}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6"
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-base font-bold text-white mb-0.5">Il Tuo Progresso</h3>
          <p className="text-sm text-white/40">
            {completedCount} di {milestones.length} obiettivi completati
          </p>
        </div>
        <div className="text-2xl font-bold text-violet-300">{Math.round(progressPercentage)}%</div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden mb-6">
        <motion.div
          className="h-full bg-gradient-to-r from-violet-500 via-indigo-400 to-emerald-400 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progressPercentage}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>

      {/* Milestones */}
      <div className="space-y-2">
        {milestones.map((milestone, index) => {
          const isCompleted = getMilestoneStatus(milestone.id);
          const isNext = !isCompleted && milestones.slice(0, index).every((m) => getMilestoneStatus(m.id));
          const Icon = milestone.Icon;

          return (
            <motion.div
              key={milestone.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`flex items-center gap-4 p-3 rounded-xl border transition-all ${
                isCompleted
                  ? 'bg-emerald-500/[0.06] border-emerald-500/20'
                  : isNext
                  ? 'bg-violet-500/[0.06] border-violet-500/20'
                  : 'bg-white/[0.02] border-white/[0.06]'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${
                  isCompleted
                    ? 'bg-emerald-500/10'
                    : isNext
                    ? 'bg-violet-500/10'
                    : 'bg-white/[0.04]'
                }`}
              >
                {isCompleted ? (
                  <CheckCircleIcon className="w-5 h-5 text-emerald-400" strokeWidth={1.8} />
                ) : (
                  <Icon
                    className={`w-5 h-5 ${isNext ? 'text-violet-300' : 'text-white/20'}`}
                    strokeWidth={1.8}
                  />
                )}
              </div>
              <div className="flex-1">
                <h4
                  className={`text-sm font-semibold ${
                    isCompleted ? 'text-emerald-300' : isNext ? 'text-white' : 'text-white/30'
                  }`}
                >
                  {milestone.label}
                </h4>
                <p className="text-xs text-white/30">{milestone.description}</p>
              </div>
              {isNext && (
                <span className="text-xs text-violet-300 font-semibold flex-shrink-0">Prossimo</span>
              )}
            </motion.div>
          );
        })}
      </div>

      {completedCount === milestones.length && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-5 p-4 rounded-xl border border-violet-500/20 bg-gradient-to-r from-violet-500/[0.08] to-emerald-400/[0.06] text-center"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center mx-auto mb-2">
            <RocketLaunchIcon className="w-5 h-5 text-white" strokeWidth={1.8} />
          </div>
          <p className="text-sm font-semibold text-white">
            Complimenti! Hai completato l'onboarding. Ora sei pronto per massimizzare i tuoi risultati!
          </p>
        </motion.div>
      )}
    </motion.div>
  );
};

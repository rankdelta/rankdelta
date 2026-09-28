/**
 * Analysis Loading Component
 *
 * Loading state for site analysis with progress indicators.
 */

import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  MagnifyingGlassIcon,
  KeyIcon,
  MapIcon,
  UsersIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

interface AnalysisStep {
  label: string;
  description: string;
  Icon: IconType;
  status: 'pending' | 'loading' | 'completed';
}

interface AnalysisLoadingProps {
  websiteUrl: string;
}

export const AnalysisLoading = ({ websiteUrl }: AnalysisLoadingProps) => {
  const { t } = useTranslation();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const steps: AnalysisStep[] = [
    {
      label: t('appPages.analysisLoading.steps.site.label'),
      description: t('appPages.analysisLoading.steps.site.description'),
      Icon: MagnifyingGlassIcon,
      status: 'loading',
    },
    {
      label: t('appPages.analysisLoading.steps.keywords.label'),
      description: t('appPages.analysisLoading.steps.keywords.description'),
      Icon: KeyIcon,
      status: 'pending',
    },
    {
      label: t('appPages.analysisLoading.steps.topicalMap.label'),
      description: t('appPages.analysisLoading.steps.topicalMap.description'),
      Icon: MapIcon,
      status: 'pending',
    },
    {
      label: t('appPages.analysisLoading.steps.competitors.label'),
      description: t('appPages.analysisLoading.steps.competitors.description'),
      Icon: UsersIcon,
      status: 'pending',
    },
  ];

  useEffect(() => {
    const intervals = steps.map((_, index) => {
      if (index === 0) return null;
      return setTimeout(() => {
        setCurrentStepIndex(index);
      }, (index + 1) * 2000);
    });

    return () => {
      intervals.forEach((interval) => interval && clearTimeout(interval));
    };
  }, []);

  const getStepStatus = (index: number): AnalysisStep['status'] => {
    if (index < currentStepIndex) return 'completed';
    if (index === currentStepIndex) return 'loading';
    return 'pending';
  };

  return (
    <div className="space-y-8">
      {/* Main animation */}
      <div className="flex flex-col items-center justify-center py-8">
        <div className="relative w-16 h-16 mb-6">
          <div className="w-16 h-16 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <MagnifyingGlassIcon className="w-6 h-6 text-violet-300" strokeWidth={1.8} />
          </div>
        </div>
        <h3 className="text-2xl font-bold text-white mb-2">{t('appPages.analysisLoading.title')}</h3>
        <p className="text-white/40 text-center max-w-md text-sm">
          <Trans
            i18nKey="appPages.analysisLoading.intro"
            values={{ url: websiteUrl }}
            components={{ url: <span className="font-semibold text-violet-300" /> }}
          />
        </p>
      </div>

      {/* Progress steps */}
      <div className="space-y-3">
        {steps.map((step, index) => {
          const status = getStepStatus(index);
          const Icon = step.Icon;

          return (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.2 }}
              className={`flex items-start gap-4 p-4 rounded-2xl border transition-all ${
                status === 'completed'
                  ? 'bg-emerald-500/[0.06] border-emerald-500/20'
                  : status === 'loading'
                  ? 'bg-violet-500/[0.06] border-violet-500/20'
                  : 'bg-white/[0.02] border-white/[0.06]'
              }`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {status === 'completed' ? (
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <CheckCircleIcon className="w-5 h-5 text-emerald-400" strokeWidth={1.8} />
                  </div>
                ) : status === 'loading' ? (
                  <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center relative">
                    <Icon className="w-5 h-5 text-violet-300" strokeWidth={1.8} />
                    <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-400" />
                    </span>
                  </div>
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-white/[0.04] flex items-center justify-center">
                    <Icon className="w-5 h-5 text-white/20" strokeWidth={1.8} />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h4
                  className={`font-semibold text-sm ${
                    status === 'completed'
                      ? 'text-emerald-300'
                      : status === 'loading'
                      ? 'text-white'
                      : 'text-white/30'
                  }`}
                >
                  {step.label}
                </h4>
                <p
                  className={`text-xs mt-0.5 ${
                    status === 'completed'
                      ? 'text-emerald-400/70'
                      : status === 'loading'
                      ? 'text-white/50'
                      : 'text-white/20'
                  }`}
                >
                  {step.description}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="pt-2">
        <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-violet-500 to-emerald-400 rounded-full"
            initial={{ width: 0 }}
            animate={{
              width: `${((currentStepIndex + 1) / steps.length) * 100}%`,
            }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
        <p className="text-xs text-white/25 mt-2 text-center">
          {t('appPages.analysisLoading.stepOf', { current: currentStepIndex + 1, total: steps.length })}
        </p>
      </div>
    </div>
  );
};

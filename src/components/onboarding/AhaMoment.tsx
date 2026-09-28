/**
 * Aha Moment Celebration Component
 *
 * Celebrates when user reaches their first aha moment (first content generated).
 */

import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  RocketLaunchIcon,
  ArrowTrendingUpIcon,
  SignalIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { Button } from '../ui/Button';

interface AhaMomentProps {
  isVisible: boolean;
  onClose: () => void;
  onNextAction?: () => void;
  nextActionLabel?: string;
}

export const AhaMoment = ({ isVisible, onClose, onNextAction, nextActionLabel }: AhaMomentProps) => {
  const { t } = useTranslation();
  const [show, setShow] = useState(isVisible);

  useEffect(() => {
    setShow(isVisible);
  }, [isVisible]);

  if (!show) return null;

  const nextSteps = [
    { Icon: DocumentTextIcon, text: t('appPages.ahaMoment.nextSteps.publish') },
    { Icon: ArrowTrendingUpIcon, text: t('appPages.ahaMoment.nextSteps.seoTracking') },
    { Icon: SignalIcon, text: t('appPages.ahaMoment.nextSteps.geoTracking') },
    { Icon: RocketLaunchIcon, text: t('appPages.ahaMoment.nextSteps.topicalMap') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        className="w-full max-w-md relative"
      >
        {/* Glow */}
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500/20 via-emerald-400/20 to-violet-500/20 rounded-2xl opacity-60 blur-3xl" />

        <div className="relative rounded-2xl border border-violet-500/30 bg-[#0c0c0c] p-8 text-center overflow-hidden">
          {/* Particle confetti */}
          <div className="absolute inset-0 pointer-events-none">
            {[...Array(20)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-1.5 h-1.5 bg-violet-400 rounded-full"
                initial={{ top: '50%', left: '50%', opacity: 1 }}
                animate={{
                  top: `${Math.random() * 100}%`,
                  left: `${Math.random() * 100}%`,
                  opacity: 0,
                }}
                transition={{ duration: 2, delay: Math.random() * 0.5, ease: 'easeOut' }}
              />
            ))}
          </div>

          {/* Icon */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.2, 1] }}
            transition={{ duration: 0.6, type: 'spring' }}
            className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center mx-auto mb-6 relative z-10"
          >
            <RocketLaunchIcon className="w-8 h-8 text-white" strokeWidth={1.8} />
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-3xl font-bold text-white mb-3 relative z-10"
          >
            {t('appPages.ahaMoment.title')}
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-white/70 text-base mb-1.5 relative z-10"
          >
            {t('appPages.ahaMoment.subtitle')}
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-white/40 text-sm mb-6 relative z-10"
          >
            <Trans i18nKey="appPages.ahaMoment.body" components={{ strong: <strong className="text-emerald-400" /> }} />
          </motion.p>

          {/* Next steps */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 mb-6 relative z-10 text-left space-y-2.5"
          >
            <p className="text-xs text-white/40 uppercase tracking-[0.15em] mb-3">{t('appPages.ahaMoment.nextStepsTitle')}</p>
            {nextSteps.map(({ Icon, text }, i) => (
              <div key={i} className="flex items-center gap-3">
                {i === 0 ? (
                  <CheckCircleIcon className="w-4 h-4 text-emerald-400 flex-shrink-0" strokeWidth={1.8} />
                ) : (
                  <ChevronRightIcon className="w-4 h-4 text-violet-400 flex-shrink-0" strokeWidth={2} />
                )}
                <Icon className="w-4 h-4 text-white/40 flex-shrink-0" strokeWidth={1.8} />
                <span className="text-sm text-white/60">{text}</span>
              </div>
            ))}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="flex gap-3 justify-center relative z-10"
          >
            {onNextAction && (
              <Button variant="primary" onClick={() => { onNextAction(); setShow(false); onClose(); }}>
                {nextActionLabel ?? t('appPages.ahaMoment.continue')}
              </Button>
            )}
            <Button variant="ghost" onClick={() => { setShow(false); onClose(); }}>
              {t('common.close')}
            </Button>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
};

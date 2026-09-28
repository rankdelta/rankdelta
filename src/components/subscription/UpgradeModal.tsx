/**
 * Upgrade Modal Component
 *
 * Modal for plan upgrades. Copy follows UI i18n (EN/IT toggle), not account preferences.
 */

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { requiresSubscription } from '../../config/deployment';
import {
  SparklesIcon,
  FolderIcon,
  LockClosedIcon,
  RocketLaunchIcon,
  ArrowUpCircleIcon,
  XMarkIcon,
  ChevronLeftIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { useSubscription } from '../../hooks/useSubscription';
import { PricingPlans } from './PricingPlans';
import { formatCredits, getPlanDisplayInfo, type SubscriptionPlan } from '../../types/subscription';
import { resolvePlanLabel } from '../../config/planPricing';

type UpgradeReason =
  | 'insufficient_credits'
  | 'project_limit'
  | 'feature_locked'
  | 'general_upgrade';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: UpgradeReason;
  creditsNeeded?: number;
  featureName?: string;
  onUpgradeSuccess?: () => void;
}

export const UpgradeModal: React.FC<UpgradeModalProps> = ({
  isOpen,
  onClose,
  reason = 'general_upgrade',
  creditsNeeded = 0,
  featureName = '',
  onUpgradeSuccess,
}) => {
  const { t } = useTranslation();
  const [showPricing, setShowPricing] = useState(false);
  const { subscription, creditsRemaining, subscribe, startTrial, currentPlan, isTrialEligible, usageStats } = useSubscription();

  const currentPlanKey = subscription?.plan ?? 'starter';
  const planInfo = getPlanDisplayInfo(currentPlanKey);
  const planLabel = currentPlan
    ? resolvePlanLabel(currentPlanKey, currentPlan.display_name)
    : planInfo.name;

  useEffect(() => {
    if (!isOpen) {
      setShowPricing(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectPlan = async (plan: SubscriptionPlan, isYearly: boolean) => {
    try {
      if (isTrialEligible === false) {
        await subscribe(plan, isYearly);
      } else {
        await startTrial(plan, isYearly);
      }
      onUpgradeSuccess?.();
    } catch (error) {
      console.error('Upgrade failed:', error);
    }
  };

  const getReasonContent = () => {
    switch (reason) {
      case 'insufficient_credits':
        return {
          Icon: SparklesIcon,
          iconTone: 'text-violet-300 bg-violet-500/10',
          title: t('paywall.insufficientCreditsTitle'),
          description: t('paywall.insufficientCreditsDesc', {
            needed: creditsNeeded,
            remaining: formatCredits(creditsRemaining),
          }),
          cta: t('paywall.insufficientCreditsCta'),
        };
      case 'project_limit':
        return {
          Icon: FolderIcon,
          iconTone: 'text-indigo-300 bg-indigo-500/10',
          title: t('paywall.projectLimitTitle'),
          description:
            usageStats && Number.isFinite(usageStats.projectsLimit)
              ? t('paywall.projectLimitDescCount', {
                  plan: planLabel,
                  used: usageStats.projectsUsed,
                  limit: usageStats.projectsLimit,
                })
              : t('paywall.projectLimitDesc', { plan: planLabel }),
          cta: t('paywall.projectLimitCta'),
        };
      case 'feature_locked':
        return {
          Icon: LockClosedIcon,
          iconTone: 'text-amber-300 bg-amber-500/10',
          title: t('paywall.featureLockedTitle'),
          description: t('paywall.featureLockedDesc', { feature: featureName, plan: planLabel }),
          cta: t('paywall.featureLockedCta'),
        };
      default:
        return {
          Icon: RocketLaunchIcon,
          iconTone: 'text-violet-300 bg-violet-500/10',
          title: t('paywall.generalTitle'),
          description: t('paywall.generalDesc'),
          cta: t('paywall.generalCta'),
        };
    }
  };

  const content = getReasonContent();
  const ContentIcon = content.Icon;

  const modal = (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div
          className={`
            relative rounded-2xl border border-white/[0.1] bg-[#0f0f0f] shadow-2xl shadow-black/60 w-full transition-all duration-300
            ${showPricing ? 'max-w-6xl' : 'max-w-md'}
          `}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 text-white/30 hover:text-white/70 transition-colors hover:bg-white/[0.05] rounded-lg z-10"
          >
            <XMarkIcon className="w-5 h-5" strokeWidth={2} />
          </button>

          {!showPricing ? (
            <div className="p-8 text-center">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 ${content.iconTone}`}>
                <ContentIcon className="w-7 h-7" strokeWidth={1.8} />
              </div>

              <h2 className="text-2xl font-bold text-white mb-2">{content.title}</h2>
              <p className="text-white/50 mb-6 max-w-sm mx-auto text-sm">{content.description}</p>

              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] mb-6">
                <span className="text-sm text-white/40">{t('paywall.currentPlan')}</span>
                <span className={`text-sm font-medium ${planInfo.color}`}>{planLabel}</span>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => setShowPricing(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-full bg-white text-black font-semibold hover:bg-white/90 transition-all"
                >
                  <ArrowUpCircleIcon className="w-4 h-4" strokeWidth={2} />
                  {content.cta}
                </button>

                <button
                  onClick={onClose}
                  className="w-full py-3 px-4 rounded-full border border-white/[0.1] text-white/60 font-medium hover:bg-white/[0.04] transition-colors text-sm"
                >
                  {t('paywall.continueCurrent')}
                </button>
              </div>

              <div className="mt-6 pt-6 border-t border-white/[0.06]">
                <p className="text-xs text-white/30 mb-3">{t('paywall.upgradeBenefits')}</p>
                <div className="flex justify-center gap-6 text-sm text-white/50">
                  {(['benefitCredits', 'benefitProjects', 'benefitPremium'] as const).map((key) => (
                    <span key={key} className="flex items-center gap-1.5">
                      <CheckIcon className="w-3.5 h-3.5 text-emerald-400" strokeWidth={2.5} />
                      {t(`paywall.${key}`)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8">
              <div className="text-center mb-8">
                <button
                  onClick={() => setShowPricing(false)}
                  className="inline-flex items-center gap-1 text-sm text-white/40 hover:text-white/70 mb-4 transition-colors"
                >
                  <ChevronLeftIcon className="w-4 h-4" strokeWidth={2} />
                  {t('paywall.back')}
                </button>
                <h2 className="text-2xl font-bold text-white">{t('paywall.choosePlanTitle')}</h2>
                <p className="text-white/40 mt-2 text-sm">
                  {isTrialEligible === false ? t('upgrade.subtitlePayNow') : t('paywall.choosePlanSubtitle')}
                </p>
                {isTrialEligible === false ? (
                  <p className="mt-3 text-xs text-amber-200/70">{t('upgrade.payNowHint')}</p>
                ) : (
                  <p className="mt-3 text-xs text-emerald-200/70">{t('pricing.trialHint')}</p>
                )}
              </div>

              <PricingPlans onSelectPlan={handleSelectPlan} showCurrentPlan />
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
};

export const useUpgradeModal = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [modalProps, setModalProps] = useState<Omit<UpgradeModalProps, 'isOpen' | 'onClose'>>({});

  const openModal = (props?: Omit<UpgradeModalProps, 'isOpen' | 'onClose'>) => {
    if (!requiresSubscription()) return; // self-host: no plans to upgrade to
    setModalProps(props ?? {});
    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
    setModalProps({});
  };

  const openForInsufficientCredits = (creditsNeeded: number) => {
    openModal({ reason: 'insufficient_credits', creditsNeeded });
  };

  const openForProjectLimit = () => {
    openModal({ reason: 'project_limit' });
  };

  const openForLockedFeature = (featureName: string) => {
    openModal({ reason: 'feature_locked', featureName });
  };

  return {
    isOpen,
    modalProps,
    openModal,
    closeModal,
    openForInsufficientCredits,
    openForProjectLimit,
    openForLockedFeature,
    UpgradeModal: () => (
      <UpgradeModal isOpen={isOpen} onClose={closeModal} {...modalProps} />
    ),
  };
};

export default UpgradeModal;

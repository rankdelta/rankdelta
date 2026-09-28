/**
 * Start Trial Modal
 *
 * Card-required free-trial gate with plan selection. Defaults to Growth (most popular).
 * Copy follows the UI language toggle (i18next), not account content-language preferences.
 */

import { useState } from 'react';
import {
  SparklesIcon,
  XMarkIcon,
  CheckIcon,
  CreditCardIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { useTranslation, Trans } from 'react-i18next';
import { useSubscription } from '../../hooks/useSubscription';
import { TRIAL_DAYS } from '../../services/stripe';
import {
  CHECKOUT_PLANS,
  POPULAR_PLAN,
  TRIAL_DEFAULT_PLAN,
  planMonthlyUsd,
  planDisplayName,
} from '../../config/planPricing';
import { getPlanCapabilityLines } from '../../config/planCapabilities';
import { formatPrice, type SubscriptionPlan } from '../../types/subscription';

interface StartTrialModalProps {
  isOpen: boolean;
  onClose: () => void;
  headline?: string;
}

const FALLBACK_BENEFIT_KEYS = ['benefit1', 'benefit2', 'benefit3'] as const;

export const StartTrialModal: React.FC<StartTrialModalProps> = ({ isOpen, onClose, headline }) => {
  const { t } = useTranslation();
  const { startTrial, allPlans, isLoading: plansLoading } = useSubscription();
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>(TRIAL_DEFAULT_PLAN);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStart = async () => {
    setError(null);
    setLoading(true);
    try {
      await startTrial(selectedPlan);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('trial.error'));
    } finally {
      setLoading(false);
    }
  };

  const selectedPrice = formatPrice(planMonthlyUsd(selectedPlan) * 100);
  const selectedPlanConfig = allPlans.find((p) => p.plan === selectedPlan);
  const capabilityLines = selectedPlanConfig
    ? getPlanCapabilityLines(selectedPlanConfig, t)
    : FALLBACK_BENEFIT_KEYS.map((key) => t(`trial.${key}`));

  const modal = (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={onClose} />

      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div
          className="relative rounded-2xl border border-white/[0.1] bg-[#0f0f0f] shadow-2xl shadow-black/60 w-full max-w-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 text-white/30 hover:text-white/70 transition-colors hover:bg-white/[0.05] rounded-lg z-10"
          >
            <XMarkIcon className="w-5 h-5" strokeWidth={2} />
          </button>

          <div className="p-8">
            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 bg-gradient-to-br from-violet-500 to-fuchsia-500">
                <SparklesIcon className="w-7 h-7 text-white" strokeWidth={1.8} />
              </div>

              <h2 className="text-2xl font-bold text-white mb-2">
                {t('trial.title', { days: TRIAL_DAYS })}
              </h2>
              <p className="text-white/50 max-w-sm mx-auto text-sm">
                {headline ?? t('trial.defaultHeadline')}
              </p>
            </div>

            <p className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">
              {t('trial.choosePlan')}
            </p>
            <div className="grid grid-cols-3 gap-2 mb-6">
              {CHECKOUT_PLANS.map((plan) => {
                const isSelected = plan === selectedPlan;
                const isPopular = plan === POPULAR_PLAN;
                return (
                  <button
                    key={plan}
                    type="button"
                    onClick={() => setSelectedPlan(plan)}
                    className={`relative rounded-xl border p-3 text-left transition-all ${
                      isSelected
                        ? 'border-violet-500/60 bg-violet-500/10 ring-1 ring-violet-500/30'
                        : 'border-white/[0.08] bg-white/[0.02] hover:border-white/15'
                    }`}
                  >
                    {isPopular && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 px-2 py-0.5 text-[9px] font-semibold text-white">
                        {t('trial.mostPopular')}
                      </span>
                    )}
                    <p className="text-xs font-semibold text-white mt-1">
                      {planDisplayName(plan).replace('Rankdelta ', '')}
                    </p>
                    <p className="text-lg font-bold text-white tabular-nums mt-0.5">
                      ${planMonthlyUsd(plan)}
                      <span className="text-[10px] font-normal text-white/40">{t('trial.perMonth')}</span>
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 mb-6">
              <div className="space-y-2.5">
                {plansLoading && !selectedPlanConfig ? (
                  FALLBACK_BENEFIT_KEYS.map((key) => (
                    <div key={key} className="h-4 rounded bg-white/[0.06] animate-pulse" />
                  ))
                ) : (
                  capabilityLines.map((line) => (
                    <div key={line} className="flex items-start gap-2.5 text-sm text-white/70">
                      <CheckIcon className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" strokeWidth={2.5} />
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mb-3 flex items-center justify-center gap-2">
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-200">
                {t('pricing.trialBadge')}
              </span>
              <span className="text-[11px] text-white/35">{t('pricing.trialHint')}</span>
            </div>

            {error && (
              <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
                {error}
              </div>
            )}

            <button
              onClick={() => void handleStart()}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-full bg-white text-black font-semibold hover:bg-white/90 transition-all disabled:opacity-60"
            >
              {loading ? (
                <>
                  <ArrowPathIcon className="w-4 h-4 animate-spin" strokeWidth={2} />
                  {t('trial.redirecting')}
                </>
              ) : (
                <>
                  <CreditCardIcon className="w-4 h-4" strokeWidth={2} />
                  {t('trial.startTrial')}
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="w-full mt-3 py-2.5 px-4 rounded-full border border-white/[0.1] text-white/60 font-medium hover:bg-white/[0.04] transition-colors text-sm"
            >
              {t('trial.later')}
            </button>

            <p className="mt-5 text-xs leading-relaxed text-white/35 text-center">
              <Trans
                i18nKey="trial.disclosure"
                values={{
                  days: TRIAL_DAYS,
                  plan: planDisplayName(selectedPlan),
                  price: selectedPrice.replace('/month', '').replace('/mese', ''),
                }}
                components={{ strong: <span className="text-white/55" /> }}
              />
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return modal;
};

export const useStartTrialModal = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [headline, setHeadline] = useState<string | undefined>(undefined);

  const openTrialModal = (opts?: { headline?: string }) => {
    setHeadline(opts?.headline);
    setIsOpen(true);
  };
  const closeTrialModal = () => setIsOpen(false);

  return {
    isTrialModalOpen: isOpen,
    openTrialModal,
    closeTrialModal,
    StartTrialModal: () => (
      <StartTrialModal isOpen={isOpen} onClose={closeTrialModal} headline={headline} />
    ),
  };
};

export default StartTrialModal;

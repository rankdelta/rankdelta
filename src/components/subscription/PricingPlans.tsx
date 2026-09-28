/**
 * Pricing Plans Component
 *
 * Displays subscription plans using prices and limits from plan_configurations.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSubscription } from '../../hooks/useSubscription';
import {
  formatPrice,
  getPlanDisplayInfo,
  type SubscriptionPlan,
} from '../../types/subscription';
import {
  POPULAR_PLAN,
  planPriceCents,
  resolvePlanLabel,
} from '../../config/planPricing';
import {
  displayPriceCents,
  getPlanCapabilityLines,
  yearlySavingsPercent,
} from '../../config/planCapabilities';

interface PricingPlansProps {
  onSelectPlan?: (plan: SubscriptionPlan, isYearly: boolean) => void;
  showCurrentPlan?: boolean;
  className?: string;
  /** trial = free-trial checkout; payNow = immediate charge. When omitted, derived from server trial eligibility. */
  checkoutMode?: 'payNow' | 'trial';
}

export const PricingPlans: React.FC<PricingPlansProps> = ({
  onSelectPlan,
  showCurrentPlan = true,
  className = '',
  checkoutMode: checkoutModeProp,
}) => {
  const { t } = useTranslation();
  const [isYearly, setIsYearly] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<SubscriptionPlan | null>(null);
  const { subscription, allPlans, subscribe, startTrial, isLoading, isTrialEligible } = useSubscription();

  const checkoutMode: 'payNow' | 'trial' = checkoutModeProp
    ?? (isTrialEligible === false ? 'payNow' : 'trial');

  const currentPlan = subscription?.plan ?? 'starter';

  const handleSelectPlan = async (plan: SubscriptionPlan) => {
    if (plan === currentPlan) return;

    setLoadingPlan(plan);
    try {
      if (onSelectPlan) {
        onSelectPlan(plan, isYearly);
      } else if (checkoutMode === 'trial') {
        await startTrial(plan, isYearly);
      } else {
        await subscribe(plan, isYearly);
      }
    } catch (error) {
      console.error('Error selecting plan:', error);
    } finally {
      setLoadingPlan(null);
    }
  };

  const displayPlans = allPlans.filter((p) => p.plan !== 'agency');

  if (isLoading) {
    return (
      <div className={`animate-pulse space-y-4 ${className}`}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-64 bg-gray-100 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex flex-col items-center gap-3 mb-8">
        {checkoutMode === 'trial' && (
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1">
            <span className="text-[11px] font-semibold text-emerald-700">{t('pricing.trialBadge')}</span>
            <span className="text-[11px] text-gray-500">{t('pricing.trialHint')}</span>
          </div>
        )}
        <div className="bg-gray-100 p-1 rounded-xl inline-flex items-center">
          <button
            onClick={() => setIsYearly(false)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              !isYearly ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t('pricing.monthly')}
          </button>
          <button
            onClick={() => setIsYearly(true)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${
              isYearly ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t('pricing.yearly')}
            <span className="bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 rounded-full">
              {t('pricing.yearlyDiscount')}
            </span>
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {displayPlans.map((plan) => {
          const planInfo = getPlanDisplayInfo(plan.plan);
          const isCurrent = plan.plan === currentPlan;
          const isPopular = plan.plan === POPULAR_PLAN;
          const price = displayPriceCents(plan, isYearly);
          const savings = yearlySavingsPercent(plan);
          const capabilities = getPlanCapabilityLines(plan, t);
          const label = resolvePlanLabel(plan.plan, plan.display_name);
          const monthlyList = planPriceCents(plan.plan, false, plan);

          return (
            <div
              key={plan.id}
              className={`
                relative bg-white rounded-2xl border-2 p-6 transition-all
                ${isCurrent ? `${planInfo.borderColor} ring-2 ring-offset-2 ${planInfo.borderColor.replace('border', 'ring')}` : 'border-gray-200 hover:border-gray-300'}
                ${isPopular && !isCurrent ? 'border-purple-300 shadow-lg' : ''}
              `}
            >
              {isPopular && !isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-medium px-3 py-1 rounded-full">
                    {t('pricing.mostPopular')}
                  </span>
                </div>
              )}

              {isCurrent && showCurrentPlan && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className={`${planInfo.bgColor} ${planInfo.color} text-xs font-medium px-3 py-1 rounded-full`}>
                    {t('pricing.currentPlan')}
                  </span>
                </div>
              )}

              <div className="text-center mb-6">
                <h3 className={`text-xl font-bold ${planInfo.color}`}>{label}</h3>
                <p className="text-sm text-gray-500 mt-1">{plan.description}</p>
              </div>

              <div className="text-center mb-6">
                <div className="flex items-baseline justify-center">
                  <span className="text-4xl font-bold text-gray-900">{formatPrice(price)}</span>
                  <span className="text-gray-500 ml-1">{t('pricing.perMonth')}</span>
                </div>
                {isYearly && savings && (
                  <p className="text-sm text-emerald-600 mt-1">
                    {t('pricing.yearlySavings', { pct: savings })}
                  </p>
                )}
              </div>

              <ul className="space-y-3 mb-6">
                {capabilities.map((line) => (
                  <li key={line} className="flex items-center gap-2 text-sm text-gray-700">
                    <CheckIcon />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => void handleSelectPlan(plan.plan)}
                disabled={isCurrent || loadingPlan === plan.plan}
                className={`
                  w-full py-3 px-4 rounded-xl font-medium transition-all
                  ${isCurrent
                    ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                    : isPopular
                      ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 shadow-lg hover:shadow-xl'
                      : 'bg-gray-900 text-white hover:bg-gray-800'
                  }
                  ${loadingPlan === plan.plan ? 'opacity-75 cursor-wait' : ''}
                `}
              >
                {loadingPlan === plan.plan ? (
                  <span className="flex items-center justify-center gap-2">
                    <SpinnerIcon />
                    {t('pricing.processing')}
                  </span>
                ) : isCurrent ? (
                  t('pricing.currentPlan')
                ) : checkoutMode === 'trial' ? (
                  t('trial.startTrial')
                ) : monthlyList > planPriceCents(currentPlan as SubscriptionPlan, false) ? (
                  t('pricing.upgrade')
                ) : (
                  t('pricing.select')
                )}
              </button>
            </div>
          );
        })}
      </div>

      {checkoutMode === 'payNow' && (
        <p className="text-center mt-4 text-xs text-gray-500">{t('upgrade.payNowHint')}</p>
      )}
      {checkoutMode === 'trial' && (
        <p className="text-center mt-4 text-xs text-gray-500">{t('pricing.trialHint')}</p>
      )}

      <div className="text-center mt-8">
        <p className="text-sm text-gray-500">{t('pricing.guarantee')}</p>
      </div>
    </div>
  );
};

function CheckIcon() {
  return (
    <svg className="w-5 h-5 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

export default PricingPlans;

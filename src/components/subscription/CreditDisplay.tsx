/**
 * Credit Display Component
 *
 * Shows current credit balance in a compact format for header/sidebar.
 * Includes visual indicator of usage and upgrade prompt when low.
 */

import { SparklesIcon, ArrowUpCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useCredits, useSubscription } from '../../hooks/useSubscription';
import { formatCredits, getPlanDisplayInfo } from '../../types/subscription';
import { requiresSubscription } from '../../config/deployment';

interface CreditDisplayProps {
  variant?: 'compact' | 'full';
  showPlan?: boolean;
  className?: string;
}

export const CreditDisplay: React.FC<CreditDisplayProps> = ({
  variant = 'compact',
  showPlan = true,
  className = '',
}) => {
  const { credits, monthly, used, isLoading } = useCredits();
  const { subscription, isFreePlan } = useSubscription();

  // No credits/billing in the self-host edition — nothing to show.
  if (!requiresSubscription()) return null;

  if (isLoading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="h-4 w-16 bg-white/[0.08] rounded" />
      </div>
    );
  }

  const usagePercentage = monthly > 0 ? Math.round((used / monthly) * 100) : 0;
  const isLow = credits < 50;
  const isCritical = credits < 20;

  const planInfo = subscription?.plan
    ? getPlanDisplayInfo(subscription.plan)
    : null;

  const creditColor = isCritical ? 'text-rose-400' : isLow ? 'text-amber-400' : 'text-white/85';
  const iconColor = isCritical ? 'text-rose-400' : isLow ? 'text-amber-400' : 'text-violet-300';

  // Compact variant for header
  if (variant === 'compact') {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {showPlan && planInfo && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${planInfo.bgColor} ${planInfo.color}`}>
            {planInfo.name}
          </span>
        )}
        <div className="flex items-center gap-1.5">
          <SparklesIcon className={`w-4 h-4 ${iconColor}`} strokeWidth={1.8} />
          <span className={`text-sm font-medium ${creditColor}`}>
            {formatCredits(credits)}
          </span>
        </div>
      </div>
    );
  }

  // Full variant with progress bar
  return (
    <div className={`rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <SparklesIcon className={`w-4 h-4 ${iconColor}`} strokeWidth={1.8} />
          <span className="text-sm font-medium text-white/70">Crediti</span>
        </div>
        {showPlan && planInfo && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${planInfo.bgColor} ${planInfo.color}`}>
            {planInfo.name}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1 mb-2">
        <span className={`text-2xl font-bold ${creditColor}`}>
          {formatCredits(credits)}
        </span>
        <span className="text-sm text-white/30">/ {formatCredits(monthly)}</span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 rounded-full ${
            isCritical ? 'bg-rose-500' : isLow ? 'bg-amber-500' : 'bg-violet-500'
          }`}
          style={{ width: `${100 - usagePercentage}%` }}
        />
      </div>

      <div className="flex justify-between mt-2 text-xs text-white/25">
        <span>{usagePercentage}% usato</span>
        <span>{formatCredits(used)} usati</span>
      </div>

      {/* Low credits warning */}
      {isLow && (
        <div className={`mt-3 p-2.5 rounded-xl flex items-start gap-2 ${isCritical ? 'bg-rose-500/10 border border-rose-500/20' : 'bg-amber-500/10 border border-amber-500/20'}`}>
          <ExclamationTriangleIcon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isCritical ? 'text-rose-400' : 'text-amber-400'}`} strokeWidth={1.8} />
          <p className={`text-xs ${isCritical ? 'text-rose-300' : 'text-amber-300'}`}>
            {isCritical
              ? 'Crediti quasi esauriti. Fai l\'upgrade per continuare.'
              : 'Crediti in esaurimento. Considera un upgrade.'}
          </p>
        </div>
      )}

      {isFreePlan && (
        <button className="mt-3 w-full flex items-center justify-center gap-2 py-2 px-3 text-sm font-semibold text-black bg-white rounded-full hover:bg-white/90 transition-all">
          <ArrowUpCircleIcon className="w-4 h-4" strokeWidth={2} />
          Upgrade
        </button>
      )}
    </div>
  );
};

/**
 * Mini credit indicator for inline use
 */
export const CreditBadge: React.FC<{ credits?: number; className?: string }> = ({
  credits: propCredits,
  className = '',
}) => {
  const { credits: hookCredits } = useCredits();
  const credits = propCredits ?? hookCredits;

  if (!requiresSubscription()) return null; // self-host: no credit cost to show

  const isLow = credits < 50;
  const isCritical = credits < 20;

  return (
    <span
      className={`
        inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
        ${isCritical ? 'bg-rose-500/15 text-rose-300' : isLow ? 'bg-amber-500/15 text-amber-300' : 'bg-violet-500/15 text-violet-300'}
        ${className}
      `}
    >
      <SparklesIcon className="w-3 h-3" strokeWidth={2} />
      {formatCredits(credits)}
    </span>
  );
};

export default CreditDisplay;

/**
 * Content Length Selector Component
 * 
 * Allows users to select content length before generation.
 * Shows credit cost for each option with clear pricing.
 */

import { useCredits, useSubscription } from '../../hooks/useSubscription';
import {
  CONTENT_LENGTH_OPTIONS,
  calculateCreditsForWords,
  formatCredits,
} from '../../types/subscription';
import { CreditBadge } from './CreditDisplay';

interface ContentLengthSelectorProps {
  value: number;
  onChange: (wordCount: number, credits: number) => void;
  disabled?: boolean;
  showEstimate?: boolean;
  includePerplexity?: boolean;
  includeFactCheck?: boolean;
  className?: string;
}

export const ContentLengthSelector: React.FC<ContentLengthSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  showEstimate = true,
  includePerplexity = true,
  includeFactCheck = true,
  className = '',
}) => {
  const { credits } = useCredits();
  const { currentPlan } = useSubscription();
  
  // Get max content words from plan (if limited)
  const maxWords = currentPlan?.features?.max_content_words as number | undefined;
  const hasWordLimit = maxWords && maxWords !== -1;
  
  // Calculate credits for each option
  const optionsWithCredits = CONTENT_LENGTH_OPTIONS.map(option => {
    let totalCredits = calculateCreditsForWords(option.wordCount);
    
    // Add Perplexity research cost (5 credits)
    if (includePerplexity) {
      totalCredits += 5;
    }
    
    // Add fact-check cost (3 credits)
    if (includeFactCheck) {
      totalCredits += 3;
    }
    
    // Add SERP analysis cost (2 credits)
    totalCredits += 2;
    
    const isDisabledByLimit = hasWordLimit && option.wordCount > maxWords;
    const canAfford = credits >= totalCredits;
    
    return {
      ...option,
      credits: totalCredits,
      isDisabled: isDisabledByLimit || !canAfford,
      disabledReason: isDisabledByLimit 
        ? `Limite del piano: ${maxWords} parole`
        : !canAfford 
          ? `Crediti insufficienti` 
          : undefined,
    };
  });
  
  const selectedOption = optionsWithCredits.find(o => o.wordCount === value) || optionsWithCredits[1];
  
  const handleSelect = (option: typeof optionsWithCredits[0]) => {
    if (option.isDisabled || disabled) return;
    onChange(option.wordCount, option.credits);
  };
  
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-3">
        Lunghezza contenuto
      </label>
      
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {optionsWithCredits.map((option) => {
          const isSelected = option.wordCount === value;
          
          return (
            <button
              key={option.wordCount}
              type="button"
              onClick={() => handleSelect(option)}
              disabled={option.isDisabled || disabled}
              className={`
                relative p-4 rounded-xl border-2 text-left transition-all
                ${isSelected 
                  ? 'border-purple-500 bg-purple-50 ring-2 ring-purple-200' 
                  : 'border-gray-200 hover:border-gray-300 bg-white'
                }
                ${option.isDisabled 
                  ? 'opacity-50 cursor-not-allowed' 
                  : 'cursor-pointer'
                }
              `}
            >
              {/* Recommended badge */}
              {option.recommended && !option.isDisabled && (
                <span className="absolute -top-2 -right-2 bg-purple-600 text-white text-xs px-2 py-0.5 rounded-full">
                  ⭐
                </span>
              )}
              
              {/* Content */}
              <div className="font-medium text-gray-900 mb-1">
                {option.label}
              </div>
              
              <div className="text-sm text-gray-500 mb-2">
                ~{option.wordCount.toLocaleString()} parole
              </div>
              
              {/* Credits cost */}
              <div className={`
                flex items-center gap-1 text-sm font-medium
                ${option.isDisabled 
                  ? 'text-gray-400' 
                  : isSelected 
                    ? 'text-purple-700' 
                    : 'text-gray-700'
                }
              `}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {option.credits} crediti
              </div>
              
              {/* Disabled reason */}
              {option.disabledReason && (
                <div className="text-xs text-red-500 mt-1">
                  {option.disabledReason}
                </div>
              )}
            </button>
          );
        })}
      </div>
      
      {/* Credit estimate breakdown */}
      {showEstimate && selectedOption && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              Stima crediti totali
            </span>
            <CreditBadge credits={selectedOption.credits} />
          </div>
          
          <div className="space-y-1 text-sm text-gray-500">
            <div className="flex justify-between">
              <span>Generazione contenuto ({selectedOption.wordCount.toLocaleString()} parole)</span>
              <span>{calculateCreditsForWords(selectedOption.wordCount)}</span>
            </div>
            {includePerplexity && (
              <div className="flex justify-between">
                <span>Ricerca Perplexity</span>
                <span>5</span>
              </div>
            )}
            {includeFactCheck && (
              <div className="flex justify-between">
                <span>Fact-checking</span>
                <span>3</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Analisi SERP</span>
              <span>2</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-gray-200 font-medium text-gray-700">
              <span>Totale</span>
              <span>{selectedOption.credits} crediti</span>
            </div>
          </div>
          
          {/* Available credits check */}
          <div className={`
            mt-3 p-2 rounded-lg text-sm
            ${credits >= selectedOption.credits 
              ? 'bg-emerald-50 text-emerald-700' 
              : 'bg-red-50 text-red-700'
            }
          `}>
            {credits >= selectedOption.credits ? (
              <span>✓ Hai abbastanza crediti ({formatCredits(credits)} disponibili)</span>
            ) : (
              <span>✗ Crediti insufficienti (hai {formatCredits(credits)}, servono {selectedOption.credits})</span>
            )}
          </div>
        </div>
      )}
      
      {/* Description */}
      {selectedOption && (
        <p className="mt-3 text-sm text-gray-500">
          {selectedOption.description}
        </p>
      )}
    </div>
  );
};

/**
 * Compact credit cost indicator for inline use
 */
export const CreditCostIndicator: React.FC<{
  credits: number;
  label?: string;
  className?: string;
}> = ({ credits, label, className = '' }) => {
  const { credits: availableCredits } = useCredits();
  const canAfford = availableCredits >= credits;
  
  return (
    <span 
      className={`
        inline-flex items-center gap-1 text-sm
        ${canAfford ? 'text-gray-600' : 'text-red-600'}
        ${className}
      `}
      title={canAfford ? `Costo: ${credits} crediti` : `Crediti insufficienti (hai ${availableCredits})`}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      {credits}
      {label && <span className="text-gray-400">{label}</span>}
    </span>
  );
};

export default ContentLengthSelector;


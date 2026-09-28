/**
 * Onboarding Tooltip Component
 * 
 * Contextual tooltips that guide users through features
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

interface OnboardingTooltipProps {
	message: string;
	position?: 'top' | 'bottom' | 'left' | 'right';
	step?: number;
	totalSteps?: number;
	onNext?: () => void;
	onSkip?: () => void;
	showProgress?: boolean;
}

export const OnboardingTooltip = ({
	message,
	position = 'bottom',
	step,
	totalSteps,
	onNext,
	onSkip,
	showProgress = false,
}: OnboardingTooltipProps) => {
	const [isVisible, setIsVisible] = useState(true);

	if (!isVisible) return null;

	const positionClasses = {
		top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
		bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
		left: 'right-full top-1/2 -translate-y-1/2 mr-2',
		right: 'left-full top-1/2 -translate-y-1/2 ml-2',
	};

	return (
		<AnimatePresence>
			{isVisible && (
				<motion.div
					initial={{ opacity: 0, scale: 0.9 }}
					animate={{ opacity: 1, scale: 1 }}
					exit={{ opacity: 0, scale: 0.9 }}
					className={`absolute ${positionClasses[position]} z-50 w-64`}
				>
					<div className="bg-cosmic-dark-soft border border-cosmic-cyan rounded-lg p-4 shadow-cosmic-lg">
						{showProgress && step !== undefined && totalSteps !== undefined && (
							<div className="flex items-center justify-between mb-2">
								<span className="text-xs text-cosmic-cyan font-semibold">
									Step {step} di {totalSteps}
								</span>
								<button
									onClick={() => {
										setIsVisible(false);
										onSkip?.();
									}}
									className="text-gray-400 hover:text-white text-xs"
								>
									Salta
								</button>
							</div>
						)}
						<p className="text-sm text-white mb-3">{message}</p>
						{onNext && (
							<button
								onClick={() => {
									setIsVisible(false);
									onNext();
								}}
								className="w-full px-4 py-2 bg-cosmic-cyan text-cosmic-dark font-semibold rounded-lg hover:bg-cosmic-green transition-colors text-sm"
							>
								{step === totalSteps ? 'Completato!' : 'Avanti'}
							</button>
						)}
					</div>
					{/* Arrow */}
					<div
						className={`absolute ${
							position === 'bottom'
								? 'top-0 left-1/2 -translate-x-1/2 -translate-y-full border-b-8 border-b-cosmic-cyan border-x-8 border-x-transparent'
								: position === 'top'
								? 'bottom-0 left-1/2 -translate-x-1/2 translate-y-full border-t-8 border-t-cosmic-cyan border-x-8 border-x-transparent'
								: position === 'left'
								? 'right-0 top-1/2 -translate-y-1/2 translate-x-full border-l-8 border-l-cosmic-cyan border-y-8 border-y-transparent'
								: 'left-0 top-1/2 -translate-y-1/2 -translate-x-full border-r-8 border-r-cosmic-cyan border-y-8 border-y-transparent'
						}`}
					/>
				</motion.div>
			)}
		</AnimatePresence>
	);
};


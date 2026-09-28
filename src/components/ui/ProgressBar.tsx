/**
 * Progress Bar Component
 * 
 * Professional progress indicator with smooth animations.
 * Optimized for light theme with gradient fills.
 */

import { motion } from 'framer-motion';

interface ProgressBarProps {
	value: number; // 0-100
	max?: number;
	label?: string;
	showValue?: boolean;
	color?: 'primary' | 'success' | 'warning' | 'error';
	size?: 'sm' | 'md' | 'lg';
}

export const ProgressBar = ({ 
	value, 
	max = 100, 
	label, 
	showValue = true, 
	color = 'primary',
	size = 'md' 
}: ProgressBarProps) => {
	const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

	const colors = {
		primary: 'bg-gradient-to-r from-violet-500 to-indigo-500',
		success: 'bg-gradient-to-r from-violet-500 to-emerald-400',
		warning: 'bg-gradient-to-r from-amber-500 to-orange-500',
		error: 'bg-gradient-to-r from-rose-500 to-red-500',
	};

	const heights = {
		sm: 'h-1.5',
		md: 'h-2',
		lg: 'h-3',
	};

	return (
		<div className="w-full">
			{label && (
				<div className="flex justify-between items-center mb-2">
					<span className="text-sm text-white/60 font-medium">{label}</span>
					{showValue && (
						<span className="text-sm font-semibold text-white">{Math.round(percentage)}%</span>
					)}
				</div>
			)}
			<div className={`w-full bg-white/[0.08] rounded-full ${heights[size]} overflow-hidden`}>
				<motion.div
					initial={{ width: 0 }}
					animate={{ width: `${percentage}%` }}
					transition={{ duration: 0.5, ease: 'easeOut' }}
					className={`h-full ${colors[color]} rounded-full`}
				/>
			</div>
		</div>
	);
};


/**
 * Loading Spinner Component
 * 
 * Professional loading indicator with smooth animations.
 * Uses gradient border for a modern look.
 */

import { motion } from 'framer-motion';

interface LoadingSpinnerProps {
	size?: 'sm' | 'md' | 'lg';
	text?: string;
	fullScreen?: boolean;
}

export const LoadingSpinner = ({ size = 'md', text, fullScreen = false }: LoadingSpinnerProps) => {
	const sizes = {
		sm: 'w-5 h-5 border-2',
		md: 'w-8 h-8 border-[3px]',
		lg: 'w-12 h-12 border-4',
	};

	const spinner = (
		<div className="flex flex-col items-center justify-center gap-4">
			<motion.div
				className={`${sizes[size]} border-white/10 border-t-violet-500 rounded-full`}
				animate={{ rotate: 360 }}
				transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
			/>
			{text && <p className="text-white/50 text-sm font-medium">{text}</p>}
		</div>
	);

	if (fullScreen) {
		return (
			<div className="fixed inset-0 bg-[#080808]/90 backdrop-blur-sm z-50 flex items-center justify-center">
				{spinner}
			</div>
		);
	}

	return spinner;
};


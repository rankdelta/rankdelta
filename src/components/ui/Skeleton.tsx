/**
 * Skeleton Loader Component
 * 
 * Provides smooth loading states for better UX
 */

import { motion } from 'framer-motion';

interface SkeletonProps {
	width?: string;
	height?: string;
	className?: string;
	rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
}

export const Skeleton = ({ width = '100%', height = '1rem', className = '', rounded = 'md' }: SkeletonProps) => {
	const roundedClasses = {
		none: 'rounded-none',
		sm: 'rounded-sm',
		md: 'rounded-md',
		lg: 'rounded-lg',
		full: 'rounded-full',
	};

	return (
		<motion.div
			initial={{ opacity: 0.5 }}
			animate={{ opacity: [0.5, 1, 0.5] }}
			transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
			className={`bg-cosmic-dark-soft ${roundedClasses[rounded]} ${className}`}
			style={{ width, height }}
		/>
	);
};


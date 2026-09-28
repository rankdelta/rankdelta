/**
 * Empty State Component
 * 
 * Professional empty states for better UX with multiple variants and actions.
 * Optimized for light theme with subtle gradients and proper contrast.
 */

import { motion } from 'framer-motion';
import { Button } from './Button';

interface EmptyStateProps {
	icon?: string;
	title: string;
	description: string | string[];
	primaryAction?: {
		label: string;
		onClick: () => void;
		icon?: string;
	};
	secondaryAction?: {
		label: string;
		onClick: () => void;
	};
	variant?: 'default' | 'minimal' | 'large';
	className?: string;
}

export const EmptyState = ({
	icon = '📭',
	title,
	description,
	primaryAction,
	secondaryAction,
	variant = 'default',
	className = '',
}: EmptyStateProps) => {
	const descriptions = Array.isArray(description) ? description : [description];
	const isLarge = variant === 'large';
	const isMinimal = variant === 'minimal';

	return (
		<motion.div
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.3 }}
			className={`${
				isMinimal ? 'p-6' : isLarge ? 'p-16' : 'p-12'
			} bg-white/[0.02] border border-white/[0.08] rounded-2xl text-center ${className}`}
		>
			{icon && (
				<motion.div
					initial={{ scale: 0 }}
					animate={{ scale: 1 }}
					transition={{ delay: 0.1, type: 'spring' }}
					className={`${isLarge ? 'text-8xl' : isMinimal ? 'text-4xl' : 'text-6xl'} mb-6`}
				>
					{icon}
				</motion.div>
			)}
			<h3 className={`${isLarge ? 'text-2xl' : isMinimal ? 'text-lg' : 'text-xl'} font-bold text-white mb-3`}>
				{title}
			</h3>
			<div className="space-y-2 mb-6 max-w-md mx-auto">
				{descriptions.map((desc, index) => (
					<p key={index} className={`${isMinimal ? 'text-xs' : 'text-sm'} text-white/50`}>
						{desc}
					</p>
				))}
			</div>
			{(primaryAction || secondaryAction) && (
				<div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
					{primaryAction && (
						<Button
							onClick={primaryAction.onClick}
							variant="primary"
							size={isMinimal ? 'sm' : 'md'}
							className="flex items-center gap-2"
						>
							{primaryAction.icon && <span>{primaryAction.icon}</span>}
							{primaryAction.label}
						</Button>
					)}
					{secondaryAction && (
						<Button
							onClick={secondaryAction.onClick}
							variant="secondary"
							size={isMinimal ? 'sm' : 'md'}
						>
							{secondaryAction.label}
						</Button>
					)}
				</div>
			)}
		</motion.div>
	);
};


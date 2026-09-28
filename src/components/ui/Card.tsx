/**
 * Card Component
 * 
 * Professional card with refined styling and subtle interactions.
 * Optimized for light theme with clean borders and shadows.
 */

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface CardProps {
	children: ReactNode;
	className?: string;
	hover?: boolean;
	onClick?: () => void;
	padding?: 'none' | 'sm' | 'md' | 'lg';
	variant?: 'default' | 'elevated' | 'outlined';
}

export const Card = ({ 
	children, 
	className = '', 
	hover = false, 
	onClick,
	padding = 'md',
	variant = 'default'
}: CardProps) => {
	const paddingStyles = {
		none: '',
		sm: 'p-4',
		md: 'p-6',
		lg: 'p-8',
	};

	const variantStyles = {
		default: 'bg-white/[0.02] border border-white/[0.08]',
		elevated: 'bg-white/[0.03] border border-white/[0.08]',
		outlined: 'bg-transparent border border-white/[0.1]',
	};

	const baseStyles = `${variantStyles[variant]} rounded-2xl ${paddingStyles[padding]} transition-all duration-200`;
	const hoverStyles = hover ? 'hover:border-white/20 hover:bg-white/[0.04] cursor-pointer' : '';

	if (onClick || hover) {
		return (
			<motion.div
				whileHover={hover ? { y: -2, scale: 1.005 } : {}}
				whileTap={onClick ? { scale: 0.995 } : {}}
				onClick={onClick}
				className={`${baseStyles} ${hoverStyles} ${className}`}
			>
				{children}
			</motion.div>
		);
	}

	return <div className={`${baseStyles} ${className}`}>{children}</div>;
};


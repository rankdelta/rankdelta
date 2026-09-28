/**
 * Button Component
 *
 * Dark premium button matching the AppShell / Command Center design system.
 */

import { motion, type HTMLMotionProps } from 'framer-motion';
import type { ButtonHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd'> {
	variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
	size?: 'sm' | 'md' | 'lg';
	fullWidth?: boolean;
	loading?: boolean;
	/** Override the label shown while loading (defaults to common.loading). */
	loadingLabel?: string;
}

export const Button = ({
	children,
	variant = 'primary',
	size = 'md',
	fullWidth = false,
	loading = false,
	loadingLabel,
	disabled,
	className = '',
	...props
}: ButtonProps) => {
	const { t } = useTranslation();
	const baseStyles = `
		font-semibold rounded-full transition-all duration-200 ease-out
		flex items-center justify-center gap-2
		disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
		focus:outline-none focus:ring-2
	`;

	const variants = {
		primary: `
			bg-white text-black
			hover:bg-white/90
			shadow-lg shadow-white/5
			focus:ring-white/30
		`,
		secondary: `
			bg-white/[0.04] border border-white/15 text-white/80
			hover:bg-white/[0.08] hover:text-white hover:border-white/25
			focus:ring-white/20
		`,
		danger: `
			bg-rose-500/10 border border-rose-500/30 text-rose-300
			hover:bg-rose-500/15 hover:border-rose-500/50
			focus:ring-rose-500/30
		`,
		ghost: `
			bg-transparent text-white/60
			hover:text-white hover:bg-white/[0.06]
			focus:ring-white/20
		`,
		success: `
			bg-gradient-to-r from-violet-600 to-emerald-500 text-white
			hover:opacity-90
			shadow-md shadow-violet-500/20
			focus:ring-violet-500/40
		`,
	};

	const sizes = {
		sm: 'px-4 py-2 text-sm',
		md: 'px-6 py-2.5 text-sm',
		lg: 'px-8 py-3.5 text-base',
	};

	const motionProps: HTMLMotionProps<'button'> = {
		whileHover: !disabled && !loading ? { scale: 1.01, y: -1 } : undefined,
		whileTap: !disabled && !loading ? { scale: 0.98 } : undefined,
		transition: { duration: 0.15, ease: 'easeOut' },
	};

	return (
		<motion.button
			{...motionProps}
			className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
			disabled={disabled || loading}
			{...(props as any)}
		>
			{loading ? (
				<>
					<svg
						className="animate-spin h-4 w-4"
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
					>
						<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
						<path
							className="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
						></path>
					</svg>
					<span>{loadingLabel ?? t('common.loading')}</span>
				</>
			) : (
				children
			)}
		</motion.button>
	);
};

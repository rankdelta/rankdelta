/**
 * Badge Component
 * 
 * Professional status badges with proper contrast for light theme.
 * Uses solid backgrounds for better readability.
 */

interface BadgeProps {
	children: React.ReactNode;
	variant?: 'success' | 'error' | 'warning' | 'info' | 'default' | 'primary';
	size?: 'sm' | 'md' | 'lg';
}

export const Badge = ({ children, variant = 'default', size = 'md' }: BadgeProps) => {
	const variants = {
		success: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
		error: 'bg-rose-500/15 text-rose-300 border border-rose-500/30',
		warning: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
		info: 'bg-sky-500/15 text-sky-300 border border-sky-500/30',
		primary: 'bg-violet-500/15 text-violet-300 border border-violet-500/30',
		default: 'bg-white/[0.06] text-white/60 border border-white/[0.1]',
	};

	const sizes = {
		sm: 'px-2 py-0.5 text-xs',
		md: 'px-2.5 py-1 text-xs',
		lg: 'px-3 py-1.5 text-sm',
	};

	return (
		<span className={`${variants[variant]} ${sizes[size]} font-semibold rounded-full inline-flex items-center gap-1`}>
			{children}
		</span>
	);
};


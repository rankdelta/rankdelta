/**
 * Tooltip Component
 * 
 * Provides helpful context on hover
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TooltipProps {
	content: string;
	children: React.ReactNode;
	position?: 'top' | 'bottom' | 'left' | 'right';
}

export const Tooltip = ({ content, children, position = 'top' }: TooltipProps) => {
	const [isVisible, setIsVisible] = useState(false);

	const positions = {
		top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
		bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
		left: 'right-full top-1/2 -translate-y-1/2 mr-2',
		right: 'left-full top-1/2 -translate-y-1/2 ml-2',
	};

	return (
		<div
			className="relative inline-block"
			onMouseEnter={() => setIsVisible(true)}
			onMouseLeave={() => setIsVisible(false)}
		>
			{children}
			<AnimatePresence>
				{isVisible && (
					<motion.div
						initial={{ opacity: 0, scale: 0.9 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.9 }}
						className={`absolute z-50 px-3 py-2 text-xs text-white bg-cosmic-dark border border-cosmic-cyan/20 rounded-lg shadow-lg whitespace-nowrap ${positions[position]}`}
					>
						{content}
						<div
							className={`absolute w-2 h-2 bg-cosmic-dark border-cosmic-cyan/20 ${
								position === 'top'
									? 'top-full left-1/2 -translate-x-1/2 -mt-1 border-t border-r rotate-45'
									: position === 'bottom'
										? 'bottom-full left-1/2 -translate-x-1/2 -mb-1 border-b border-l rotate-45'
										: position === 'left'
											? 'left-full top-1/2 -translate-y-1/2 -ml-1 border-l border-b rotate-45'
											: 'right-full top-1/2 -translate-y-1/2 -mr-1 border-r border-t rotate-45'
							}`}
						/>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
};


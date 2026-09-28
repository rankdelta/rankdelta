/**
 * Toast Notification Component
 * 
 * Professional toast notifications with solid backgrounds for better visibility.
 * Optimized for light theme with proper contrast and shadows.
 */

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
	message: string;
	type: ToastType;
	isVisible: boolean;
	onClose: () => void;
	duration?: number;
}

export const Toast = ({ message, type, isVisible, onClose, duration = 5000 }: ToastProps) => {
	useEffect(() => {
		if (isVisible && duration > 0) {
			const timer = setTimeout(() => {
				onClose();
			}, duration);
			return () => clearTimeout(timer);
		}
		return undefined;
	}, [isVisible, duration, onClose]);

	if (!isVisible) {
		return null;
	}

	// Solid backgrounds with high contrast for professional appearance
	const styles = {
		success: {
			container: 'bg-emerald-50 border-emerald-200 shadow-emerald-100',
			icon: 'bg-emerald-500 text-white',
			text: 'text-emerald-800',
			close: 'text-emerald-500 hover:text-emerald-700',
		},
		error: {
			container: 'bg-red-50 border-red-200 shadow-red-100',
			icon: 'bg-red-500 text-white',
			text: 'text-red-800',
			close: 'text-red-500 hover:text-red-700',
		},
		info: {
			container: 'bg-sky-50 border-sky-200 shadow-sky-100',
			icon: 'bg-sky-500 text-white',
			text: 'text-sky-800',
			close: 'text-sky-500 hover:text-sky-700',
		},
		warning: {
			container: 'bg-amber-50 border-amber-200 shadow-amber-100',
			icon: 'bg-amber-500 text-white',
			text: 'text-amber-800',
			close: 'text-amber-500 hover:text-amber-700',
		},
	};

	const icons = {
		success: (
			<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
			</svg>
		),
		error: (
			<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
			</svg>
		),
		info: (
			<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
				<path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
			</svg>
		),
		warning: (
			<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
				<path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
			</svg>
		),
	};

	const style = styles[type];

	return (
		<AnimatePresence mode="wait">
			<motion.div
				initial={{ opacity: 0, y: -20, scale: 0.95 }}
				animate={{ opacity: 1, y: 0, scale: 1 }}
				exit={{ opacity: 0, y: -20, scale: 0.95 }}
				transition={{ duration: 0.2, ease: 'easeOut' }}
				className={`fixed top-4 right-4 z-50 px-4 py-3.5 rounded-xl border shadow-lg ${style.container} flex items-center gap-3 min-w-[320px] max-w-md`}
			>
				<span className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${style.icon}`}>
					{icons[type]}
				</span>
				<p className={`flex-1 text-sm font-medium ${style.text}`}>{message}</p>
				<button
					onClick={onClose}
					className={`p-1 rounded-lg hover:bg-black/5 transition-colors ${style.close}`}
				>
					<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</motion.div>
		</AnimatePresence>
	);
};


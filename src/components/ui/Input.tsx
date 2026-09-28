/**
 * Input Component
 * 
 * Professional SaaS-level input with refined styling and focus states.
 * Optimized for light theme with proper contrast and accessibility.
 */

import { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
	label?: string;
	error?: string;
	helperText?: string;
	type?: 'text' | 'search' | 'email' | 'password' | 'url' | 'textarea' | 'number' | 'date';
	rows?: number;
}

export const Input = forwardRef<HTMLInputElement | HTMLTextAreaElement, InputProps>(
	({ label, error, helperText, type = 'text', rows, className = '', ...props }, ref) => {
		const inputClassName = `
			w-full px-4 py-2.5
			bg-white/[0.03] border
			${error ? 'border-rose-500/40 focus:border-rose-500/60 focus:ring-rose-500/20' : 'border-white/[0.1] focus:border-violet-500/50 focus:ring-violet-500/20'}
			rounded-xl
			focus:outline-none focus:ring-2
			text-white placeholder-white/30
			transition-all duration-200
			hover:border-white/20
			${props.disabled ? 'bg-white/[0.02] text-white/40 cursor-not-allowed' : ''}
			${className}
		`;

		return (
			<div className="w-full">
				{label && (
					<label className="block text-sm font-medium text-white/60 mb-2">
						{label}
						{props.required && <span className="text-rose-400 ml-1">*</span>}
					</label>
				)}
				{type === 'textarea' ? (
					<textarea
						ref={ref as React.Ref<HTMLTextAreaElement>}
						rows={rows || 4}
						className={inputClassName}
						{...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
					/>
				) : (
					<input
						ref={ref as React.Ref<HTMLInputElement>}
						type={type}
						className={inputClassName}
						{...props}
					/>
				)}
				{error && (
					<p className="mt-1.5 text-sm text-rose-300 flex items-center gap-1">
						<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
							<path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
						</svg>
						{error}
					</p>
				)}
				{helperText && !error && <p className="mt-1.5 text-xs text-white/30">{helperText}</p>}
			</div>
		);
	}
);

Input.displayName = 'Input';


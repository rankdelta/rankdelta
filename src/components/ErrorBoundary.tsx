/**
 * Error Boundary Component
 * 
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI.
 */

import React from 'react';
import i18next from 'i18next';
import { isSupabaseConfigured } from '../lib/supabaseClient';

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

interface ErrorBoundaryProps {
	children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error('ErrorBoundary caught an error:', error, errorInfo);
	}

	override render() {
		if (this.state.hasError) {
			const isConfigError = !isSupabaseConfigured();
			
			return (
				<div style={{
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'center',
					height: '100vh',
					width: '100vw',
					backgroundColor: '#0a0e27',
					color: '#ffffff',
					fontFamily: 'system-ui, -apple-system, sans-serif',
					padding: '20px'
				}}>
					<div style={{ 
						textAlign: 'center', 
						maxWidth: '600px',
						backgroundColor: '#1a2a4d',
						padding: '40px',
						borderRadius: '12px',
						border: '1px solid #00d9ff'
					}}>
						<h1 style={{ fontSize: '24px', marginBottom: '16px', color: '#00d9ff' }}>
							{isConfigError ? '⚠️ Configuration Error' : '❌ Something went wrong'}
						</h1>
						{isConfigError ? (
							<>
								<p style={{ marginBottom: '16px', opacity: 0.9 }}>
									Supabase environment variables are not configured.
								</p>
								<p style={{ marginBottom: '24px', fontSize: '14px', opacity: 0.7 }}>
									Please set the following environment variables in your Vercel project settings:
								</p>
								<div style={{ 
									textAlign: 'left', 
									backgroundColor: '#0f1729', 
									padding: '16px', 
									borderRadius: '8px',
									marginBottom: '24px',
									fontFamily: 'monospace',
									fontSize: '12px'
								}}>
									<div>VITE_SUPABASE_URL</div>
									<div>VITE_SUPABASE_ANON_KEY</div>
								</div>
								<p style={{ fontSize: '14px', opacity: 0.7 }}>
									After setting these variables, redeploy your application.
								</p>
							</>
						) : (
							<>
								<p style={{ marginBottom: '16px', opacity: 0.9 }}>
									{import.meta.env.DEV
										? (this.state.error?.message || 'An unexpected error occurred')
										: i18next.t('errorBoundary.genericMessage', 'An unexpected error occurred. Please reload the page.')}
								</p>
								<button
									onClick={() => window.location.reload()}
									style={{
										backgroundColor: '#00d9ff',
										color: '#0a0e27',
										border: 'none',
										padding: '12px 24px',
										borderRadius: '8px',
										cursor: 'pointer',
										fontSize: '14px',
										fontWeight: '600'
									}}
								>
									Reload Page
								</button>
							</>
						)}
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}


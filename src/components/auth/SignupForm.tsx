/**
 * Signup Form Component
 *
 * Handles user registration via email/password and Google OAuth.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../ui/LanguageSwitcher';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate } from '@tanstack/react-router';
import { isValidEmail, isValidPassword, sanitizeString } from '../../utils/validation';
import { getDefaultAuthenticatedHomePath } from '../../config/productMode';
import { setRobots } from '../../lib/seoRobots';
import { PasswordRequirements } from './PasswordRequirements';
import { readPendingCheck } from '../../lib/pendingCheck';

export const SignupForm = () => {
	const { t, i18n } = useTranslation();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const { signUp, signIn, isSigningUp } = useAuth();
	const navigate = useNavigate();

	useEffect(() => {
		document.title = i18n.language.startsWith('it') ? 'Registrati · Rankdelta' : 'Sign up · Rankdelta';
		setRobots('noindex, nofollow');
	}, [i18n.language]);

	// Coming from the free AI-visibility check: the visitor already typed their email there.
	useEffect(() => {
		const pending = readPendingCheck();
		if (pending?.email) setEmail((current) => current || pending.email);
	}, []);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		// Validate and sanitize input
		const sanitizedEmail = sanitizeString(email);
		if (!isValidEmail(sanitizedEmail)) {
			setError(t('authSignup.errorInvalidEmail'));
			return;
		}

		if (!isValidPassword(password)) {
			setError(t('passwordRules.errorTooWeak'));
			return;
		}

		if (password !== confirmPassword) {
			setError(t('authSignup.errorPasswordsMismatch'));
			return;
		}

		try {
			const result = await signUp({ email: sanitizedEmail, password });

			// Check if email confirmation is required
			if (result.user && !result.session) {
				// Email confirmation might be required, but try to sign in anyway
				// This handles the case where email confirmation is disabled
				console.log('User created but no session, attempting to sign in...');

				try {
					// Try to sign in immediately (works if email confirmation is disabled)
					await signIn({ email: sanitizedEmail, password });
					navigate({ to: getDefaultAuthenticatedHomePath() as any });
				} catch (signInErr: any) {
					// If sign in fails, email confirmation is likely required
					console.log('Sign in failed, email confirmation required:', signInErr);
					setSuccess(t('authSignup.successConfirmEmail'));
					setError(null);
					// Clear form after a delay
					setTimeout(() => {
						setEmail('');
						setPassword('');
						setConfirmPassword('');
						setSuccess(null);
					}, 5000);
				}
				return;
			}

			// User is immediately authenticated, redirect to dashboard
			if (result.session) {
				navigate({ to: getDefaultAuthenticatedHomePath() as any });
			}
		} catch (err: any) {
			console.error('Signup error:', err);

			// Show specific error messages
			let errorMessage = t('authSignup.errorSignupFailed');

			if (err?.message) {
				if (err.message.includes('already registered') || err.message.includes('already exists')) {
					errorMessage = t('authSignup.errorAlreadyRegistered');
				} else if (err.message.includes('invalid email')) {
					errorMessage = t('authSignup.errorInvalidEmailShort');
				} else if (err.message.toLowerCase().includes('password')) {
					errorMessage = t('passwordRules.errorTooWeak');
				} else if (err.message.includes('rate limit')) {
					errorMessage = t('authSignup.errorRateLimit');
				}
				// Anything else keeps the generic message — never surface raw backend errors.
			}

			setError(errorMessage);
		}
	};


	return (
		<div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#080808' }}>
			{/* Language escape hatch — in case the visitor lands in the wrong language */}
			<div className="fixed top-5 right-5 z-50">
				<LanguageSwitcher />
			</div>
			{/* Ambient gradient blobs */}
			<div className="fixed inset-0 pointer-events-none overflow-hidden">
				<div
					className="absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full opacity-30"
					style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.6) 0%, transparent 70%)' }}
				/>
				<div
					className="absolute top-1/3 right-0 w-[500px] h-[500px] rounded-full opacity-20"
					style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.5) 0%, transparent 70%)' }}
				/>
				<div
					className="absolute bottom-0 left-1/4 w-[400px] h-[400px] rounded-full opacity-15"
					style={{ background: 'radial-gradient(circle, rgba(20,184,166,0.5) 0%, transparent 70%)' }}
				/>
			</div>

			<div className="relative w-full max-w-md">
				<div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-xl p-8">
					{/* Wordmark */}
					<div className="flex items-center gap-2 mb-2">
						<span className="text-white/60 font-mono text-sm select-none">✦/</span>
						<span className="text-white font-semibold tracking-tight text-lg">rankdelta.ai</span>
					</div>
					<p className="text-white/50 mb-8 text-sm">{t('authSignup.tagline')}</p>

					<form onSubmit={handleSubmit} className="space-y-5">
						<div>
							<label htmlFor="email" className="block text-sm font-medium text-white/60 mb-2">
								{t('authSignup.emailLabel')}
							</label>
							<input
								id="email"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
								className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.1] rounded-xl focus:outline-none focus:border-violet-500/50 text-white placeholder-white/30 transition-all"
								placeholder={t('common.emailPlaceholder')}
							/>
						</div>

						<div>
							<label htmlFor="password" className="block text-sm font-medium text-white/60 mb-2">
								{t('authSignup.passwordLabel')}
							</label>
							<input
								id="password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.1] rounded-xl focus:outline-none focus:border-violet-500/50 text-white placeholder-white/30 transition-all"
								placeholder="••••••••"
							/>
							<PasswordRequirements password={password} />
						</div>

						<div>
							<label htmlFor="confirmPassword" className="block text-sm font-medium text-white/60 mb-2">
								{t('authSignup.confirmPasswordLabel')}
							</label>
							<input
								id="confirmPassword"
								type="password"
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
								required
								className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.1] rounded-xl focus:outline-none focus:border-violet-500/50 text-white placeholder-white/30 transition-all"
								placeholder="••••••••"
							/>
						</div>

						{error && (
							<div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm flex items-center gap-2">
								<svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
									<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
								</svg>
								{error}
							</div>
						)}

						{success && (
							<div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-sm flex items-center gap-2">
								<svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
									<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
								</svg>
								{success}
							</div>
						)}

						<button
							type="submit"
							disabled={isSigningUp}
							className="w-full py-3 rounded-full bg-white text-black font-semibold hover:bg-white/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{isSigningUp ? t('authSignup.submitting') : t('authSignup.submit')}
						</button>
					</form>

					{/* Google OAuth button removed until the provider is configured in Supabase. */}

						<p className="mt-6 text-center text-sm text-white/40">
						{t('authSignup.haveAccount')}{' '}
						<a href="/login" className="text-violet-400 hover:text-violet-300 font-medium transition-colors">
							{t('authSignup.loginLink')}
						</a>
					</p>
				</div>
			</div>
		</div>
	);
};

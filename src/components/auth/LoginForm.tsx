/**
 * Login Form Component
 *
 * Handles user authentication via email/password and Google OAuth.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../ui/LanguageSwitcher';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate, useLocation } from '@tanstack/react-router';
import { isValidEmail, sanitizeString } from '../../utils/validation';
import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { getDefaultAuthenticatedHomePath } from '../../config/productMode';
import { setRobots } from '../../lib/seoRobots';

export const LoginForm = () => {
	const { t, i18n } = useTranslation();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const { signIn, isSigningIn } = useAuth();
	const navigate = useNavigate();
	const location = useLocation();
	// `/login?notice=link_expired|access_denied` — set by /auth/callback when the auth link failed.
	const notice = new URLSearchParams(location.searchStr).get('notice');
	const noticeText =
		notice === 'link_expired'
			? t('authLogin.noticeLinkExpired')
			: notice === 'access_denied'
				? t('authLogin.noticeAccessDenied')
				: null;

	useEffect(() => {
		document.title = i18n.language.startsWith('it') ? 'Accedi · Rankdelta' : 'Sign in · Rankdelta';
		setRobots('noindex, nofollow');
	}, [i18n.language]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		// Validate input
		const sanitizedEmail = sanitizeString(email);
		if (!isValidEmail(sanitizedEmail)) {
			setError(t('authLogin.errorInvalidEmail'));
			return;
		}

		if (!password || password.length < 6) {
			setError(t('authLogin.errorInvalidPassword'));
			return;
		}

		try {
			await signIn({ email: sanitizedEmail, password });
			navigate({ to: getDefaultAuthenticatedHomePath() as any });
		} catch (err) {
			// Don't expose internal error details
			setError(t('authLogin.errorInvalidCredentials'));
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
					<p className="text-white/50 mb-8 text-sm">{t('authLogin.tagline')}</p>

					{!isSupabaseConfigured() && (
						<div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
							<p className="text-amber-400 text-sm font-semibold mb-2">{t('authLogin.configRequiredTitle')}</p>
							<p className="text-amber-300/80 text-xs">
								{t('authLogin.configRequiredBody')}
							</p>
						</div>
					)}

					{noticeText && (
						<div className="mb-6 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-sm">
							{noticeText}
						</div>
					)}

					<form onSubmit={handleSubmit} className="space-y-5">
						<div>
							<label htmlFor="email" className="block text-sm font-medium text-white/60 mb-2">
								{t('authLogin.emailLabel')}
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
								{t('authLogin.passwordLabel')}
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
						</div>

						{error && (
							<div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-sm flex items-center gap-2">
								<svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
									<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
								</svg>
								{error}
							</div>
						)}

						<button
							type="submit"
							disabled={isSigningIn}
							className="w-full py-3 rounded-full bg-white text-black font-semibold hover:bg-white/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{isSigningIn ? t('authLogin.submitting') : t('authLogin.submit')}
						</button>
					</form>

					{/* Google OAuth button removed until the provider is configured in Supabase. */}

						<div className="mt-6 space-y-3">
						<p className="text-center text-sm text-white/40">
							{t('authLogin.noAccount')}{' '}
							<a href="/signup" className="text-violet-400 hover:text-violet-300 font-medium transition-colors">
								{t('authLogin.signupLink')}
							</a>
						</p>
						<p className="text-center">
							<a href="/forgot-password" className="text-sm text-violet-400 hover:text-violet-300 font-medium transition-colors">
								{t('authLogin.forgotPassword')}
							</a>
						</p>
					</div>
				</div>
			</div>
		</div>
	);
};

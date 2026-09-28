/**
 * OAuth Callback Route
 * 
 * Handles OAuth redirects from providers (Google, etc.)
 * This route processes the authentication callback and redirects to dashboard.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDefaultAuthenticatedHomePath } from '../config/productMode';
import { supabase } from '../lib/supabaseClient';

export const Route = createFileRoute('/auth/callback')({
	component: AuthCallback,
});

function AuthCallback() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const handleAuthCallback = async () => {
			try {
				// GoTrue reports a failed/expired link as `?error=access_denied&error_code=otp_expired…`
				// (or the same in the hash). Surface it on /login instead of a silent bounce.
				const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
				const searchParams = new URLSearchParams(window.location.search);
				const param = (key: string) => searchParams.get(key) ?? hashParams.get(key);
				const errorCode = param('error_code');
				const errorDescription = param('error_description');
				if (param('error') || errorCode || errorDescription) {
					const notice = /expired/i.test(`${errorCode ?? ''} ${errorDescription ?? ''}`)
						? 'link_expired'
						: 'access_denied';
					navigate({ to: '/login' as any, search: { notice } as any });
					return;
				}

				// Handle the OAuth callback
				const { data, error: authError } = await supabase.auth.getSession();

				if (authError) {
					console.error('Auth callback error:', authError);
					setError(t('authCallback.errorAuth'));
					setTimeout(() => {
						navigate({ to: '/login' as any });
					}, 3000);
					return;
				}

				if (data.session) {
					navigate({ to: getDefaultAuthenticatedHomePath() as any });
				} else {
					// No session, redirect to login
					navigate({ to: '/login' as any });
				}
			} catch (err) {
				console.error('Unexpected error in auth callback:', err);
				setError(t('authCallback.errorUnexpected'));
				setTimeout(() => {
					navigate({ to: '/login' as any });
				}, 3000);
			}
		};

		handleAuthCallback();
	}, [navigate]);

	if (error) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-cosmic-dark p-4">
				<div className="text-center">
					<div className="text-red-400 mb-4">{error}</div>
					<div className="text-gray-400 text-sm">{t('authCallback.redirecting')}</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen flex items-center justify-center bg-cosmic-dark p-4">
			<div className="text-center">
				<div className="text-cosmic-cyan mb-4">{t('authCallback.completing')}</div>
				<div className="text-gray-400 text-sm">{t('authCallback.pleaseWait')}</div>
			</div>
		</div>
	);
}


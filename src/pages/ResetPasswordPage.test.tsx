import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../common/i18n';
import { isRecoveryHash } from '../lib/recoveryLink';

// The situation that broke real resets: supabase-js has already read the recovery link, cleared
// the hash and emitted PASSWORD_RECOVERY before this lazily loaded page subscribed.
const recovery = { seen: false };
vi.mock('../lib/supabaseClient', () => ({
	cameFromRecoveryLink: () => recovery.seen,
	supabase: {
		auth: {
			onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
			getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }),
		},
	},
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => undefined }));

import { ResetPasswordPage } from './ResetPasswordPage';

const renderPage = () =>
	render(
		<I18nextProvider i18n={i18n}>
			<ResetPasswordPage />
		</I18nextProvider>,
	);

afterEach(() => {
	cleanup();
	recovery.seen = false;
	window.location.hash = '';
});

describe('ResetPasswordPage', () => {
	it('shows the form when the client already consumed the recovery link', async () => {
		recovery.seen = true;
		renderPage();
		await waitFor(() => expect(document.getElementById('password')).toBeInTheDocument());
		expect(screen.queryByText(/invalid or expired link/i)).not.toBeInTheDocument();
	});

	it('does not unlock the form for an ordinary signed-in session', async () => {
		renderPage();
		expect(await screen.findByText(/invalid or expired link/i)).toBeInTheDocument();
	});
});

describe('isRecoveryHash', () => {
	it('recognises a recovery link and nothing else', () => {
		expect(isRecoveryHash('#access_token=a.b.c&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery')).toBe(true);
		expect(isRecoveryHash('#access_token=a.b.c&type=signup')).toBe(false);
		expect(isRecoveryHash('#error=access_denied&error_code=otp_expired')).toBe(false);
		expect(isRecoveryHash('')).toBe(false);
	});
});

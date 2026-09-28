import { createFileRoute } from '@tanstack/react-router';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { useForceLocale } from '../hooks/useForceLocale';

// Italian reset-password URL: the Italian "forgot password" page sends the reset link here, and
// the Supabase email template reads this path to write the email in Italian.
function ItResetPassword() {
	useForceLocale('it');
	return <ResetPasswordPage />;
}

export const Route = createFileRoute('/it/reset-password')({
	component: ItResetPassword,
});

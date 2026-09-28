import { createFileRoute } from '@tanstack/react-router';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { useForceLocale } from '../hooks/useForceLocale';

// Italian forgot-password URL: forces Italian and renders the same page as /forgot-password.
function ItForgotPassword() {
	useForceLocale('it');
	return <ForgotPasswordPage />;
}

export const Route = createFileRoute('/it/forgot-password')({
	component: ItForgotPassword,
});

import { createFileRoute } from '@tanstack/react-router';
import { LoginForm } from '../components/auth/LoginForm';
import { useForceLocale } from '../hooks/useForceLocale';

// Italian login URL: forces Italian so a visitor arriving here (or from the /it marketing pages)
// gets the app in Italian and stays there. Renders the same LoginForm as /login.
function ItLogin() {
	useForceLocale('it');
	return <LoginForm />;
}

export const Route = createFileRoute('/it/login')({
	component: ItLogin,
});

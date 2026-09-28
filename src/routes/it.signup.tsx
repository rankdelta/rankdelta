import { createFileRoute } from '@tanstack/react-router';
import { SignupForm } from '../components/auth/SignupForm';
import { useForceLocale } from '../hooks/useForceLocale';

// Italian signup URL: forces Italian and renders the same SignupForm as /signup.
function ItSignup() {
	useForceLocale('it');
	return <SignupForm />;
}

export const Route = createFileRoute('/it/signup')({
	component: ItSignup,
});

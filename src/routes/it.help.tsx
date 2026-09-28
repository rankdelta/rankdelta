import { createFileRoute } from '@tanstack/react-router';
import { HelpPage } from '../pages/HelpPage';
import { useForceLocale } from '../hooks/useForceLocale';

// Italian help URL — same HelpPage, forced Italian (persists).
function ItHelp() {
	useForceLocale('it');
	return <HelpPage />;
}

export const Route = createFileRoute('/it/help')({
	component: ItHelp,
});

import { redirect } from '@tanstack/react-router';
import { isSelfHost } from '../config/deployment';
import { getDefaultAuthenticatedHomePath } from '../config/productMode';
import { getSessionSafe } from './requireAuth';

/**
 * Self-host edition has no marketing surface — the operator already installed it. Call from a
 * marketing route's beforeLoad: on self-host it redirects into the app (signed in → home,
 * otherwise → login); on the cloud it returns and the page renders as usual.
 */
export async function redirectSelfHostIntoApp(): Promise<void> {
	if (!isSelfHost()) return;
	let signedIn = false;
	try {
		const {
			data: { session },
		} = await getSessionSafe();
		signedIn = Boolean(session);
	} catch {
		// No session → login.
	}
	throw redirect({ to: (signedIn ? getDefaultAuthenticatedHomePath() : '/login') as any });
}

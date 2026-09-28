import { redirect } from '@tanstack/react-router';
import { getDefaultAuthenticatedHomePath, isLegacyAgentUiAvailable } from '../config/productMode';

/**
 * Use in route `beforeLoad` to block legacy content-agent pages when the product
 * is in visibility-first mode. Code stays deployed; users are sent to the current home.
 */
export const redirectIfLegacyAgentDisabled = (): void => {
	if (!isLegacyAgentUiAvailable()) {
		throw redirect({ to: getDefaultAuthenticatedHomePath() });
	}
};

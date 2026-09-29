/**
 * User-facing messages for visibility-ops generate / run errors.
 */

import { AccountBudgetError, PlanRequiredError } from '../services/edgeProxy';
import { proxyErrorMessage } from './proxyErrorMessage';

type TFn = (key: string, opts?: Record<string, unknown>) => string;

export function isVisibilityPlanRequired(err: unknown): boolean {
	return err instanceof PlanRequiredError;
}

export function isVisibilityBudgetBlocked(err: unknown): boolean {
	return err instanceof AccountBudgetError;
}

export function visibilityGenerateErrorMessage(t: TFn, err: unknown): string {
	const proxy = proxyErrorMessage(t, err);
	if (proxy) return proxy;

	if (err instanceof Error) {
		if (/non-2xx/i.test(err.message)) {
			return t('visibility.generateErrorGeneric');
		}
		const msg = err.message.trim();
		// Server error codes (snake_case, e.g. query_generation_failed) are for logs, not people.
		if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(msg)) return t('visibility.generateErrorGeneric');
		if (msg && msg.length <= 240) return msg;
	}

	return t('visibility.generateErrorGeneric');
}

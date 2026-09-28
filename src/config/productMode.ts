/**
 * Product surface switch (build-time via Vite env).
 *
 * - Default (omit env or anything other than `all`): **visibility-first** — GEO / AI visibility
 *   hub, tracker UI; legacy content-agent surfaces hidden unless forced.
 * - `VITE_PRODUCT_MODE=all`: full legacy app — calendar, proposals, content workflows.
 *
 * Escape hatch for QA / demos when visibility-first is on:
 *   VITE_FORCE_LEGACY_AGENT_UI=true
 */

export type ProductMode = 'all' | 'visibility';

const raw = import.meta.env['VITE_PRODUCT_MODE'] as string | undefined;

export const productMode: ProductMode = raw === 'all' ? 'all' : 'visibility';

export const isVisibilityFirstProduct = (): boolean => productMode === 'visibility';

/** Content-agent surfaces (calendar, proposals, editor, keyword SEO hub, content reports, …) */
export const isLegacyAgentUiAvailable = (): boolean => {
	if (import.meta.env['VITE_FORCE_LEGACY_AGENT_UI'] === 'true') {
		return true;
	}
	return productMode === 'all';
};

/** Where authenticated users land after login / root redirect */
export const getDefaultAuthenticatedHomePath = (): '/dashboard' | '/home' =>
	isLegacyAgentUiAvailable() ? '/dashboard' : '/home';

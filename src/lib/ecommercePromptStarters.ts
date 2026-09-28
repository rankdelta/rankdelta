import type { ContentLanguage } from './contentLanguages';
import { normalizeContentLanguage } from './contentLanguages';
import type { QueryIntentType } from '../types/database';
import type { WorkspaceVertical } from '../types/database';

export type StarterPrompt = { text: string; intent_type: QueryIntentType };

export type StarterPackResult =
  | { ok: true; prompts: StarterPrompt[]; vertical: WorkspaceVertical }
  | { ok: false; reason: 'missing_category_seed' | 'missing_brand' };

function categorySeed(seeds: string[]): string | null {
  const seed = seeds.map((s) => s.trim()).find(Boolean);
  return seed ?? null;
}

/**
 * E-commerce shopping prompts — require a real category seed (no placeholder fallbacks).
 */
export function buildEcommerceStarterPrompts(
	lang: ContentLanguage | string,
	brand: string,
	competitors: string[],
	seeds: string[],
): StarterPrompt[] {
	const code = normalizeContentLanguage(lang);
	const seed = categorySeed(seeds);
	if (!seed) return [];
	const comp = competitors[0]?.trim() || (code === 'it' ? 'un competitor' : 'a competitor');

	if (code === 'it') {
		return [
			{ text: `dove comprare online ${seed} affidabile spedizione Italia`, intent_type: 'category' },
			{ text: `migliori negozi per ${seed} opinioni 2025`, intent_type: 'category' },
			{ text: `${brand} è affidabile recensioni`, intent_type: 'brand' },
			{ text: `${brand} vs ${comp} cosa scegliere per qualità prezzo`, intent_type: 'comparison' },
			{ text: `alternativa a ${brand} per ${seed}`, intent_type: 'comparison' },
			{ text: `cosa sapere prima di ordinare ${seed} da ${brand}`, intent_type: 'problem' },
			{ text: `miglior ${seed} per principianti consigli`, intent_type: 'use_case' },
			{ text: `offerte ${seed} Black Friday dove conviene`, intent_type: 'category' },
			{ text: `spedizione resi ${brand} come funziona`, intent_type: 'problem' },
			{ text: `chi vende ${seed} con pagamento alla consegna`, intent_type: 'use_case' },
			{ text: `negozio Shopify affidabile per ${seed}`, intent_type: 'category' },
			{ text: `${brand} opinioni negative problemi comuni`, intent_type: 'brand' },
		];
	}

	return [
		{ text: `best places to buy ${seed} online free shipping`, intent_type: 'category' },
		{ text: `top rated stores for ${seed} reviews 2025`, intent_type: 'category' },
		{ text: `is ${brand} legit trustworthy reviews`, intent_type: 'brand' },
		{ text: `${brand} vs ${comp} which is better quality`, intent_type: 'comparison' },
		{ text: `alternatives to ${brand} for ${seed}`, intent_type: 'comparison' },
		{ text: `what to know before buying ${seed} from ${brand}`, intent_type: 'problem' },
		{ text: `best ${seed} for beginners recommendations`, intent_type: 'use_case' },
		{ text: `${seed} deals worth it right now`, intent_type: 'category' },
		{ text: `${brand} shipping returns policy worth it`, intent_type: 'problem' },
		{ text: `where to buy ${seed} with buy now pay later`, intent_type: 'use_case' },
		{ text: `reliable Shopify store for ${seed}`, intent_type: 'category' },
		{ text: `${brand} negative reviews common issues`, intent_type: 'brand' },
	];
}

/** B2B / SaaS prompts — no e-commerce shipping/buying language. */
export function buildSaasStarterPrompts(
	lang: ContentLanguage | string,
	brand: string,
	competitors: string[],
	seeds: string[],
): StarterPrompt[] {
	const code = normalizeContentLanguage(lang);
	const niche = categorySeed(seeds) || (code === 'it' ? 'software B2B' : 'B2B software');
	const comp = competitors[0]?.trim() || (code === 'it' ? 'un competitor' : 'a competitor');

	if (code === 'it') {
		return [
			{ text: `miglior ${niche} per piccole imprese`, intent_type: 'category' },
			{ text: `${brand} recensioni prezzi funzionalità`, intent_type: 'brand' },
			{ text: `${brand} vs ${comp} confronto`, intent_type: 'comparison' },
			{ text: `alternative a ${brand} per ${niche}`, intent_type: 'comparison' },
			{ text: `quanto costa ${brand} piani e limiti`, intent_type: 'problem' },
			{ text: `${brand} integrazioni API sicurezza`, intent_type: 'use_case' },
			{ text: `come implementare ${niche} in azienda`, intent_type: 'use_case' },
			{ text: `${brand} onboarding tempi di attivazione`, intent_type: 'problem' },
			{ text: `migliori tool ${niche} per team marketing`, intent_type: 'category' },
			{ text: `${brand} supporto clienti SLA`, intent_type: 'brand' },
		];
	}

	return [
		{ text: `best ${niche} for small business`, intent_type: 'category' },
		{ text: `${brand} reviews pricing features`, intent_type: 'brand' },
		{ text: `${brand} vs ${comp} comparison`, intent_type: 'comparison' },
		{ text: `alternatives to ${brand} for ${niche}`, intent_type: 'comparison' },
		{ text: `${brand} pricing plans limits`, intent_type: 'problem' },
		{ text: `${brand} integrations API security`, intent_type: 'use_case' },
		{ text: `how to implement ${niche} in your company`, intent_type: 'use_case' },
		{ text: `${brand} onboarding time to value`, intent_type: 'problem' },
		{ text: `top ${niche} tools for marketing teams`, intent_type: 'category' },
		{ text: `${brand} customer support SLA`, intent_type: 'brand' },
	];
}

/** Pick starter pack by project vertical from Brand & market settings. */
export function buildStarterPromptsForVertical(
	vertical: WorkspaceVertical | null | undefined,
	lang: ContentLanguage | string,
	brand: string,
	competitors: string[],
	seeds: string[],
): StarterPackResult {
	const v = vertical ?? 'ecommerce';
	if (!brand.trim()) {
		return { ok: false, reason: 'missing_brand' };
	}
	if (v === 'saas' || v === 'other') {
		const prompts = buildSaasStarterPrompts(lang, brand, competitors, seeds);
		return { ok: true, prompts, vertical: v === 'other' ? 'other' : 'saas' };
	}
	const seed = categorySeed(seeds);
	if (!seed) {
		return { ok: false, reason: 'missing_category_seed' };
	}
	const prompts = buildEcommerceStarterPrompts(lang, brand, competitors, seeds);
	return { ok: true, prompts, vertical: 'ecommerce' };
}

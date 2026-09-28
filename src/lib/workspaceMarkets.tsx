/**
 * Project workspace market selector — scoped to countries whose primary language is
 * supported by projects.primary_language (it/en/de/fr/es/pt). Location codes come from
 * RESEARCH_MARKETS in seoMarkets.ts (single source of truth for DataForSEO).
 */

import type { TFunction } from 'i18next';
import type { WorkspaceMarket } from '../types/database';
import type { ContentLanguage } from './contentLanguages';
import { RESEARCH_MARKETS } from './seoMarkets';

const SELECTOR_PRIMARY_LANGUAGES = new Set<ContentLanguage>(['it', 'en', 'de', 'fr', 'es', 'pt']);

/** Uppercase ISO codes shown in Settings / Brand & market selectors. */
export const WORKSPACE_SELECTOR_MARKETS = [
  'US',
  'GB',
  'CA',
  'AU',
  'IE',
  'IN',
  'ES',
  'MX',
  'AR',
  'CO',
  'PT',
  'BR',
  'DE',
  'AT',
  'CH',
  'FR',
  'BE',
  'IT',
] as const satisfies readonly Exclude<WorkspaceMarket, 'global'>[];

export type WorkspaceSelectorMarket = (typeof WORKSPACE_SELECTOR_MARKETS)[number];

export interface WorkspaceMarketGroup {
  regionKey: 'settings.marketRegionAmericas' | 'settings.marketRegionEurope' | 'settings.marketRegionApac';
  markets: WorkspaceSelectorMarket[];
}

/** Grouped for <optgroup> rendering — order matches product UX (Americas / Europe / APAC). */
export const WORKSPACE_MARKET_GROUPS: WorkspaceMarketGroup[] = [
  {
    regionKey: 'settings.marketRegionAmericas',
    markets: ['US', 'CA', 'MX', 'AR', 'CO', 'BR'],
  },
  {
    regionKey: 'settings.marketRegionEurope',
    markets: ['GB', 'IE', 'DE', 'AT', 'CH', 'FR', 'BE', 'IT', 'ES', 'PT'],
  },
  {
    regionKey: 'settings.marketRegionApac',
    markets: ['AU', 'IN'],
  },
];

const MARKET_I18N_KEYS: Record<WorkspaceSelectorMarket, string> = {
  US: 'settings.marketUsa',
  GB: 'settings.marketUnitedKingdom',
  CA: 'settings.marketCanada',
  AU: 'settings.marketAustralia',
  IE: 'settings.marketIreland',
  IN: 'settings.marketIndia',
  ES: 'settings.marketSpain',
  MX: 'settings.marketMexico',
  AR: 'settings.marketArgentina',
  CO: 'settings.marketColombia',
  PT: 'settings.marketPortugal',
  BR: 'settings.marketBrazil',
  DE: 'settings.marketGermany',
  AT: 'settings.marketAustria',
  CH: 'settings.marketSwitzerland',
  FR: 'settings.marketFrance',
  BE: 'settings.marketBelgium',
  IT: 'settings.marketItaly',
};

/** Sanity check: every selector market exists in RESEARCH_MARKETS with an allowed primary language. */
for (const code of WORKSPACE_SELECTOR_MARKETS) {
  const row = RESEARCH_MARKETS.find((m) => m.code === code.toLowerCase());
  if (!row || !SELECTOR_PRIMARY_LANGUAGES.has(row.loc.languageCode as ContentLanguage)) {
    throw new Error(`workspaceMarkets: ${code} missing or has unsupported primary language`);
  }
}

export function workspaceMarketLabel(code: WorkspaceMarket, t: TFunction): string {
  if (code === 'global') return t('settings.marketGlobal');
  const key = MARKET_I18N_KEYS[code as WorkspaceSelectorMarket];
  return key ? t(key) : code;
}

type WorkspaceMarketSelectOptionsProps = {
  t: TFunction;
  optionClassName?: string;
};

/** Shared <option>/<optgroup> tree for project market <select> elements. */
export function WorkspaceMarketSelectOptions({ t, optionClassName }: WorkspaceMarketSelectOptionsProps) {
  return (
    <>
      {WORKSPACE_MARKET_GROUPS.map((group) => (
        <optgroup key={group.regionKey} label={t(group.regionKey)}>
          {group.markets.map((code) => (
            <option key={code} value={code} className={optionClassName}>
              {t(MARKET_I18N_KEYS[code])}
            </option>
          ))}
        </optgroup>
      ))}
      <option value="global" className={optionClassName}>
        {t('settings.marketGlobal')}
      </option>
    </>
  );
}

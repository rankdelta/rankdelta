import { describe, expect, it } from 'vitest';
import { mapMarketToLocation } from '../../supabase/functions/_shared/marketLocale.ts';
import { resolveLocale } from './seoMarkets';
import {
  WORKSPACE_MARKET_GROUPS,
  WORKSPACE_SELECTOR_MARKETS,
} from './workspaceMarkets';

describe('workspaceMarkets', () => {
  it('lists 18 country markets plus global in three regional groups', () => {
    expect(WORKSPACE_SELECTOR_MARKETS).toHaveLength(18);
    const grouped = WORKSPACE_MARKET_GROUPS.flatMap((g) => g.markets);
    expect(grouped.sort()).toEqual([...WORKSPACE_SELECTOR_MARKETS].sort());
    expect(WORKSPACE_MARKET_GROUPS.map((g) => g.regionKey)).toEqual([
      'settings.marketRegionAmericas',
      'settings.marketRegionEurope',
      'settings.marketRegionApac',
    ]);
  });

  it('aligns mapMarketToLocation with resolveLocale for every selector code', () => {
    for (const code of WORKSPACE_SELECTOR_MARKETS) {
      expect(mapMarketToLocation(code)).toEqual(resolveLocale(code.toLowerCase()).locationCode);
    }
    expect(mapMarketToLocation('global')).toBe(resolveLocale('us').locationCode);
    expect(mapMarketToLocation('GB')).toBe(2826);
  });
});

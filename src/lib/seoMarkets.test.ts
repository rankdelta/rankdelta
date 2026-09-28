import { describe, expect, it } from 'vitest';
import {
  RESEARCH_MARKETS,
  TRAFFIC_MARKETS,
  defaultResearchMarket,
  labsMarket,
  marketGl,
  parentMarket,
  researchMarketByCode,
  resolveLocale,
} from './seoMarkets';

describe('research markets', () => {
  it('includes Switzerland and other common markets beyond the original six', () => {
    const codes = RESEARCH_MARKETS.map((m) => m.code);
    expect(codes).toEqual(expect.arrayContaining(['us', 'gb', 'de', 'fr', 'it', 'es', 'ch', 'nl', 'au', 'br', 'in', 'jp']));
    expect(RESEARCH_MARKETS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('keeps traffic-by-country at six markets so cost does not multiply', () => {
    expect(TRAFFIC_MARKETS.map((m) => m.code).sort()).toEqual(['de', 'es', 'fr', 'gb', 'it', 'us']);
    expect(TRAFFIC_MARKETS.every((m) => m.group !== 'cities')).toBe(true);
  });

  it('defaults from UI language', () => {
    expect(defaultResearchMarket('it-IT').code).toBe('it');
    expect(defaultResearchMarket('de').code).toBe('de');
    expect(defaultResearchMarket('en-US').code).toBe('us');
  });

  it('resolves ISO codes and names without changing LOCATION aliases', () => {
    expect(researchMarketByCode('ch')?.loc).toEqual({ locationCode: 2756, languageCode: 'de' });
    expect(resolveLocale('ch')).toEqual({ locationCode: 2756, languageCode: 'de' });
    expect(resolveLocale('italy')).toEqual({ locationCode: 2380, languageCode: 'it' });
    expect(resolveLocale('uk', 'en')).toEqual({ locationCode: 2826, languageCode: 'en' });
  });

  it('maps city markets to parent country for Labs without multiplying cost', () => {
    const basel = researchMarketByCode('city-basel');
    expect(basel?.group).toBe('cities');
    expect(basel?.parent).toBe('ch');
    expect(parentMarket(basel!)?.code).toBe('ch');
    expect(labsMarket(basel!).code).toBe('ch');
    expect(marketGl(basel!)).toBe('ch');
    expect(marketGl(researchMarketByCode('us')!)).toBe('us');
    expect(RESEARCH_MARKETS.some((m) => m.group === 'cities')).toBe(true);
  });
});

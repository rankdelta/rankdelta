/**
 * DataForSEO location + language pairs used by Keyword Research and Site Explorer.
 *
 * Keyword research cost does NOT grow with the number of countries in this list —
 * each search still sends one location_code. Traffic-by-country is different: that
 * tab fires one paid call per market, so TRAFFIC_MARKETS stays short.
 */

export const LOCATION = {
  US: 2840,
  UK: 2826,
  ITALY: 2380,
} as const;

export type LocationCode = typeof LOCATION[keyof typeof LOCATION];

export interface MarketLocale {
  locationCode: number;
  languageCode: string;
}

export interface ResearchMarket {
  /** ISO-ish key used as the <select> value (stable if the list is reordered). */
  code: string;
  name: string;
  group: 'europe' | 'americas' | 'apac' | 'mea' | 'cities';
  loc: MarketLocale;
  /** Country code whose Labs locale is used when this is a city. */
  parent?: string;
}

/**
 * Country-level markets DataForSEO Labs commonly covers. City targeting is a
 * separate UX problem; country + primary language is what Keyword Research needs.
 */
export const RESEARCH_MARKETS: ResearchMarket[] = [
  { code: 'us', name: 'United States', group: 'americas', loc: { locationCode: 2840, languageCode: 'en' } },
  { code: 'ca', name: 'Canada', group: 'americas', loc: { locationCode: 2124, languageCode: 'en' } },
  { code: 'mx', name: 'Mexico', group: 'americas', loc: { locationCode: 2484, languageCode: 'es' } },
  { code: 'br', name: 'Brazil', group: 'americas', loc: { locationCode: 2076, languageCode: 'pt' } },
  { code: 'ar', name: 'Argentina', group: 'americas', loc: { locationCode: 2032, languageCode: 'es' } },
  { code: 'cl', name: 'Chile', group: 'americas', loc: { locationCode: 2152, languageCode: 'es' } },
  { code: 'co', name: 'Colombia', group: 'americas', loc: { locationCode: 2170, languageCode: 'es' } },
  { code: 'gb', name: 'United Kingdom', group: 'europe', loc: { locationCode: 2826, languageCode: 'en' } },
  { code: 'ie', name: 'Ireland', group: 'europe', loc: { locationCode: 2372, languageCode: 'en' } },
  { code: 'de', name: 'Germany', group: 'europe', loc: { locationCode: 2276, languageCode: 'de' } },
  { code: 'at', name: 'Austria', group: 'europe', loc: { locationCode: 2040, languageCode: 'de' } },
  { code: 'ch', name: 'Switzerland', group: 'europe', loc: { locationCode: 2756, languageCode: 'de' } },
  { code: 'fr', name: 'France', group: 'europe', loc: { locationCode: 2250, languageCode: 'fr' } },
  { code: 'be', name: 'Belgium', group: 'europe', loc: { locationCode: 2056, languageCode: 'fr' } },
  { code: 'nl', name: 'Netherlands', group: 'europe', loc: { locationCode: 2528, languageCode: 'nl' } },
  { code: 'it', name: 'Italy', group: 'europe', loc: { locationCode: 2380, languageCode: 'it' } },
  { code: 'es', name: 'Spain', group: 'europe', loc: { locationCode: 2724, languageCode: 'es' } },
  { code: 'pt', name: 'Portugal', group: 'europe', loc: { locationCode: 2620, languageCode: 'pt' } },
  { code: 'pl', name: 'Poland', group: 'europe', loc: { locationCode: 2616, languageCode: 'pl' } },
  { code: 'cz', name: 'Czechia', group: 'europe', loc: { locationCode: 2203, languageCode: 'cs' } },
  { code: 'hu', name: 'Hungary', group: 'europe', loc: { locationCode: 2348, languageCode: 'hu' } },
  { code: 'ro', name: 'Romania', group: 'europe', loc: { locationCode: 2642, languageCode: 'ro' } },
  { code: 'gr', name: 'Greece', group: 'europe', loc: { locationCode: 2300, languageCode: 'el' } },
  { code: 'se', name: 'Sweden', group: 'europe', loc: { locationCode: 2752, languageCode: 'sv' } },
  { code: 'no', name: 'Norway', group: 'europe', loc: { locationCode: 2578, languageCode: 'no' } },
  { code: 'dk', name: 'Denmark', group: 'europe', loc: { locationCode: 2208, languageCode: 'da' } },
  { code: 'fi', name: 'Finland', group: 'europe', loc: { locationCode: 2246, languageCode: 'fi' } },
  { code: 'tr', name: 'Turkey', group: 'europe', loc: { locationCode: 2792, languageCode: 'tr' } },
  { code: 'ua', name: 'Ukraine', group: 'europe', loc: { locationCode: 2804, languageCode: 'uk' } },
  { code: 'au', name: 'Australia', group: 'apac', loc: { locationCode: 2036, languageCode: 'en' } },
  { code: 'nz', name: 'New Zealand', group: 'apac', loc: { locationCode: 2554, languageCode: 'en' } },
  { code: 'in', name: 'India', group: 'apac', loc: { locationCode: 2356, languageCode: 'en' } },
  { code: 'sg', name: 'Singapore', group: 'apac', loc: { locationCode: 2702, languageCode: 'en' } },
  { code: 'hk', name: 'Hong Kong', group: 'apac', loc: { locationCode: 2344, languageCode: 'en' } },
  { code: 'jp', name: 'Japan', group: 'apac', loc: { locationCode: 2392, languageCode: 'ja' } },
  { code: 'kr', name: 'South Korea', group: 'apac', loc: { locationCode: 2410, languageCode: 'ko' } },
  { code: 'tw', name: 'Taiwan', group: 'apac', loc: { locationCode: 2158, languageCode: 'zh' } },
  { code: 'th', name: 'Thailand', group: 'apac', loc: { locationCode: 2764, languageCode: 'th' } },
  { code: 'id', name: 'Indonesia', group: 'apac', loc: { locationCode: 2360, languageCode: 'id' } },
  { code: 'my', name: 'Malaysia', group: 'apac', loc: { locationCode: 2458, languageCode: 'en' } },
  { code: 'ph', name: 'Philippines', group: 'apac', loc: { locationCode: 2608, languageCode: 'en' } },
  { code: 'vn', name: 'Vietnam', group: 'apac', loc: { locationCode: 2704, languageCode: 'vi' } },
  { code: 'ae', name: 'United Arab Emirates', group: 'mea', loc: { locationCode: 2784, languageCode: 'en' } },
  { code: 'sa', name: 'Saudi Arabia', group: 'mea', loc: { locationCode: 2682, languageCode: 'ar' } },
  { code: 'il', name: 'Israel', group: 'mea', loc: { locationCode: 2376, languageCode: 'en' } },
  { code: 'za', name: 'South Africa', group: 'mea', loc: { locationCode: 2710, languageCode: 'en' } },
  { code: 'eg', name: 'Egypt', group: 'mea', loc: { locationCode: 2818, languageCode: 'ar' } },
  { code: 'ng', name: 'Nigeria', group: 'mea', loc: { locationCode: 2566, languageCode: 'en' } },
  // City targets: still one location_code per search. Labs (volume/KD) uses the parent
  // country so we don't burn a rejected-city call; live SERP stays on the city.
  { code: 'city-basel', name: 'Basel, Switzerland', group: 'cities', loc: { locationCode: 1007338, languageCode: 'de' }, parent: 'ch' },
  { code: 'city-zurich', name: 'Zurich, Switzerland', group: 'cities', loc: { locationCode: 1007368, languageCode: 'de' }, parent: 'ch' },
  { code: 'city-geneva', name: 'Geneva, Switzerland', group: 'cities', loc: { locationCode: 1007340, languageCode: 'fr' }, parent: 'ch' },
  { code: 'city-milan', name: 'Milan, Italy', group: 'cities', loc: { locationCode: 1003946, languageCode: 'it' }, parent: 'it' },
  { code: 'city-rome', name: 'Rome, Italy', group: 'cities', loc: { locationCode: 1003854, languageCode: 'it' }, parent: 'it' },
  { code: 'city-london', name: 'London, UK', group: 'cities', loc: { locationCode: 1006886, languageCode: 'en' }, parent: 'gb' },
  { code: 'city-paris', name: 'Paris, France', group: 'cities', loc: { locationCode: 1006094, languageCode: 'fr' }, parent: 'fr' },
  { code: 'city-berlin', name: 'Berlin, Germany', group: 'cities', loc: { locationCode: 1005424, languageCode: 'de' }, parent: 'de' },
  { code: 'city-munich', name: 'Munich, Germany', group: 'cities', loc: { locationCode: 1005422, languageCode: 'de' }, parent: 'de' },
  { code: 'city-madrid', name: 'Madrid, Spain', group: 'cities', loc: { locationCode: 1005426, languageCode: 'es' }, parent: 'es' },
  { code: 'city-nyc', name: 'New York, US', group: 'cities', loc: { locationCode: 1023191, languageCode: 'en' }, parent: 'us' },
];

/** Traffic-by-country stays short: one paid DataForSEO call per market. */
export const TRAFFIC_MARKETS: ResearchMarket[] = RESEARCH_MARKETS.filter((m) =>
  ['us', 'gb', 'de', 'fr', 'it', 'es'].includes(m.code),
);

export function researchMarketByCode(code: string | null | undefined): ResearchMarket | undefined {
  if (!code) return undefined;
  return RESEARCH_MARKETS.find((m) => m.code === code.toLowerCase());
}

export function parentMarket(market: ResearchMarket): ResearchMarket | undefined {
  return market.parent ? researchMarketByCode(market.parent) : undefined;
}

/**
 * DataForSEO Labs (ranked keywords, ideas, domain overview) often rejects city
 * location_codes. Use the parent country for those calls — still one paid request.
 * Live SERP can keep the city code.
 */
export function labsMarket(market: ResearchMarket): ResearchMarket {
  return parentMarket(market) ?? market;
}

/** Google `gl` country — cities use their parent ISO code (`ch`, not `city-basel`). */
export function marketGl(market: ResearchMarket): string {
  return (market.parent ?? market.code).slice(0, 2).toLowerCase();
}

/** Default market from the UI language (it → Italy, de → Germany, …). */
export function defaultResearchMarket(lang?: string | null): ResearchMarket {
  const code = (lang || '').slice(0, 2).toLowerCase();
  const byLang: Record<string, string> = {
    it: 'it', de: 'de', fr: 'fr', es: 'es', pt: 'br', nl: 'nl', pl: 'pl',
    ja: 'jp', ko: 'kr', zh: 'tw', ar: 'ae', sv: 'se', da: 'dk', fi: 'fi',
    no: 'no', tr: 'tr', el: 'gr', cs: 'cz', hu: 'hu', ro: 'ro', uk: 'ua',
    vi: 'vn', th: 'th', id: 'id',
  };
  return researchMarketByCode(byLang[code]) ?? RESEARCH_MARKETS[0]!;
}

/**
 * Resolve market and language to DataForSEO location and language codes.
 * Accepts ISO codes, country names, and the short LOCATION aliases.
 */
export function resolveLocale(
  market?: string | null,
  language?: string | null,
): { locationCode: number; languageCode: string } {
  const normalizedMarket = (market || '').toLowerCase().trim();
  const normalizedLanguage = (language || '').toLowerCase().trim();

  let locationCode: number = LOCATION.US;
  let languageCode = 'en';

  const byCode = researchMarketByCode(normalizedMarket);
  if (byCode) {
    locationCode = byCode.loc.locationCode;
    languageCode = byCode.loc.languageCode;
  } else if (normalizedMarket === 'usa' || normalizedMarket === 'united states') {
    locationCode = LOCATION.US;
    languageCode = 'en';
  } else if (normalizedMarket === 'uk' || normalizedMarket === 'united kingdom') {
    locationCode = LOCATION.UK;
    languageCode = 'en';
  } else if (normalizedMarket === 'italy' || normalizedMarket === 'italia') {
    locationCode = LOCATION.ITALY;
    languageCode = 'it';
  } else {
    const byName = RESEARCH_MARKETS.find((m) => m.name.toLowerCase() === normalizedMarket);
    if (byName) {
      locationCode = byName.loc.locationCode;
      languageCode = byName.loc.languageCode;
    }
  }

  if (normalizedLanguage) languageCode = normalizedLanguage;
  return { locationCode, languageCode };
}

/**
 * DataForSEO location + language for a project: its own market and language, the language's
 * home market when the market is unset, and United States / English when neither is known.
 */
export function projectResearchLocale(project: {
  market?: string | null;
  language?: string | null;
}): { locationCode: number; languageCode: string } {
  const market = project.market || (project.language ? defaultResearchMarket(project.language).code : null);
  return resolveLocale(market, project.language);
}

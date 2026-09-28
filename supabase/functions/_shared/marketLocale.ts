/**
 * Project market / primary_language → DataForSEO location + language codes.
 * Shared by MCP (keyword_research, domain_overview) and visibility-ops (SERP rank, LLM mentions).
 *
 * Location codes are resolved via RESEARCH_MARKETS in src/lib/seoMarkets.ts (single source of truth).
 */

import { RESEARCH_MARKETS, resolveLocale } from '../../../src/lib/seoMarkets.ts';

export function mapMarketToLocation(market: string | null | undefined): number {
  const normalized = (market ?? 'global').toLowerCase().trim();
  if (!normalized || normalized === 'global') {
    return resolveLocale('us').locationCode;
  }
  const byCode = RESEARCH_MARKETS.find((m) => m.code === normalized);
  if (byCode) return byCode.loc.locationCode;
  return resolveLocale(normalized).locationCode;
}

const SUPPORTED_LANGS = new Set(['it', 'en', 'de', 'fr', 'es', 'pt', 'nl']);

export function mapLangToCode(code: string | null | undefined): string {
  const normalized = (code ?? 'en').toLowerCase().split('-')[0] ?? 'en';
  return SUPPORTED_LANGS.has(normalized) ? normalized : 'en';
}

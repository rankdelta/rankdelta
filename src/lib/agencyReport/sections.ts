/** Report section keys — mirror supabase/functions/_shared/reportBuild.ts */

export type SectionKey =
  | 'summary'
  | 'geo'
  | 'ai_attribution'
  | 'rankings'
  | 'gsc'
  | 'ga4'
  | 'site_health'
  | 'backlinks'

export const ALL_SECTION_KEYS: SectionKey[] = [
  'summary',
  'geo',
  'ai_attribution',
  'rankings',
  'gsc',
  'ga4',
  'site_health',
  'backlinks',
]

export const DEFAULT_ENABLED_SECTIONS: SectionKey[] = [...ALL_SECTION_KEYS]

export interface NullSectionShape {
  data: null
  reason: string
}

export function isNullSection(section: unknown): boolean {
  if (!section || typeof section !== 'object') return false
  const o = section as { data?: unknown; reason?: string }
  return o.data === null && typeof o.reason === 'string'
}

export function isConnectedSection<T>(section: T | NullSectionShape | undefined | null): section is T {
  return section != null && !isNullSection(section)
}
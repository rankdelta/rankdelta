/**
 * "Connected but nothing to show" detection for report sections.
 *
 * A disconnected source is a null-section and is handled elsewhere (hidden for clients, connect
 * prompt for the owner). This module covers the other dead end: the source IS connected but the
 * period produced nothing — zero referring domains, an audit with no score, GSC with no impressions.
 * Instead of three bare zeros the report renders a short note, dated from timestamps already in
 * `report.data` (`site_health.auditedAt`, `meta.builtAt`).
 */
import { isConnectedSection } from './sections'
import type {
  BacklinksSectionData,
  Ga4SectionData,
  GeoSectionData,
  GscSectionData,
  ReportData,
  SiteHealthSectionData,
} from './types'

export type EmptyGuidanceSection = 'geo' | 'gsc' | 'ga4' | 'site_health' | 'backlinks'

export const EMPTY_GUIDANCE_SECTIONS: readonly EmptyGuidanceSection[] = ['geo', 'gsc', 'ga4', 'site_health', 'backlinks']

/** The one KPI widget per section that carries the guidance note in the layout view. */
export const EMPTY_GUIDANCE_PRIMARY_METRIC: Record<EmptyGuidanceSection, string> = {
  geo: 'sovOverall',
  gsc: 'clicks',
  ga4: 'sessions',
  site_health: 'auditScore',
  backlinks: 'referringDomains',
}

export const SECTION_EMPTY_KEYS: Record<EmptyGuidanceSection, string> = {
  geo: 'agencyReport.emptyState.geo',
  gsc: 'agencyReport.emptyState.gsc',
  ga4: 'agencyReport.emptyState.ga4',
  site_health: 'agencyReport.emptyState.site_health',
  backlinks: 'agencyReport.emptyState.backlinks',
}

function zeroish(v: number | null | undefined): boolean {
  return v == null || v === 0
}

export function isEmptyGuidanceSection(section: string): section is EmptyGuidanceSection {
  return (EMPTY_GUIDANCE_SECTIONS as readonly string[]).includes(section)
}

/** True when the section is connected yet has nothing worth a KPI card for this period. */
export function connectedButEmpty(data: ReportData | null | undefined, section: EmptyGuidanceSection): boolean {
  if (!data) return false
  switch (section) {
    case 'backlinks': {
      const b = data.backlinks
      if (!isConnectedSection<BacklinksSectionData>(b)) return false
      return zeroish(b.referringDomains) && zeroish(b.new) && zeroish(b.lost)
    }
    case 'site_health': {
      const s = data.site_health
      if (!isConnectedSection<SiteHealthSectionData>(s)) return false
      return s.auditScore == null
    }
    case 'gsc': {
      const g = data.gsc
      if (!isConnectedSection<GscSectionData>(g)) return false
      return zeroish(g.clicks?.value) && zeroish(g.impressions?.value) && !(g.trend ?? []).some((d) => d.clicks > 0 || d.impressions > 0)
    }
    case 'ga4': {
      const g = data.ga4
      if (!isConnectedSection<Ga4SectionData>(g)) return false
      return zeroish(g.sessions?.value) && zeroish(g.users?.value) && !(g.trend ?? []).some((d) => d.sessions > 0)
    }
    case 'geo': {
      const g = data.geo
      if (!isConnectedSection<GeoSectionData>(g)) return false
      return g.sovOverall?.value == null && (g.trend ?? []).length === 0 && (g.sovByEngine ?? []).length === 0
    }
    default:
      return false
  }
}

/** ISO timestamp that best dates the empty state: the audit for site health, else the build time. */
export function emptyStateTimestamp(data: ReportData | null | undefined, section: EmptyGuidanceSection): string | null {
  if (!data) return null
  if (section === 'site_health' && isConnectedSection<SiteHealthSectionData>(data.site_health) && data.site_health.auditedAt) {
    return data.site_health.auditedAt
  }
  return data.meta?.builtAt ?? null
}

/** "10 Jun 2026" style date for guidance captions; null for unparseable input. */
export function fmtGuidanceDate(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

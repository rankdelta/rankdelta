/**
 * Contracts for report-build edge function (supabase/functions/report-build).
 */

import { describe, it, expect } from 'vitest'
import { checkNarrativeGrounding } from '../lib/reportBuild/narrative'
import { REPORT_SECTIONS } from '../../supabase/functions/_shared/reportBuild'
import {
  isValidShareToken,
  SHARED_REPORT_FORBIDDEN_FIELDS,
  SHARED_REPORT_PUBLIC_FIELDS,
} from '../../supabase/functions/_shared/reportShare'

describe('report-build API contracts', () => {
  it('defines all required report sections', () => {
    expect([...REPORT_SECTIONS]).toEqual([
      'summary',
      'geo',
      'ai_attribution',
      'rankings',
      'gsc',
      'ga4',
      'site_health',
      'backlinks',
    ])
  })

  it('client_reports select columns exclude user_id for share reads', () => {
    const ownerCols =
      'id, project_id, period_start, period_end, sections, data, narrative, share_token, branding, goals, created_at'
    expect(ownerCols).not.toContain('refresh_token')
    expect(ownerCols).not.toContain('user_id')
  })

  it('get_shared_report returns only public fields', () => {
    expect([...SHARED_REPORT_PUBLIC_FIELDS]).toEqual([
      'id',
      'project_id',
      'period_start',
      'period_end',
      'sections',
      'data',
      'narrative',
      'branding',
      'goals',
      'layout',
      'created_at',
    ])
    for (const field of SHARED_REPORT_FORBIDDEN_FIELDS) {
      expect(SHARED_REPORT_PUBLIC_FIELDS).not.toContain(field)
    }
  })

  it('isValidShareToken rejects short or blank tokens', () => {
    expect(isValidShareToken(null)).toBe(false)
    expect(isValidShareToken('')).toBe(false)
    expect(isValidShareToken('too-short')).toBe(false)
    expect(isValidShareToken(' sixteen-chars-ok')).toBe(true)
  })

  it('null sections use not_connected reason', () => {
    const nullSection = { data: null, reason: 'not_connected' }
    expect(nullSection.reason).toBe('not_connected')
  })

  it('narrative grounding rejects invented numbers', () => {
    const data = { summary: { healthScore: { value: 72 } } }
    const narrative = { executiveSummary: 'Sessions hit 5000.' }
    expect(checkNarrativeGrounding(narrative, data).grounded).toBe(false)
  })

  it('isValidShareToken rejects short or blank tokens', async () => {
    const { isValidShareToken } = await import('./reportBuild')
    expect(isValidShareToken(null)).toBe(false)
    expect(isValidShareToken('')).toBe(false)
    expect(isValidShareToken('too-short')).toBe(false)
    expect(isValidShareToken(' sixteen-chars-ok')).toBe(true)
  })
})

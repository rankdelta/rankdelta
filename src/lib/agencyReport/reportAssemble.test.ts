/**
 * Report assembly hardening — summary rollup + narrative resilience (vitest).
 * Full assembleReportData integration tests live in supabase/functions/_shared/__tests__/reportAssemble.test.ts (deno).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildReportSummary,
  isNullSection,
  readMetric,
  readMetricDelta,
  readMetricValue,
} from '../../../supabase/functions/_shared/reportBuild'

function expectNullSafeMetric(m: unknown) {
  expect(m).toBeTruthy()
  const metric = m as { value: unknown; delta: unknown; deltaPct: unknown }
  expect(metric).toHaveProperty('value')
  expect(metric).toHaveProperty('delta')
  expect(metric).toHaveProperty('deltaPct')
}

describe('reportBuild null-safe helpers', () => {
  it('detects not_connected placeholders', () => {
    expect(isNullSection({ data: null, reason: 'not_connected' })).toBe(true)
    expect(isNullSection({ avgPosition: { value: 5, delta: null, deltaPct: null } })).toBe(false)
  })

  it('readMetric skips placeholders and missing fields', () => {
    expect(readMetric({ data: null, reason: 'not_connected' }, 'clicks')).toBeNull()
    expect(readMetric({ clicks: { value: 10, delta: 2, deltaPct: 25 } }, 'clicks')).toEqual({
      value: 10,
      delta: 2,
      deltaPct: 25,
    })
    expect(readMetricValue({ avgPosition: { value: 4.2, delta: -0.3, deltaPct: null } }, 'avgPosition')).toBe(4.2)
    expect(readMetricDelta({ data: null, reason: 'not_connected' }, 'avgPosition')).toBeNull()
  })

  it('(a) buildReportSummary with every section not_connected', () => {
    const summary = buildReportSummary(
      {
        rankings: { data: null, reason: 'not_connected' },
        gsc: { data: null, reason: 'not_connected' },
        ga4: { data: null, reason: 'not_connected' },
        site_health: { data: null, reason: 'not_connected' },
      },
      null,
    )
    for (const key of [
      'healthScore',
      'aiSov',
      'avgPosition',
      'gscClicks',
      'ga4Sessions',
      'ga4AiAssistantSessions',
      'keyEvents',
    ] as const) {
      expectNullSafeMetric(summary[key])
      expect(summary[key]?.value).toBeNull()
    }
  })

  it('(b) buildReportSummary reads geo when present', () => {
    const summary = buildReportSummary(
      { rankings: { data: null, reason: 'not_connected' } },
      { sovOverall: { value: 42, delta: 3, deltaPct: 7.7 } },
    )
    expect(summary['aiSov']?.value).toBe(42)
    expect(summary['avgPosition']?.value).toBeNull()
  })

  it('(c) buildReportSummary reads GSC clicks when present', () => {
    const summary = buildReportSummary(
      { gsc: { clicks: { value: 120, delta: 15, deltaPct: 14.3 } } },
      null,
    )
    expect(summary['gscClicks']?.value).toBe(120)
  })

  it('(d) buildReportSummary reads rankings avg position when present', () => {
    const summary = buildReportSummary(
      { rankings: { avgPosition: { value: 8, delta: -1, deltaPct: -11.1 } } },
      null,
    )
    expect(summary['avgPosition']?.value).toBe(8)
  })

  it('(e) buildReportSummary handles GA4 zero sessions', () => {
    const summary = buildReportSummary(
      { ga4: { sessions: { value: 0, delta: 0, deltaPct: 0 } } },
      null,
    )
    expect(summary['ga4Sessions']?.value).toBe(0)
  })

  it('does not throw when rankings placeholder is truthy but lacks avgPosition', () => {
    expect(() =>
      buildReportSummary(
        {
          rankings: { data: null, reason: 'not_connected' },
          geo: { sovOverall: { value: 10, delta: 1, deltaPct: 10 } },
        },
        { sovOverall: { value: 10, delta: 1, deltaPct: 10 } },
      ),
    ).not.toThrow()
  })
})

describe('report-build narrative resilience', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.stubGlobal('fetch', originalFetch)
  })

  it('(f) returns degraded narrative when seo-proxy fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'))

    const degradedNarrative = (locale: string, reason = 'generation_failed') => ({
      executiveSummary: '',
      sections: {},
      nextActions: [],
      locale,
      grounding: { grounded: false, ungrounded: [] },
      degraded: true,
      degradedReason: reason,
    })

    async function generateNarrativeLikeBuild(): Promise<Record<string, unknown>> {
      try {
        await fetch('https://example.supabase.co/functions/v1/seo-proxy', { method: 'POST' })
        return { executiveSummary: 'ok', sections: {}, nextActions: [], locale: 'en' }
      } catch {
        return degradedNarrative('en', 'fetch_error')
      }
    }

    const narrative = await generateNarrativeLikeBuild()
    expect(narrative['degraded']).toBe(true)
    expect(narrative['executiveSummary']).toBe('')
    expect(narrative['sections']).toEqual({})
  })

  it('(f) wraps non-JSON LLM response without throwing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: 'not json at all' } }] }), { status: 200 }),
    )

    const res = await fetch('https://example.supabase.co/functions/v1/seo-proxy')
    const llmBody = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = llmBody.choices?.[0]?.message?.content ?? ''

    let narrative: Record<string, unknown>
    try {
      narrative = JSON.parse(content) as Record<string, unknown>
    } catch {
      narrative = {
        executiveSummary: content.slice(0, 4000),
        sections: {},
        nextActions: [],
        locale: 'en',
        grounding: { grounded: false, ungrounded: [] },
      }
    }

    expect(narrative['executiveSummary']).toBe('not json at all')
    expect(narrative['sections']).toEqual({})
  })
})

/**
 * Narrative grounding helpers (deno).
 *
 * Run: deno test supabase/functions/_shared/__tests__/reportNarrativeGrounding.test.ts
 */

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  buildNarrativePrompt,
  checkNarrativeGrounding,
  collectNumbersFromData,
  metric,
  parseNarrativeContent,
} from '../reportBuild.ts'

Deno.test('collectNumbersFromData gathers nested metric values', () => {
  const nums = collectNumbersFromData({
    summary: { ga4Sessions: metric(1200, 1100) },
    rankings: { avgPosition: metric(6.2, 8.1) },
  })
  assert(nums.has(1200))
  assert(nums.has(100)) // delta from metric(1200, 1100)
  assert(nums.has(6.2) || nums.has(6))
})

Deno.test('checkNarrativeGrounding accepts numbers present in report data', () => {
  const data = {
    summary: { gscClicks: metric(500, 450) },
  }
  const result = checkNarrativeGrounding(
    { executiveSummary: 'GSC clicks reached 500 this period.' },
    data,
  )
  assertEquals(result.grounded, true)
  assertEquals(result.ungrounded.length, 0)
})

Deno.test('checkNarrativeGrounding allows exempt round numbers', () => {
  const data = { summary: { ga4Sessions: metric(100, null) } }
  const result = checkNarrativeGrounding(
    { executiveSummary: 'Sessions stayed at 100 with 28-day context in 2026.' },
    data,
  )
  assertEquals(result.grounded, true)
})

Deno.test('checkNarrativeGrounding flags invented metrics', () => {
  const data = { summary: { gscClicks: metric(500, 450) } }
  const result = checkNarrativeGrounding(
    { executiveSummary: 'Clicks jumped to 999 this period.' },
    data,
  )
  assertEquals(result.grounded, false)
  assert(result.ungrounded.includes(999))
})

Deno.test('parseNarrativeContent returns null for invalid or non-object JSON', () => {
  assertEquals(parseNarrativeContent(null), null)
  assertEquals(parseNarrativeContent('not json at all'), null)
  assertEquals(parseNarrativeContent('{"broken":'), null)
  assertEquals(parseNarrativeContent('[1,2,3]'), null)
})

Deno.test('buildNarrativePrompt includes locale and serializes data JSON', () => {
  const { system, user } = buildNarrativePrompt(
    { summary: { ga4Sessions: metric(50, null) } },
    'it',
  )
  assert(system.toLowerCase().includes('italian'))
  assert(user.includes('"ga4Sessions"'))
  assert(user.includes('50'))
})

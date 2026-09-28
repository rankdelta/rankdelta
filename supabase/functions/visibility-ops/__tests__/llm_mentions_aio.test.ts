/**
 * parseAioResponse — DataForSEO SERP responses for Google AI Overviews (deno).
 * Shapes follow what production stored: 40106 partial results still carry the AI Overview;
 * 40101 is a transient engine error worth one retry.
 */
import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { parseAioResponse } from '../llm_mentions.ts'

const serp = (code: number, message: string, items: unknown[] | null) => ({
  tasks: [{ status_code: code, status_message: message, cost: 0.002, result: items === null ? null : [{ items }] }],
})
const aioItem = {
  type: 'ai_overview',
  items: [{ text: 'Pour-over kits from Brewcraft are a common pick.' }],
  references: [{ url: 'https://www.coffee.example/kits', domain: 'www.coffee.example', title: 'Kits' }],
}

Deno.test('20000 with an AI Overview: answer text and cited sources', () => {
  const r = parseAioResponse(serp(20000, 'Ok.', [{ type: 'organic' }, aioItem]), true)
  assert(r.ok)
  assertEquals(r.cited.length, 1)
  assertEquals(r.cited[0].domain, 'www.coffee.example')
  assertEquals(r.costUsd, 0.002)
})

Deno.test('40106 partial results that include the AI Overview are read, not failed', () => {
  const r = parseAioResponse(serp(40106, 'Task completed with partial results.', [{ type: 'organic' }, aioItem]), true)
  assert(r.ok)
  assertEquals(r.cited.length, 1)
  assertFalse(r.retryable)
})

Deno.test('20000 without an AI Overview: a completed run with no answer', () => {
  const r = parseAioResponse(serp(20000, 'Ok.', [{ type: 'organic' }]), true)
  assert(r.ok)
  assertEquals(r.answerText, '')
  assertEquals(r.cited, [])
})

Deno.test('40101 internal engine error: failed and retryable, cost kept', () => {
  const r = parseAioResponse(serp(40101, 'Internal SE Server Error.', null), true)
  assertFalse(r.ok)
  assert(r.retryable)
  assertEquals(r.costUsd, 0.002)
  assertEquals(r.errorMessage, 'Internal SE Server Error.')
})

Deno.test('40106 with no items is still a failure, and not retried', () => {
  const r = parseAioResponse(serp(40106, 'Task completed with partial results.', []), true)
  assertFalse(r.ok)
  assertFalse(r.retryable)
})

// Production 28/09: 18 of 20 AI Overview runs came back like this (no load_async_ai_overview) and
// were stored as completed runs with an empty answer, i.e. "AI Overviews does not mention the brand".
Deno.test('an AI Overview whose content was not loaded is a failed run, not an empty answer', () => {
  const unloaded = { type: 'ai_overview', asynchronous_ai_overview: true, items: null, markdown: null, references: null }
  const r = parseAioResponse(serp(20000, 'Ok.', [{ type: 'organic' }, unloaded]), true)
  assertFalse(r.ok)
  assertFalse(r.retryable)
  assertEquals(r.errorMessage, 'AI Overview shown but its content was not loaded')
  assertEquals(r.costUsd, 0.002)
})

Deno.test('an AI Overview with only markdown still yields the answer text', () => {
  const md = { type: 'ai_overview', asynchronous_ai_overview: true, items: null, markdown: 'Brewcraft kits are popular.', references: [] }
  const r = parseAioResponse(serp(20000, 'Ok.', [md]), true)
  assert(r.ok)
  assertEquals(r.answerText, 'Brewcraft kits are popular.')
})

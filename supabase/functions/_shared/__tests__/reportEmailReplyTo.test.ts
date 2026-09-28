/**
 * sendScheduledReportEmail — the client's reply goes to the agency (reply_to), never breaks a send.
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/reportEmailReplyTo.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { sendScheduledReportEmail } from '../reportEmail.ts'

const summary = { projectName: 'Acme', periodStart: '2026-08-27', periodEnd: '2026-09-23', aiSov: 10 }

async function capture(replyTo: string | null | undefined): Promise<Record<string, unknown>> {
  Deno.env.set('RESEND_API_KEY', 're_test')
  Deno.env.set('RESEND_FROM', 'Rankdelta <hello@rankdelta.ai>')
  const original = globalThis.fetch
  let body: Record<string, unknown> = {}
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? '{}'))
    return Promise.resolve(new Response('{"id":"x"}', { status: 200 }))
  }) as typeof fetch
  try {
    const res = await sendScheduledReportEmail('client@example.com', 'en', summary, 'https://rankdelta.ai/r/t', null, replyTo)
    assertEquals(res.ok, true)
  } finally {
    globalThis.fetch = original
  }
  return body
}

Deno.test('sets reply_to to the agency owner', async () => {
  const body = await capture('owner@agency.com')
  assertEquals(body.reply_to, 'owner@agency.com')
  assertEquals(body.to, ['client@example.com'])
})

Deno.test('omits reply_to when missing or malformed', async () => {
  assertEquals('reply_to' in (await capture(null)), false)
  assertEquals('reply_to' in (await capture('not-an-email')), false)
})

// ── From: the agency's name in the client's inbox ─────────────────────────────────────────────

import { reportFromHeader } from '../reportEmail.ts'

Deno.test('the client sees the agency as sender, on Rankdelta\'s verified address', () => {
  const from = 'Rankdelta <hello@rankdelta.ai>'
  assertEquals(reportFromHeader(from, { agencyName: 'Northwind Agency' }), '"Northwind Agency via Rankdelta" <hello@rankdelta.ai>')
  assertEquals(reportFromHeader(from, { agencyName: 'Northwind Agency', hideAstroSeoFooter: true }), '"Northwind Agency" <hello@rankdelta.ai>')
  assertEquals(reportFromHeader('hello@rankdelta.ai', { agencyName: 'Northwind' }), '"Northwind via Rankdelta" <hello@rankdelta.ai>')
})

Deno.test('no agency name (or no agency plan): the configured sender, unchanged', () => {
  assertEquals(reportFromHeader('Rankdelta <hello@rankdelta.ai>', null), 'Rankdelta <hello@rankdelta.ai>')
  assertEquals(reportFromHeader('Rankdelta <hello@rankdelta.ai>', { agencyName: '   ' }), 'Rankdelta <hello@rankdelta.ai>')
})

Deno.test('an agency name cannot inject headers or break out of the quoted name', () => {
  const header = reportFromHeader('Rankdelta <hello@rankdelta.ai>', { agencyName: 'Evil"\r\nBcc: x@y.z <a@b.c>', hideAstroSeoFooter: true })
  assertEquals(header, '"Evil Bcc: x@y.z a@b.c" <hello@rankdelta.ai>')
  assertEquals(/[\r\n]/.test(header), false)
})

Deno.test('the send uses the agency sender', async () => {
  Deno.env.set('RESEND_API_KEY', 're_test')
  Deno.env.set('RESEND_FROM', 'Rankdelta <hello@rankdelta.ai>')
  const original = globalThis.fetch
  let body: Record<string, unknown> = {}
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? '{}'))
    return Promise.resolve(new Response('{"id":"x"}', { status: 200 }))
  }) as typeof fetch
  try {
    await sendScheduledReportEmail('client@example.com', 'en', summary, 'https://rankdelta.ai/r/t', { agencyName: 'Northwind' })
  } finally {
    globalThis.fetch = original
  }
  assertEquals(body.from, '"Northwind via Rankdelta" <hello@rankdelta.ai>')
})

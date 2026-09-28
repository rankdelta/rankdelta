/**
 * Scheduled report email helpers (deno).
 *
 * Run: deno test supabase/functions/_shared/__tests__/reportEmail.test.ts
 */

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { nullSection, metric } from '../reportBuild.ts'
import {
  buildScheduledReportEmail,
  extractReportEmailSummary,
  firstSentence,
  formatEmailPeriod,
  parseReportEmailRecipients,
  sanitizeReportEmailBranding,
} from '../reportEmail.ts'

Deno.test('parseReportEmailRecipients normalizes and filters invalid emails', () => {
  assertEquals(
    parseReportEmailRecipients(['  Alice@Example.COM ', 'not-an-email', '', 42, 'bob@test.org']),
    ['alice@example.com', 'bob@test.org'],
  )
  assertEquals(parseReportEmailRecipients(null), [])
})

Deno.test('extractReportEmailSummary reads summary KPIs, movements and the narrative headline', () => {
  const summary = extractReportEmailSummary(
    {
      summary: {
        aiSov: metric(33.3, 28),
        avgPosition: metric(6, 8),
        gscClicks: metric(500, 450),
        ga4Sessions: metric(1200, 1100),
        healthScore: metric(72, null),
      },
    },
    'Acme Corp',
    '2026-02-01',
    '2026-02-28',
    {
      executiveSummary: 'Share of voice rose to 33% this month. Clicks followed. More text here.',
      nextActions: ['Fix the 12 pages with thin content first. Then move on.', 'Second action'],
    },
  )
  assertEquals(summary.projectName, 'Acme Corp')
  assertEquals(summary.aiSov, 33.3)
  assertEquals(Math.round((summary.aiSovDelta ?? 0) * 10) / 10, 5.3)
  assertEquals(summary.avgPositionDelta, -2)
  assertEquals(summary.gscClicksDeltaPct, 11.1)
  assertEquals(summary.healthScore, 72)
  assertEquals(summary.healthScoreDelta, null) // first reading → no movement
  assertEquals(summary.headline, 'Share of voice rose to 33% this month.')
  assertEquals(summary.nextAction, 'Fix the 12 pages with thin content first.')
})

Deno.test('extractReportEmailSummary is null-safe for disconnected sections and no narrative', () => {
  const summary = extractReportEmailSummary(
    {
      summary: {
        aiSov: metric(null, null),
        avgPosition: metric(null, null),
        gscClicks: metric(null, null),
        ga4Sessions: metric(null, null),
      },
      site_health: nullSection('not_connected'),
    },
    'Acme',
    '2026-02-01',
    '2026-02-28',
  )
  assertEquals(summary.aiSov, null)
  assertEquals(summary.healthScore, null)
  assertEquals(summary.headline, null)
  assertEquals(summary.nextAction, null)
})

Deno.test('extractReportEmailSummary treats the legacy first-reading shape as no movement', () => {
  // Snapshots from before computeDelta's fix: missing prior stored as delta === value, deltaPct === 100.
  const summary = extractReportEmailSummary(
    {
      summary: {
        aiSov: { value: 27.4, delta: 27.4, deltaPct: 100 },
        gscClicks: { value: 1234, delta: 1234, deltaPct: 100 },
        healthScore: { value: 86, delta: null, deltaPct: null },
        avgPosition: metric(null, null),
        ga4Sessions: metric(null, null),
      },
    },
    'Harborstay',
    '2026-08-23',
    '2026-09-21',
    { executiveSummary: '', nextActions: [] },
  )
  assertEquals(summary.aiSov, 27.4)
  assertEquals(summary.aiSovDelta, null)
  assertEquals(summary.gscClicksDeltaPct, null)
  assertEquals(summary.firstReading, true)
  const { html } = buildScheduledReportEmail('it', summary, 'https://rankdelta.ai/r/abc', null)
  assert(!html.includes('▲'))
  assert(!/[▲▼] 100/.test(html))
  assert(html.includes('Primo report: i confronti con il periodo precedente compaiono dal prossimo.'))
})

Deno.test('extractReportEmailSummary drops a connected-but-empty Search Console / GA4 instead of printing 0', () => {
  const summary = extractReportEmailSummary(
    {
      summary: {
        aiSov: metric(40, 38),
        gscClicks: metric(0, 0),
        ga4Sessions: metric(0, 0),
        avgPosition: metric(null, null),
        healthScore: metric(null, null),
      },
      gsc: { clicks: metric(0, 0), impressions: metric(0, 0), trend: [] },
      ga4: { sessions: metric(0, 0), users: metric(0, 0), trend: [] },
    },
    'Acme',
    '2026-02-01',
    '2026-02-28',
  )
  assertEquals(summary.gscClicks, null)
  assertEquals(summary.ga4Sessions, null)
  assertEquals(summary.firstReading, false) // share of voice does carry a prior period
  const { html } = buildScheduledReportEmail('en', summary, 'https://rankdelta.ai/r/abc', null)
  assert(!html.includes('Clicks from Google'))
  assert(!html.includes('Website sessions'))
  assert(html.includes('AI share of voice'))
  assert(!html.includes('First report:'))
})

Deno.test('buildScheduledReportEmail never names a disconnected source', () => {
  const summary = extractReportEmailSummary(
    {
      summary: { aiSov: metric(27.4, null), healthScore: metric(86, null), avgPosition: metric(null, null), gscClicks: metric(null, null), ga4Sessions: metric(null, null) },
      gsc: nullSection('not_connected'),
      ga4: nullSection('not_connected'),
      rankings: nullSection('not_connected'),
    },
    'Harborstay',
    '2026-08-23',
    '2026-09-21',
    { executiveSummary: 'Harborstay detiene una share of voice del 27,4%.', nextActions: ['Ampliare le pagine con poco testo.'] },
  )
  const { html, subject } = buildScheduledReportEmail('it', summary, 'https://rankdelta.ai/r/abc', { agencyName: 'Northwind Agency', hideAstroSeoFooter: true })
  assertEquals(subject, 'Harborstay · Report SEO e visibilità AI · 23 ago – 21 set 2026')
  for (const forbidden of ['Google', 'Sessioni', 'Posizione media', 'Powered by', 'Clicks', 'Sessions', 'undefined', 'null']) {
    assert(!html.includes(forbidden), `email must not contain "${forbidden}"`)
  }
  assert(html.includes('27,4%'))
  assert(html.includes('86/100'))
  assert(html.includes('Primo report'))
  assert(html.includes('preparato da Northwind Agency'))
})

Deno.test('firstSentence trims to one sentence and caps length', () => {
  assertEquals(firstSentence('  Hello  world. Second one.'), 'Hello world.')
  assertEquals(firstSentence('No terminator here'), 'No terminator here')
  assertEquals(firstSentence(''), null)
  assertEquals(firstSentence(42), null)
  const long = firstSentence(`${'a'.repeat(300)}.`, 50)
  assert(long && long.length <= 50 && long.endsWith('…'))
})

Deno.test('formatEmailPeriod renders human dates per locale, ISO on bad input', () => {
  assertEquals(formatEmailPeriod('2026-08-16', '2026-09-14', 'it'), '16 ago – 14 set 2026')
  assertEquals(formatEmailPeriod('2026-08-16', '2026-09-14', 'en'), 'Aug 16 – Sep 14, 2026')
  assertEquals(formatEmailPeriod('2025-12-16', '2026-01-14', 'en'), 'Dec 16, 2025 – Jan 14, 2026')
  assertEquals(formatEmailPeriod('nope', '2026-01-14', 'en'), 'nope – 2026-01-14')
})

Deno.test('buildScheduledReportEmail escapes HTML in project name', () => {
  const { html, subject } = buildScheduledReportEmail(
    'en',
    {
      projectName: '<script>alert(1)</script>',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      aiSov: 40,
    },
    'https://rankdelta.ai/share/abc',
    null,
  )
  assert(html.includes('&lt;script&gt;'))
  assert(!html.includes('<script>alert'))
  assert(subject.includes('<script>'))
})

Deno.test('buildScheduledReportEmail applies agency branding and hides powered-by footer', () => {
  const { html } = buildScheduledReportEmail(
    'en',
    {
      projectName: 'Acme',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
    },
    'https://rankdelta.ai/share/abc',
    {
      agencyName: 'Acme Agency',
      logoUrl: 'https://cdn.example.com/logo.png',
      primaryColor: '#ff5500',
      hideAstroSeoFooter: true,
    },
  )
  assert(html.includes('Acme Agency'))
  assert(html.includes('prepared by Acme Agency'))
  assert(html.includes('https://cdn.example.com/logo.png'))
  assert(html.includes('#ff5500'))
  assert(!html.includes('Powered by Rankdelta'))
})

Deno.test('sanitizeReportEmailBranding rejects CSS injection and non-http logos', () => {
  const safe = sanitizeReportEmailBranding({
    primaryColor: '#7c3aed; background:url(https://evil.example/x)',
    logoUrl: 'javascript:alert(1)',
  })
  assertEquals(safe.primaryColor, '#7c3aed')
  assertEquals(safe.logoUrl, null)
})

Deno.test('buildScheduledReportEmail does not emit injected CSS or javascript logos', () => {
  const { html } = buildScheduledReportEmail(
    'en',
    {
      projectName: 'Acme',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
    },
    'javascript:alert(1)',
    {
      primaryColor: '#fff;color:red',
      logoUrl: 'javascript:alert(1)',
    },
  )
  assert(!html.includes('javascript:'))
  assert(!html.includes('color:red'))
  assert(html.includes('background:#7c3aed'))
})

Deno.test('buildScheduledReportEmail uses Italian copy, human period and movement chips', () => {
  const { subject, html } = buildScheduledReportEmail(
    'it',
    {
      projectName: 'Cliente',
      periodStart: '2026-08-16',
      periodEnd: '2026-09-14',
      aiSov: 85.3,
      aiSovDelta: 3.2,
      avgPosition: 7.7,
      avgPositionDelta: -0.4,
      gscClicks: 12345,
      gscClicksDeltaPct: -12.5,
      ga4Sessions: 4567,
      healthScore: 51,
      headline: 'Il primo mese registra una share of voice dell’85%.',
      nextAction: 'Rendere citabili le 5 pagine senza schema.',
    },
    'https://rankdelta.ai/r/abc',
    { agencyName: 'Studio Rossi' },
  )
  assertEquals(subject, 'Cliente · Report SEO e visibilità AI · 16 ago – 14 set 2026')
  assert(html.includes('Apri il report completo'))
  assert(html.includes('preparato da Studio Rossi'))
  assert(html.includes('In breve'))
  assert(html.includes('Prossimo passo'))
  assert(html.includes('85,3%'))
  assert(html.includes('▲ 3,2 pt'))
  assert(html.includes('#7,7'))
  assert(html.includes('▲ 0,4 posizioni')) // lower position = improvement
  assert(html.includes('12.345')) // it-IT groups from 5 digits (CLDR minimumGroupingDigits)
  assert(html.includes('▼ 12,5%'))
  assert(html.includes('51/100'))
  assert(html.includes('Powered by Rankdelta'))
})

Deno.test('buildScheduledReportEmail shows no movement chip on a first reading', () => {
  const { html } = buildScheduledReportEmail(
    'en',
    { projectName: 'Acme', periodStart: '2026-02-01', periodEnd: '2026-02-28', aiSov: 40, aiSovDelta: null },
    'https://rankdelta.ai/r/abc',
    null,
  )
  assert(html.includes('40%'))
  assert(!html.includes('▲'))
  assert(!html.includes('▼'))
})

Deno.test('buildScheduledReportEmail: a quote in the logo URL cannot open a new attribute on <img>', () => {
  const { html } = buildScheduledReportEmail(
    'en',
    { projectName: "O'Brien & Co", periodStart: '2026-08-01', periodEnd: '2026-08-31', aiSov: 10 },
    'https://rankdelta.ai/r/tok',
    { agencyName: 'Northwind', logoUrl: 'https://cdn.example/logo.png" onerror="alert(1)' },
  )
  assert(!html.includes('" onerror="'))
  assert(html.includes('logo.png&quot; onerror=&quot;alert(1)'))
  assert(html.includes('O&#39;Brien &amp; Co'))
})

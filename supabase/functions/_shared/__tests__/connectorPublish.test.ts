/**
 * connectorPublish (deno) — publish-loop rules for the WordPress / Shopify / PrestaShop connectors:
 * no duplicate live posts, articles in the shop language, no raw model output on the queue.
 *
 * Run: deno test --allow-net --allow-env --allow-read --no-check supabase/functions/_shared/__tests__/connectorPublish.test.ts
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  articleLanguageName,
  decidePublished,
  parseArticleCompletion,
  readyArticleAction,
  refreshReviewMetadata,
  reviewDraftBody,
} from '../connectorPublish.ts'

Deno.test('readyArticleAction: update when the article already has a live post', () => {
  assertEquals(readyArticleAction('123'), 'update')
  assertEquals(readyArticleAction(null), 'create')
  assertEquals(readyArticleAction(''), 'create')
  assertEquals(readyArticleAction('   '), 'create')
  assertEquals(readyArticleAction(undefined), 'create')
})

const report = { externalId: '42', externalUrl: 'https://shop.test/blogs/news/a', isNewPost: false }

Deno.test('decidePublished: first publish records what the plugin reported', () => {
  assertEquals(
    decidePublished({ publish_state: 'ready_to_publish', external_id: null, external_url: null }, report),
    { kind: 'record', externalId: '42', externalUrl: 'https://shop.test/blogs/news/a', keptOriginal: false },
  )
})

Deno.test('decidePublished: a repeated call for a published article changes nothing', () => {
  const d = decidePublished(
    { publish_state: 'published', external_id: '42', external_url: 'https://shop.test/blogs/news/a' },
    report,
  )
  assertEquals(d, { kind: 'already_published', externalId: '42', externalUrl: 'https://shop.test/blogs/news/a' })
  // Even a different id on an already-published row does not swap the stored post.
  const other = decidePublished(
    { publish_state: 'published', external_id: '42', external_url: 'https://shop.test/a' },
    { externalId: '99', externalUrl: 'https://shop.test/b', isNewPost: true },
  )
  assertEquals(other.kind, 'already_published')
  assertEquals(other.externalId, '42')
})

Deno.test('decidePublished: legacy published row without external id gets it filled in', () => {
  const d = decidePublished({ publish_state: 'published', external_id: null, external_url: null }, report)
  assertEquals(d.kind, 'record')
  assertEquals(d.externalId, '42')
})

Deno.test('decidePublished: refresh reported with a different post id keeps the original', () => {
  const d = decidePublished(
    { publish_state: 'ready_to_publish', external_id: '7', external_url: 'https://shop.test/original' },
    report,
  )
  assertEquals(d, { kind: 'record', externalId: '7', externalUrl: 'https://shop.test/original', keptOriginal: true })
})

Deno.test('decidePublished: explicit new_post replaces the stored post', () => {
  const d = decidePublished(
    { publish_state: 'ready_to_publish', external_id: '7', external_url: 'https://shop.test/original' },
    { ...report, isNewPost: true },
  )
  assertEquals(d, { kind: 'record', externalId: '42', externalUrl: 'https://shop.test/blogs/news/a', keptOriginal: false })
})

Deno.test('decidePublished: same post with a new URL (slug change) records the new URL', () => {
  const d = decidePublished(
    { publish_state: 'ready_to_publish', external_id: '42', external_url: 'https://shop.test/old-slug' },
    report,
  )
  assertEquals(d, { kind: 'record', externalId: '42', externalUrl: 'https://shop.test/blogs/news/a', keptOriginal: false })
})

Deno.test('parseArticleCompletion: valid JSON is sanitized and accepted', () => {
  const r = parseArticleCompletion(
    'Sure! {"title":"Best dog food","html":"<h2>Why</h2><p>Because.</p><script>alert(1)</script>"}',
    'dog food',
  )
  assertEquals(r.kind, 'ok')
  if (r.kind === 'ok') {
    assertEquals(r.title, 'Best dog food')
    assert(r.html.includes('<h2>Why</h2>'))
    assert(!r.html.includes('<script'))
  }
})

Deno.test('parseArticleCompletion: missing title falls back to the keyword', () => {
  const r = parseArticleCompletion('{"html":"<p>Body</p>"}', 'kw')
  assertEquals(r.kind === 'ok' && r.title, 'kw')
})

Deno.test('parseArticleCompletion: raw prose is never accepted as an article', () => {
  assertEquals(parseArticleCompletion('Here is your article about dog food. It is great.', 'dog food'), {
    kind: 'needs_review',
    reason: 'llm_output_not_json',
  })
})

Deno.test('parseArticleCompletion: truncated JSON is flagged as truncated', () => {
  assertEquals(parseArticleCompletion('{"title":"T","html":"<p>cut off mid', 'kw', 'length'), {
    kind: 'needs_review',
    reason: 'llm_output_truncated',
  })
  assertEquals(parseArticleCompletion('{"title":"T","html":"<p>cut off mid', 'kw', 'stop'), {
    kind: 'needs_review',
    reason: 'llm_output_not_json',
  })
})

Deno.test('parseArticleCompletion: empty text or empty html is an error, not an article', () => {
  assertEquals(parseArticleCompletion('   ', 'kw'), { kind: 'empty' })
  assertEquals(parseArticleCompletion('{"title":"T","html":""}', 'kw'), { kind: 'empty' })
  assertEquals(parseArticleCompletion('{"title":"T"}', 'kw'), { kind: 'empty' })
})

Deno.test('reviewDraftBody: escapes markup so a draft cannot carry live HTML', () => {
  assertEquals(reviewDraftBody('<script>x</script> & <b>'), '<pre>&lt;script&gt;x&lt;/script&gt; &amp; &lt;b&gt;</pre>')
})

Deno.test('refreshReviewMetadata: keeps existing metadata and adds the marker', () => {
  assertEquals(refreshReviewMetadata({ html: '<p>live</p>', moneyUrl: 'u' }, 'llm_output_not_json', 'T'), {
    html: '<p>live</p>',
    moneyUrl: 'u',
    refresh_needs_review: { reason: 'llm_output_not_json', at: 'T' },
  })
  assertEquals(refreshReviewMetadata(null, 'r', 'T'), { refresh_needs_review: { reason: 'r', at: 'T' } })
})

Deno.test('articleLanguageName: shop language for the prompt, English by default', () => {
  assertEquals(articleLanguageName('it'), 'Italian')
  assertEquals(articleLanguageName('en'), 'English')
  assertEquals(articleLanguageName('de'), 'German')
  assertEquals(articleLanguageName('it_IT'), 'Italian (Italy)')
  assertEquals(articleLanguageName('Italian'), 'Italian')
  assertEquals(articleLanguageName(''), 'English')
  assertEquals(articleLanguageName(null), 'English')
  assertEquals(articleLanguageName(undefined), 'English')
  assertEquals(articleLanguageName('??'), 'English')
})

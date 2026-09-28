/**
 * extractCitations — both OpenRouter citation shapes (deno).
 *
 * Run: deno test --allow-env --no-check supabase/functions/visibility-ops/__tests__/llm_mentions_citations.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { extractCitations } from '../llm_mentions.ts'

Deno.test('reads OpenRouter message.annotations url_citation entries (the live Perplexity shape)', () => {
  const j = {
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'Tra i nomi che emergono ci sono Staynest e Harborstay.',
          annotations: [
            { type: 'url_citation', url_citation: { url: 'https://staynest.example/gestione-case-vacanza/', title: 'Gestione case vacanza', start_index: 0, end_index: 0 } },
            { type: 'url_citation', url_citation: { url: 'https://www.harborstay.example/', title: 'Harborstay' } },
            { type: 'url_citation', url_citation: { url: 'https://www.harborstay.example/', title: 'duplicate' } },
            { type: 'file_citation', file_citation: { id: 'x' } },
          ],
        },
      },
    ],
  }
  const cited = extractCitations(j)
  assertEquals(cited.length, 2)
  assertEquals(cited[0], { url: 'https://staynest.example/gestione-case-vacanza/', domain: 'staynest.example', title: 'Gestione case vacanza', snippet: null })
  assertEquals(cited[1]?.domain, 'harborstay.example')
})

Deno.test('still reads the legacy top-level citations array (strings or {url})', () => {
  const j = { citations: ['https://a.example/x', { url: 'https://b.example/y', title: 'B' }, 42, ''] }
  const cited = extractCitations(j)
  assertEquals(cited.map((c) => c.domain), ['a.example', 'b.example'])
  assertEquals(cited[1]?.title, 'B')
})

Deno.test('merges both shapes without duplicates and tolerates missing fields', () => {
  const j = {
    citations: ['https://a.example/x'],
    choices: [{ message: { annotations: [{ type: 'url_citation', url_citation: { url: 'https://a.example/x' } }, { type: 'url_citation', url_citation: {} }] } }],
  }
  assertEquals(extractCitations(j).length, 1)
  assertEquals(extractCitations({}), [])
  assertEquals(extractCitations({ choices: [] }), [])
})

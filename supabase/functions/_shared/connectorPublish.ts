/**
 * Pure decisions for the connector publish loop:
 *   generate/refresh → content row (ready_to_publish) → GET /v1/articles/ready → plugin creates or
 *   updates the post on the customer site → POST /v1/articles/:id/published.
 *
 * Kept free of DB/network calls so the rules that prevent duplicate live posts and raw model output
 * from being published are unit-tested (see __tests__/connectorPublish.test.ts).
 */
import { sanitizeShopifyArticleHtml } from './connector.ts'

export type ReadyAction = 'create' | 'update'

/**
 * Hint for plugins on GET /v1/articles/ready: an article that already has an external post id
 * (a refreshed, previously published article) must UPDATE that post, not create a second one.
 */
export function readyArticleAction(externalId: unknown): ReadyAction {
  return typeof externalId === 'string' && externalId.trim() ? 'update' : 'create'
}

export type PublishedRowState = {
  publish_state: string | null
  external_id: string | null
  external_url: string | null
}

export type PublishedReport = {
  externalId: string
  externalUrl: string
  /** Plugin explicitly says it created a brand-new post that should replace the stored one. */
  isNewPost: boolean
}

export type PublishedDecision =
  /** Repeated call for an article that is already published: answer ok, change nothing. */
  | { kind: 'already_published'; externalId: string; externalUrl: string }
  /** Mark the row published with these external ids. */
  | { kind: 'record'; externalId: string; externalUrl: string; keptOriginal: boolean }

/**
 * Decide what POST /v1/articles/:id/published does with the plugin's report.
 *
 * - Already published with a stored external id → idempotent no-op (plugins retry on timeouts,
 *   and a retry must not bump published_date, re-log activity or swap the post id).
 * - A stored external id that differs from the reported one (typically a refresh handled by an
 *   older plugin that created a second post instead of updating) → KEEP THE ORIGINAL id/url.
 *   The original post is the one already indexed, linked from llms.txt and tracked for ranks;
 *   overwriting it would orphan that post and make the next refresh target the duplicate.
 *   The plugin can opt in to replacing it by sending `new_post: true` (e.g. the merchant deleted
 *   the original post).
 * - Otherwise record what the plugin reported (first publish, same post, or a changed URL/slug).
 */
export function decidePublished(row: PublishedRowState, report: PublishedReport): PublishedDecision {
  const storedId = typeof row.external_id === 'string' ? row.external_id.trim() : ''
  const storedUrl = typeof row.external_url === 'string' ? row.external_url : ''
  if (row.publish_state === 'published' && storedId) {
    return { kind: 'already_published', externalId: storedId, externalUrl: storedUrl || report.externalUrl }
  }
  if (storedId && storedId !== report.externalId && !report.isNewPost) {
    return {
      kind: 'record',
      externalId: storedId,
      externalUrl: storedUrl || report.externalUrl,
      keptOriginal: true,
    }
  }
  return { kind: 'record', externalId: report.externalId, externalUrl: report.externalUrl, keptOriginal: false }
}

export type ArticleCompletion =
  | { kind: 'ok'; title: string; html: string }
  | { kind: 'empty' }
  /** Model text that is not the requested JSON (or was cut off): never publishable as-is. */
  | { kind: 'needs_review'; reason: 'llm_output_not_json' | 'llm_output_truncated' }

/**
 * Parse the model's `{"title","html"}` answer. Anything that is not valid JSON with html is NOT
 * wrapped and queued any more: it is reported as needs_review so callers keep it off the publish
 * queue.
 */
export function parseArticleCompletion(
  text: string,
  keyword: string,
  finishReason?: string | null,
): ArticleCompletion {
  if (!text.trim()) return { kind: 'empty' }
  const match = text.match(/\{[\s\S]*\}/)
  let parsed: { title?: unknown; html?: unknown } | null = null
  try {
    const value = JSON.parse(match?.[0] || text)
    parsed = value && typeof value === 'object' ? (value as { title?: unknown; html?: unknown }) : null
  } catch {
    parsed = null
  }
  if (!parsed) {
    return { kind: 'needs_review', reason: finishReason === 'length' ? 'llm_output_truncated' : 'llm_output_not_json' }
  }
  if (typeof parsed.html !== 'string' || !parsed.html.trim()) return { kind: 'empty' }
  const html = sanitizeShopifyArticleHtml(parsed.html)
  if (!html) return { kind: 'empty' }
  const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : keyword
  return { kind: 'ok', title: title.slice(0, 180), html }
}

/** Escape model text so a needs_review draft body can never carry live markup. */
export function reviewDraftBody(rawText: string): string {
  const escaped = rawText.slice(0, 20000).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<pre>${escaped}</pre>`
}

/**
 * Metadata for a refresh whose model output was unusable: the live article (body, publish_state,
 * external ids) is left untouched and only this marker is added.
 */
export function refreshReviewMetadata(metadata: unknown, reason: string, at: string): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {}
  return { ...base, refresh_needs_review: { reason, at } }
}

/**
 * English name of the project's language for the prompt ("Write in Italian"). Accepts ISO codes
 * ('it', 'pt-BR', 'en_US') and plain names ('Italian'); anything unusable falls back to English.
 */
const COMMON_LANGUAGES: Record<string, string> = {
  en: 'English',
  it: 'Italian',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
  nl: 'Dutch',
}

export function articleLanguageName(code: unknown): string {
  const raw = typeof code === 'string' ? code.trim() : ''
  if (!raw) return 'English'
  // Plain codes without Intl (works even if the runtime ships without full ICU data).
  const common = COMMON_LANGUAGES[raw.toLowerCase()]
  if (common) return common
  try {
    const tag = Intl.getCanonicalLocales(raw.replace(/_/g, '-'))[0]
    const name = tag ? new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) : undefined
    if (name && name.toLowerCase() !== tag.toLowerCase()) return name
  } catch {
    // not a BCP-47 tag; maybe a plain language name below
  }
  if (/^[A-Za-z]{4,20}$/.test(raw)) return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
  return 'English'
}

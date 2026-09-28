import { supabase } from '../lib/supabaseClient'

/**
 * Snapshot the article before an AI tool overwrites it, so the user can restore it from
 * Versioning. Throws when the snapshot cannot be saved — callers must not overwrite then.
 */
export async function saveRevisionBeforeAiEdit(opts: {
  contentId: string
  before: string
  after: string
  tool: string
}): Promise<void> {
  const { error } = await supabase.from('revisions').insert({
    content_id: opts.contentId,
    original_body: opts.before,
    updated_body: opts.after,
    // `comment` is what the Versioning list shows; restoring brings back original_body.
    changes: { tool: opts.tool, source: 'ai_edit', comment: `Before AI edit (${opts.tool})` },
  })
  if (error) throw error
}

/** Word count used to catch a cut-off AI response (tools that only add text must not shrink it). */
export function wordCount(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

/**
 * True when an "add/improve" rewrite came back meaningfully shorter than the original: the model
 * hit its output limit, and saving it would silently delete the end of the article.
 */
export function looksTruncated(original: string, revised: string, minRatio = 0.9): boolean {
  const before = wordCount(original)
  return before > 0 && wordCount(revised) < before * minRatio
}

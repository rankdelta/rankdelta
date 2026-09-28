/**
 * Prompts for the "expand / rewrite / improve / shorten" tools on an existing article.
 * The original article always travels in full: the model revises it, it does not start over.
 */

export type ExpansionMode = 'expand' | 'rewrite' | 'improve' | 'shorten'

export const REVISION_SYSTEM_PROMPT =
  'You are a senior SEO editor. You revise an existing article as instructed. ' +
  'Write in the same language as the original article. Keep facts, figures, names and links from the original; ' +
  'never invent statistics, quotes or sources. Return only the revised article in Markdown, with no preamble or notes.'

const MODE_BRIEF: Record<ExpansionMode, string> = {
  expand:
    'Expand the article: add depth, practical examples and relevant new sections where they genuinely help the reader. Keep the original tone and style.',
  rewrite:
    'Rewrite the article from scratch in fresh wording, keeping the same topic, main keyword and overall structure. Improve clarity and engagement.',
  improve:
    'Improve the article for SEO and readability: better headings, tighter paragraphs, natural use of the main keyword, clearer structure. Keep roughly the same length.',
  shorten:
    'Shorten the article: keep every key point, the main structure and the main keyword; remove redundancy and less relevant passages.',
}

const LENGTH_FACTOR: Record<ExpansionMode, number> = { expand: 1.5, rewrite: 1, improve: 1, shorten: 0.7 }

export function buildRevisionPrompt(opts: {
  mode: ExpansionMode
  body: string
  primaryKeyword: string
  tone: string
  instructions?: string
}): { prompt: string; targetLength: number } {
  const currentLength = opts.body.trim() ? opts.body.trim().split(/\s+/).length : 0
  const targetLength = Math.floor(currentLength * LENGTH_FACTOR[opts.mode])
  const parts = [
    MODE_BRIEF[opts.mode],
    opts.primaryKeyword ? `Main keyword: "${opts.primaryKeyword}".` : '',
    `Tone: ${opts.tone}.`,
    `Target length: about ${targetLength} words (the original has ${currentLength}).`,
    opts.instructions?.trim() ? `Additional instructions from the editor: ${opts.instructions.trim()}` : '',
    `Original article:\n\n${opts.body}`,
  ]
  return { prompt: parts.filter(Boolean).join('\n\n'), targetLength }
}

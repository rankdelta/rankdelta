/**
 * What a site says it does, read from the top of its homepage: <title>, meta description and the
 * first headings. Visibility prompt generation uses it so the prompts are about what the business
 * actually sells, not what its name sounds like.
 *
 * Pure module (no Deno APIs) so vitest can import it unchanged.
 */

export type SiteSummary = { title: string; description: string; headings: string[] };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function clean(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      const c = code.toLowerCase();
      if (c.startsWith('#x')) return String.fromCodePoint(parseInt(c.slice(2), 16) || 32);
      if (c.startsWith('#')) return String.fromCodePoint(parseInt(c.slice(1), 10) || 32);
      return ENTITIES[c] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html: string, name: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (key !== name) continue;
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1];
    if (content) return clean(content);
  }
  return '';
}

export function summarizeSiteHtml(html: string | null | undefined): SiteSummary {
  if (!html) return { title: '', description: '', headings: [] };
  const body = html.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ');
  const title = clean(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') || metaContent(body, 'og:title');
  const description = metaContent(body, 'description') || metaContent(body, 'og:description');
  const headings: string[] = [];
  for (const m of body.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi)) {
    const text = clean(m[1] ?? '');
    if (text.length >= 3 && text.length <= 140 && !headings.includes(text)) headings.push(text);
    if (headings.length >= 6) break;
  }
  return { title: title.slice(0, 160), description: description.slice(0, 300), headings };
}

/** One bounded line for an LLM prompt; empty when the page told us nothing. */
export function siteSummaryText(s: SiteSummary, maxChars = 600): string {
  const parts = [
    s.title && `Title: ${s.title}`,
    s.description && `Description: ${s.description}`,
    s.headings.length > 0 && `Headings: ${s.headings.join(' | ')}`,
  ].filter(Boolean) as string[];
  return parts.join('. ').slice(0, maxChars);
}

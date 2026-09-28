import DOMPurify from 'dompurify'

/**
 * Sanitize article HTML before rendering it via dangerouslySetInnerHTML.
 *
 * The generated article body is mostly app-produced Gutenberg HTML, but the refresh/augment flow
 * ingests existing/external page content, so the preview is a stored/reflected-XSS surface. DOMPurify
 * strips <script>, inline event handlers (onerror/onclick/…) and javascript: URLs while preserving the
 * rich content we intentionally render — tables, links, and inline SVG infographics. <style> blocks
 * are dropped (CSS injection / UI-redress surface); inline `style` attributes still pass.
 *
 * Note: this hardens the in-browser PREVIEW only. The publish path sends the original content, so
 * sanitizing here never alters what gets published to WordPress.
 */

// Reverse-tabnabbing guard: any target="_blank" link must carry rel="noopener noreferrer".
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function sanitizeArticleHtml(html: string): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_ATTR: ['target', 'rel'],
  })
}

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Why this file exists
 * --------------------
 * The client technical audit reported page-level findings as a bare number:
 * "H1 mancante × 12", "Schema assenti × 4". The user could see *how many* pages were affected and
 * never *which* ones, so the finding was impossible to act on — the exact complaint from the field.
 *
 * The data was never missing: the crawl produced one result per page and the code reduced it with
 * `.filter(...).length`, discarding the URLs. These tests pin the URLs down so a future refactor
 * cannot silently reduce a finding back to a count.
 */

const src = readFileSync(resolve(process.cwd(), 'src/services/siteAudit.ts'), 'utf8')

/** Strip comments so the file's own explanatory prose cannot satisfy a source assertion. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const code = withoutComments(src)

describe('audit issues name the affected pages', () => {
  it('SiteAuditIssue carries urls alongside count', () => {
    expect(code).toMatch(/interface SiteAuditIssue[\s\S]*?urls\?: string\[\]/)
  })

  it('auditPage attaches the requested URL, since the response does not echo it', () => {
    // The crawl runs concurrently, so without this the items are unidentifiable.
    expect(code).toMatch(/return item \? \{ \.\.\.item, url \} : null/)
    expect(code).toMatch(/url\?: string/)
  })

  it('geoSignalsForPage returns its own url instead of only boolean signals', () => {
    expect(code).toMatch(/internalLinkIssueCount: number[\s\S]{0,120}?url: string/)
    // Both the success and the catch path must carry it, or a failed fetch loses its page.
    expect(code).toMatch(/return \{\s*url,\s*schema: false/)
  })

  it('SEO issues are bucketed by URL, not reduced to a counter', () => {
    // The old shape was a Map<string, number> incremented per page.
    expect(code).not.toMatch(/issueCounts\.set\(code, \(issueCounts\.get\(code\) \?\? 0\) \+ 1\)/)
    expect(code).toMatch(/issueUrls/)
    expect(code).toMatch(/urls: \[\.\.\.urls\]\.sort\(\)/)
  })

  it('every page-level GEO issue exposes the pages it covers', () => {
    for (const issue of [
      'geo_no_schema',
      'geo_no_article_faq',
      'geo_no_author',
      'geo_no_org_schema',
      'geo_low_answerability',
      'invalid_jsonld',
    ]) {
      const re = new RegExp(`code: '${issue}',[\\s\\S]{0,200}?urls: urls`)
      expect(code, `${issue} must carry urls`).toMatch(re)
    }
    expect(code).toMatch(/code: 'multiple_h1',[\s\S]{0,120}?urls: urlsWithMultipleH1/)
  })

  it('site-wide checks expose no page list rather than an empty one that reads as "0 pages"', () => {
    // robots.txt / llms.txt / crawler access genuinely have no page list. They must not be given
    // `urls: []`, which the UI would render as a page list of zero.
    expect(code).not.toMatch(/geo_no_llms_txt',[\s\S]{0,160}?urls:/)
    expect(code).not.toMatch(/geo_search_blocked_\w+',[\s\S]{0,200}?urls:/)
  })
})

describe('the audit UI renders WHERE, not just how many', () => {
  const ui = readFileSync(
    resolve(process.cwd(), 'src/components/agencyReport/widgets/ReportWidgetRenderer.tsx'),
    'utf8',
  )

  it('SiteHealthIssuesTable prints the affected page URLs', () => {
    expect(ui).toMatch(/const urls = issue\.urls \?\? \[\]/)
    expect(ui).toMatch(/shown\.map\(\(u\)/)
    expect(ui).toMatch(/agencyReport\.siteIssues\.affectedPages/)
  })

  it('collapses a long list instead of dumping every URL', () => {
    expect(ui).toMatch(/MAX_URLS_PER_ISSUE/)
    expect(ui).toMatch(/hidden > 0/)
    expect(ui).toMatch(/agencyReport\.siteIssues\.morePages/)
  })

  it('labels site-wide findings so the user does not hunt for a page list', () => {
    expect(ui).toMatch(/isSiteWide/)
    expect(ui).toMatch(/agencyReport\.siteIssues\.siteWide/)
  })
})

describe('the guided plan targets the real page', () => {
  const guided = readFileSync(resolve(process.cwd(), 'src/services/agent/guidedAudit.ts'), 'utf8')

  it('uses the audited URL for a single-page finding instead of guessing the site URL', () => {
    // The old fallback assumed a one-page finding was the homepage, which pointed at the wrong
    // page whenever the crawl had sampled anything else.
    expect(guided).not.toMatch(/const singlePageTarget = isPageQuality && \(iss\.count \?\? 0\) <= 1 \? audit\.siteUrl/)
    expect(guided).toMatch(/affected\.length === 1 \? affected\[0\]/)
  })

  it('carries every affected URL so a multi-page finding stays resolvable', () => {
    expect(guided).toMatch(/affectedUrls/)
    expect(guided).toMatch(/affectedUrls\?: string\[\]/)
  })
})

describe('report types stay backward compatible', () => {
  const types = readFileSync(resolve(process.cwd(), 'src/lib/agencyReport/types.ts'), 'utf8')

  it('urls is optional, so reports persisted before this change still validate', () => {
    expect(types).toMatch(/urls\?: string\[\] \| null/)
  })
})

describe('already-built reports are not relabelled as site-wide', () => {
  const ui = readFileSync(
    resolve(process.cwd(), 'src/components/agencyReport/widgets/ReportWidgetRenderer.tsx'),
    'utf8',
  )

  it('decides site-wide from the issue code, never from a missing url list', () => {
    // Every audit stored before `urls` existed has no `urls` on any issue. Inferring
    // "site-wide" from `urls.length === 0` would print
    // "fixed in the site configuration, not on a single page" under page-level findings such as
    // `canonical`, `low_content_rate` or `no_h1_tag` — on every report already delivered.
    expect(ui).toMatch(/const isSiteWide = SITE_WIDE_ISSUE_CODES\.has\(issue\.code\)/)
    expect(ui).not.toMatch(/const isSiteWide = urls\.length === 0/)
  })

  it('lists only the checks that genuinely have no page list', () => {
    const block = ui.match(/const SITE_WIDE_ISSUE_CODES = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
    expect(block).toMatch(/geo_no_llms_txt/)
    expect(block).toMatch(/geo_search_blocked_chatgpt/)
    // Page-level codes seen in production must never be in the allowlist.
    for (const code of ['canonical', 'low_content_rate', 'no_h1_tag', 'title_too_long', 'internal_link_issues']) {
      expect(block).not.toMatch(new RegExp(`'${code}'`))
    }
  })
})

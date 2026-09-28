import { describe, expect, it } from 'vitest'
import { aiCrawlerFindings, htmlHasExtractableStructure, htmlHasQuestionHeading, robotsAccessForBot } from './siteAudit'

describe('htmlHasExtractableStructure', () => {
  it('detects a real bullet list', () => {
    expect(htmlHasExtractableStructure('<ul><li>one</li><li>two</li></ul>')).toBe(true)
    expect(htmlHasExtractableStructure('<ol>\n <li>step</li></ol>')).toBe(true)
  })
  it('detects a data table with cells', () => {
    expect(htmlHasExtractableStructure('<table><tr><td>a</td></tr></table>')).toBe(true)
    expect(htmlHasExtractableStructure('<table><thead><tr><th>H</th></tr></thead></table>')).toBe(true)
  })
  it('is false for prose or an empty list shell', () => {
    expect(htmlHasExtractableStructure('<p>just a wall of prose text</p>')).toBe(false)
    expect(htmlHasExtractableStructure('<ul></ul>')).toBe(false)
    expect(htmlHasExtractableStructure('<table></table>')).toBe(false)
  })
})

describe('htmlHasQuestionHeading', () => {
  it('detects a heading ending in a question mark', () => {
    expect(htmlHasQuestionHeading('<h2>What is GEO?</h2>')).toBe(true)
    expect(htmlHasQuestionHeading('<h3 class="x">Come funziona?</h3>')).toBe(true)
  })
  it('detects a question-word opener without a mark', () => {
    expect(htmlHasQuestionHeading('<h2>How to optimize for AI</h2>')).toBe(true)
    expect(htmlHasQuestionHeading('<h3>Perché scegliere Rankdelta</h3>')).toBe(true)
  })
  it('strips inner tags before testing', () => {
    expect(htmlHasQuestionHeading('<h2><span>Why</span> does it matter?</h2>')).toBe(true)
  })
  it('is false for plain statement headings and h1/h4', () => {
    expect(htmlHasQuestionHeading('<h2>Our pricing plans</h2>')).toBe(false)
    expect(htmlHasQuestionHeading('<h1>What is this?</h1>')).toBe(false)
    expect(htmlHasQuestionHeading('<h4>What is this?</h4>')).toBe(false)
    expect(htmlHasQuestionHeading('<p>no headings here</p>')).toBe(false)
  })
})

describe('robotsAccessForBot', () => {
  it('flags an AI bot explicitly disallowed from root', () => {
    const robots = `User-agent: GPTBot\nDisallow: /`
    expect(robotsAccessForBot(robots, 'GPTBot').fullyBlocked).toBe(true)
    expect(robotsAccessForBot(robots, 'GPTBot').partiallyRestricted).toBe(false)
  })

  it('does not flag a bot with only a partial disallow', () => {
    const robots = `User-agent: GPTBot\nDisallow: /private/`
    expect(robotsAccessForBot(robots, 'GPTBot').fullyBlocked).toBe(false)
    expect(robotsAccessForBot(robots, 'GPTBot').partiallyRestricted).toBe(true)
  })

  it('honours a wildcard Disallow: / when no specific group exists', () => {
    const robots = `User-agent: *\nDisallow: /`
    expect(robotsAccessForBot(robots, 'PerplexityBot').fullyBlocked).toBe(true)
  })

  it('lets a specific allow override a wildcard block (most-specific UA wins)', () => {
    // Wildcard blocks everyone, but ClaudeBot has its own group that allows root.
    const robots = `User-agent: *\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow:`
    expect(robotsAccessForBot(robots, 'ClaudeBot').fullyBlocked).toBe(false)
    // A bot without its own group still inherits the wildcard block.
    expect(robotsAccessForBot(robots, 'GPTBot').fullyBlocked).toBe(true)
  })

  it('ignores comments and is case-insensitive on directives', () => {
    const robots = `# block the AI\nuser-agent: Google-Extended  # openai\ndisallow: /`
    expect(robotsAccessForBot(robots, 'Google-Extended').fullyBlocked).toBe(true)
  })

  it('returns false for an empty or allow-all robots.txt', () => {
    expect(robotsAccessForBot('', 'GPTBot').fullyBlocked).toBe(false)
    expect(robotsAccessForBot('User-agent: *\nDisallow:', 'GPTBot').fullyBlocked).toBe(false)
  })

  it('handles grouped user-agents sharing one ruleset', () => {
    const robots = `User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /`
    expect(robotsAccessForBot(robots, 'GPTBot').fullyBlocked).toBe(true)
    expect(robotsAccessForBot(robots, 'ClaudeBot').fullyBlocked).toBe(true)
    expect(robotsAccessForBot(robots, 'PerplexityBot').fullyBlocked).toBe(false)
  })

  it('does not treat Allow: / together with Disallow: / as a full block', () => {
    const robots = `User-agent: GPTBot\nAllow: /\nDisallow: /`
    const access = robotsAccessForBot(robots, 'GPTBot')
    expect(access.fullyBlocked).toBe(false)
    expect(access.partiallyRestricted).toBe(false)
  })

  it('reports Disallow: / plus Allow: /public/ as partial, not universal', () => {
    const robots = `User-agent: GPTBot\nDisallow: /\nAllow: /public/`
    const access = robotsAccessForBot(robots, 'GPTBot')
    expect(access.fullyBlocked).toBe(false)
    expect(access.partiallyRestricted).toBe(true)
  })

  it('groups agents across comments/blank lines and merges repeated groups', () => {
    const robots = [
      'User-agent: GPTBot',
      '# a comment between agent lines',
      'User-agent: ClaudeBot',
      '',
      'Disallow: /',
      '',
      'User-agent: *',
      'Disallow: /admin/',
      '',
      'User-agent: GPTBot',
      'Disallow: /',
    ].join('\n')
    expect(robotsAccessForBot(robots, 'GPTBot').fullyBlocked).toBe(true)
    expect(robotsAccessForBot(robots, 'ClaudeBot').fullyBlocked).toBe(true)
    expect(robotsAccessForBot(robots, 'PerplexityBot').fullyBlocked).toBe(false)
    expect(robotsAccessForBot(robots, 'PerplexityBot').partiallyRestricted).toBe(true)
  })

  it('applies the * wildcard only when no bot-specific group matches', () => {
    const robots = `User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nDisallow:`
    expect(robotsAccessForBot(robots, 'GPTBot').fullyBlocked).toBe(false)
    expect(robotsAccessForBot(robots, 'PerplexityBot').fullyBlocked).toBe(true)
  })
})

describe('aiCrawlerFindings', () => {
  it('treats a training opt-out as neutral info, not a ChatGPT-search block', () => {
    const robots = `User-agent: GPTBot\nDisallow: /`
    const findings = aiCrawlerFindings(robots, true)
    expect(findings.issues.filter((i) => i.code === 'geo_search_blocked_chatgpt')).toHaveLength(0)
    expect(findings.issues.filter((i) => i.severity === 'critical')).toHaveLength(0)
    expect(findings.trainingOptOuts).toEqual(['GPTBot'])
    expect(findings.trainingOptOutNotes).toHaveLength(1)
    expect(findings.trainingOptOutNotes[0]).toMatch(/training opt-out/)
  })

  it('scopes a ChatGPT Search block and never claims all AI citations are impossible', () => {
    const robots = `User-agent: OAI-SearchBot\nDisallow: /`
    const findings = aiCrawlerFindings(robots, true)
    const issue = findings.issues.find((i) => i.code === 'geo_search_blocked_chatgpt')
    expect(issue).toBeDefined()
    expect(issue!.severity).toBe('critical')
    expect(issue!.why).toMatch(/ChatGPT search/i)
    expect(issue!.why).not.toMatch(/every other|moot|all AI|destroyed/i)
    expect(findings.trainingOptOuts).toEqual([])
  })

  it('localizes the search-block copy in Italian', () => {
    const robots = `User-agent: OAI-SearchBot\nDisallow: /`
    const issue = aiCrawlerFindings(robots, false).issues.find((i) => i.code === 'geo_search_blocked_chatgpt')
    expect(issue).toBeDefined()
    expect(issue!.label).toMatch(/ChatGPT Search/i)
    expect(issue!.why).toMatch(/OAI-SearchBot è bloccato/)
  })

  it('never describes PerplexityBot as a training crawler', () => {
    const findings = aiCrawlerFindings('User-agent: PerplexityBot\nDisallow: /', true)
    const issue = findings.issues.find((i) => i.code === 'geo_search_blocked_perplexity')
    expect(issue).toBeDefined()
    expect(`${issue!.label} ${issue!.why}`).not.toMatch(/training crawler|addestramento/i)
    expect(issue!.why).toMatch(/not used to crawl content for AI foundation models/i)
  })

  it('does not treat Google-Extended as the Google Search / AI-Overviews control', () => {
    const findings = aiCrawlerFindings('User-agent: Google-Extended\nDisallow: /', true)
    expect(findings.blockedSearch).toEqual([])
    expect(findings.issues.filter((i) => i.code === 'geo_search_blocked_google')).toHaveLength(0)
    expect(findings.trainingOptOuts).toEqual(['Google-Extended'])
    expect(findings.trainingOptOutNotes[0]).toMatch(/not the control for Google Search/i)
  })

  it('does not report user-initiated fetchers', () => {
    const robots = `User-agent: ChatGPT-User\nDisallow: /\nUser-agent: Claude-User\nDisallow: /\nUser-agent: Perplexity-User\nDisallow: /`
    const findings = aiCrawlerFindings(robots, true)
    expect(findings.issues).toHaveLength(0)
    expect(findings.trainingOptOuts).toEqual([])
    expect(findings.blockedSearch).toEqual([])
  })
})

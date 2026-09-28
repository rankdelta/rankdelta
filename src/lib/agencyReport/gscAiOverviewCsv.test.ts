import { describe, it, expect } from 'vitest'
import { parseGscAiOverviewCsv } from './gscAiOverviewCsv'

describe('parseGscAiOverviewCsv', () => {
  it('parses standard GSC-style headers', () => {
    const csv = `Query,Impressions,Clicks,CTR,Position
seo tool,1200,45,3.75,8.2
ai search,800,12,1.5,12.1`
    const rows = parseGscAiOverviewCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ query: 'seo tool', impressions: 1200, clicks: 45 })
  })

  it('returns empty for too few lines', () => {
    expect(parseGscAiOverviewCsv('Query')).toEqual([])
  })
})

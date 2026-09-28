import { describe, it, expect } from 'vitest'
import { ga4PageRows, gscTopRows, pagePath } from './tables'

describe('gscTopRows', () => {
  it('types real Search Console rows and drops malformed ones', () => {
    const rows = gscTopRows([
      { key: 'webcam marzamemi', clicks: 646, impressions: 1242, ctr: 0.52, position: 1.73 },
      { key: '', clicks: 1, impressions: 1, ctr: 1, position: 1 },
      null,
      'nope',
      { key: 'no numbers' },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ key: 'webcam marzamemi', clicks: 646, impressions: 1242, ctr: 0.52, position: 1.73 })
    expect(rows[1]).toEqual({ key: 'no numbers', clicks: 0, impressions: 0, ctr: 0, position: null })
  })

  it('normalises a percent CTR to a fraction and derives CTR when missing', () => {
    const rows = gscTopRows([
      { key: 'a', clicks: 10, impressions: 200, ctr: 5, position: 3 },
      { key: 'b', clicks: 10, impressions: 200, position: 3 },
    ])
    expect(rows[0]!.ctr).toBeCloseTo(0.05)
    expect(rows[1]!.ctr).toBeCloseTo(0.05)
  })
})

describe('ga4PageRows', () => {
  it('types GA4 landing-page rows', () => {
    const rows = ga4PageRows([{ key: '/crm/', sessions: 900, users: 800, pageviews: 1200 }, { sessions: 3 }])
    expect(rows).toEqual([{ key: '/crm/', sessions: 900, users: 800, pageviews: 1200 }])
  })
})

describe('pagePath', () => {
  it('strips the origin and keeps the path', () => {
    expect(pagePath('https://example-hotel.com/harbor-webcam/')).toBe('/harbor-webcam/')
    expect(pagePath('https://acme.test/')).toBe('/')
    expect(pagePath('/already/a/path')).toBe('/already/a/path')
  })
})

import { describe, it, expect } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../common/i18n'
import { RankDistributionBar, RankMovers, splitMovers } from '../../components/agencyReport/RankingsStory'
import { Ga4LandingPagesTable, GscTopTable } from '../../components/agencyReport/SearchTables'

const movers = [
  { phrase: 'crm software', currentRank: 2, previousRank: 6, delta: 4, url: null },
  { phrase: 'crm for agencies', currentRank: 8, previousRank: 14, delta: 6, url: null },
  { phrase: 'sales pipeline tool', currentRank: 15, previousRank: 7, delta: -8, url: null },
  { phrase: 'lead tracker', currentRank: 24, previousRank: 19, delta: -5, url: null },
  { phrase: 'flat one', currentRank: 3, previousRank: 3, delta: 0, url: null },
]

const wrap = (ui: React.ReactElement) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)

describe('splitMovers', () => {
  it('separates wins from drops, sorted by magnitude, ignoring flat rows', () => {
    const { wins, drops } = splitMovers(movers)
    expect(wins.map((m) => m.phrase)).toEqual(['crm for agencies', 'crm software'])
    expect(drops.map((m) => m.phrase)).toEqual(['sales pipeline tool', 'lead tracker'])
  })
})

describe('RankMovers', () => {
  it('tells wins and drops with keyword names, previous → current rank and positions moved', () => {
    wrap(<RankMovers movers={movers} />)
    const wins = screen.getByTestId('movers-wins')
    expect(wins).toHaveTextContent('crm for agencies')
    expect(wins).toHaveTextContent('#14 → #8')
    expect(within(wins).getByLabelText(/6 (positions|posizioni)/)).toBeInTheDocument()
    const drops = screen.getByTestId('movers-drops')
    expect(drops).toHaveTextContent('sales pipeline tool')
    expect(drops).toHaveTextContent('#7 → #15')
  })
})

describe('RankDistributionBar', () => {
  it('renders every bucket with count and share, and the page-1 caption', () => {
    wrap(<RankDistributionBar distribution={{ '1': 2, '2-3': 5, '4-10': 12, '11-20': 8, '21+': 3 }} />)
    const bar = screen.getByTestId('rank-distribution')
    expect(bar).toHaveTextContent('#4–10')
    expect(bar).toHaveTextContent('12')
    expect(bar).toHaveTextContent(/19 (of|keyword su) 30/)
    expect(bar).toHaveTextContent('63%')
  })

  it('counts keywords outside the top 100 in the total (1 of 12 on page 1, not 1 of 2)', () => {
    // A real report shape: 12 keywords checked, the brand name at #1, one at #36, ten not ranking.
    const table = [
      { phrase: 'voltway', rank: 1, url: null },
      { phrase: 'colonnine ricarica milano', rank: 36, url: null },
      ...Array.from({ length: 10 }, (_, i) => ({ phrase: `ricarica città ${i}`, rank: null, url: null })),
    ]
    wrap(<RankDistributionBar distribution={{ '1': 1, '2-3': 0, '4-10': 0, '11-20': 0, '21+': 1 }} table={table} />)
    const bar = screen.getByTestId('rank-distribution')
    expect(bar).toHaveTextContent(/1 (of|keyword su) 12/)
    expect(bar).toHaveTextContent('8%')
    expect(bar).toHaveTextContent(/Not in top 100|Fuori dalla top 100/)
    expect(bar).not.toHaveTextContent(/1 (of|keyword su) 2 /)
  })

  it('renders nothing for an all-zero distribution', () => {
    const { container } = wrap(<RankDistributionBar distribution={{ '1': 0, '21+': 0 }} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('search tables', () => {
  it('types GSC rows and shows query, clicks, impressions, CTR and position', () => {
    wrap(
      <GscTopTable
        kind="queries"
        rows={[
          { key: 'webcam marzamemi', clicks: 646, impressions: 1242, ctr: 0.52, position: 1.73 },
          { key: 'avola', clicks: 206, impressions: 29965, ctr: 0.0069, position: 7.68 },
          'garbage',
        ]}
      />,
    )
    const table = screen.getByTestId('gsc-top-queries')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3) // header + 2
    expect(rows[1]).toHaveTextContent('webcam marzamemi')
    expect(rows[1]).toHaveTextContent('52.0%')
    expect(rows[2]).toHaveTextContent('0.7%')
    expect(rows[2]).toHaveTextContent('7.7')
  })

  it('shows page paths (not full URLs) for GSC pages and GA4 landing pages', () => {
    wrap(
      <>
        <GscTopTable kind="pages" rows={[{ key: 'https://example-hotel.com/harbor-webcam/', clicks: 1240, impressions: 3310, ctr: 0.42, position: 3.1 }]} />
        <Ga4LandingPagesTable rows={[{ key: '/crm/', sessions: 900, users: 800, pageviews: 1200 }]} />
      </>,
    )
    expect(screen.getByTestId('gsc-top-pages')).toHaveTextContent('/harbor-webcam/')
    expect(screen.getByTestId('gsc-top-pages')).not.toHaveTextContent('https://')
    expect(screen.getByTestId('ga4-landing-pages')).toHaveTextContent('/crm/')
    expect(screen.getByTestId('ga4-landing-pages')).toHaveTextContent('900')
  })
})

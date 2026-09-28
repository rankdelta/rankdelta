import { describe, it, expect, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../common/i18n'
import { layoutFromSections } from '../../../lib/agencyReport/layout'
import type { ClientReportRow } from '../../../services/reportBuild'
import { RecentReportsList } from './RecentReportsList'
import { ScheduleNextSendPreview } from './ScheduleNextSendPreview'

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

const fullLayout = layoutFromSections(['summary', 'geo', 'ai_attribution', 'rankings', 'gsc', 'ga4', 'site_health', 'backlinks'])

/** Harborstay's history row: all eight sections requested, five built, backlinks never analysed. */
const harborstayRow: ClientReportRow = {
  id: 'rpt-geo-1',
  project_id: 'p1',
  period_start: '2026-08-23',
  period_end: '2026-09-21',
  sections: ['summary', 'geo', 'ai_attribution', 'site_health', 'backlinks'],
  share_token: 'tok',
  created_at: new Date().toISOString(),
  layout: fullLayout,
  backlinks: { referringDomains: 0, new: 0, lost: null },
}

function renderList(rows: ClientReportRow[]) {
  return render(
    <I18nextProvider i18n={i18n}>
      <RecentReportsList reports={rows} onOpen={() => {}} />
    </I18nextProvider>,
  )
}

describe('RecentReportsList — which sources were missing on that build', () => {
  it('names the requested sources that did not make it, in the owner\'s language', () => {
    renderList([harborstayRow])
    expect(screen.getByText('5 sections with data')).toBeInTheDocument()
    expect(screen.getByTestId('recent-report-missing')).toHaveTextContent(
      'Not included (source not connected): Rankings, Google Search Console, Google Analytics 4, Backlinks',
    )
  })

  it('says nothing when every requested source built, or when the row has no layout to compare with', () => {
    renderList([
      { ...harborstayRow, id: 'a', sections: ['summary', 'geo', 'ai_attribution', 'rankings', 'gsc', 'ga4', 'site_health', 'backlinks'], backlinks: { referringDomains: 12, new: 1, lost: 0 } },
      { ...harborstayRow, id: 'b', layout: null },
    ])
    expect(screen.queryByTestId('recent-report-missing')).not.toBeInTheDocument()
  })

  it('speaks Italian', async () => {
    await i18n.changeLanguage('it')
    renderList([harborstayRow])
    expect(screen.getByTestId('recent-report-missing')).toHaveTextContent('Non incluse (fonte non collegata): Posizionamenti')
  })
})

describe('ScheduleNextSendPreview', () => {
  const wrap = (node: React.ReactElement) => render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)

  it('shows the date of the first send for a weekly schedule', () => {
    // 2026-09-21 is a Monday; next Wednesday (3) is the 23rd.
    wrap(<ScheduleNextSendPreview cadence="weekly" dayOfWeek={3} dayOfMonth={1} asOf="2026-09-21" />)
    expect(screen.getByTestId('schedule-next-send-preview')).toHaveTextContent('First send: Wednesday, September 23')
  })

  it('says "today" / "tomorrow" and handles a monthly day already past this month', () => {
    wrap(<ScheduleNextSendPreview cadence="weekly" dayOfWeek={1} dayOfMonth={1} asOf="2026-09-21" />)
    expect(screen.getByTestId('schedule-next-send-preview')).toHaveTextContent('First send: today')
    cleanup()
    wrap(<ScheduleNextSendPreview cadence="monthly" dayOfWeek={1} dayOfMonth={1} asOf="2026-09-21" />)
    expect(screen.getByTestId('schedule-next-send-preview')).toHaveTextContent('First send: Thursday, October 1')
  })

  it('is Italian when the UI is', async () => {
    await i18n.changeLanguage('it')
    wrap(<ScheduleNextSendPreview cadence="weekly" dayOfWeek={2} dayOfMonth={1} asOf="2026-09-21" />)
    expect(screen.getByTestId('schedule-next-send-preview')).toHaveTextContent('Primo invio: domani')
  })
})

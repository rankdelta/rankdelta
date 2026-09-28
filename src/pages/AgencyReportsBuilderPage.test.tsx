import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../common/i18n'
import { AgencyReportsBuilderPage } from './AgencyReportsBuilderPage'
import { useSubscription } from '../hooks/useSubscription'
import { buildClientReport } from '../services/reportBuild'
import type { ReportScheduleRow } from '../services/reportSchedules'

vi.mock('../hooks/useSubscription', () => ({
  useSubscription: vi.fn(),
}))

// Projects the builder can pick; tests that build a report select the first one.
const projects: Array<{ id: string; name: string }> = []
vi.mock('../hooks/useProjects', () => ({
  useProjects: () => ({ data: projects }),
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../services/reportBuild', (): Record<string, unknown> => ({
  buildClientReport: vi.fn(),
  fetchClientReports: vi.fn().mockResolvedValue([]),
  fetchClientReportById: vi.fn(),
}))
vi.mock('../services/reportSchedules', (): Record<string, unknown> => ({
  createReportSchedule: vi.fn(),
  deleteReportSchedule: vi.fn(),
  fetchReportSchedules: vi.fn().mockResolvedValue([]),
  sendReportScheduleTest: vi.fn(),
}))
vi.mock('../services/reportTemplates', (): Record<string, unknown> => ({
  deleteReportTemplate: vi.fn(),
  fetchReportTemplates: vi.fn().mockResolvedValue([]),
  saveReportTemplate: vi.fn(),
}))

vi.mock('../hooks/useActiveProject', () => ({
  useActiveProject: () => ({ activeProject: null }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  Outlet: () => null,
}))

// Query results by the first key segment ('client-reports' | 'report-schedules' | 'report-templates').
const queryData: Record<string, Array<unknown>> = {}
vi.mock('@tanstack/react-query', (): Record<string, unknown> => ({
  useQuery: ({ queryKey }: { queryKey: [string, ...Array<unknown>] }): { data: Array<unknown>; isLoading: boolean } => ({
    data: queryData[queryKey[0]] ?? [],
    isLoading: false,
  }),
  useQueryClient: (): { invalidateQueries: () => void } => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('../components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}))

vi.mock('../components/agencyReport/builder/ReportLayoutEditor', () => ({
  ReportLayoutEditor: () => <div data-testid="layout-editor-mock" />,
}))

vi.mock('../components/subscription/UpgradeModal', () => ({
  useUpgradeModal: () => ({
    openForLockedFeature: vi.fn(),
    UpgradeModal: () => null,
  }),
}))

describe('AgencyReportsBuilderPage plan gating', () => {
  beforeEach(() => {
    vi.mocked(useSubscription).mockReturnValue({
      subscription: { plan: 'starter' } as never,
      currentPlan: null,
      isLoading: false,
    } as never)
  })

  it('shows an in-app Pro upsell card for starter users (no builder form)', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <AgencyReportsBuilderPage />
      </I18nextProvider>,
    )

    expect(screen.getByText(/Client report builder is available on Pro and Agency plans/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Upgrade to Pro/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Build report/i })).not.toBeInTheDocument()
  })

  it('renders the builder form for Pro users', () => {
    vi.mocked(useSubscription).mockReturnValue({
      subscription: { plan: 'pro' } as never,
      currentPlan: null,
      isLoading: false,
    } as never)

    render(
      <I18nextProvider i18n={i18n}>
        <AgencyReportsBuilderPage />
      </I18nextProvider>,
    )

    expect(screen.queryByRole('button', { name: /Upgrade to Pro/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('build-report-button')).toBeInTheDocument()
    expect(screen.getByTestId('report-builder-sticky-bar')).toBeInTheDocument()
  })

  it('shows project hint and disables build when no project is selected', () => {
    vi.mocked(useSubscription).mockReturnValue({
      subscription: { plan: 'pro' } as never,
      currentPlan: null,
      isLoading: false,
    } as never)

    render(
      <I18nextProvider i18n={i18n}>
        <AgencyReportsBuilderPage />
      </I18nextProvider>,
    )

    expect(screen.getAllByText(/Select a (project|client) to start/i).length).toBeGreaterThan(0)
    expect(screen.getByTestId('build-report-button')).toBeDisabled()
  })

  it('keeps the build action reachable from the layout tab', () => {
    vi.mocked(useSubscription).mockReturnValue({
      subscription: { plan: 'pro' } as never,
      currentPlan: null,
      isLoading: false,
    } as never)

    render(
      <I18nextProvider i18n={i18n}>
        <AgencyReportsBuilderPage />
      </I18nextProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Layout/i }))
    expect(screen.getByTestId('build-report-button')).toBeInTheDocument()
  })
})

describe('AgencyReportsBuilderPage — weekly delivery nudge after a build', () => {
  const schedule: ReportScheduleRow = {
    id: 'sch-1',
    project_id: 'p1',
    user_id: 'u1',
    cadence: 'monthly',
    day_of_week: null,
    day_of_month: 1,
    recipients: ['client@company.com'],
    sections: ['summary'],
    branding: null,
    goals: null,
    layout: null,
    last_run_at: null,
    active: true,
    created_at: '2026-09-01T00:00:00Z',
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    Element.prototype.scrollIntoView = vi.fn()
    projects.splice(0, projects.length, { id: 'p1', name: 'Bravalo' })
    delete queryData['report-schedules']
    vi.mocked(useSubscription).mockReturnValue({
      subscription: { plan: 'pro' } as never,
      currentPlan: null,
      isLoading: false,
    } as never)
    vi.mocked(buildClientReport).mockResolvedValue({
      ok: true,
      narrativeGenerated: true,
      report: { id: 'r1', project_id: 'p1', period_start: '2026-08-23', period_end: '2026-09-21', sections: ['summary'], share_token: null, created_at: '2026-09-21T13:00:00Z' },
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    projects.splice(0, projects.length)
    delete queryData['report-schedules']
  })

  async function buildReport(): Promise<void> {
    render(
      <I18nextProvider i18n={i18n}>
        <AgencyReportsBuilderPage />
      </I18nextProvider>,
    )
    fireEvent.change(screen.getByLabelText(/Client/i, { selector: 'select' }), { target: { value: 'p1' } })
    fireEvent.click(screen.getByTestId('build-report-button'))
    await screen.findByTestId('report-build-success')
  }

  it('offers weekly delivery when the client has no active schedule and opens the form with weekly preselected', async () => {
    await buildReport()
    expect(screen.queryByTestId('schedule-form')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set up weekly delivery' }))
    const form = screen.getByTestId('schedule-form')
    expect(form).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Weekly' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'false')
    await vi.advanceTimersByTimeAsync(200)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByLabelText('Send to'))
  })

  it('reuses the recipients of a paused schedule (the last-used ones) and stays quiet when an active schedule exists', async () => {
    queryData['report-schedules'] = [{ ...schedule, active: false }]
    await buildReport()
    fireEvent.click(screen.getByRole('button', { name: 'Set up weekly delivery' }))
    expect(screen.getByLabelText('Send to')).toHaveValue('client@company.com')
    cleanup()

    queryData['report-schedules'] = [schedule]
    await buildReport()
    expect(screen.queryByTestId('schedule-nudge')).not.toBeInTheDocument()
    expect(screen.getByTestId('report-build-success')).toBeInTheDocument()
  })
})

import { useTranslation } from 'react-i18next'
import { fmtDecimals, fmtWholeNumber } from '../../lib/agencyReport/reportUi'
import { ga4PageRows, gscTopRows, pagePath } from '../../lib/agencyReport/tables'
import { ReportDataTable } from './reportPrimitives'

function fmtNum(v: number | null | undefined): string {
  return fmtWholeNumber(v)
}

function fmtPos(v: number | null): string {
  return v != null ? fmtDecimals(v, 1) : '—'
}

function fmtCtr(v: number): string {
  return `${fmtDecimals(v * 100, 1)}%`
}

/**
 * Compact "which queries / which pages" table from Search Console rows. `kind` decides the first
 * column: the query text, or the page path (origin stripped, full URL in the tooltip).
 */
export function GscTopTable({
  rows,
  kind,
  limit = 10,
  title,
}: {
  rows: unknown[] | null | undefined
  kind: 'queries' | 'pages'
  limit?: number
  title?: string
}) {
  const { t } = useTranslation()
  const typed = gscTopRows(rows).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, limit)
  if (typed.length === 0) return null
  return (
    <div data-testid={`gsc-top-${kind}`}>
      {title && <p className="mb-2 text-xs font-semibold text-gray-600">{title}</p>}
      <ReportDataTable
        rows={typed}
        getRowKey={(r) => r.key}
        columns={[
          {
            key: 'key',
            header: t(kind === 'queries' ? 'agencyReport.story.query' : 'agencyReport.builder.page'),
            render: (r) =>
              kind === 'pages' ? (
                <span className="block max-w-[260px] truncate" title={r.key}>
                  {pagePath(r.key)}
                </span>
              ) : (
                r.key
              ),
          },
          { key: 'clicks', header: t('agencyReport.story.clicks'), align: 'right', render: (r) => fmtNum(r.clicks) },
          { key: 'impressions', header: t('agencyReport.impressions'), align: 'right', render: (r) => fmtNum(r.impressions) },
          { key: 'ctr', header: t('agencyReport.ctr'), align: 'right', render: (r) => fmtCtr(r.ctr) },
          { key: 'position', header: t('agencyReport.story.position'), align: 'right', render: (r) => fmtPos(r.position) },
        ]}
      />
    </div>
  )
}

/** Top landing pages from GA4 rows: page, sessions, users. */
export function Ga4LandingPagesTable({ rows, limit = 10, title }: { rows: unknown[] | null | undefined; limit?: number; title?: string }) {
  const { t } = useTranslation()
  const typed = ga4PageRows(rows).sort((a, b) => b.sessions - a.sessions).slice(0, limit)
  if (typed.length === 0) return null
  const hasUsers = typed.some((r) => r.users != null)
  return (
    <div data-testid="ga4-landing-pages">
      {title && <p className="mb-2 text-xs font-semibold text-gray-600">{title}</p>}
      <ReportDataTable
        rows={typed}
        getRowKey={(r) => r.key}
        columns={[
          {
            key: 'key',
            header: t('agencyReport.builder.page'),
            render: (r) => (
              <span className="block max-w-[300px] truncate" title={r.key}>
                {pagePath(r.key)}
              </span>
            ),
          },
          { key: 'sessions', header: t('agencyReport.ga4Sessions'), align: 'right', render: (r) => fmtNum(r.sessions) },
          ...(hasUsers ? [{ key: 'users', header: t('agencyReport.users'), align: 'right' as const, render: (r: { users: number | null }) => fmtNum(r.users) }] : []),
        ]}
      />
    </div>
  )
}

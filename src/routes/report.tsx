import { createFileRoute, redirect } from '@tanstack/react-router'
import { ResultsReportPage } from '../pages/ResultsReportPage'
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/report')({
  beforeLoad: async () => {
    const {
      data: { session },
    } = await getSessionSafe()
    if (!session) throw redirect({ to: '/login' as any })
  },
  component: ResultsReportPage,
})

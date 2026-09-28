import { createFileRoute, redirect } from '@tanstack/react-router'
import { ClientReportPage } from '../pages/ClientReportPage'
import { getSessionSafe } from '../lib/requireAuth'

export const Route = createFileRoute('/reports/portal/$reportId')({
  beforeLoad: async () => {
    const {
      data: { session },
    } = await getSessionSafe()
    if (!session) throw redirect({ to: '/login' as any })
  },
  component: ClientReportPage,
})

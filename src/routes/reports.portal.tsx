import { createFileRoute, redirect } from '@tanstack/react-router'
import { AgencyReportsBuilderPage } from '../pages/AgencyReportsBuilderPage'
import { getSessionSafe } from '../lib/requireAuth'

export const Route = createFileRoute('/reports/portal')({
  beforeLoad: async () => {
    const {
      data: { session },
    } = await getSessionSafe()
    if (!session) throw redirect({ to: '/login' as any })
  },
  component: AgencyReportsBuilderPage,
})

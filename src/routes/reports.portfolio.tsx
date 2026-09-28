import { createFileRoute, redirect } from '@tanstack/react-router'
import { PortfolioPage } from '../pages/PortfolioPage'
import { getSessionSafe } from '../lib/requireAuth'

export const Route = createFileRoute('/reports/portfolio')({
  beforeLoad: async () => {
    const {
      data: { session },
    } = await getSessionSafe()
    if (!session) throw redirect({ to: '/login' as any })
  },
  component: PortfolioPage,
})

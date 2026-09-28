import { createFileRoute, redirect } from '@tanstack/react-router'
import { SiteAuditPage } from '../pages/SiteAuditPage'
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/audit')({
  beforeLoad: async () => {
    const {
      data: { session },
    } = await getSessionSafe()
    if (!session) throw redirect({ to: '/login' as any })
  },
  component: SiteAuditPage,
})

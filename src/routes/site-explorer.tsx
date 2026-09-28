import { createFileRoute, redirect } from '@tanstack/react-router'
import { SiteExplorerPage } from '../pages/SiteExplorerPage'
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/site-explorer')({
  beforeLoad: async () => {
    // Local visual QA (`?preview=1`) must render the real AppShell without a session.
    if (import.meta.env.DEV) return
    const {
      data: { session },
    } = await getSessionSafe()
    if (!session) throw redirect({ to: '/login' as any })
  },
  component: SiteExplorerPage,
})

import { createFileRoute, redirect } from '@tanstack/react-router'
import { KeywordResearchPage } from '../pages/KeywordResearchPage'
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/keyword-research')({
  beforeLoad: async () => {
    if (import.meta.env.DEV) return
    const {
      data: { session },
    } = await getSessionSafe()
    if (!session) throw redirect({ to: '/login' as any })
  },
  component: KeywordResearchPage,
})

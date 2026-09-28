import { createFileRoute, redirect } from '@tanstack/react-router'
import { ContentGenerator } from '../pages/ContentGenerator'
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/content/generate')({
  beforeLoad: async () => {
    const {
      data: { session },
    } = await getSessionSafe()
    if (!session) throw redirect({ to: '/login' as any })
  },
  component: ContentGenerator,
})

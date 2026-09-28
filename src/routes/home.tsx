import { createFileRoute, redirect } from '@tanstack/react-router'
import { CommandCenter } from '../pages/CommandCenter'
import { getSessionSafe } from '../lib/requireAuth';

export const Route = createFileRoute('/home')({
  beforeLoad: async () => {
    const {
      data: { session },
    } = await getSessionSafe()
    if (!session) {
      throw redirect({ to: '/login' as any })
    }
  },
  component: CommandCenter,
})

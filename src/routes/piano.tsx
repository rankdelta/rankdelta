import { createFileRoute, redirect } from '@tanstack/react-router'
import { PianoPage } from '../pages/PianoPage'
import { getSessionSafe } from '../lib/requireAuth'

export const Route = createFileRoute('/piano')({
  beforeLoad: async () => {
    const {
      data: { session },
    } = await getSessionSafe()
    if (!session) throw redirect({ to: '/login' as any })
  },
  component: PianoPage,
})

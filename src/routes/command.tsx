import { createFileRoute, redirect } from '@tanstack/react-router';
import { getSessionSafe } from '../lib/requireAuth';

/** Alias for Command Center (/home) — supports direct loads and bookmarks. */
export const Route = createFileRoute('/command')({
  beforeLoad: async () => {
    const {
      data: { session },
    } = await getSessionSafe();
    if (!session) {
      throw redirect({ to: '/login' as any });
    }
    throw redirect({ to: '/home' as any });
  },
});

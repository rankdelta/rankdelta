import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useProjects } from '../hooks/useProjects'
import { AppShell } from '../components/layout/AppShell'
import { getSessionSafe } from '../lib/requireAuth';

function AgentIndexPage() {
  const navigate = useNavigate()
  const { data: projects, isLoading } = useProjects()

  useEffect(() => {
    if (isLoading) return
    const first = projects?.[0]
    if (first) {
      navigate({ to: '/agent/$projectId', params: { projectId: first.id } })
    }
  }, [projects, isLoading, navigate])

  if (!isLoading && (!projects || projects.length === 0)) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto text-center py-32">
          <div className="text-5xl mb-4">✍️</div>
          <h2 className="text-2xl font-bold text-white">Aggiungi il tuo primo sito</h2>
          <p className="text-white/40 mt-2 mb-8">
            Crea un sito per attivare l'agente che ricerca e scrive contenuti SEO/GEO.
          </p>
          <button
            onClick={() => navigate({ to: '/projects/new' as any })}
            className="px-6 py-3 rounded-full bg-white text-black font-semibold hover:bg-white/90 transition-all"
          >
            + Aggiungi sito
          </button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="flex items-center justify-center py-40">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    </AppShell>
  )
}

export const Route = createFileRoute('/agent/')({
  beforeLoad: async () => {
    const {
      data: { session },
    } = await getSessionSafe()
    if (!session) throw redirect({ to: '/login' as any })
  },
  component: AgentIndexPage,
})

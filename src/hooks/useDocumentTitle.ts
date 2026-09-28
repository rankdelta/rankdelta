import { useEffect, useSyncExternalStore } from 'react'
import { useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useActiveProject } from '../hooks/useActiveProject'

const APP_TITLE = 'Rankdelta'

/** Map pathname prefixes to i18n title keys (without the app suffix). */
function titleKeyForPath(pathname: string): string | null {
  if (pathname.startsWith('/login')) return 'forgotPassword.signIn'
  if (pathname.startsWith('/signup')) return 'authSignup.submit'
  if (pathname.startsWith('/settings')) return 'appNav.impostazioni'
  if (pathname.startsWith('/billing')) return 'billing.title'
  if (pathname.startsWith('/pricing') || pathname.startsWith('/upgrade')) return 'upgrade.title'
  if (pathname.startsWith('/command') || pathname.startsWith('/home')) return 'appNav.comando'
  if (pathname.startsWith('/visibility')) return 'appNav.visibilitaAi'
  if (pathname.startsWith('/rankings') || pathname.startsWith('/analytics')) return 'appNav.posizionamento'
  if (pathname.startsWith('/audit')) return 'appNav.diagnosi'
  if (pathname.startsWith('/agent')) return 'appNav.contenuti'
  if (pathname.startsWith('/site-explorer')) return 'appNav.siteExplorer'
  if (pathname.startsWith('/keyword-research')) return 'appNav.keywordResearch'
  if (pathname.startsWith('/bulk-analysis')) return 'appNav.bulkAnalysis'
  if (pathname.startsWith('/piano')) return 'appNav.piano'
  if (pathname.startsWith('/reports')) return 'appNav.reports'
  return null
}

// A page can claim the title outright (e.g. a client report must show the report's client, not
// whichever project is active in the sidebar). Tiny external store so AppShell re-applies it.
let titleOverride: string | null = null
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getOverride = () => titleOverride

function setTitleOverride(next: string | null) {
  if (titleOverride === next) return
  titleOverride = next
  listeners.forEach((l) => l())
}

/** Claim document.title while mounted (null = release). */
export function useDocumentTitleOverride(title: string | null) {
  useEffect(() => {
    setTitleOverride(title)
    return () => setTitleOverride(null)
  }, [title])
}

/** Sets document.title from the current route + active project name, unless a page claimed it. */
export function useDocumentTitle() {
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const { activeProject } = useActiveProject()
  const override = useSyncExternalStore(subscribe, getOverride, getOverride)

  useEffect(() => {
    if (override) {
      document.title = override
      return
    }
    const key = titleKeyForPath(pathname)
    const section = key ? t(key) : null
    const project = activeProject?.name
    const parts = [project, section, APP_TITLE].filter(Boolean)
    document.title = parts.join(' · ')
  }, [pathname, activeProject?.name, t, override])
}

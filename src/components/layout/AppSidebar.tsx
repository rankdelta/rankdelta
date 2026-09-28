/**
 * AppSidebar — unified, dark navigation for the rebuilt product.
 *
 * One coherent IA built around the GEO loop:
 *   Comando · Contenuti · Visibilità AI · Posizionamento · Impostazioni
 *
 * Includes a site switcher at the top — every surface is per-site.
 */

import { useState, useEffect, useRef, useLayoutEffect, type ComponentType, type SVGProps } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Squares2X2Icon,
  PencilSquareIcon,
  SignalIcon,
  MagnifyingGlassIcon,
  KeyIcon,
  RectangleStackIcon,
  ArrowTrendingUpIcon,
  ShieldCheckIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  LinkIcon,
  ChevronUpDownIcon,
  CheckIcon,
  PlusIcon,
  ArrowRightStartOnRectangleIcon,
  Bars3Icon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import type { ParseKeys } from 'i18next'
import { useAuth } from '../../hooks/useAuth'
import { useActiveProject } from '../../hooks/useActiveProject'
import { useSubscription } from '../../hooks/useSubscription'
import { useUpgradeModal } from '../subscription/UpgradeModal'
import { LanguageSwitcher } from '../ui/LanguageSwitcher'
import { creditsEnabled } from '../../config/deployment'
import { AccountUsageMeter } from './AccountUsageMeter'

type IconType = ComponentType<SVGProps<SVGSVGElement>>

interface NavDef {
  id: string
  labelKey: ParseKeys
  icon: IconType
  to: (pid: string | null) => string
  match: string
  search?: Record<string, string>
}

// Grouped IA so the one codebase reads as ONE coherent product (was a flat list; the old separate
// rankdelta repo had a nicer grouped nav — adopted here so cloud + self-host look identical).
const NAV_GROUPS: { labelKey?: ParseKeys; items: NavDef[] }[] = [
  { items: [
    { id: 'home', labelKey: 'appNav.comando', icon: Squares2X2Icon, to: () => '/home', match: '/home' },
  ] },
  { labelKey: 'appNav.groupResearch', items: [
    { id: 'siteExplorer', labelKey: 'appNav.siteExplorer', icon: MagnifyingGlassIcon, to: () => '/site-explorer', match: '/site-explorer' },
    { id: 'keywordResearch', labelKey: 'appNav.keywordResearch', icon: KeyIcon, to: () => '/keyword-research', match: '/keyword-research' },
    { id: 'bulkAnalysis', labelKey: 'appNav.bulkAnalysis', icon: RectangleStackIcon, to: () => '/bulk-analysis', match: '/bulk-analysis' },
  ] },
  { labelKey: 'appNav.groupMonitor', items: [
    { id: 'visibility', labelKey: 'appNav.visibilitaAi', icon: SignalIcon, to: (p) => (p ? `/visibility/${p}/` : '/visibility/'), match: '/visibility' },
    { id: 'rankings', labelKey: 'appNav.posizionamento', icon: ArrowTrendingUpIcon, to: (p) => (p ? `/rankings/${p}` : '/rankings/'), match: '/rankings' },
    { id: 'reports', labelKey: 'appNav.reports', icon: ChartBarIcon, to: () => '/reports/portal', match: '/reports' },
  ] },
  { labelKey: 'appNav.groupOptimize', items: [
    { id: 'audit', labelKey: 'appNav.diagnosi', icon: ShieldCheckIcon, to: () => '/audit', match: '/audit' },
    { id: 'content', labelKey: 'appNav.contenuti', icon: PencilSquareIcon, to: (p) => (p ? `/agent/${p}` : '/agent/'), match: '/agent' },
    { id: 'piano', labelKey: 'appNav.piano', icon: CalendarDaysIcon, to: () => '/piano', match: '/piano' },
  ] },
  { items: [
    // Surface the hosted-MCP connection (Settings → API & MCP) as a first-class nav entry.
    {
      id: 'connectAi',
      labelKey: 'appNav.connectAi',
      icon: LinkIcon,
      to: () => '/settings',
      match: '/settings',
      search: { tab: 'mcp' },
    },
    { id: 'settings', labelKey: 'appNav.impostazioni', icon: Cog6ToothIcon, to: () => '/settings', match: '/settings' },
  ] },
]

function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <span className="text-violet-400 font-mono text-sm select-none">✦</span>
      <span className="text-white font-semibold tracking-tight">rankdelta<span className="text-white/40">.ai</span></span>
    </div>
  )
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, signOut } = useAuth()
  const { projects, activeProject, activeProjectId, setActive, isLoading } = useActiveProject()
  const { checkCanCreateProject } = useSubscription()
  const { openForProjectLimit, UpgradeModal } = useUpgradeModal()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const switcherBtnRef = useRef<HTMLButtonElement>(null)
  const loadingProjects = isLoading && !activeProject

  // Keep global project in sync when the URL carries a project id (visibility / agent routes).
  useEffect(() => {
    const m = location.pathname.match(/^\/(?:visibility|agent|rankings)\/([^/]+)/)
    const routeProjectId = m?.[1]
    if (routeProjectId && routeProjectId !== activeProjectId) {
      setActive(routeProjectId)
    }
  }, [location.pathname, activeProjectId, setActive])

  useLayoutEffect(() => {
    if (!switcherOpen || !switcherBtnRef.current) {
      setMenuPos(null)
      return
    }
    const update = () => {
      const rect = switcherBtnRef.current!.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [switcherOpen])

  const settingsTab = new URLSearchParams(location.searchStr).get('tab')

  const isActive = (item: NavDef) => {
    if (item.id === 'connectAi') {
      return location.pathname === '/settings' && settingsTab === 'mcp'
    }
    if (item.id === 'settings') {
      return location.pathname === '/settings' && settingsTab !== 'mcp'
    }
    return location.pathname === item.match || location.pathname.startsWith(`${item.match}/`)
  }

  const go = (path: string, search?: Record<string, string>) => {
    if (
      path === '/settings' &&
      search?.['tab'] === 'mcp' &&
      location.pathname === '/settings' &&
      settingsTab === 'mcp'
    ) {
      document.getElementById('api-mcp')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      onNavigate?.()
      return
    }
    navigate({ to: path as any, ...(search ? { search: search as any } : {}) })
    onNavigate?.()
  }

  const selectProject = (id: string) => {
    setActive(id)
    setSwitcherOpen(false)
    const path = location.pathname
    const rankings = path.match(/^\/rankings\/[^/]+/)
    if (rankings) {
      const tab = new URLSearchParams(location.searchStr).get('tab')
      go(`/rankings/${id}`, tab ? { tab } : undefined)
      return
    }
    const vis = path.match(/^\/visibility\/[^/]+(\/.*)?$/)
    if (vis) {
      const sub = vis[1] ?? '/'
      go(`/visibility/${id}${sub}`)
      return
    }
    const agent = path.match(/^\/agent\/[^/]+/)
    if (agent) {
      go(`/agent/${id}`)
    }
  }

  const handleAddSite = async () => {
    setSwitcherOpen(false)
    const gate = await checkCanCreateProject()
    if (!gate.canCreate) {
      openForProjectLimit()
      return
    }
    go('/projects/new')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 pt-6 pb-5">
        <Wordmark />
      </div>

      {/* Site switcher */}
      <div className="px-3 pb-4 relative">
        {loadingProjects ? (
          <div className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <div className="w-7 h-7 rounded-lg bg-white/[0.06] animate-pulse flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-2.5 w-2/3 rounded bg-white/[0.08] animate-pulse" />
              <div className="h-2 w-1/2 rounded bg-white/[0.05] animate-pulse" />
            </div>
          </div>
        ) : (
          <button
            ref={switcherBtnRef}
            type="button"
            aria-expanded={switcherOpen}
            aria-haspopup="listbox"
            aria-label={t('appNav.switchSite', { name: activeProject?.name ?? t('appNav.noSite') })}
            onClick={() => setSwitcherOpen((o) => !o)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-xs font-semibold text-white flex-shrink-0">
              {activeProject?.name?.[0]?.toUpperCase() ?? '+'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {activeProject?.name ?? t('appNav.noSite')}
              </p>
              <p className="text-[11px] text-white/35 truncate">
                {activeProject?.website_url?.replace(/^https?:\/\//, '') ?? t('appNav.createFirstSite')}
              </p>
            </div>
            <ChevronUpDownIcon className="w-4 h-4 text-white/40 flex-shrink-0" />
          </button>
        )}

        {switcherOpen && menuPos && typeof document !== 'undefined' && createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[200] cursor-default"
              aria-label={t('appNav.closeSiteMenu')}
              onClick={() => setSwitcherOpen(false)}
            />
            <motion.div
              role="listbox"
              aria-label={t('appNav.siteList')}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
              className="fixed z-[210] rounded-xl border border-white/[0.1] bg-[#141414] shadow-2xl shadow-black/50 overflow-hidden"
            >
              <div className="max-h-64 overflow-y-auto py-1">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={p.id === activeProjectId}
                    aria-label={t('appNav.selectSite', { name: p.name })}
                    onClick={() => selectProject(p.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.05] transition-colors ${
                      p.id === activeProjectId ? 'bg-white/[0.04]' : ''
                    }`}
                  >
                    <div className="w-6 h-6 rounded-md bg-white/[0.08] flex items-center justify-center text-[10px] font-semibold text-white/70">
                      {p.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <span className="text-sm text-white/80 truncate flex-1">{p.name}</span>
                    {p.id === activeProjectId && <CheckIcon className="w-4 h-4 text-violet-400" aria-hidden />}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void handleAddSite()}
                className="w-full flex items-center gap-2 px-3 py-2.5 border-t border-white/[0.06] text-violet-400 hover:bg-white/[0.04] transition-colors text-sm font-medium"
              >
                <PlusIcon className="w-4 h-4" aria-hidden /> {t('appNav.addSite')}
              </button>
            </motion.div>
          </>,
          document.body,
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 overflow-y-auto">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className={`space-y-0.5 ${gi > 0 ? 'mt-4' : ''}`}>
            {group.labelKey && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/25">{t(group.labelKey)}</p>
            )}
            {group.items.map((item) => {
              const active = isActive(item)
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  onClick={() => go(item.to(activeProjectId), item.search)}
                  className={`group w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all relative ${
                    active
                      ? 'bg-white/[0.06] text-white'
                      : 'text-white/45 hover:text-white hover:bg-white/[0.03]'
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-violet-400" />
                  )}
                  <Icon className={`w-[18px] h-[18px] flex-shrink-0 ${active ? 'text-violet-300' : 'text-white/40 group-hover:text-white/70'}`} strokeWidth={1.8} />
                  <span className="text-sm font-medium">{t(item.labelKey)}</span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer: credits + user */}
      <div className="p-3 space-y-2 border-t border-white/[0.06] mt-3">
        {/* Credits are a cloud concept — self-host is BYOK, no credit balance. */}
        {creditsEnabled() && <AccountUsageMeter />}

        <div className="flex items-center justify-between px-1.5">
          <span className="text-[11px] text-white/35">{t('appNav.language')}</span>
          <LanguageSwitcher />
        </div>

        {user ? (
          <div className="flex items-center gap-3 px-1.5 py-1">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-xs font-semibold text-white">
              {user.email?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white/90 truncate">{user.email?.split('@')[0] ?? t('appNav.account')}</p>
              <p className="text-[11px] text-white/30 truncate">{user.email}</p>
            </div>
            <button
              onClick={() => signOut()}
              className="text-white/30 hover:text-white/70 transition-colors p-1.5 rounded-lg hover:bg-white/[0.05]"
              title={t('appNav.signOut')}
            >
              <ArrowRightStartOnRectangleIcon className="w-[18px] h-[18px]" strokeWidth={1.8} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-1.5 py-1">
            <div className="w-8 h-8 rounded-full bg-white/[0.06] animate-pulse flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-2.5 w-1/2 rounded bg-white/[0.08] animate-pulse" />
              <div className="h-2 w-3/4 rounded bg-white/[0.05] animate-pulse" />
            </div>
          </div>
        )}
      </div>
      <UpgradeModal />
    </div>
  )
}

export function AppSidebar() {
  const { t } = useTranslation()
  const location = useLocation()
  const [isMobile, setIsMobile] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  if (isMobile) {
    return (
      <>
        <header className="md:hidden fixed top-0 left-0 right-0 z-50 bg-[#0c0c0c] border-b border-white/[0.06] flex items-center justify-between px-4 h-14">
          <Wordmark />
          <button onClick={() => setOpen((o) => !o)} className="p-2 text-white/60 hover:text-white" aria-label={t('appNav.menu')}>
            {open ? <XMarkIcon className="w-6 h-6" /> : <Bars3Icon className="w-6 h-6" />}
          </button>
        </header>
        <AnimatePresence>
          {open && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setOpen(false)}
                className="fixed inset-0 bg-black/60 z-40 md:hidden"
              />
              <motion.aside
                initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                className="fixed left-0 top-0 bottom-0 w-64 bg-[#0c0c0c] border-r border-white/[0.06] z-50 md:hidden"
              >
                <SidebarBody onNavigate={() => setOpen(false)} />
              </motion.aside>
            </>
          )}
        </AnimatePresence>
        <div className="h-14 md:hidden" />
      </>
    )
  }

  return (
    <aside className="hidden md:flex w-64 bg-[#0c0c0c] border-r border-white/[0.06] flex-col h-screen sticky top-0">
      <SidebarBody />
    </aside>
  )
}

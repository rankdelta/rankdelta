/**
 * AppShell — the dark, premium layout frame for the rebuilt product.
 * Composes the unified AppSidebar with a scrollable main area and subtle ambient light.
 */

import type { ReactNode } from 'react'
import { AppSidebar } from './AppSidebar'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'

export function AppShell({ children, maxWidth = '6xl' }: { children: ReactNode; maxWidth?: '5xl' | '6xl' | '7xl' | 'full' }) {
  useDocumentTitle()
  const widthClass =
    maxWidth === 'full' ? '' : maxWidth === '7xl' ? 'max-w-7xl' : maxWidth === '5xl' ? 'max-w-5xl' : 'max-w-6xl'

  return (
    <div className="flex min-h-screen bg-[#080808] text-white">
      <AppSidebar />
      <div className="flex-1 relative overflow-hidden">
        {/* ambient light */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -top-40 right-0 w-[480px] h-[480px] rounded-full opacity-[0.12]"
            style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.8) 0%, transparent 70%)' }}
          />
          <div
            className="absolute top-1/2 -left-32 w-[360px] h-[360px] rounded-full opacity-[0.08]"
            style={{ background: 'radial-gradient(circle, rgba(20,184,166,0.8) 0%, transparent 70%)' }}
          />
        </div>
        {/* pt-20 on mobile clears the md:hidden fixed top bar (h-14); md:pt-10 restores desktop spacing. */}
        <main className={`relative ${widthClass} mx-auto px-6 sm:px-10 pt-20 pb-10 md:pt-10`}>{children}</main>
      </div>
    </div>
  )
}

/**
 * useActiveProject — the single source of truth for "which site am I working on".
 *
 * The unified product (Command Center, Contenuti, Visibilità) is per-site, but the top-level
 * routes (/home) carry no projectId. This hook resolves the active site from a SHARED store
 * (backed by localStorage) so that switching the site in the sidebar instantly updates every
 * consumer — the dashboard, KPIs, the loop — without a reload.
 *
 * Implemented with useSyncExternalStore over a module-level store: a previous version used a
 * per-component useState, which meant the sidebar's setActive updated only its own copy and the
 * Comando kept showing the old site until a remount. The shared store fixes that.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { useProjects } from './useProjects'
import type { Project } from '../types/database'

const STORAGE_KEY = 'astroseo:activeProjectId'

function read(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

let current: string | null = read()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  // Keep in sync across tabs/windows too.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      current = e.newValue
      cb()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

function getSnapshot(): string | null {
  return current
}

/** Set the active site for every consumer at once (and persist it). */
export function setActiveProjectId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* ignore */
  }
  current = id
  emit()
}

export function useActiveProject() {
  const { data: projects, isLoading } = useProjects()
  const storedId = useSyncExternalStore(subscribe, getSnapshot, () => null)

  const list = (projects ?? []) as Project[]
  const activeProject = list.find((p) => p.id === storedId) ?? list[0] ?? null

  const setActive = useCallback((id: string) => {
    setActiveProjectId(id)
  }, [])

  return {
    projects: list,
    activeProject,
    activeProjectId: activeProject?.id ?? null,
    setActive,
    isLoading,
  }
}

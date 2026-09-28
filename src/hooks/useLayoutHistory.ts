import { useCallback, useRef, useState } from 'react'
import type { ReportLayout } from '../lib/agencyReport/layout'

const MAX_HISTORY = 50

export function useLayoutHistory(initial: ReportLayout) {
  const [layout, setLayoutState] = useState(initial)
  const pastRef = useRef<ReportLayout[]>([])
  const futureRef = useRef<ReportLayout[]>([])
  const skipSyncRef = useRef(false)

  const setLayout = useCallback((next: ReportLayout | ((prev: ReportLayout) => ReportLayout)) => {
    setLayoutState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      if (resolved === prev) return prev
      pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), prev]
      futureRef.current = []
      return resolved
    })
  }, [])

  const resetLayout = useCallback((next: ReportLayout) => {
    skipSyncRef.current = true
    pastRef.current = []
    futureRef.current = []
    setLayoutState(next)
  }, [])

  const undo = useCallback(() => {
    const past = pastRef.current
    if (!past.length) return
    setLayoutState((current) => {
      const previous = past[past.length - 1]!
      pastRef.current = past.slice(0, -1)
      futureRef.current = [current, ...futureRef.current]
      skipSyncRef.current = true
      return previous
    })
  }, [])

  const redo = useCallback(() => {
    const future = futureRef.current
    if (!future.length) return
    setLayoutState((current) => {
      const next = future[0]!
      futureRef.current = future.slice(1)
      pastRef.current = [...pastRef.current, current]
      skipSyncRef.current = true
      return next
    })
  }, [])

  const [historyMeta, setHistoryMeta] = useState({ canUndo: false, canRedo: false })

  const syncMeta = useCallback(() => {
    setHistoryMeta({
      canUndo: pastRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
    })
  }, [])

  const setLayoutWithMeta = useCallback(
    (next: ReportLayout | ((prev: ReportLayout) => ReportLayout)) => {
      setLayout(next)
      queueMicrotask(syncMeta)
    },
    [setLayout, syncMeta],
  )

  const undoWithMeta = useCallback(() => {
    undo()
    queueMicrotask(syncMeta)
  }, [undo, syncMeta])

  const redoWithMeta = useCallback(() => {
    redo()
    queueMicrotask(syncMeta)
  }, [redo, syncMeta])

  const resetLayoutWithMeta = useCallback(
    (next: ReportLayout) => {
      resetLayout(next)
      queueMicrotask(syncMeta)
    },
    [resetLayout, syncMeta],
  )

  return {
    layout,
    setLayout: setLayoutWithMeta,
    resetLayout: resetLayoutWithMeta,
    undo: undoWithMeta,
    redo: redoWithMeta,
    canUndo: historyMeta.canUndo,
    canRedo: historyMeta.canRedo,
    skipSyncRef,
  }
}

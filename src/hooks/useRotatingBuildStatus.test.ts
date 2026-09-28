import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRotatingBuildStatus, REPORT_BUILD_STATUS_KEYS } from './useRotatingBuildStatus'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('useRotatingBuildStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the first status key when active', () => {
    const { result } = renderHook(() => useRotatingBuildStatus(true))
    expect(result.current).toBe(REPORT_BUILD_STATUS_KEYS[0])
  })

  it('rotates through status keys while active', () => {
    const { result } = renderHook(() => useRotatingBuildStatus(true))
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(result.current).toBe(REPORT_BUILD_STATUS_KEYS[1])
  })

  it('resets to the first key when deactivated', () => {
    const { result, rerender } = renderHook(({ active }) => useRotatingBuildStatus(active), {
      initialProps: { active: true },
    })
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    rerender({ active: false })
    expect(result.current).toBe(REPORT_BUILD_STATUS_KEYS[0])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPendingCheck, readPendingCheck, savePendingCheck } from './pendingCheck'
import { installMemoryLocalStorage } from '../test-utils/memoryStorage'

const KEY = 'rankdelta.pendingCheck'
const DAY = 24 * 60 * 60 * 1000

describe('pendingCheck (free-check → signup/onboarding carrier)', () => {
  let storage: Storage
  beforeEach(() => {
    storage = installMemoryLocalStorage()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-21T10:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('save → read round-trips the check and stamps savedAt', () => {
    savePendingCheck({ domain: 'acme.com', email: 'jane@acme.com', lang: 'en', level: 'absent', brand: 'Acme' })
    const read = readPendingCheck()
    expect(read).toMatchObject({ domain: 'acme.com', email: 'jane@acme.com', lang: 'en', level: 'absent', brand: 'Acme' })
    expect(read?.savedAt).toBe(Date.now())
  })

  it('read returns null when nothing was saved', () => {
    expect(readPendingCheck()).toBeNull()
  })

  it('clear removes the entry', () => {
    savePendingCheck({ domain: 'acme.com', email: 'jane@acme.com' })
    clearPendingCheck()
    expect(readPendingCheck()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('is still readable just before the 7-day TTL and expired (and purged) after it', () => {
    savePendingCheck({ domain: 'acme.com', email: 'jane@acme.com' })
    vi.advanceTimersByTime(7 * DAY - 1000)
    expect(readPendingCheck()?.domain).toBe('acme.com')
    vi.advanceTimersByTime(2000)
    expect(readPendingCheck()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('ignores malformed JSON', () => {
    localStorage.setItem(KEY, '{not json')
    expect(readPendingCheck()).toBeNull()
  })

  it('ignores JSON with the wrong shape', () => {
    localStorage.setItem(KEY, JSON.stringify({ domain: 'acme.com' }))
    expect(readPendingCheck()).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ domain: 1, email: 'x', savedAt: Date.now() }))
    expect(readPendingCheck()).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ domain: 'acme.com', email: 'x', savedAt: 'yesterday' }))
    expect(readPendingCheck()).toBeNull()
  })

  it('never throws when storage throws (private mode / blocked storage)', () => {
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })
    vi.spyOn(storage, 'removeItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })
    expect(() => {
      savePendingCheck({ domain: 'acme.com', email: 'jane@acme.com' })
    }).not.toThrow()
    expect(readPendingCheck()).toBeNull()
    expect(() => {
      clearPendingCheck()
    }).not.toThrow()
  })
})

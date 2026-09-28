/**
 * In-memory `Storage` for vitest. Node 22+ ships its own experimental `localStorage` global that is
 * `undefined` unless `--localstorage-file` is passed, and it shadows jsdom's — so tests that touch
 * localStorage install this stub explicitly instead of relying on the environment.
 */
export function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return map.size
    },
    clear: () => {
      map.clear()
    },
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value))
    },
  }
  return storage
}

/** Installs a fresh in-memory `localStorage` on `globalThis` (and `window` when present). */
export function installMemoryLocalStorage(): Storage {
  const storage = createMemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
  if (typeof window !== 'undefined' && window !== (globalThis as unknown as Window)) {
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true, writable: true })
  }
  return storage
}

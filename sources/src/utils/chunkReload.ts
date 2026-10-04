/**
 * BUG-111: a tab opened before a deploy still asks for the previous build's hashed chunks. Cloudflare
 * Pages answers an unknown path with index.html (200, text/html), so the module load fails and the
 * lazy page throws into the ErrorBoundary (「頁面發生錯誤」) on the next tab switch.
 *
 * On a failed chunk load, reload the page once so the tab picks up the current build, and keep the
 * Suspense fallback on screen until it does. A second failure within `WINDOW_MS` is not a stale tab
 * (offline, host down) and is rethrown to the ErrorBoundary, as is any failure when sessionStorage
 * cannot hold the guard — a reload with no guard could loop.
 */
const KEY = 'chunk-reload-at'
const WINDOW_MS = 30_000

export interface ChunkReloadDeps {
  now: () => number
  storage: () => Pick<Storage, 'getItem' | 'setItem'>
  reload: () => void
}

const browserDeps: ChunkReloadDeps = {
  now: () => Date.now(),
  storage: () => window.sessionStorage,
  reload: () => window.location.reload(),
}

export function loadChunk<T>(importer: () => Promise<T>, deps: ChunkReloadDeps = browserDeps): Promise<T> {
  return importer().catch((err: unknown) => {
    try {
      const store = deps.storage()
      const last = Number(store.getItem(KEY)) || 0
      if (deps.now() - last < WINDOW_MS) throw err
      store.setItem(KEY, String(deps.now()))
    } catch {
      throw err
    }
    deps.reload()
    return new Promise<T>(() => {})
  })
}

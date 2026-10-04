// BUG-111 — a stale tab's lazy page load reloads once instead of hitting the ErrorBoundary.
import { describe, expect, it } from 'vitest'
import { loadChunk, type ChunkReloadDeps } from './chunkReload'

function fakeDeps(start: Record<string, string> = {}, now = 1_000_000) {
  const store = new Map(Object.entries(start))
  const rec = { reloads: 0, now }
  const deps: ChunkReloadDeps = {
    now: () => rec.now,
    storage: () => ({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) }),
    reload: () => void rec.reloads++,
  }
  return { deps, rec, store }
}

const STALE = new TypeError('Failed to fetch dynamically imported module: https://x/assets/FxPage-old.js')
const settled = async (p: Promise<unknown>) => {
  let state = 'pending'
  p.then(() => (state = 'resolved'), () => (state = 'rejected'))
  await new Promise((r) => setTimeout(r, 0))
  return state
}

describe('loadChunk', () => {
  it('passes a successful load through untouched', async () => {
    const { deps, rec } = fakeDeps()
    await expect(loadChunk(async () => ({ Page: 1 }), deps)).resolves.toEqual({ Page: 1 })
    expect(rec.reloads).toBe(0)
  })

  it('reloads once on a failed load and stays pending so Suspense keeps its fallback', async () => {
    const { deps, rec, store } = fakeDeps()
    const p = loadChunk(() => Promise.reject(STALE), deps)
    expect(await settled(p)).toBe('pending')
    expect(rec.reloads).toBe(1)
    expect(store.get('chunk-reload-at')).toBe('1000000')
  })

  it('rethrows to the ErrorBoundary when it already reloaded within 30 s', async () => {
    const { deps, rec } = fakeDeps({ 'chunk-reload-at': String(1_000_000 - 29_999) })
    await expect(loadChunk(() => Promise.reject(STALE), deps)).rejects.toBe(STALE)
    expect(rec.reloads).toBe(0)
  })

  it('reloads again once the 30 s window has passed', async () => {
    const { deps, rec } = fakeDeps({ 'chunk-reload-at': String(1_000_000 - 30_000) })
    expect(await settled(loadChunk(() => Promise.reject(STALE), deps))).toBe('pending')
    expect(rec.reloads).toBe(1)
  })

  it('never reloads without a working guard', async () => {
    const { deps, rec } = fakeDeps()
    const blocked: ChunkReloadDeps = {
      ...deps,
      storage: () => {
        throw new DOMException('denied', 'SecurityError')
      },
    }
    await expect(loadChunk(() => Promise.reject(STALE), blocked)).rejects.toBe(STALE)
    expect(rec.reloads).toBe(0)
  })
})

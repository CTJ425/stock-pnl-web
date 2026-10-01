// @vitest-environment jsdom
/**
 * Task 185 / C4 — local mode returns an empty store for data it cannot read, and the next write
 * replaces it. The unreadable text is copied aside first so it can still be recovered by hand.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { LocalProvider } from './dataProvider'

const KEY = 'stock-pnl-web/local-store-v1'
const BACKUP = `${KEY}/unreadable-backup`

beforeEach(() => {
  localStorage.clear()
})

describe('LocalProvider with an unreadable store', () => {
  it('L1 broken JSON: reads as empty, keeps a copy, and a later write does not lose the copy', async () => {
    const broken = '{"workspaces":[{"id":"w1","name":"我的投資組合"'
    localStorage.setItem(KEY, broken)
    const provider = new LocalProvider()

    expect(await provider.listWorkspaces()).toEqual([])
    expect(localStorage.getItem(BACKUP)).toBe(broken)

    await provider.createWorkspace('新的')
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').workspaces).toHaveLength(1)
    expect(localStorage.getItem(BACKUP)).toBe(broken)
  })

  it('L2 valid JSON of the wrong shape is treated the same way', async () => {
    const wrongShape = JSON.stringify({ workspaces: {}, transactions: [] })
    localStorage.setItem(KEY, wrongShape)

    expect(await new LocalProvider().listWorkspaces()).toEqual([])
    expect(localStorage.getItem(BACKUP)).toBe(wrongShape)
  })

  it('L3 JSON null does not throw out of the read', async () => {
    localStorage.setItem(KEY, 'null')
    expect(await new LocalProvider().listWorkspaces()).toEqual([])
    expect(localStorage.getItem(BACKUP)).toBe('null')
  })

  it('L4 a healthy store, or no store at all, leaves no backup behind', async () => {
    expect(await new LocalProvider().listWorkspaces()).toEqual([])
    await new LocalProvider().createWorkspace('A')
    expect(await new LocalProvider().listWorkspaces()).toHaveLength(1)
    expect(localStorage.getItem(BACKUP)).toBeNull()
  })
})

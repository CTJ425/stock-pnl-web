import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke } },
}))

import { warmStock, resetWarmState } from './warmStock'

const ok = (
  daily: number,
  fund: number,
  complete = true,
  revenueMonths: string[] = [],
  profitQuarters: string[] = [],
) => ({
  data: {
    ok: true,
    dailySynced: daily,
    fundamentalSynced: fund,
    fundamentalComplete: complete,
    revenueMonths,
    profitQuarters,
  },
  error: null,
})

const FAILED_RESULT = {
  ok: false,
  dailySynced: 0,
  fundamentalSynced: 0,
  fundamentalComplete: false,
  backfilled: 0,
}

describe('warmStock', () => {
  beforeEach(() => {
    invoke.mockReset()
    resetWarmState()
  })

  it('以 action: warm 帶代號呼叫 stock-report', async () => {
    invoke.mockResolvedValue(ok(1, 1))
    const r = await warmStock('2330')
    expect(r).toEqual({ ok: true, dailySynced: 1, fundamentalSynced: 1, fundamentalComplete: true, backfilled: 0 })
    expect(invoke).toHaveBeenCalledWith('stock-report', {
      body: { action: 'warm', ticker: '2330', name: '' },
    })
  })

  it('有 name 時一併帶上（0.6.44 後白名單已撤，名稱改由呼叫端提供）', async () => {
    invoke.mockResolvedValue(ok(1, 1))
    await warmStock('2330', '台積電')
    expect(invoke).toHaveBeenCalledWith('stock-report', {
      body: { action: 'warm', ticker: '2330', name: '台積電' },
    })
  })

  it('同一代號整個 session 只送出一次請求——這是額度安全的關鍵', async () => {
    // Without this throttling, a stock that never gets data will cause users to burn an invocation every time they switch to a page.
    invoke.mockResolvedValue(ok(1, 1))
    await warmStock('2330')
    await warmStock('2330')
    await warmStock('2330')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('伺服器回「沒有產出任何東西」時也不重試', async () => {
    invoke.mockResolvedValue(ok(0, 0))
    const first = await warmStock('0050')
    expect(first.ok).toBe(true)
    expect(first.fundamentalSynced).toBe(0)

    const second = await warmStock('0050')
    expect(second.ok).toBe(false)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('併發呼叫共用同一個 promise，不會送出兩次', async () => {
    let resolve: (v: unknown) => void = () => {}
    invoke.mockReturnValue(new Promise((r) => { resolve = r }))

    const a = warmStock('2609')
    const b = warmStock('2609')
    resolve(ok(1, 1))

    expect(await a).toEqual(await b)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('不同代號各自獨立', async () => {
    invoke.mockResolvedValue(ok(1, 1))
    await warmStock('2330')
    await warmStock('2609')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('函式回錯誤或丟出例外時回失敗值，且不重試', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: '403' } })
    expect(await warmStock('9999')).toEqual(FAILED_RESULT)

    invoke.mockRejectedValue(new Error('network'))
    expect(await warmStock('8888')).toEqual(FAILED_RESULT)

    await warmStock('9999')
    await warmStock('8888')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('incomplete 且本輪有補到資料 → 解封，下次還可再 warm', async () => {
    invoke.mockResolvedValue(ok(0, 0, false, ['2026-07', '2026-06'], []))
    const first = await warmStock('2059')
    expect(first.fundamentalComplete).toBe(false)
    expect(first.backfilled).toBe(2)

    invoke.mockResolvedValue(ok(0, 0, true, [], []))
    await warmStock('2059')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('incomplete 但本輪無進度 → 保持封印，不再打 Edge', async () => {
    invoke.mockResolvedValue(ok(0, 0, false, [], []))
    const first = await warmStock('2330')
    expect(first.ok).toBe(true)
    expect(first.backfilled).toBe(0)
    expect(first.fundamentalComplete).toBe(false)

    const second = await warmStock('2330')
    expect(second.ok).toBe(false)
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})

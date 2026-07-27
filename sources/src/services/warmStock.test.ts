import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke } },
}))

import { warmStock, resetWarmState } from './warmStock'

const ok = (daily: number, fund: number) => ({
  data: { ok: true, dailySynced: daily, fundamentalSynced: fund },
  error: null,
})

describe('warmStock', () => {
  beforeEach(() => {
    invoke.mockReset()
    resetWarmState()
  })

  it('以 action: warm 帶代號呼叫 stock-report', async () => {
    invoke.mockResolvedValue(ok(1, 1))
    const r = await warmStock('2330')
    expect(r).toEqual({ ok: true, dailySynced: 1, fundamentalSynced: 1 })
    expect(invoke).toHaveBeenCalledWith('stock-report', { body: { action: 'warm', ticker: '2330' } })
  })

  it('同一代號整個 session 只送出一次請求——這是額度安全的關鍵', async () => {
    // 沒有這條節流，一檔永遠拿不到資料的股票會讓使用者每切一次分頁就燒一次 invocation
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
    expect(await warmStock('9999')).toEqual({ ok: false, dailySynced: 0, fundamentalSynced: 0 })

    invoke.mockRejectedValue(new Error('network'))
    expect(await warmStock('8888')).toEqual({ ok: false, dailySynced: 0, fundamentalSynced: 0 })

    await warmStock('9999')
    await warmStock('8888')
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})

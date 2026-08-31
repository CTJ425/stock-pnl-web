import { describe, it, expect, vi, beforeEach } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke } },
}))

import {
  warmStock,
  warmStockCore,
  warmStockHistory,
  warmStockChips,
  resetWarmState,
} from './warmStock'

const ok = (
  daily: number,
  fund: number,
  complete = true,
  revenueMonths: string[] = [],
  profitQuarters: string[] = [],
  phase?: string,
) => ({
  data: {
    ok: true,
    dailySynced: daily,
    fundamentalSynced: fund,
    fundamentalComplete: complete,
    revenueMonths,
    profitQuarters,
    phase,
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

describe('warmStock (progressive)', () => {
  beforeEach(() => {
    invoke.mockReset()
    resetWarmState()
  })

  it('core then history when incomplete; combines counts', async () => {
    invoke
      .mockResolvedValueOnce(ok(1, 1, false, [], [], 'core'))
      .mockResolvedValueOnce(ok(0, 0, true, ['2026-07', '2026-06'], ['2026-Q1'], 'history'))

    const r = await warmStock('2330', '台積電')
    expect(r).toEqual({
      ok: true,
      dailySynced: 1,
      fundamentalSynced: 1,
      fundamentalComplete: true,
      backfilled: 3,
      phase: 'full',
    })
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenNthCalledWith(1, 'stock-report', expect.objectContaining({
      body: { action: 'warm', ticker: '2330', name: '台積電', phase: 'core' },
    }))
    expect(invoke).toHaveBeenNthCalledWith(2, 'stock-report', expect.objectContaining({
      body: { action: 'warm', ticker: '2330', name: '台積電', phase: 'history' },
    }))
  })

  it('skips history when core reports complete', async () => {
    invoke.mockResolvedValue(ok(1, 1, true, [], [], 'core'))
    const r = await warmStock('2330')
    expect(r.fundamentalComplete).toBe(true)
    expect(r.phase).toBe('core')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('同一代號整個 session core 只送出一次——額度安全', async () => {
    invoke.mockResolvedValue(ok(1, 1, true, [], [], 'core'))
    await warmStock('2330')
    await warmStock('2330')
    await warmStockCore('2330')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('BUG-A: core 封印後再呼叫回傳上次結果（非 FAILED），history 仍可接續', async () => {
    invoke
      .mockResolvedValueOnce(ok(1, 1, false, [], [], 'core'))
      .mockResolvedValueOnce(ok(0, 0, true, ['2026-07'], ['2026-Q1'], 'history'))

    const firstCore = await warmStockCore('2881', '富邦金')
    expect(firstCore.ok).toBe(true)
    expect(firstCore.fundamentalComplete).toBe(false)

    // Second core: sealed, must echo last result so callers can chain history
    const sealed = await warmStockCore('2881')
    expect(sealed).toEqual(firstCore)
    expect(invoke).toHaveBeenCalledTimes(1)

    // warmStock still runs history because cached core is incomplete
    const progressive = await warmStock('2881', '富邦金')
    expect(progressive.fundamentalComplete).toBe(true)
    expect(progressive.backfilled).toBe(2)
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[1][1].body.phase).toBe('history')
  })

  it('incomplete 且 history 有進度 → 解封 history，下次還可再補', async () => {
    invoke
      .mockResolvedValueOnce(ok(1, 1, false, [], [], 'core'))
      .mockResolvedValueOnce(ok(0, 0, false, ['2026-07'], [], 'history'))
      .mockResolvedValueOnce(ok(0, 0, true, ['2026-06'], [], 'history'))

    const first = await warmStock('2059')
    expect(first.fundamentalComplete).toBe(false)
    expect(first.backfilled).toBe(1)

    // core still sealed; history unsealed → only history fires
    const second = await warmStockHistory('2059')
    expect(second.fundamentalComplete).toBe(true)
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(invoke.mock.calls[2][1].body.phase).toBe('history')
  })

  it('incomplete 但 history 無進度 → 保持封印並回傳上次 history 結果', async () => {
    invoke
      .mockResolvedValueOnce(ok(1, 1, false, [], [], 'core'))
      .mockResolvedValueOnce(ok(0, 0, false, [], [], 'history'))

    const first = await warmStock('2330')
    expect(first.backfilled).toBe(0)

    const second = await warmStockHistory('2330')
    // Sealed: echo last history (ok with 0 backfill), not a bare FAILED
    expect(second.ok).toBe(true)
    expect(second.backfilled).toBe(0)
    expect(second.fundamentalComplete).toBe(false)
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('函式回錯誤或丟出例外時回失敗值，且不重試 core', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: '403' } })
    expect(await warmStockCore('9999')).toMatchObject(FAILED_RESULT)

    invoke.mockRejectedValue(new Error('network'))
    expect(await warmStockCore('8888')).toMatchObject(FAILED_RESULT)

    await warmStockCore('9999')
    await warmStockCore('8888')
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})

describe('warmStockCore', () => {
  beforeEach(() => {
    invoke.mockReset()
    resetWarmState()
  })

  it('以 phase: core 呼叫', async () => {
    invoke.mockResolvedValue(ok(1, 1, false, [], [], 'core'))
    const r = await warmStockCore('2609', '陽明')
    expect(r).toEqual({
      ok: true,
      dailySynced: 1,
      fundamentalSynced: 1,
      fundamentalComplete: false,
      backfilled: 0,
      phase: 'core',
    })
    expect(invoke).toHaveBeenCalledWith('stock-report', expect.objectContaining({
      body: { action: 'warm', ticker: '2609', name: '陽明', phase: 'core' },
    }))
  })

  it('併發呼叫共用同一個 promise', async () => {
    let resolve: (v: unknown) => void = () => {}
    invoke.mockReturnValue(new Promise((r) => { resolve = r }))

    const a = warmStockCore('2609')
    const b = warmStockCore('2609')
    resolve(ok(1, 1, false, [], [], 'core'))

    expect(await a).toEqual(await b)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('不同代號各自獨立', async () => {
    invoke.mockResolvedValue(ok(1, 1, true, [], [], 'core'))
    await warmStockCore('2330')
    await warmStockCore('2609')
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})

describe('warmStockHistory', () => {
  beforeEach(() => {
    invoke.mockReset()
    resetWarmState()
  })

  it('以 phase: history 呼叫', async () => {
    invoke.mockResolvedValue(ok(0, 0, true, ['2026-07'], ['2026-Q1'], 'history'))
    const r = await warmStockHistory('2330')
    expect(r.backfilled).toBe(2)
    expect(r.phase).toBe('history')
    expect(invoke).toHaveBeenCalledWith('stock-report', expect.objectContaining({
      body: { action: 'warm', ticker: '2330', name: '', phase: 'history' },
    }))
  })
})

describe('warmStockChips (Task 130)', () => {
  beforeEach(() => {
    invoke.mockReset()
    resetWarmState()
  })

  const okChips = (daysWritten: number, skipped = false) => ({
    data: {
      ok: true,
      ticker: '2059',
      phase: 'chips',
      daysWritten,
      daysFetchedUpstream: 0,
      skipped: skipped ? 'already-present' : undefined,
    },
    error: null,
  })

  it('以 phase: chips 呼叫', async () => {
    invoke.mockResolvedValue(okChips(7))
    const r = await warmStockChips('2059', '川湖')
    expect(r).toMatchObject({ ok: true, daysWritten: 7 })
    expect(invoke).toHaveBeenCalledWith('stock-report', expect.objectContaining({
      body: { action: 'warm', ticker: '2059', name: '川湖', phase: 'chips' },
    }))
  })

  it('省略名稱時送出空字串——與其他 phase 一致', async () => {
    invoke.mockResolvedValue(okChips(7))
    await warmStockChips('2059')
    expect(invoke).toHaveBeenCalledWith('stock-report', expect.objectContaining({
      body: { action: 'warm', ticker: '2059', name: '', phase: 'chips' },
    }))
  })

  it('已補齊時回傳 skipped，不視為失敗', async () => {
    invoke.mockResolvedValue(okChips(0, true))
    const r = await warmStockChips('2059')
    expect(r.ok).toBe(true)
    expect(r.skipped).toBe(true)
    expect(r.daysWritten).toBe(0)
  })

  it('同一 session 同代號只送出一次——額度安全', async () => {
    invoke.mockResolvedValue(okChips(7))
    await warmStockChips('2059')
    await warmStockChips('2059')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('resetWarmState 會清掉 chips 封印', async () => {
    invoke.mockResolvedValue(okChips(7))
    await warmStockChips('2059')
    resetWarmState()
    await warmStockChips('2059')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('不同代號各自獨立', async () => {
    invoke.mockResolvedValue(okChips(7))
    await warmStockChips('2059')
    await warmStockChips('2330')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('回錯誤或丟例外時回失敗值，且不丟出', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: '403' } })
    expect(await warmStockChips('9999')).toMatchObject({ ok: false, daysWritten: 0 })

    invoke.mockRejectedValue(new Error('network'))
    expect(await warmStockChips('8888')).toMatchObject({ ok: false, daysWritten: 0 })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({
  supabase: { functions: { invoke } },
}))

import { runAdminJobs } from './adminRun'

describe('runAdminJobs', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('全部執行時 body 帶 jobs: all', async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        jobs: ['generate-all', 'sync-market', 'sync-macro', 'sync-fx', 'probe'],
        results: {},
        failed: [],
        durationMs: 12,
      },
      error: null,
    })
    const r = await runAdminJobs('all')
    expect(r.ok).toBe(true)
    expect(invoke).toHaveBeenCalledWith('stock-report', {
      body: { action: 'admin-run', jobs: 'all' },
    })
  })

  it('個別 job 以陣列送出', async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        jobs: ['sync-market'],
        results: {
          'sync-market': { httpStatus: 200, durationMs: 5, body: { ok: true } },
        },
        failed: [],
        durationMs: 5,
      },
      error: null,
    })
    const r = await runAdminJobs(['sync-market'])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.jobs).toEqual(['sync-market'])
      expect(r.data.results['sync-market']?.httpStatus).toBe(200)
    }
    expect(invoke).toHaveBeenCalledWith('stock-report', {
      body: { action: 'admin-run', jobs: ['sync-market'] },
    })
  })

  it('Edge 回 error 字串時轉成失敗', async () => {
    invoke.mockResolvedValue({
      data: { ok: false, error: 'Forbidden' },
      error: null,
    })
    const r = await runAdminJobs(['probe'])
    expect(r).toEqual({ ok: false, error: 'Forbidden' })
  })
})

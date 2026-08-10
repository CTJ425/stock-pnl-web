import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({
  supabase: { functions: { invoke } },
}))

import { ADMIN_RUN_JOBS, runAdminJobs } from './adminRun'

describe('runAdminJobs', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('全部執行時對每個 job 各 invoke 一次（避免單請求 wall-clock 逾時）', async () => {
    invoke.mockImplementation(async (_name: string, opts: { body: { jobs: string[] } }) => {
      const job = opts.body.jobs[0]
      return {
        data: {
          ok: true,
          jobs: [job],
          results: {
            [job]: { httpStatus: 200, durationMs: 3, body: { ok: true } },
          },
          failed: [],
          durationMs: 3,
        },
        error: null,
      }
    })
    const r = await runAdminJobs('all')
    expect(r.ok).toBe(true)
    expect(invoke).toHaveBeenCalledTimes(ADMIN_RUN_JOBS.length)
    for (const job of ADMIN_RUN_JOBS) {
      expect(invoke).toHaveBeenCalledWith('stock-report', {
        body: { action: 'admin-run', jobs: [job] },
      })
    }
    if (r.ok) {
      expect(r.data.jobs).toEqual([...ADMIN_RUN_JOBS])
      expect(r.data.ok).toBe(true)
      expect(r.data.failed).toEqual([])
    }
  })

  it('個別 job 以單元素陣列送出', async () => {
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
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('stock-report', {
      body: { action: 'admin-run', jobs: ['sync-market'] },
    })
  })

  it('單一 job 的 Edge error 字串（200 包體）轉成失敗訊息', async () => {
    invoke.mockResolvedValue({
      data: { ok: false, error: 'Forbidden' },
      error: null,
    })
    const r = await runAdminJobs(['probe'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Forbidden/)
  })

  it('transport 失敗時仍彙總其他 job 的結果', async () => {
    invoke.mockImplementation(async (_name: string, opts: { body: { jobs: string[] } }) => {
      const job = opts.body.jobs[0]
      if (job === 'generate-all') {
        const res = new Response('Gateway Timeout', { status: 504 })
        return {
          data: null,
          error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
            context: res,
          }),
        }
      }
      return {
        data: {
          ok: true,
          jobs: [job],
          results: {
            [job]: { httpStatus: 200, durationMs: 2, body: { ok: true } },
          },
          failed: [],
          durationMs: 2,
        },
        error: null,
      }
    })
    const r = await runAdminJobs(['generate-all', 'sync-fx'])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.failed).toContain('generate-all')
      expect(r.data.results['sync-fx']?.httpStatus).toBe(200)
      const genBody = r.data.results['generate-all']?.body as { error?: string }
      expect(genBody?.error).toMatch(/504|逾時|Gateway/)
    }
  })

  it('全部 transport 失敗且無結果時回 ok:false', async () => {
    const res = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
        context: res,
      }),
    })
    const r = await runAdminJobs(['probe'])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/Unauthorized|401/)
    }
  })

  it('onProgress 在每個 job 開始與結束時回報', async () => {
    invoke.mockImplementation(async (_name: string, opts: { body: { jobs: string[] } }) => {
      const job = opts.body.jobs[0]
      return {
        data: {
          ok: true,
          jobs: [job],
          results: {
            [job]: { httpStatus: 200, durationMs: 1, body: { ok: true } },
          },
          failed: [],
          durationMs: 1,
        },
        error: null,
      }
    })
    const events: Array<{ phase: string; job: string; completed: number }> = []
    await runAdminJobs(['sync-fx', 'probe'], (p) => {
      events.push({ phase: p.phase, job: p.job, completed: p.completed })
    })
    expect(events).toEqual([
      { phase: 'job-start', job: 'sync-fx', completed: 0 },
      { phase: 'job-done', job: 'sync-fx', completed: 1 },
      { phase: 'job-start', job: 'probe', completed: 1 },
      { phase: 'job-done', job: 'probe', completed: 2 },
    ])
  })
})

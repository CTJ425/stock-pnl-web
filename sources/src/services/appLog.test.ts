/**
 * Spec 146 — application log capture.
 *
 * Two contracts matter more than the rest, and both fail closed:
 *   1. `redactDetail` is an allowlist. A denylist or a value regex already leaked the DEV
 *      CRON_SECRET into a transcript once; an unknown key must disappear, at every depth.
 *   2. `logClient` never throws and never blocks. A failure to record a problem must not
 *      become a second problem.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const { insert, select, getSession, functionsInvoke } = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  getSession: vi.fn(),
  functionsInvoke: vi.fn(),
}))

vi.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession },
    from: () => ({ insert }),
    functions: { invoke: functionsInvoke },
  },
}))

const { redactDetail, logClient, fetchAppLogs, __resetLogDedupe } = await import('./appLog')

const SESSION = { data: { session: { user: { id: 'u1' } } } }

beforeEach(() => {
  vi.clearAllMocks()
  __resetLogDedupe()
  getSession.mockResolvedValue(SESSION)
  insert.mockResolvedValue({ error: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('redactDetail', () => {
  it('keeps an allowlisted key', () => {
    expect(redactDetail({ ticker: '2330' })).toEqual({ ticker: '2330' })
  })

  it('drops an unknown key', () => {
    expect(redactDetail({ apikey: 'sbp_secret', authorization: 'Bearer x' })).toEqual({})
  })

  it('drops an unknown key nested inside an allowlisted one', () => {
    const out = redactDetail({ code: 'PGRST116', hint: { headers: { authorization: 'x' } } })
    expect(out).toEqual({ code: 'PGRST116', hint: {} })
  })

  it('drops unknown keys inside an array', () => {
    const out = redactDetail({ name: [{ ticker: '2330', token: 'x' }] })
    expect(out).toEqual({ name: [{ ticker: '2330' }] })
  })

  it('truncates a string inside an array', () => {
    const out = redactDetail({ name: ['x'.repeat(900)] })
    expect((out.name as string[])[0].length).toBe(500)
  })

  it('caps an array at 20 items', () => {
    const out = redactDetail({ name: Array.from({ length: 50 }, (_, i) => ({ ticker: String(i) })) })
    expect((out.name as unknown[]).length).toBe(20)
  })

  it('truncates stack to 2000 characters', () => {
    const out = redactDetail({ stack: 'a'.repeat(5000) })
    expect((out.stack as string).length).toBe(2000)
  })

  it('truncates any other string to 500 characters', () => {
    const out = redactDetail({ message: 'b'.repeat(900), hint: 'c'.repeat(900) })
    expect((out.hint as string).length).toBe(500)
  })

  it('returns an empty object for a non-object input', () => {
    expect(redactDetail(null)).toEqual({})
    expect(redactDetail('boom')).toEqual({})
  })
})

describe('logClient', () => {
  it('writes source web, the session user, and the app version', async () => {
    logClient('error', 'importCsv', 'parse failed', { ticker: '2330' })
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1))
    const row = insert.mock.calls[0][0] as Record<string, unknown>
    expect(row.source).toBe('web')
    expect(row.level).toBe('error')
    expect(row.action).toBe('importCsv')
    expect(row.user_id).toBe('u1')
    expect(row.detail).toEqual({ ticker: '2330' })
    expect(typeof row.app_version).toBe('string')
  })

  /**
   * Verified against DEV on 2026-09-06: `app_log` has an INSERT policy and deliberately no SELECT
   * policy, and PostgreSQL requires a SELECT policy for `INSERT ... RETURNING`. supabase-js only
   * adds RETURNING when `.select()` is chained, so chaining it here would make every client-side
   * log fail — silently, because logClient swallows its own errors.
   */
  it('never chains .select() onto the insert — RETURNING needs a SELECT policy', async () => {
    // Hand the code a chainable result, so a `.select()` call would be recorded rather than throw.
    insert.mockReturnValue({ select })
    logClient('error', 'saveTx', 'no returning')
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1))
    expect(select).not.toHaveBeenCalled()
  })

  it('redacts detail before it writes', async () => {
    logClient('error', 'saveTx', 'rejected', { code: 'PGRST301', apikey: 'sbp_secret' })
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1))
    const row = insert.mock.calls[0][0] as Record<string, unknown>
    expect(row.detail).toEqual({ code: 'PGRST301' })
  })

  it('truncates an over-long message to 500 characters', async () => {
    logClient('error', 'saveTx', 'x'.repeat(900))
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1))
    const row = insert.mock.calls[0][0] as Record<string, unknown>
    expect((row.message as string).length).toBe(500)
  })

  it('writes nothing when no session exists', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    logClient('error', 'saveTx', 'no session')
    await new Promise((r) => setTimeout(r, 10))
    expect(insert).not.toHaveBeenCalled()
  })

  it('does not throw when the insert rejects', async () => {
    insert.mockRejectedValue(new Error('network down'))
    expect(() => logClient('error', 'saveTx', 'boom')).not.toThrow()
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1))
  })

  it('does not throw when getSession rejects', async () => {
    getSession.mockRejectedValue(new Error('auth down'))
    expect(() => logClient('error', 'saveTx', 'boom')).not.toThrow()
    await new Promise((r) => setTimeout(r, 10))
    expect(insert).not.toHaveBeenCalled()
  })

  it('drops a repeat of the same action and message inside the dedupe window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T00:00:00Z'))
    logClient('error', 'render', 'same')
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1))
    vi.setSystemTime(new Date('2026-09-06T00:04:59Z'))
    logClient('error', 'render', 'same')
    await vi.advanceTimersByTimeAsync(5)
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('writes the same event again after the dedupe window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T00:00:00Z'))
    logClient('error', 'render', 'same')
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1))
    vi.setSystemTime(new Date('2026-09-06T00:05:01Z'))
    logClient('error', 'render', 'same')
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(2))
  })

  it('does not dedupe two different messages', async () => {
    logClient('error', 'render', 'first')
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1))
    logClient('error', 'render', 'second')
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(2))
  })
})

describe('fetchAppLogs', () => {
  const ROW = {
    id: 7,
    at: '2026-09-06T01:00:00Z',
    level: 'error',
    source: 'edge',
    action: 'generate-all',
    message: 'boom',
    detail: { code: 'X' },
    user_id: null,
    app_version: '0.9.34',
    request_id: 'r1',
  }

  it('calls stock-report with action app-logs and the given filters', async () => {
    functionsInvoke.mockResolvedValue({ data: { ok: true, logs: [ROW] }, error: null })
    await fetchAppLogs({ limit: 50, level: 'error', source: 'edge' })
    const body = functionsInvoke.mock.calls[0][1].body as Record<string, unknown>
    expect(functionsInvoke.mock.calls[0][0]).toBe('stock-report')
    expect(body.action).toBe('app-logs')
    expect(body.limit).toBe(50)
    expect(body.level).toBe('error')
    expect(body.source).toBe('edge')
  })

  it('maps a row into camelCase', async () => {
    functionsInvoke.mockResolvedValue({ data: { ok: true, logs: [ROW] }, error: null })
    const rows = await fetchAppLogs()
    expect(rows).toHaveLength(1)
    expect(rows[0].requestId).toBe('r1')
    expect(rows[0].appVersion).toBe('0.9.34')
    expect(rows[0].userId).toBeNull()
  })

  it('drops a malformed row and keeps the valid one', async () => {
    functionsInvoke.mockResolvedValue({
      data: { ok: true, logs: [{ id: 'nope', level: 'error' }, ROW] },
      error: null,
    })
    const rows = await fetchAppLogs()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(7)
  })

  it('returns an empty array when ok is not true', async () => {
    functionsInvoke.mockResolvedValue({ data: { ok: false }, error: null })
    await expect(fetchAppLogs()).resolves.toEqual([])
  })

  it('returns an empty array when the invoke errors', async () => {
    functionsInvoke.mockResolvedValue({ data: null, error: new Error('403') })
    await expect(fetchAppLogs()).resolves.toEqual([])
  })

  it('returns an empty array when the invoke rejects', async () => {
    functionsInvoke.mockRejectedValue(new Error('network'))
    await expect(fetchAppLogs()).resolves.toEqual([])
  })
})

describe('logClient without a supabase client', () => {
  it('is a no-op and does not throw', async () => {
    vi.resetModules()
    vi.doMock('./supabase', () => ({ isSupabaseConfigured: false, supabase: null }))
    const mod = await import('./appLog')
    expect(() => mod.logClient('error', 'saveTx', 'boom')).not.toThrow()
    await expect(mod.fetchAppLogs()).resolves.toEqual([])
    vi.doUnmock('./supabase')
  })
})

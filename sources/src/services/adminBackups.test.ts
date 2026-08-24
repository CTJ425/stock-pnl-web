import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({
  supabase: { functions: { invoke } },
  supabaseUrl: 'https://supabase.example',
}))

import { fetchAdminBackups, requestBackupUrl } from './adminBackups'

const UID = '0754d012-7a86-477f-8009-f81531281caf'

const account = {
  userId: UID,
  email: 'a@example.com',
  fileCount: 2,
  newestDate: '2026-08-24',
  totalBytes: 20510,
  files: [
    { name: '2026-08-24.json', date: '2026-08-24', size: 20000, createdAt: '2026-08-24T18:00:00.000Z' },
    { name: '2026-08-23.json', date: '2026-08-23', size: 510, createdAt: null },
  ],
  lastRun: { runDate: '2026-08-24', status: 'ok', error: null, transactionCount: 62 },
}

describe('fetchAdminBackups', () => {
  // Braces matter: `() => invoke.mockReset()` returns the mock, and vitest treats a function
  // returned from a hook as a teardown — it would call `invoke` after the test, producing an
  // unhandled rejection in the cases below that reject. Same reason adminRun.test.ts:12 uses a block.
  beforeEach(() => {
    invoke.mockReset()
  })

  it('呼叫 stock-report 的 admin-backups action', async () => {
    invoke.mockResolvedValue({ data: { ok: true, accounts: [account] }, error: null })
    await fetchAdminBackups()
    expect(invoke).toHaveBeenCalledWith('stock-report', expect.objectContaining({
      body: { action: 'admin-backups' },
    }))
  })

  it('回傳解析後的帳號清單', async () => {
    invoke.mockResolvedValue({ data: { ok: true, accounts: [account] }, error: null })
    const rows = await fetchAdminBackups()
    expect(rows).toHaveLength(1)
    expect(rows![0].email).toBe('a@example.com')
    expect(rows![0].fileCount).toBe(2)
    expect(rows![0].totalBytes).toBe(20510)
    expect(rows![0].files[0].name).toBe('2026-08-24.json')
    expect(rows![0].lastRun?.transactionCount).toBe(62)
  })

  it('沒有備份的帳號不會被丟掉，也不會捏造日期', async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        accounts: [{ userId: UID, email: 'b@example.com', fileCount: 0, newestDate: null, totalBytes: 0, files: [], lastRun: null }],
      },
      error: null,
    })
    const rows = await fetchAdminBackups()
    expect(rows).toHaveLength(1)
    expect(rows![0].newestDate).toBeNull()
    expect(rows![0].lastRun).toBeNull()
    expect(rows![0].files).toEqual([])
  })

  it('後端回錯或 ok 不為 true 時回 null，不丟例外', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await fetchAdminBackups()).toBeNull()
    invoke.mockResolvedValue({ data: { ok: false }, error: null })
    expect(await fetchAdminBackups()).toBeNull()
  })

  it('invoke 丟例外時回 null', async () => {
    invoke.mockImplementation(() => Promise.reject(new Error('network')))
    expect(await fetchAdminBackups()).toBeNull()
  })

  it('欄位型別不對時退回安全值，不讓畫面爆炸', async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        accounts: [{ userId: UID, email: 123, fileCount: 'two', newestDate: 5, totalBytes: null, files: 'nope', lastRun: 'nope' }],
      },
      error: null,
    })
    const rows = await fetchAdminBackups()
    expect(rows![0].email).toBe('')
    expect(rows![0].fileCount).toBe(0)
    expect(rows![0].newestDate).toBeNull()
    expect(rows![0].totalBytes).toBe(0)
    expect(rows![0].files).toEqual([])
    expect(rows![0].lastRun).toBeNull()
  })
})

describe('requestBackupUrl', () => {
  // Braces matter: `() => invoke.mockReset()` returns the mock, and vitest treats a function
  // returned from a hook as a teardown — it would call `invoke` after the test, producing an
  // unhandled rejection in the cases below that reject. Same reason adminRun.test.ts:12 uses a block.
  beforeEach(() => {
    invoke.mockReset()
  })

  it('帶著路徑呼叫 admin-backup-url 並回傳簽名網址', async () => {
    invoke.mockResolvedValue({ data: { ok: true, url: 'https://signed.example/x', expiresIn: 60 }, error: null })
    const res = await requestBackupUrl(`${UID}/2026-08-24.json`)
    expect(invoke).toHaveBeenCalledWith('stock-report', expect.objectContaining({
      body: { action: 'admin-backup-url', path: `${UID}/2026-08-24.json` },
    }))
    expect(res).toEqual({ url: 'https://signed.example/x' })
  })

  it('後端訊息要傳到畫面，不能吞掉', async () => {
    invoke.mockResolvedValue({ data: { ok: false, error: '備份路徑格式不正確' }, error: null })
    expect(await requestBackupUrl('../x')).toEqual({ error: '備份路徑格式不正確' })
  })

  it('非 2xx 時從 error.context 取出後端訊息', async () => {
    const context = new Response(JSON.stringify({ error: '找不到備份檔' }), { status: 404 })
    invoke.mockResolvedValue({ data: null, error: Object.assign(new Error('non-2xx'), { context }) })
    expect(await requestBackupUrl(`${UID}/2026-01-01.json`)).toEqual({ error: '找不到備份檔' })
  })

  it('完全取不到訊息時仍給使用者一句話，而不是 undefined', async () => {
    invoke.mockImplementation(() => Promise.reject(new Error('network down')))
    const res = await requestBackupUrl(`${UID}/2026-08-24.json`)
    expect('error' in res && res.error.length > 0).toBe(true)
  })

  /*
    DEV verification (2026-08-24) caught this: on self-hosted Supabase the Edge function's client is
    built from the *internal* SUPABASE_URL, so `createSignedUrl` returned `http://kong:8000/...` —
    a hostname no browser can resolve. The backend therefore returns a root-relative URL and the
    browser side, which is the only place that knows the public URL, makes it absolute.
  */
  it('後端給相對路徑時，補上前端設定的 Supabase 公開網址', async () => {
    invoke.mockResolvedValue({
      data: { ok: true, url: `/storage/v1/object/sign/backups/${UID}/2026-08-24.json?token=abc`, expiresIn: 60 },
      error: null,
    })
    const res = await requestBackupUrl(`${UID}/2026-08-24.json`)
    expect('url' in res && res.url).toBe(
      `https://supabase.example/storage/v1/object/sign/backups/${UID}/2026-08-24.json?token=abc`,
    )
  })

  it('後端已經給絕對網址時原樣使用，不重複加前綴', async () => {
    invoke.mockResolvedValue({ data: { ok: true, url: 'https://signed.example/x', expiresIn: 60 }, error: null })
    expect(await requestBackupUrl(`${UID}/2026-08-24.json`)).toEqual({ url: 'https://signed.example/x' })
  })

})

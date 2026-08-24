import { describe, expect, it } from 'vitest'
import {
  isValidBackupPath,
  parseBackupDocument,
  restoreFailureMessage,
  rowsToInsert,
  summarizeAccountBackups,
  type BackupObject,
} from './backupAdmin'

const UID = '0754d012-7a86-477f-8009-f81531281caf'

describe('isValidBackupPath', () => {
  it('accepts exactly <uuid>/<YYYY-MM-DD>.json', () => {
    expect(isValidBackupPath(`${UID}/2026-08-24.json`)).toBe(true)
  })

  it('rejects parent-directory traversal', () => {
    expect(isValidBackupPath(`${UID}/../${UID}/2026-08-24.json`)).toBe(false)
    expect(isValidBackupPath('../secrets.json')).toBe(false)
    expect(isValidBackupPath(`..%2f${UID}/2026-08-24.json`)).toBe(false)
  })

  it('rejects a path that escapes the account prefix', () => {
    expect(isValidBackupPath(`${UID}/2026-08-24.json/../../other.json`)).toBe(false)
    expect(isValidBackupPath(`/${UID}/2026-08-24.json`)).toBe(false)
  })

  it('rejects a non-uuid prefix', () => {
    expect(isValidBackupPath('admin/2026-08-24.json')).toBe(false)
    expect(isValidBackupPath('0754d012/2026-08-24.json')).toBe(false)
  })

  it('rejects a bad or missing date', () => {
    expect(isValidBackupPath(`${UID}/2026-8-24.json`)).toBe(false)
    expect(isValidBackupPath(`${UID}/notes.json`)).toBe(false)
    expect(isValidBackupPath(`${UID}/2026-08-24.txt`)).toBe(false)
    expect(isValidBackupPath(`${UID}/2026-08-24`)).toBe(false)
  })

  it('rejects extra depth and empty input', () => {
    expect(isValidBackupPath(`${UID}/sub/2026-08-24.json`)).toBe(false)
    expect(isValidBackupPath('')).toBe(false)
    expect(isValidBackupPath(UID)).toBe(false)
  })

  it('rejects a query string or fragment glued on', () => {
    expect(isValidBackupPath(`${UID}/2026-08-24.json?x=1`)).toBe(false)
    expect(isValidBackupPath(`${UID}/2026-08-24.json\n`)).toBe(false)
  })
})

describe('summarizeAccountBackups', () => {
  const obj = (name: string, size: number, createdAt: string | null = null): BackupObject => ({
    name,
    size,
    createdAt,
  })

  it('counts, totals and finds the newest date', () => {
    const s = summarizeAccountBackups(UID, 'a@example.com', [
      obj('2026-08-22.json', 100),
      obj('2026-08-24.json', 300),
      obj('2026-08-23.json', 200),
    ])
    expect(s.userId).toBe(UID)
    expect(s.email).toBe('a@example.com')
    expect(s.fileCount).toBe(3)
    expect(s.totalBytes).toBe(600)
    expect(s.newestDate).toBe('2026-08-24')
  })

  it('lists files newest first and exposes the date separately from the name', () => {
    const s = summarizeAccountBackups(UID, 'a@example.com', [
      obj('2026-08-22.json', 1),
      obj('2026-08-24.json', 1),
      obj('2026-08-23.json', 1),
    ])
    expect(s.files.map((f) => f.date)).toEqual(['2026-08-24', '2026-08-23', '2026-08-22'])
    expect(s.files[0].name).toBe('2026-08-24.json')
  })

  it('ignores anything that is not a dated backup object', () => {
    const s = summarizeAccountBackups(UID, 'a@example.com', [
      obj('notes.txt', 999),
      obj('.emptyFolderPlaceholder', 0),
      obj('2026-08-24.json', 50),
    ])
    expect(s.fileCount).toBe(1)
    expect(s.totalBytes).toBe(50)
    expect(s.files.map((f) => f.name)).toEqual(['2026-08-24.json'])
  })

  it('reports an account with no backups without inventing a date', () => {
    const s = summarizeAccountBackups(UID, 'a@example.com', [])
    expect(s.fileCount).toBe(0)
    expect(s.totalBytes).toBe(0)
    expect(s.newestDate).toBeNull()
    expect(s.files).toEqual([])
  })

  it('keeps createdAt when present and null when not', () => {
    const s = summarizeAccountBackups(UID, 'a@example.com', [
      obj('2026-08-24.json', 10, '2026-08-24T18:00:00.000Z'),
      obj('2026-08-23.json', 10),
    ])
    expect(s.files[0].createdAt).toBe('2026-08-24T18:00:00.000Z')
    expect(s.files[1].createdAt).toBeNull()
  })

  it('treats a missing size as zero rather than NaN', () => {
    const s = summarizeAccountBackups(UID, 'a@example.com', [
      { name: '2026-08-24.json', size: Number.NaN, createdAt: null },
      obj('2026-08-23.json', 10),
    ])
    expect(s.totalBytes).toBe(10)
    expect(s.files[0].size).toBe(0)
  })
})

describe('parseBackupDocument', () => {
  const doc = (over: Record<string, unknown> = {}) => ({
    version: 1,
    user_id: UID,
    backup_date: '2026-08-24',
    exported_at: '2026-08-23T18:00:00.000Z',
    tables: {
      workspaces: [{ id: 'ws-1', user_id: UID }],
      transactions: [{ id: 'tx-1', user_id: UID }],
      user_settings: [{ user_id: UID }],
    },
    ...over,
  })

  it('accepts a well-formed document for the expected account', () => {
    const r = parseBackupDocument(doc(), UID)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.doc.tables.transactions).toHaveLength(1)
  })

  it('rejects anything that is not an object with tables', () => {
    for (const bad of [null, 'x', 42, [], {}, { version: 1 }]) {
      const r = parseBackupDocument(bad, UID)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toBe('備份檔格式無法辨識')
    }
  })

  it('rejects an unsupported version', () => {
    const r = parseBackupDocument(doc({ version: 2 }), UID)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('備份檔版本不支援')
  })

  it('names the table that is missing or malformed', () => {
    const r = parseBackupDocument(
      doc({ tables: { workspaces: [], transactions: 'nope', user_settings: [] } }),
      UID,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('備份檔缺少資料表：transactions')
  })

  /* The whole reason this function exists: a file must never be able to write into another account. */
  it('rejects a document whose account does not match the path', () => {
    const other = '11111111-2222-3333-4444-555555555555'
    const r = parseBackupDocument(doc(), other)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('備份檔的帳號與路徑不符')
  })

  it('rejects a document with even one row belonging to someone else', () => {
    const tampered = doc({
      tables: {
        workspaces: [{ id: 'ws-1', user_id: UID }],
        transactions: [
          { id: 'tx-1', user_id: UID },
          { id: 'tx-2', user_id: '11111111-2222-3333-4444-555555555555' },
        ],
        user_settings: [],
      },
    })
    const r = parseBackupDocument(tampered, UID)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('備份檔內有不屬於該帳號的資料列')
  })

  it('accepts empty tables — an account with no data is still a valid backup', () => {
    const empty = doc({ tables: { workspaces: [], transactions: [], user_settings: [] } })
    expect(parseBackupDocument(empty, UID).ok).toBe(true)
  })
})

describe('rowsToInsert', () => {
  it('keeps only the rows whose key is absent, in file order', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(rowsToInsert(rows, ['b'], 'id')).toEqual([{ id: 'a' }, { id: 'c' }])
  })

  it('returns nothing when everything is already present — restore must be a no-op', () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    expect(rowsToInsert(rows, ['a', 'b'], 'id')).toEqual([])
  })

  it('honours a different key field, because user_settings is keyed by user_id', () => {
    const rows = [{ user_id: 'u-1' }, { user_id: 'u-2' }]
    expect(rowsToInsert(rows, ['u-1'], 'user_id')).toEqual([{ user_id: 'u-2' }])
  })

  it('treats an empty existing set as "insert everything"', () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    expect(rowsToInsert(rows, [], 'id')).toEqual(rows)
  })

  it('skips a row missing the key field rather than inserting a keyless row', () => {
    const rows = [{ id: 'a' }, { name: 'no key' }, { id: 'c' }]
    expect(rowsToInsert(rows, [], 'id')).toEqual([{ id: 'a' }, { id: 'c' }])
  })
})

/*
  A restore is several separate writes with no transaction across them, so it can stop half way.
  The reviewer's point: returning a bare Postgres error leaves the admin believing nothing happened
  when workspaces rows are already in. The message has to say what landed.
*/
describe('restoreFailureMessage', () => {
  it('says plainly when nothing was written', () => {
    expect(restoreFailureMessage([], '連線中斷')).toBe('還原失敗：連線中斷。尚未寫入任何資料。')
  })

  it('names what already landed so the admin knows the state is partial', () => {
    expect(restoreFailureMessage([{ table: 'workspaces', count: 2 }], '違反外鍵')).toBe(
      '還原失敗：違反外鍵。已寫入 workspaces 2 筆，請重新預覽確認目前狀態。',
    )
  })

  it('lists every table that landed', () => {
    expect(
      restoreFailureMessage(
        [
          { table: 'workspaces', count: 2 },
          { table: 'transactions', count: 51 },
        ],
        '逾時',
      ),
    ).toBe('還原失敗：逾時。已寫入 workspaces 2 筆、transactions 51 筆，請重新預覽確認目前狀態。')
  })

  it('ignores tables that wrote nothing', () => {
    expect(restoreFailureMessage([{ table: 'workspaces', count: 0 }], '逾時')).toBe(
      '還原失敗：逾時。尚未寫入任何資料。',
    )
  })
})

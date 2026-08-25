import { describe, expect, it } from 'vitest'
import {
  backupObjectPath,
  buildBackupPayload,
  describeError,
  prunablePaths,
  rowCounts,
  taipeiYmd,
  type BackupTables,
} from './backupPlan'

const emptyTables = (): BackupTables => ({ workspaces: [], transactions: [], user_settings: [] })

describe('taipeiYmd', () => {
  it('rolls to the next day for UTC evening, because Taipei is +8', () => {
    // Taipei 2026-08-24 01:00 — the moment the 02:00 job is about to fire
    expect(taipeiYmd(new Date('2026-08-23T17:00:00Z'))).toBe('2026-08-24')
  })

  it('keeps the same day for UTC morning', () => {
    expect(taipeiYmd(new Date('2026-08-24T02:30:00Z'))).toBe('2026-08-24')
  })

  it('pads month and day to two digits', () => {
    expect(taipeiYmd(new Date('2026-01-04T00:00:00Z'))).toBe('2026-01-04')
  })

  it('crosses the year boundary', () => {
    expect(taipeiYmd(new Date('2025-12-31T16:00:00Z'))).toBe('2026-01-01')
  })
})

describe('backupObjectPath', () => {
  it('is <user_id>/<date>.json so one prefix holds one account', () => {
    expect(backupObjectPath('11111111-2222-3333-4444-555555555555', '2026-08-24')).toBe(
      '11111111-2222-3333-4444-555555555555/2026-08-24.json',
    )
  })
})

describe('buildBackupPayload', () => {
  const base = {
    userId: 'u-1',
    backupDate: '2026-08-24',
    exportedAt: new Date('2026-08-23T18:00:05Z'),
  }

  it('stamps version, account, date and export time', () => {
    const payload = buildBackupPayload({ ...base, tables: emptyTables() })
    expect(payload.version).toBe(1)
    expect(payload.user_id).toBe('u-1')
    expect(payload.backup_date).toBe('2026-08-24')
    expect(payload.exported_at).toBe('2026-08-23T18:00:05.000Z')
  })

  it('keeps every column verbatim, so a row can go straight back into the table', () => {
    const row = {
      id: 'tx-9',
      user_id: 'u-1',
      workspace_id: 'ws-1',
      tx_date: '2026-08-20',
      ticker: '2330',
      qty: 1000,
      price: 1085.5,
      fee_tax: 154,
      created_at: '2026-08-20T01:02:03.000Z',
    }
    const payload = buildBackupPayload({
      ...base,
      tables: { ...emptyTables(), transactions: [row] },
    })
    expect(payload.tables.transactions[0]).toEqual(row)
  })

  it('orders transactions by tx_date then id, so daily files are diffable', () => {
    const tables: BackupTables = {
      ...emptyTables(),
      transactions: [
        { id: 'b', tx_date: '2026-08-20' },
        { id: 'a', tx_date: '2026-08-20' },
        { id: 'c', tx_date: '2026-08-01' },
      ],
    }
    const payload = buildBackupPayload({ ...base, tables })
    expect(payload.tables.transactions.map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })

  it('orders workspaces by id and user_settings by user_id', () => {
    const tables: BackupTables = {
      workspaces: [{ id: 'ws-2' }, { id: 'ws-1' }],
      transactions: [],
      user_settings: [{ user_id: 'u-2' }, { user_id: 'u-1' }],
    }
    const payload = buildBackupPayload({ ...base, tables })
    expect(payload.tables.workspaces.map((r) => r.id)).toEqual(['ws-1', 'ws-2'])
    expect(payload.tables.user_settings.map((r) => r.user_id)).toEqual(['u-1', 'u-2'])
  })

  it('does not mutate the caller\'s arrays', () => {
    const transactions = [
      { id: 'b', tx_date: '2026-08-20' },
      { id: 'a', tx_date: '2026-08-01' },
    ]
    buildBackupPayload({ ...base, tables: { ...emptyTables(), transactions } })
    expect(transactions.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('prunablePaths', () => {
  const dated = (...days: string[]) => days.map((d) => `${d}.json`)

  it('deletes nothing while the account has 7 or fewer days', () => {
    const names = dated(
      '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21',
      '2026-08-22', '2026-08-23', '2026-08-24',
    )
    expect(prunablePaths(names, 7)).toEqual([])
  })

  it('keeps the newest 7 and returns the rest', () => {
    const names = dated(
      '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20',
      '2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24',
    )
    expect(prunablePaths(names, 7).sort()).toEqual(dated('2026-08-16', '2026-08-17').sort())
  })

  it('is independent of the order the bucket listed the objects in', () => {
    const names = dated('2026-08-24', '2026-08-16', '2026-08-20', '2026-08-17')
    expect(prunablePaths(names, 2).sort()).toEqual(dated('2026-08-16', '2026-08-17').sort())
  })

  it('never returns a name it does not recognise', () => {
    const names = ['notes.txt', 'README', '2026-08-1.json', ...dated('2026-08-16', '2026-08-24')]
    expect(prunablePaths(names, 1)).toEqual(dated('2026-08-16'))
  })

  it('handles gaps: 7 kept days may span more than 7 calendar days', () => {
    const names = dated(
      '2026-07-01', '2026-08-01', '2026-08-05', '2026-08-11',
      '2026-08-17', '2026-08-20', '2026-08-23', '2026-08-24',
    )
    expect(prunablePaths(names, 7)).toEqual(dated('2026-07-01'))
  })

  it('returns nothing for an empty prefix', () => {
    expect(prunablePaths([], 7)).toEqual([])
  })
})

describe('rowCounts', () => {
  it('reports one count per backed-up table', () => {
    const tables: BackupTables = {
      workspaces: [{ id: 'ws-1' }, { id: 'ws-2' }],
      transactions: [{ id: 't-1' }],
      user_settings: [{ user_id: 'u-1' }],
    }
    expect(rowCounts(tables)).toEqual({ workspaces: 2, transactions: 1, user_settings: 1 })
  })
})

describe('describeError', () => {
  it('keeps the message of a real Error, as Storage and network errors are Errors', () => {
    expect(describeError(new Error('upload failed'))).toBe('upload failed')
  })

  // The 2026-08-25 regression: PostgREST errors are plain objects, so String() produced
  // "[object Object]" and the 401 that actually broke the backup was never recorded.
  it('reads a PostgREST error object instead of stringifying it to [object Object]', () => {
    const postgrest = { message: 'Invalid authentication credentials', code: 'PGRST301', details: null, hint: null }
    const out = describeError(postgrest)
    expect(out).not.toBe('[object Object]')
    expect(out).toContain('Invalid authentication credentials')
    expect(out).toContain('PGRST301')
  })

  it('falls back to JSON for an object with no recognisable fields', () => {
    expect(describeError({ weird: 1 })).toBe('{"weird":1}')
  })

  it('handles values that are neither Error nor object', () => {
    expect(describeError('boom')).toBe('boom')
    expect(describeError(null)).toBe('null')
    expect(describeError(undefined)).toBe('undefined')
  })
})

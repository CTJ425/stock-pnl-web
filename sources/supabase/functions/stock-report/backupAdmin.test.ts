import { describe, expect, it } from 'vitest'
import { isValidBackupPath, summarizeAccountBackups, type BackupObject } from './backupAdmin'

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

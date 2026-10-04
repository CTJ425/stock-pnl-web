import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const { buildQueryArgs, withSqlFile } = require('./sqlFile.cjs')

describe('withSqlFile', () => {
  it('hands fn a private file holding the whole statement, even past the 128 KiB argv limit', () => {
    const sql = `SELECT '${'x'.repeat(300_000)}';`
    withSqlFile(sql, (file) => {
      expect(fs.readFileSync(file, 'utf8')).toBe(sql)
      expect(fs.statSync(file).mode & 0o777).toBe(0o600)
      expect(fs.statSync(file.replace(/[/\\][^/\\]+$/, '')).mode & 0o777).toBe(0o700)
      // The argument vector stays tiny however large the SQL is.
      expect(JSON.stringify(buildQueryArgs(file)).length).toBeLessThan(200)
    })
  })

  it('deletes the file afterwards', () => {
    let seen
    withSqlFile('SELECT 1;', (file) => {
      seen = file
    })
    expect(fs.existsSync(seen)).toBe(false)
  })

  it('deletes the file when fn throws, and rethrows', () => {
    let seen
    expect(() =>
      withSqlFile('SELECT 1;', (file) => {
        seen = file
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(fs.existsSync(seen)).toBe(false)
  })

  it('returns what fn returns', () => {
    expect(withSqlFile('SELECT 1;', () => 42)).toBe(42)
  })
})

describe('buildQueryArgs', () => {
  it('targets the linked project and passes the path via --file', () => {
    expect(buildQueryArgs('/tmp/a.sql')).toEqual(['db', 'query', '--linked', '--file', '/tmp/a.sql'])
  })
})

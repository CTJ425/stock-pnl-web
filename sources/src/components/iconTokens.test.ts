/**
 * Guard for Phase 3: the three migrated files must size every icon by token.
 * A source scan covers AppShell and TransactionsPage, which have no unit test
 * that can reach all 24 of their icon sites.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// vitest runs with `sources/` as its root, so these paths are stable.
const MIGRATED: [path: string, appIconCount: number][] = [
  ['src/components/AppShell.tsx', 14],
  ['src/components/Transactions/TransactionsPage.tsx', 10],
  ['src/components/Common/SortableTh.tsx', 1],
]

describe('Phase 3 icon token migration', () => {
  it.each(MIGRATED)('%s leaves no raw numeric size', (path) => {
    const offenders = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => /size=\{\d+\}/.test(line))
    expect(offenders, `raw pixel size still used in ${path}`).toEqual([])
  })

  it.each(MIGRATED)('%s imports AppIcon', (path) => {
    expect(readFileSync(path, 'utf8')).toMatch(/import \{[^}]*\bAppIcon\b[^}]*\} from '.*AppIcon'/)
  })

  it.each(MIGRATED)('%s migrated every site', (path, expected) => {
    const count = readFileSync(path, 'utf8').match(/<AppIcon\b/g)?.length ?? 0
    expect(count).toBe(expected)
  })
})

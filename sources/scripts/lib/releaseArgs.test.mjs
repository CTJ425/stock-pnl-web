import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildCreateArgs, buildEditArgs } = require('./releaseArgs.cjs')

// Task 193 M13: a CHANGELOG heading with backticks or $(…) must reach `gh` as one literal argument.
const TITLES = [
  '0.9.35 — 全域錯誤記錄 `app_log`：捕捉層、後台檢視頁與全站埋點',
  '0.9.33 — 補讀 `stock-report/index.ts` 未覆蓋範圍的六項修正',
  '1.0.0 — "quoted" and $(touch /tmp/pwned) and ; rm -rf ~',
]

describe('release gh argument vectors', () => {
  it.each(TITLES)('keeps the title as a single literal argument: %s', (title) => {
    const create = buildCreateArgs({ tag: '1.0.0', targetCommit: 'abc123', title, notesFile: '/tmp/n.md', isLatest: true })
    expect(create[create.indexOf('--title') + 1]).toBe(title)
    const edit = buildEditArgs({ tag: '1.0.0', title, notesFile: '/tmp/n.md' })
    expect(edit[edit.indexOf('--title') + 1]).toBe(title)
  })

  it('marks only the newest version as latest', () => {
    const base = { tag: '1.0.0', targetCommit: 'abc123', title: 't', notesFile: 'n.md' }
    expect(buildCreateArgs({ ...base, isLatest: true }).at(-1)).toBe('--latest')
    expect(buildCreateArgs({ ...base, isLatest: false }).at(-1)).toBe('--latest=false')
  })

  it('passes the tag and the target commit as their own arguments', () => {
    expect(buildCreateArgs({ tag: '0.10.29', targetCommit: 'deadbeef', title: 't', notesFile: 'n.md', isLatest: false }).slice(0, 5)).toEqual(
      ['release', 'create', '0.10.29', '--target', 'deadbeef'],
    )
  })
})

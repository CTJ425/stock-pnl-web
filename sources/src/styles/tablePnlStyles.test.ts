import { describe, it, expect } from 'vitest'

describe('index.css .data-table PnL color rules (Task 150 regression test)', () => {
  it('contains data-table pnl-up, pnl-down, pnl-flat rules restoring semantic colors', async () => {
    // Dynamic import to avoid static Node type dependencies in browser tsconfig
    // @ts-ignore
    const fs = await import('node:fs'.slice(0))
    // @ts-ignore
    const path = await import('node:path'.slice(0))
    // @ts-ignore
    const cwd = typeof process !== 'undefined' ? process.cwd() : '.'
    const cssPath = path.resolve(cwd, 'src/index.css')
    const cssContent: string = fs.readFileSync(cssPath, 'utf-8')

    // pnl-up base and hover rules
    expect(cssContent).toContain('.data-table td.pnl-up')
    expect(cssContent).toContain('.data-table td.num.pnl-up')
    expect(cssContent).toContain('.data-table td.pnl-up > div:first-child')
    expect(cssContent).toContain('.data-table td.num.pnl-up > div:first-child')
    expect(cssContent).toContain('.data-table tbody tr:hover td.pnl-up')
    expect(cssContent).toContain('.data-table tbody tr:hover td.num.pnl-up')
    expect(cssContent).toContain('.data-table tbody tr:hover td.pnl-up > div:first-child')
    expect(cssContent).toContain('.data-table tbody tr:hover td.num.pnl-up > div:first-child')

    // pnl-down base and hover rules
    expect(cssContent).toContain('.data-table td.pnl-down')
    expect(cssContent).toContain('.data-table td.num.pnl-down')
    expect(cssContent).toContain('.data-table td.pnl-down > div:first-child')
    expect(cssContent).toContain('.data-table td.num.pnl-down > div:first-child')
    expect(cssContent).toContain('.data-table tbody tr:hover td.pnl-down')
    expect(cssContent).toContain('.data-table tbody tr:hover td.num.pnl-down')
    expect(cssContent).toContain('.data-table tbody tr:hover td.pnl-down > div:first-child')
    expect(cssContent).toContain('.data-table tbody tr:hover td.num.pnl-down > div:first-child')

    // pnl-flat base and hover rules
    expect(cssContent).toContain('.data-table td.pnl-flat')
    expect(cssContent).toContain('.data-table td.num.pnl-flat')
    expect(cssContent).toContain('.data-table td.pnl-flat > div:first-child')
    expect(cssContent).toContain('.data-table td.num.pnl-flat > div:first-child')

    // Cascade order check: pnl rules must appear after hover td rule
    const hoverTdIndex = cssContent.indexOf('.data-table tbody tr:hover td')
    const pnlUpIndex = cssContent.indexOf('.data-table td.pnl-up')
    expect(hoverTdIndex).toBeGreaterThan(0)
    expect(pnlUpIndex).toBeGreaterThan(hoverTdIndex)
  })
})

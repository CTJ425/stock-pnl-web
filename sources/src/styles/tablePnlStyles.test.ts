// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'

describe('index.css .data-table PnL color rules (Task 150 regression test)', () => {
  async function loadCss(): Promise<string> {
    // Dynamic import to avoid static Node type dependencies in browser tsconfig (tsc -b)
    // @ts-ignore
    const fs = await import('node:fs'.slice(0))
    // @ts-ignore
    const path = await import('node:path'.slice(0))
    // @ts-ignore
    const cwd = typeof process !== 'undefined' ? process.cwd() : '.'
    const cssPath = path.resolve(cwd, 'src/index.css')
    return fs.readFileSync(cssPath, 'utf-8')
  }

  it('contains data-table pnl-up, pnl-down, pnl-flat rules restoring semantic colors', async () => {
    const cssContent = await loadCss()

    // pnl-up base and hover rules
    expect(cssContent).toContain('.data-table td.pnl-up')
    expect(cssContent).toContain('.data-table td.num.pnl-up')
    expect(cssContent).toContain('.data-table td.num > .pnl-up')
    expect(cssContent).toContain('.data-table td.pnl-up > div:first-child')
    expect(cssContent).toContain('.data-table td.num.pnl-up > div:first-child')
    expect(cssContent).toContain('.data-table td.num > div.pnl-up:first-child')
    expect(cssContent).toContain('.data-table tbody tr:hover td.pnl-up')
    expect(cssContent).toContain('.data-table tbody tr:hover td.num.pnl-up')
    expect(cssContent).toContain('.data-table tbody tr:hover td.pnl-up > div:first-child')
    expect(cssContent).toContain('.data-table tbody tr:hover td.num.pnl-up > div:first-child')

    // pnl-down base and hover rules
    expect(cssContent).toContain('.data-table td.pnl-down')
    expect(cssContent).toContain('.data-table td.num.pnl-down')
    expect(cssContent).toContain('.data-table td.num > .pnl-down')
    expect(cssContent).toContain('.data-table td.pnl-down > div:first-child')
    expect(cssContent).toContain('.data-table td.num.pnl-down > div:first-child')
    expect(cssContent).toContain('.data-table td.num > div.pnl-down:first-child')
    expect(cssContent).toContain('.data-table tbody tr:hover td.pnl-down')
    expect(cssContent).toContain('.data-table tbody tr:hover td.num.pnl-down')
    expect(cssContent).toContain('.data-table tbody tr:hover td.pnl-down > div:first-child')
    expect(cssContent).toContain('.data-table tbody tr:hover td.num.pnl-down > div:first-child')

    // pnl-flat base and hover rules
    expect(cssContent).toContain('.data-table td.pnl-flat')
    expect(cssContent).toContain('.data-table td.num.pnl-flat')
    expect(cssContent).toContain('.data-table td.num > .pnl-flat')
    expect(cssContent).toContain('.data-table td.pnl-flat > div:first-child')
    expect(cssContent).toContain('.data-table td.num.pnl-flat > div:first-child')

    // Cascade order check: pnl rules must appear after hover td rule
    const hoverTdIndex = cssContent.indexOf('.data-table tbody tr:hover td')
    const pnlUpIndex = cssContent.indexOf('.data-table td.pnl-up')
    expect(hoverTdIndex).toBeGreaterThan(0)
    expect(pnlUpIndex).toBeGreaterThan(hoverTdIndex)
  })

  it('correctly computes cascading text colors across data-table cell types in JSDOM', async () => {
    const cssContent = await loadCss()

    // Inject stylesheet into the current DOM
    const styleEl = document.createElement('style')
    styleEl.textContent = cssContent
    document.head.appendChild(styleEl)

    try {
      const container = document.createElement('div')
      container.innerHTML = `
        <table class="data-table">
          <tbody>
            <tr>
              <td id="cell-ticker">2330</td>
              <td id="cell-name">台積電</td>
              <td class="num pnl-up" id="cell-price">
                <span id="price-val">1,000</span>
              </td>
              <td class="num" id="cell-cost">
                <div id="cost-main">950,000</div>
                <div id="cost-sub">未含費 948,000</div>
              </td>
              <td class="num pnl-up" id="cell-unreal-win">
                <div id="unreal-win-main">+50,000</div>
                <div id="unreal-win-sub">未含費 +52,000</div>
              </td>
              <td class="num pnl-down" id="cell-unreal-loss">
                <div id="unreal-loss-main">-10,000</div>
                <div id="unreal-loss-sub">未含費 -8,000</div>
              </td>
              <td class="num pnl-flat" id="cell-unreal-flat">
                <div id="unreal-flat-main">0</div>
              </td>
              <td class="num" id="cell-inner-win">
                <div class="pnl-up" id="inner-win-main">+3.5%</div>
              </td>
              <td class="num" id="cell-inner-loss">
                <div class="pnl-down" id="inner-loss-main">-2.1%</div>
              </td>
            </tr>
          </tbody>
        </table>
      `
      document.body.appendChild(container)

      try {
        // First column anchor text gets primary
        expect(window.getComputedStyle(document.getElementById('cell-ticker')!).color).toBe('var(--cds-text-primary)')

        // Regular data column gets secondary
        expect(window.getComputedStyle(document.getElementById('cell-name')!).color).toBe('var(--cds-text-secondary)')

        // Price cell (pnl-up) inherits var(--up)
        expect(window.getComputedStyle(document.getElementById('price-val')!).color).toBe('var(--up)')

        // Plain numeric cell: headline gets primary, sublabel gets helper
        expect(window.getComputedStyle(document.getElementById('cost-main')!).color).toBe('var(--cds-text-primary)')
        expect(window.getComputedStyle(document.getElementById('cost-sub')!).color).toBe('var(--cds-text-helper)')

        // Gain cell: headline gets var(--up), sublabel keeps var(--cds-text-helper)
        expect(window.getComputedStyle(document.getElementById('unreal-win-main')!).color).toBe('var(--up)')
        expect(window.getComputedStyle(document.getElementById('unreal-win-sub')!).color).toBe('var(--cds-text-helper)')

        // Loss cell: headline gets var(--down), sublabel keeps var(--cds-text-helper)
        expect(window.getComputedStyle(document.getElementById('unreal-loss-main')!).color).toBe('var(--down)')
        expect(window.getComputedStyle(document.getElementById('unreal-loss-sub')!).color).toBe('var(--cds-text-helper)')

        // Flat cell: headline gets var(--cds-text-secondary)
        expect(window.getComputedStyle(document.getElementById('unreal-flat-main')!).color).toBe('var(--cds-text-secondary)')

        // Direct inner pnl element gets semantic color
        expect(window.getComputedStyle(document.getElementById('inner-win-main')!).color).toBe('var(--up)')
        expect(window.getComputedStyle(document.getElementById('inner-loss-main')!).color).toBe('var(--down)')
      } finally {
        container.remove()
      }
    } finally {
      styleEl.remove()
    }
  })
})

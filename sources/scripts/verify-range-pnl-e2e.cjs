/**
 * Task 176 區間收益 — real-browser interaction check.
 *
 * Every expected figure below is hand-computed from the fixture by hand, not read back from the
 * app's own engine, so this is an independent oracle. It also re-checks the invariant the feature
 * rests on: 「去年」 must print exactly what the 2025 row of the yearly table prints.
 *
 * Local mode (no login), seeded through localStorage:
 *   cd sources && VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run dev
 *   node scripts/verify-range-pnl-e2e.cjs            # defaults to http://localhost:5173/
 *   TEST_URL=http://localhost:5199/ node scripts/verify-range-pnl-e2e.cjs
 *
 * The 近 1 個月 / 近 3 個月 / 近 1 年 / 今年以來 cases read the real Taipei date, so their expected
 * window moves with the calendar; the fixture dates are chosen to keep the assertions true.
 */
const { chromium } = require('playwright')

const BASE = process.env.TEST_URL || 'http://localhost:5173/'

const WS = 'ws-1'
let n = 0
const tx = (date, type, price, qty, fee, over = {}) => ({
  id: `tx-${++n}`,
  workspace_id: WS,
  tx_date: date,
  market: 'TPE',
  ticker: '2330',
  name: '台積電',
  tx_type: type,
  price,
  qty,
  fee_tax: fee,
  created_at: `2020-01-01T00:00:00.${String(n).padStart(3, '0')}Z`,
  ...over,
})
const UC = { market: 'US', ticker: 'AAPL', name: 'Apple Inc.' }

// 2330: buy 2000@500 fee 1425 (avg 500.7125) → sell 1000@600 fee 2655 → div 3.5×2000 fee 200 → sell 1000@1105 fee 3891
// 2303: buy 3000@60 fee 256 → sell 3000@50 fee 663
// 00878: buy 5000@20 fee 142 → div 1.2×5000 fee 0   (dividend only, never sold)
// AAPL: buy 20@180 → sell 20@225
const transactions = [
  tx('2025-02-10', 'BUY', 500, 2000, 1425),
  tx('2025-06-20', 'SELL', 600, 1000, 2655),
  tx('2025-08-15', 'DIVIDEND', 3.5, 2000, 200),
  tx('2026-03-14', 'SELL', 1105, 1000, 3891),
  tx('2025-11-02', 'BUY', 60, 3000, 256, { ticker: '2303', name: '聯電' }),
  tx('2026-04-08', 'SELL', 50, 3000, 663, { ticker: '2303', name: '聯電' }),
  tx('2025-05-01', 'BUY', 20, 5000, 142, { ticker: '00878', name: '國泰永續高股息' }),
  tx('2026-02-20', 'DIVIDEND', 1.2, 5000, 0, { ticker: '00878', name: '國泰永續高股息' }),
  tx('2025-09-09', 'BUY', 180, 20, 0, UC),
  tx('2026-05-12', 'SELL', 225, 20, 0, UC),
]

const store = { workspaces: [{ id: WS, name: '我的投資組合', fee_rate: 0.001425 }], transactions }

let pass = 0
const fails = []
function check(label, actual, expected) {
  const ok = String(actual) === String(expected)
  if (ok) pass++
  else fails.push(`${label}\n     expected: ${expected}\n     actual:   ${actual}`)
  console.log(`  ${ok ? '✅' : '❌'} ${label}${ok ? ` = ${actual}` : ''}`)
}

async function kpi(page, title) {
  // Match the card by its own <h3>, not by hasText: 「區間總報酬」's sub-line reads
  // 「已實現損益＋股利」 and would swallow a hasText lookup for either of the other two.
  const card = page.locator('.yr-range-kpi').filter({ has: page.locator('h3', { hasText: new RegExp(`^${title}$`) }) })
  return (await card.locator('.yr-range-fig').innerText()).trim()
}

/** Open a ticker's legs whichever state the row is in (the drill-down survives a preset change). */
async function openLegs(page, ticker) {
  const btn = page.getByRole('button', { name: `展開 ${ticker} 區間內的逐筆賣出` })
  if (await btn.count()) await btn.click()
  await page.waitForTimeout(120)
}
async function foot(page, index) {
  return (await page.locator('.yr-range tfoot td').nth(index).innerText()).replace(/\s+/g, ' ').trim()
}
async function rowCells(page, ticker) {
  const row = page.locator('.yr-range tbody tr', { hasText: ticker }).first()
  return (await row.locator('td').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, locale: 'zh-TW' })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ([s, w]) => {
      localStorage.setItem('stock-pnl-web/local-store-v1', s)
      localStorage.setItem('stock-pnl-web/current-workspace', w)
    },
    [JSON.stringify(store), WS],
  )
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '年度收益' }).click()
  await page.locator('.yr-range').waitFor()

  const press = async (label) => {
    await page.locator('.m-range button', { hasText: new RegExp(`^${label}$`) }).click()
    await page.waitForTimeout(120)
  }
  const from = () => page.locator('#yr-range-from')
  const to = () => page.locator('#yr-range-to')

  console.log('\n── 預設區間：近 1 年（今天 2026-09-30 往回一年）')
  check('近 1 年 為預設按下的鍵', await page.locator('.m-range button[aria-pressed="true"]').innerText(), '近 1 年')
  check('起始日', await from().inputValue(), '2025-09-30')
  check('結束日', await to().inputValue(), '2026-09-30')
  // 2330 sell 2026-03-14 realized 1,105,000−3,891−500,712.5 = 600,396.5 → 600,397
  // 2303 sell 2026-04-08 realized 150,000−663−180,256 = −30,919
  // 00878 div 2026-02-20 net 6,000 ・2330 的 2025-08-15 股利落在區間外
  check('區間總報酬 (569,477.5+6,000)', await kpi(page, '區間總報酬'), '+NT$575,478')
  check('已實現損益 (600,396.5−30,919)', await kpi(page, '已實現損益'), '+NT$569,478')
  check('股利 (只有 00878 的 6,000)', await kpi(page, '股利'), 'NT$6,000')
  check('賺賠檔數', (await kpi(page, '賺賠檔數')).replace(/\s+/g, ' '), '2 / 1')
  check('合計 已實現', await foot(page, 1), '+NT$569,478')
  check('合計 股利', await foot(page, 2), 'NT$6,000')
  check('合計 總報酬', await foot(page, 3), '+NT$575,478')
  // ROI 569,477.5 ÷ (500,712.5+180,256 = 680,968.5) = 83.6275%
  check('合計 報酬率', await foot(page, 4), '+83.63%')
  check('合計 賣出成本', await foot(page, 5), 'NT$680,969')
  check('合計 賣出收入 (1,101,109+149,337)', await foot(page, 6), 'NT$1,250,446')
  check('合計 賣出筆數', await foot(page, 7), '2')

  console.log('\n── 個股列與排序（由賺到賠）')
  check(
    '排序',
    (await page.locator('.yr-range tbody tr td:first-child').allInnerTexts())
      .map((t) => t.trim().split('（')[0].replace(/^\s*/, ''))
      .join(' > '),
    '2330 > 00878 > 2303',
  )
  const c2330 = await rowCells(page, '2330')
  check('2330 已實現', c2330[1], '+NT$600,397')
  check('2330 股利（2025 的落在區間外）', c2330[2], '—')
  check('2330 報酬率 600,396.5÷500,712.5', c2330[4], '+119.91%')
  const c878 = await rowCells(page, '00878')
  check('00878 掛「僅股利」', c878[0].includes('僅股利'), 'true')
  check('00878 已實現為 —', c878[1], '—')
  check('00878 股利', c878[2], 'NT$6,000')
  check('00878 報酬率為 —（沒有賣出成本）', c878[4], '—')
  const c2303 = await rowCells(page, '2303')
  check('2303 已實現', c2303[1], '-NT$30,919')
  check('2303 報酬率 −30,919÷180,256', c2303[4], '-17.15%')

  console.log('\n── 展開 2330 的逐筆賣出')
  await openLegs(page, '2330')
  const legs = await page.locator('.yr-range tbody tr.sell-row td:first-child').allInnerTexts()
  check('區間內只有一筆賣出', legs.length, 1)
  check('那一筆是 2026-03-14 賣出 1,000 股', legs[0].replace(/\s+/g, ' ').includes('2026-03-14') && legs[0].includes('1,000'), 'true')
  const legRow = page.locator('.yr-range tbody tr.sell-row').first()
  check('逐筆列有「未含費」副行', (await legRow.innerText()).includes('未含費'), 'true')

  console.log('\n── 去年（2025 整年）')
  await press('去年')
  check('起始日', await from().inputValue(), '2025-01-01')
  check('結束日', await to().inputValue(), '2025-12-31')
  // 2330 sell 2025-06-20 realized 600,000−2,655−500,712.5 = 96,632.5 → 96,633；股利 7,000−200 = 6,800
  check('已實現損益', await kpi(page, '已實現損益'), '+NT$96,633')
  check('股利', await kpi(page, '股利'), 'NT$6,800')
  check('區間總報酬 (96,632.5+6,800)', await kpi(page, '區間總報酬'), '+NT$103,433')
  check('賺賠檔數', (await kpi(page, '賺賠檔數')).replace(/\s+/g, ' '), '1 / 0')
  check('報酬率 96,632.5÷500,712.5', await foot(page, 4), '+19.30%')
  check('只有 2330 一列', (await page.locator('.yr-range tbody tr:not(.sell-row)').count()), 1)

  console.log('\n── 對帳：去年 = 下方 2025 年度列')
  const yearTable = page.locator('table.data-table').filter({ has: page.getByRole('columnheader', { name: /^年度/ }) }).first()
  const y2025 = yearTable.locator('tbody tr', { hasText: '2025' }).first()
  const yc = (await y2025.locator('td').allInnerTexts()).map((t) => t.split('\n')[0].trim())
  // 年度表欄位：年度 賣出成本 賣出收入 已實現 報酬率 股利 總報酬 手續費 交易稅 筆數
  check('2025 年度列 已實現 = 區間的已實現', yc[3], '+NT$96,633')
  check('2025 年度列 股利 = 區間的股利', yc[5], 'NT$6,800')
  check('2025 年度列 總報酬 = 區間總報酬', yc[6], '+NT$103,433')
  check('2025 年度列 賣出成本 = 區間合計', yc[1], await foot(page, 5))
  check('2025 年度列 報酬率 = 區間合計', yc[4], await foot(page, 4))

  console.log('\n── 全部（第一筆到最後一筆落袋的日子）')
  await press('全部')
  check('起始日 = 最早的賣出 2025-06-20', await from().inputValue(), '2025-06-20')
  check('結束日 = 最晚的一筆（美股 2026-05-12）', await to().inputValue(), '2026-05-12')
  check('已實現 (96,632.5+600,396.5−30,919)', await kpi(page, '已實現損益'), '+NT$666,110')
  check('股利 (6,800+6,000)', await kpi(page, '股利'), 'NT$12,800')
  check('區間總報酬', await kpi(page, '區間總報酬'), '+NT$678,910')
  check('賣出筆數', await foot(page, 7), '3')
  await openLegs(page, '2330')
  check('2330 展開後兩筆賣出', await page.locator('.yr-range tbody tr.sell-row').count(), 2)

  console.log('\n── 近 1 個月 / 近 3 個月：這段期間沒有賣出')
  await press('近 1 個月')
  check('起始日', await from().inputValue(), '2026-08-30')
  check('空狀態文字', (await page.locator('.yr-range .empty-state').innerText()).includes('這段期間沒有賣出，也沒有領到股利'), 'true')
  check('沒有表格', await page.locator('.yr-range table').count(), 0)
  await press('近 3 個月')
  check('近 3 個月 起始日', await from().inputValue(), '2026-06-30')
  check('近 3 個月 仍是空的', await page.locator('.yr-range .empty-state').count(), 1)

  console.log('\n── 今年以來')
  await press('今年以來')
  check('起始日', await from().inputValue(), '2026-01-01')
  check('已實現 = 近 1 年（本筆資料 2026 的腳位相同）', await kpi(page, '已實現損益'), '+NT$569,478')

  console.log('\n── 自訂：改日期會切到「自訂」，只框住一天')
  await from().fill('2026-03-14')
  await to().fill('2026-03-14')
  await page.waitForTimeout(150)
  check('按下的鍵變成 自訂', await page.locator('.m-range button[aria-pressed="true"]').innerText(), '自訂')
  check('只有 2330', (await page.locator('.yr-range tbody tr:not(.sell-row) td:first-child').allInnerTexts())[0].includes('2330'), 'true')
  check('已實現就是那一筆', await kpi(page, '已實現損益'), '+NT$600,397')
  check('股利 0', await kpi(page, '股利'), 'NT$0')
  check('賣出筆數 1', await foot(page, 7), '1')

  console.log('\n── 起始日晚於結束日')
  await from().fill('2026-12-31')
  await page.waitForTimeout(150)
  check('擋下並說明', (await page.locator('.yr-range .empty-state').innerText()).includes('起始日晚於結束日'), 'true')
  check('不畫表格', await page.locator('.yr-range table').count(), 0)

  console.log('\n── 美股切換')
  await press('全部')
  await page.locator('[aria-label="區間收益幣別"] button', { hasText: '美股' }).click()
  await page.waitForTimeout(150)
  check('只有 AAPL', (await page.locator('.yr-range tbody tr:not(.sell-row) td:first-child').allInnerTexts())[0].includes('AAPL'), 'true')
  check('美股已實現 4,500−3,600', await kpi(page, '已實現損益'), '+US$900.00')
  check('美股沒有股利', await kpi(page, '股利'), 'US$0.00')
  check('美股報酬率 900÷3,600', await foot(page, 4), '+25.00%')
  await page.locator('[aria-label="區間收益幣別"] button', { hasText: '台股' }).click()
  await page.waitForTimeout(150)
  check('切回台股', (await page.locator('.yr-range tbody tr:not(.sell-row) td:first-child').allInnerTexts())[0].includes('2330'), 'true')

  console.log('\n── 只有買進、從沒賣過的帳本：整個區塊不出現')
  await page.evaluate(
    ([s, w]) => {
      localStorage.setItem('stock-pnl-web/local-store-v1', s)
      localStorage.setItem('stock-pnl-web/current-workspace', w)
    },
    [
      JSON.stringify({
        workspaces: [{ id: WS, name: '我的投資組合', fee_rate: 0.001425 }],
        transactions: [tx('2026-03-05', 'BUY', 700, 1000, 997)],
      }),
      WS,
    ],
  )
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '年度收益' }).click()
  await page.locator('table.data-table').first().waitFor()
  check('沒有區間收益區塊', await page.locator('.yr-range').count(), 0)
  check('年度表格還在', await page.locator('table.data-table').count() >= 1, 'true')

  check('console 無錯誤', consoleErrors.length === 0 ? 'none' : consoleErrors.join(' | '), 'none')

  await browser.close()
  console.log(`\n${fails.length === 0 ? '✅ ALL PASS' : '❌ FAILED'}  ${pass} passed, ${fails.length} failed`)
  if (fails.length) {
    console.log('\n' + fails.map((f, i) => `${i + 1}. ${f}`).join('\n'))
    process.exit(1)
  }
})()

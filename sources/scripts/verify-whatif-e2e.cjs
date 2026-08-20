/**
 * E2E: 損益試算 must agree with 庫存總覽 for a held stock.
 *
 * Cross-checks the two screens instead of asserting hard-coded numbers, so it keeps
 * working as prices move: at 賣出價 = 現價 the tab's 投入成本 / 損益 must equal the
 * dashboard's 投入成本 / 未實現淨損益 for the same holding.
 *
 * Credentials come from the environment and are never written anywhere:
 *   BASE_URL=http://host:5173 APP_USER=… APP_PASS=… [WORKSPACE=…] [TICKER=0050] \
 *     node scripts/verify-whatif-e2e.cjs
 */
const { chromium } = require('playwright')

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const TICKER = process.env.TICKER || '0050'
const WORKSPACE = process.env.WORKSPACE || ''
const money = (s) => Number(String(s).replace(/[^\d.-]/g, ''))

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } })
  const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1 }

  await page.goto(BASE)
  await page.waitForTimeout(1500)
  const email = page.locator('input[type=email]').first()
  if (await email.count()) {
    if (!process.env.APP_USER || !process.env.APP_PASS) {
      console.error('FAIL: login required but APP_USER / APP_PASS are not set')
      await browser.close()
      process.exit(1)
    }
    await email.fill(process.env.APP_USER)
    await page.locator('input[type=password]').first().fill(process.env.APP_PASS)
    await page.getByRole('button', { name: '登入', exact: true }).first().click()
    await page.waitForTimeout(6000)
  }

  if (WORKSPACE) {
    await page.locator('button[aria-label^="工作區"]').first().click()
    await page.waitForTimeout(1000)
    await page.getByRole('menuitemradio', { name: new RegExp(WORKSPACE, 'i') }).first().click()
    await page.waitForTimeout(4000)
  }

  // 1. 庫存總覽：抓這一檔的 投入成本 與 未實現淨損益
  await page.getByRole('button', { name: '庫存總覽' }).first().click()
  await page.waitForTimeout(3000)
  const row = page.locator('.data-table tbody tr').filter({ hasText: TICKER }).first()
  if (!(await row.count())) {
    console.error(`FAIL: ${TICKER} is not held in this workspace — nothing to cross-check`)
    await browser.close()
    process.exit(1)
  }
  const cells = await row.locator('td').allInnerTexts()
  const dashCost = money(cells[4].split('\n')[0])
  const dashUnrealized = money(cells[8].split('\n')[0])
  console.log(`庫存總覽  投入成本 ${dashCost}  未實現淨損益 ${dashUnrealized}`)

  // 2. 損益試算：預設狀態（賣出價 = 現價）
  await page.getByRole('button', { name: '個股分析' }).first().click()
  await page.waitForTimeout(3500)
  const picker = page.locator('.detail-head-analysis button').first()
  await picker.click()
  await page.waitForTimeout(1000)
  await page.getByRole('menuitemradio', { name: new RegExp(TICKER) }).first().click()
  await page.waitForTimeout(3500)
  await page.getByRole('button', { name: '損益試算' }).first().click()
  await page.waitForTimeout(2500)

  const tabCost = money(await page.getByTestId('whatif-cost').innerText())
  const tabPnl = money(await page.getByTestId('whatif-pnl').innerText())
  const ladderRows = await page.getByTestId('whatif-ladder-row').count()
  const marks = await page.getByTestId('whatif-mark').count()
  console.log(`損益試算  投入成本 ${tabCost}  損益 ${tabPnl}  階梯 ${ladderRows} 列  摘要 ${marks} 項`)

  if (tabCost !== dashCost) fail(`投入成本 mismatch: 試算 ${tabCost} vs 庫存總覽 ${dashCost}`)
  if (tabPnl !== dashUnrealized) fail(`損益 mismatch: 試算 ${tabPnl} vs 庫存總覽 ${dashUnrealized}`)
  if (ladderRows < 9) fail(`賣出階梯 only ${ladderRows} rows`)
  if (marks < 2) fail(`摘要列 only ${marks} items`)
  if (!process.exitCode) console.log('PASS: 損益試算與庫存總覽同一口徑')
  await browser.close()
})()

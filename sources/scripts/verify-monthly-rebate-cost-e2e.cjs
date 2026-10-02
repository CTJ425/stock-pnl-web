/**
 * Playwright E2E: under 月退 the 券商 figure carries the list-price buy fee in cost (Task 189).
 *
 * Real case, 玉山 App 2026-10-02: 009828 10,000 @ 10.70, recorded fee 57 (3.8 折 0.0541%), price
 * 10.68. The app showed −610; the recorded cost gives −515. The oracle below is written from the
 * broker rules (fee and ETF tax floored, cost = gross + fee), not from the app's engine.
 *
 * Journey (玉山-style workspace: 0.0005415, 月退 + 牌告 saved under the split; a workspace with no
 * sell basis saved keeps the 0.10.20 figure, which the unit tests pin):
 *   1. row reads −610, the expanded row shows 券商 App 成本 107,152 and the 月退 note
 *   2. fee panel opens on the 玉山 preset with the four settings folded; the action bar reads
 *      −610 「儲存後不變」; preview 元大 → −515 (recorded cost, posted sell rate) and the bar reads −610 → −515
 *   3. 改單項 → 折扣後 sell basis → −420, the preset turns into 自訂, the basis line says 折扣後
 *   4. 取消 → −610, nothing written
 *   5. 元大 + 儲存 → PATCH fee_rebate 'instant', fee_rounding 'position', day_trade_tax_estimate false; row −515
 *
 * Supabase mode with every backend call mocked (same pattern as verify-pnl-rounding-e2e.cjs).
 *
 *   cd sources && TEST_URL=http://127.0.0.1:5173/ node scripts/verify-monthly-rebate-cost-e2e.cjs
 */
const { chromium } = require('playwright')

const TARGET_URL = process.env.TEST_URL || 'http://127.0.0.1:5173/'
const SHOT_DIR = process.env.SHOT_DIR || '/tmp'
const PRICE = 10.68
const BUY = { price: 10.7, qty: 10000, fee: 57 }
const LIST_RATE = 0.001425
const WS_RATE = 0.0005415
const ETF_TAX = 0.001

// ---------------------------------------------------------------- oracle
const floor = (v) => Math.floor(Math.round(v * 1e6) / 1e6)
const gross = BUY.price * BUY.qty
const mkt = PRICE * BUY.qty
const tax = floor(mkt * ETF_TAX)
const recordedCost = gross + BUY.fee
const appCost = gross + floor(gross * LIST_RATE)
const EXPECT_MONTHLY = Math.round(mkt - floor(mkt * LIST_RATE) - tax - appCost)
const EXPECT_INSTANT_LIST = Math.round(mkt - floor(mkt * LIST_RATE) - tax - recordedCost)
const EXPECT_NET = Math.round(mkt - floor(mkt * WS_RATE) - tax - recordedCost)
if (EXPECT_MONTHLY !== -610 || EXPECT_INSTANT_LIST !== -515 || EXPECT_NET !== -420) {
  throw new Error(`oracle drifted: ${EXPECT_MONTHLY} / ${EXPECT_INSTANT_LIST} / ${EXPECT_NET}`)
}

const money = (n) => `${n < 0 ? '-' : '+'}NT$${Math.abs(n).toLocaleString('en-US')}`

// ---------------------------------------------------------------- mocks
const wsId = 'ws-monthly-e2e'
const userId = 'e2e-user-monthly'
const mockUser = {
  id: userId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'e2e@example.com',
  app_metadata: { provider: 'email' },
  user_metadata: {},
  created_at: new Date().toISOString(),
}
const mockSession = {
  access_token: 'mock-access-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'mock-refresh-token',
  user: mockUser,
}
const dbWorkspaces = [
  {
    id: wsId,
    name: '月退成本 E2E',
    created_at: '2026-09-01T00:00:00Z',
    fee_rate: WS_RATE,
    fee_rebate: 'monthly',
    fee_rounding: null,
    sell_fee_basis: 'list',
    user_id: userId,
  },
]
const dbTransactions = [
  {
    id: 'tx-seed-1',
    workspace_id: wsId,
    user_id: userId,
    tx_date: '2026-10-02',
    market: 'TPE',
    ticker: '009828',
    // BUG-109: a broker-export spelling (full-width) on the row; the page must show the exchange's name.
    name: '中信台日韓ＰＣＢ',
    tx_type: 'BUY',
    price: BUY.price,
    qty: BUY.qty,
    fee_tax: BUY.fee,
    tx_nature: 'SPOT',
    fee_rate: WS_RATE,
    created_at: '2026-10-02T01:00:00Z',
  },
]
const workspacePatches = []

async function installMocks(page) {
  await page.addInitScript(({ session, wsId, rate }) => {
    for (const ref of ['zyebvayngwrqzoaicbwd', 'hrilemueiqyaoiwnkeuu']) {
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session))
    }
    window.localStorage.setItem('stock-pnl-web/current-workspace', wsId)
    window.localStorage.setItem(`stock-pnl-web/fee-rate/${wsId}`, String(rate))
  }, { session: mockSession, wsId, rate: WS_RATE })

  const json = (route, body, status = 200, headers = {}) =>
    route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) })

  await page.route('**/auth/v1/**', (route) =>
    json(route, route.request().url().includes('/user') ? mockUser : mockSession),
  )
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.pathname.endsWith('/workspaces')) {
      if (req.method() === 'PATCH') {
        const payload = req.postDataJSON()
        workspacePatches.push(payload)
        Object.assign(dbWorkspaces[0], payload)
        return json(route, [dbWorkspaces[0]])
      }
      return json(route, dbWorkspaces)
    }
    if (url.pathname.endsWith('/transactions')) {
      return json(route, dbTransactions, 200, { 'Content-Range': `0-${dbTransactions.length - 1}/${dbTransactions.length}` })
    }
    return json(route, [])
  })
  // Playwright tries the most recently registered route first: the catch-alls go before the specific ones.
  await page.route('**/functions/v1/**', (route) => json(route, {}))
  await page.route('**/storage/v1/**', (route) => json(route, {}, 404))
  // The official TW list (vite dev proxies /api/twse and /api/tpex), source of the labels (BUG-109).
  await page.route('**/api/twse/**', (route) =>
    json(route, [{ Code: '009828', Name: '中信台日韓PCB', ClosingPrice: '10.68' }]),
  )
  await page.route('**/api/tpex/**', (route) =>
    json(route, [{ SecuritiesCompanyCode: '6488', CompanyName: '環球晶', Close: '500' }]),
  )
  await page.route('**/functions/v1/stock-price', (route) =>
    json(route, {
      prices: {
        'TPE:009828': {
          price: PRICE,
          prevClose: 10.38,
          tradeDate: '20261002',
          tradeTime: '13:30:00',
          asOf: new Date().toISOString(),
        },
      },
    }),
  )
}

// ---------------------------------------------------------------- steps
async function rowFigure(page) {
  const cell = page.locator('tr', { hasText: '009828' }).first().locator('[data-c="unr"]')
  await cell.waitFor({ timeout: 15000 })
  return (await cell.innerText()).replace(/\s+/g, ' ').trim()
}

async function expectRow(page, expected, label) {
  const want = money(expected)
  let got = ''
  for (let i = 0; i < 20; i++) {
    got = await rowFigure(page)
    if (got.startsWith(want)) break
    await page.waitForTimeout(250)
  }
  if (!got.startsWith(want)) throw new Error(`${label}: expected ${want}, page shows "${got}"`)
  console.log(`  ✓ ${label}: ${got}`)
}

async function openFeePanel(page) {
  await page.locator('.stmt-basis').click()
  await page.waitForSelector('.fee-settings-broker')
}

;(async () => {
  console.log(`🚀 月退 cost E2E on ${TARGET_URL}`)
  const browser = await chromium.launch({ headless: true })
  const errors = []
  let failed = false
  try {
    for (const vp of [
      { width: 1440, height: 1000, tag: 'desktop' },
      { width: 390, height: 844, tag: 'phone' },
    ]) {
      workspacePatches.length = 0
      Object.assign(dbWorkspaces[0], { fee_rebate: 'monthly', sell_fee_basis: 'list' })
      const page = await (await browser.newContext({ viewport: { width: vp.width, height: vp.height } })).newPage()
      page.on('pageerror', (e) => errors.push(String(e)))
      await installMocks(page)
      await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 20000 })
      await page.getByRole('button', { name: '庫存總覽' }).first().click()
      await page.waitForSelector('text=持股明細')
      console.log(`[${vp.tag}]`)

      if (vp.tag === 'desktop') await expectRow(page, EXPECT_MONTHLY, '1. 月退 row (玉山 App −610)')
      await page.waitForFunction(
        () => document.querySelector('[data-testid="holding-row-009828"]')?.textContent?.includes('中信台日韓PCB'),
        null,
        { timeout: 15000 },
      )
      const rowText = await page.getByTestId('holding-row-009828').innerText()
      if (rowText.includes('ＰＣＢ')) throw new Error(`0. row still shows the row's own name: ${rowText}`)
      console.log('  ✓ 0. row labelled with the official name 中信台日韓PCB, not the row\'s 「中信台日韓ＰＣＢ」')
      await page.getByTestId('holding-row-009828').click()
      const detail = await page.locator('.hl-detail-body').first().innerText()
      if (!detail.includes('券商 App 成本') || !detail.includes('NT$107,152')) throw new Error(`1. app cost missing: ${detail}`)
      if (!detail.includes('月退：成本裡的買進手續費也用牌告算')) throw new Error('1. 月退 note missing')
      console.log('  ✓ 1. detail shows 券商 App 成本 NT$107,152 and the 月退 note')
      const basisLine = await page.locator('.stmt-basis').innerText()
      if (!basisLine.includes('計成本與預扣')) throw new Error(`1. basis line: "${basisLine}"`)
      await page.screenshot({ path: `${SHOT_DIR}/monthly-detail-${vp.tag}.png`, fullPage: true })

      await openFeePanel(page)
      await page.screenshot({ path: `${SHOT_DIR}/monthly-fee-panel-${vp.tag}.png`, fullPage: true })
      if (vp.tag === 'phone') {
        await page.locator('.fee-settings-broker').scrollIntoViewIfNeeded()
        await page.screenshot({ path: `${SHOT_DIR}/fee-panel-phone-viewport.png` })
        const bar = await page.locator('.fee-settings-actions').boundingBox()
        const nav = await page.locator('.bottom-nav').boundingBox()
        if (!bar || !nav || bar.y + bar.height > nav.y + 1) throw new Error(`phone: action bar ${JSON.stringify(bar)} under the bottom nav ${JSON.stringify(nav)}`)
        console.log('  ✓ phone: action bar sits above the bottom nav while the form scrolls')
      }
      if (vp.tag === 'desktop') {
        if (!(await page.getByRole('radio', { name: '玉山' }).isChecked())) throw new Error('2. 玉山 preset not shown')
        if (await page.getByRole('radio', { name: /^月退/ }).count()) throw new Error('2. detail radios not folded')
        const bar0 = await page.locator('.fee-settings-impact').innerText()
        if (!bar0.includes('-NT$610') || !bar0.includes('儲存後不變')) throw new Error(`2. action bar: "${bar0}"`)
        await page.getByText('元大', { exact: true }).click()
        await expectRow(page, EXPECT_INSTANT_LIST, '2. preview 元大 preset (recorded cost)')
        const bar1 = (await page.locator('.fee-settings-impact').innerText()).replace(/\s+/g, ' ')
        if (!bar1.includes('-NT$610') || !bar1.includes('-NT$515')) throw new Error(`2. action bar: "${bar1}"`)
        console.log(`  ✓ 2. action bar: ${bar1}`)
        await page.screenshot({ path: `${SHOT_DIR}/fee-panel-yuanta-desktop.png`, fullPage: false })
        await page.getByRole('button', { name: /改單項/ }).click()
        await page.getByRole('radio', { name: /^折扣後/ }).check()
        await expectRow(page, EXPECT_NET, '3. preview 折扣後 sell basis')
        if (!(await page.getByRole('radio', { name: '其他券商／自訂' }).isChecked())) throw new Error('3. preset did not turn into 自訂')
        const b = await page.locator('.stmt-basis').innerText()
        if (!b.includes('折扣後')) throw new Error(`3. basis line did not switch: "${b}"`)
        await page.getByRole('button', { name: '取消' }).click()
        await expectRow(page, EXPECT_MONTHLY, '4. 取消 restores −610')
        if (workspacePatches.length) throw new Error(`4. 取消 wrote ${JSON.stringify(workspacePatches)}`)

        await openFeePanel(page)
        await page.getByText('元大', { exact: true }).click()
        await page.getByRole('button', { name: '儲存' }).click()
        await page.waitForTimeout(500)
        const patched = Object.assign({}, ...workspacePatches)
        if (
          patched.fee_rebate !== 'instant' ||
          patched.fee_rounding !== 'position' ||
          patched.day_trade_tax_estimate !== false ||
          'sell_fee_basis' in patched
        ) {
          throw new Error(`5. unexpected PATCH ${JSON.stringify(workspacePatches)}`)
        }
        await expectRow(page, EXPECT_INSTANT_LIST, '5. saved 元大, PATCH as expected')
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      if (overflow > 0) throw new Error(`[${vp.tag}] page scrolls sideways by ${overflow}px`)
      await page.close()
    }
    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
    console.log('🎉 PASSED')
  } catch (err) {
    failed = true
    console.error('❌ FAILED:', err instanceof Error ? err.message : err)
  } finally {
    await browser.close()
    process.exit(failed ? 1 : 0)
  }
})()

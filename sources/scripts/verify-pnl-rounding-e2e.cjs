/**
 * Playwright E2E: holdings P&L after new trades, per-lot vs whole-position flooring, and the fee
 * settings preview (BUG-088, 0.10.5).
 *
 * Every figure the page prints is checked against an oracle written here from the broker rules —
 * moving-average cost, FIFO lots, fee and tax floored per lot (玉山) or once per position (元大) —
 * not against the app's own engine, so a regression in the engine cannot also move the expectation.
 *
 * Journey (元大-style workspace: 3折 0.0004275, 月退 → the dashboard withholds 牌告 0.1425%):
 *   1. two seeded lots of 2303 (the 2026-09-29 PROD case) → −17,993 per lot
 *   2. 新增交易: buy a third lot through the form → figure follows the new lot
 *   3. 新增交易: sell one lot → FIFO drops the oldest lot, cost falls by the average
 *   4. fee panel: pick 整筆一起算 → figures preview before saving, tagged 預覽・尚未儲存
 *   5. 取消 → saved figures come back, nothing written
 *   6. 整筆一起算 + 儲存 → PATCH fee_rounding 'position', figures stay on the whole-position value
 *   7. preview 現折 → basis switches to the discounted rate, then 取消 restores 牌告
 *
 * Supabase mode with every backend call mocked (same pattern as verify-fee-rate-e2e.cjs): run it
 * against a vite that has VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY set; no project is contacted.
 *
 *   cd sources && TEST_URL=http://127.0.0.1:5173/ node scripts/verify-pnl-rounding-e2e.cjs
 */
const { chromium } = require('playwright')

const TARGET_URL = process.env.TEST_URL || 'http://127.0.0.1:5173/'
const PRICE = 153.5
const LIST_RATE = 0.001425
const WS_RATE = 0.0004275
const TAX_RATE = 0.003
const MIN_FEE = 20

// ---------------------------------------------------------------- oracle
function position(trades) {
  let qty = 0
  let cost = 0
  const lots = []
  for (const t of trades) {
    if (t.tx_type === 'BUY') {
      qty += t.qty
      cost += t.price * t.qty + t.fee_tax
      lots.push(t.qty)
    } else {
      cost -= (cost / qty) * t.qty
      qty -= t.qty
      let left = t.qty
      while (left > 0) {
        const take = Math.min(lots[0], left)
        lots[0] -= take
        left -= take
        if (lots[0] === 0) lots.shift()
      }
    }
  }
  return { qty, cost, lots }
}

function unrealized(pos, price, rate, rounding) {
  const floor = (v) => Math.floor(Math.round(v * 1e6) / 1e6)
  let fee
  let tax
  if (rounding === 'position') {
    fee = floor(price * pos.qty * rate)
    tax = floor(price * pos.qty * TAX_RATE)
  } else {
    fee = pos.lots.reduce((s, q) => s + floor(price * q * rate), 0)
    tax = pos.lots.reduce((s, q) => s + floor(price * q * TAX_RATE), 0)
  }
  if (fee < MIN_FEE) fee = MIN_FEE
  return Math.round(price * pos.qty - pos.cost - fee - tax)
}

const money = (n) => `${n < 0 ? '-' : '+'}NT$${Math.abs(n).toLocaleString('en-US')}`

// ---------------------------------------------------------------- mocks
const wsId = 'ws-rounding-e2e'
const userId = 'e2e-user-rounding'
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
    name: '捨去方式 E2E',
    created_at: '2026-09-01T00:00:00Z',
    fee_rate: WS_RATE,
    fee_rebate: 'monthly',
    fee_rounding: null,
    user_id: userId,
  },
]
const seed = (id, date, price, fee) => ({
  id,
  workspace_id: wsId,
  user_id: userId,
  tx_date: date,
  market: 'TPE',
  ticker: '2303',
  name: '聯電',
  tx_type: 'BUY',
  price,
  qty: 1000,
  fee_tax: fee,
  tx_nature: 'SPOT',
  fee_rate: WS_RATE,
  created_at: `${date}T01:00:00Z`,
})
const dbTransactions = [seed('tx-seed-1', '2026-09-22', 163.5, 69), seed('tx-seed-2', '2026-09-23', 160, 68)]
const workspacePatches = []

async function installMocks(page) {
  await page.addInitScript(({ session, wsId }) => {
    for (const ref of ['zyebvayngwrqzoaicbwd', 'hrilemueiqyaoiwnkeuu']) {
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session))
    }
    window.localStorage.setItem('stock-pnl-web/current-workspace', wsId)
    window.localStorage.setItem(`stock-pnl-web/fee-rate/${wsId}`, '0.0004275')
  }, { session: mockSession, wsId })

  const json = (route, body, status = 200, headers = {}) =>
    route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) })

  await page.route('**/auth/v1/**', (route) =>
    json(route, route.request().url().includes('/user') ? mockUser : mockSession),
  )
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    if (url.pathname.endsWith('/workspaces')) {
      if (method === 'PATCH') {
        const payload = req.postDataJSON()
        workspacePatches.push(payload)
        Object.assign(dbWorkspaces[0], payload)
        return json(route, [dbWorkspaces[0]])
      }
      return json(route, dbWorkspaces)
    }
    if (url.pathname.endsWith('/transactions')) {
      if (method === 'POST') {
        const rows = [].concat(req.postDataJSON())
        const created = rows.map((r, i) => ({
          ...r,
          id: `tx-new-${dbTransactions.length + i}`,
          user_id: userId,
          created_at: new Date(Date.now() + i).toISOString(),
        }))
        dbTransactions.push(...created)
        return json(route, created, 201)
      }
      return json(route, dbTransactions, 200, { 'Content-Range': `0-${dbTransactions.length - 1}/${dbTransactions.length}` })
    }
    return json(route, [])
  })
  // Playwright tries the most recently registered route first: the catch-alls go before the specific ones.
  await page.route('**/functions/v1/**', (route) => json(route, {}))
  await page.route('**/storage/v1/**', (route) => json(route, {}, 404))
  await page.route('**/functions/v1/stock-price', (route) =>
    json(route, {
      prices: {
        'TPE:2303': {
          price: PRICE,
          prevClose: 154,
          tradeDate: '20260929',
          tradeTime: '13:30:00',
          asOf: new Date().toISOString(),
        },
      },
    }),
  )
}

// ---------------------------------------------------------------- steps
async function rowFigure(page) {
  const cell = page.locator('tr', { hasText: '2303' }).first().locator('[data-c="unr"]')
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

async function goDashboard(page) {
  await page.getByRole('button', { name: '庫存總覽' }).first().click()
  await page.waitForSelector('text=持股明細')
}

async function addTrade(page, { type, date, price, qty }) {
  await page.getByRole('button', { name: '新增交易' }).first().click()
  await page.waitForSelector('.modal[role="dialog"]')
  await page.fill('#tx-date', date)
  await page.selectOption('#tx-type', type)
  await page.fill('#tx-ticker', '2303')
  await page.fill('#tx-name', '聯電')
  await page.fill('#tx-price', String(price))
  await page.fill('#tx-qty', String(qty))
  await page.waitForTimeout(300)
  const fee = Number(await page.inputValue('#tx-fee'))
  await page.locator('.modal[role="dialog"] button[type="submit"]').click()
  await page.waitForSelector('.notice-ok', { timeout: 10000 })
  const closer = page.locator('button.modal-close')
  if (await closer.isVisible().catch(() => false)) await closer.click()
  await page.waitForTimeout(300)
  return fee
}

async function openFeePanel(page) {
  await page.locator('.stmt-basis').click()
  await page.waitForSelector('text=分批買進時')
}

;(async () => {
  console.log(`🚀 P&L rounding E2E on ${TARGET_URL}`)
  const browser = await chromium.launch({ headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  let failed = false
  try {
    await installMocks(page)
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 20000 })
    await goDashboard(page)

    const trades = dbTransactions.map((t) => ({ ...t }))
    let pos = position(trades)
    await expectRow(page, unrealized(pos, PRICE, LIST_RATE, 'lot'), '1. seeded two lots, per lot (牌告)')
    if (unrealized(pos, PRICE, LIST_RATE, 'lot') !== -17993) throw new Error('oracle drifted from the PROD case −17,993')

    const buyFee = await addTrade(page, { type: 'BUY', date: '2026-09-24', price: 150, qty: 1 })
    trades.push({ tx_type: 'BUY', price: 150, qty: 1000, fee_tax: buyFee })
    pos = position(trades)
    await goDashboard(page)
    await expectRow(page, unrealized(pos, PRICE, LIST_RATE, 'lot'), `2. new buy 1 張 @150 (fee ${buyFee}), per lot`)

    const sellFee = await addTrade(page, { type: 'SELL', date: '2026-09-29', price: 155, qty: 1 })
    trades.push({ tx_type: 'SELL', price: 155, qty: 1000, fee_tax: sellFee })
    pos = position(trades)
    await goDashboard(page)
    await expectRow(page, unrealized(pos, PRICE, LIST_RATE, 'lot'), `3. sell 1 張 @155, FIFO leaves ${pos.lots.length} lots`)

    await openFeePanel(page)
    await page.getByRole('radio', { name: /整筆一起算/ }).check()
    await expectRow(page, unrealized(pos, PRICE, LIST_RATE, 'position'), '4. preview 整筆 before saving')
    if (!(await page.getByText('預覽・尚未儲存').isVisible())) throw new Error('4. preview tag missing')
    console.log('  ✓ 4. preview tag shown')

    await page.getByRole('button', { name: '取消' }).click()
    await expectRow(page, unrealized(pos, PRICE, LIST_RATE, 'lot'), '5. 取消 restores the saved per-lot figure')
    if (await page.getByText('預覽・尚未儲存').isVisible()) throw new Error('5. preview tag still shown after 取消')
    if (workspacePatches.length) throw new Error(`5. 取消 wrote ${JSON.stringify(workspacePatches)}`)
    console.log('  ✓ 5. tag gone, nothing written')

    await openFeePanel(page)
    await page.getByRole('radio', { name: /整筆一起算/ }).check()
    await page.getByRole('button', { name: '儲存' }).click()
    await page.waitForTimeout(500)
    if (!workspacePatches.some((p) => p.fee_rounding === 'position')) {
      throw new Error(`6. expected PATCH fee_rounding=position, got ${JSON.stringify(workspacePatches)}`)
    }
    await expectRow(page, unrealized(pos, PRICE, LIST_RATE, 'position'), '6. saved 整筆, PATCH fee_rounding=position')
    if (await page.getByText('預覽・尚未儲存').isVisible()) throw new Error('6. preview tag shown after saving')

    await openFeePanel(page)
    await page.getByRole('radio', { name: /現折/ }).check()
    await expectRow(page, unrealized(pos, PRICE, WS_RATE, 'position'), '7. preview 現折 (折扣後 0.0427%)')
    const basis = await page.locator('.stmt-basis').innerText()
    if (!basis.includes('折扣後')) throw new Error(`7. basis line did not switch: "${basis}"`)
    await page.getByRole('button', { name: '取消' }).click()
    await expectRow(page, unrealized(pos, PRICE, LIST_RATE, 'position'), '7. 取消 restores 牌告')

    if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
    console.log('🎉 PASSED')
  } catch (err) {
    failed = true
    console.error('❌ FAILED:', err instanceof Error ? err.message : err)
    await page.screenshot({ path: process.env.FAIL_SHOT || '/tmp/pnl-rounding-e2e-fail.png' }).catch(() => {})
  } finally {
    await browser.close()
    process.exit(failed ? 1 : 0)
  }
})()

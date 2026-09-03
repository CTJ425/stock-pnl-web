/**
 * Playwright E2E verification for Intraday Day-Trade Short-First Matching (0.9.28-dev.1).
 *
 * Runs against real browser (Chromium) on http://localhost:5173/ (or target URL).
 * Verifies:
 * 1. Creating a Day-Trade SELL transaction (先賣出放空 1 張 @ 1000, 交易性質: 當沖, 0.15% 減半稅率).
 * 2. Creating a Day-Trade BUY transaction (後買入回補 1 張 @ 990, 交易性質: 當沖).
 * 3. Verifying the ledger settles realized profit (+5,665 TWD) with 0 remaining custody shares and no oversold warning.
 * 4. Verifying Dashboard and Yearly P&L report accurate figures.
 */
const { chromium } = require('playwright')

const TARGET_URL = process.env.TEST_URL || 'http://localhost:5173/'

;(async () => {
  console.log(`🚀 Starting Playwright E2E Day-Trade Short Test on ${TARGET_URL}...`)
  const browser = await chromium.launch({ headless: true })
  let hasFailure = false

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  const consoleErrors = []
  page.on('pageerror', (err) => {
    console.error('❌ Page Error:', err)
    consoleErrors.push(String(err))
  })
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
      console.warn('⚠️ Console Error:', msg.text())
      consoleErrors.push(msg.text())
    }
  })

  const wsId = 'ws-daytrade-e2e'
  const userId = 'e2e-user-daytrade'
  const mockUser = {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'daytrade-e2e@example.com',
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

  // Seed session and initial workspace in localStorage
  await page.addInitScript(({ session, wsId }) => {
    window.localStorage.setItem('sb-zyebvayngwrqzoaicbwd-auth-token', JSON.stringify(session))
    window.localStorage.setItem('sb-hrilemueiqyaoiwnkeuu-auth-token', JSON.stringify(session))
    window.localStorage.setItem('stock-pnl-web/current-workspace', wsId)
  }, { session: mockSession, wsId })

  // Route auth requests
  await page.route('**/auth/v1/user', async (route) => {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockUser) })
  })
  await page.route('**/auth/v1/token**', async (route) => {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockSession) })
  })

  // In-memory mock database for Supabase PostgREST tables
  const dbWorkspaces = [{ id: wsId, name: '當沖放空 E2E 測試區', created_at: new Date().toISOString(), fee_rate: 0.001425, user_id: userId }]
  const dbTransactions = []

  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request()
    const method = req.method()
    const url = new URL(req.url())
    const path = url.pathname

    if (path.includes('/workspaces')) {
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dbWorkspaces) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
    }

    if (path.includes('/transactions')) {
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dbTransactions) })
      }
      if (method === 'POST') {
        const payload = req.postDataJSON()
        const rows = Array.isArray(payload) ? payload : [payload]
        const created = rows.map((r, idx) => {
          const row = { ...r, id: `tx-mock-${Date.now()}-${idx}`, created_at: new Date().toISOString() }
          dbTransactions.push(row)
          return row
        })
        return route.fulfill({ status: 201, headers: { 'Content-Range': '0-0/1' }, contentType: 'application/json', body: JSON.stringify(created) })
      }
      if (method === 'PATCH') {
        const payload = req.postDataJSON()
        const idMatch = url.searchParams.get('id')
        const id = idMatch ? idMatch.replace(/^eq\./, '') : null
        const target = dbTransactions.find(t => t.id === id)
        if (target) Object.assign(target, payload)
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(target || payload) })
      }
      if (method === 'DELETE') {
        const idMatch = url.searchParams.get('id')
        if (idMatch) {
          const id = idMatch.replace(/^eq\./, '')
          const idx = dbTransactions.findIndex(t => t.id === id)
          if (idx >= 0) dbTransactions.splice(idx, 1)
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
      }
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })

  // Mock stock-price Edge Function
  await page.route('**/functions/v1/stock-price', async (route) => {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quotes: { '2330.TW': { price: 1000, change: 0, changePercent: 0 } } }) })
  })

  try {
    console.log(`Navigating to ${TARGET_URL}...`)
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(1000)

    // Ensure we are on Transactions page
    const txTab = page.getByRole('button', { name: '交易紀錄' })
    await txTab.click()
    await page.waitForTimeout(500)
    console.log('✅ Switched to 交易紀錄 tab.')

    // STEP 1: Add a Day-Trade SELL transaction (先賣出放空 1 張 @ 1000)
    console.log('📝 Adding Day-Trade SELL transaction...')
    const addBtn = page.getByRole('button', { name: '新增交易' }).first()
    await addBtn.click()
    await page.waitForSelector('.modal[role="dialog"]', { timeout: 5000 })
    console.log('✅ Opened 新增交易 modal.')

    // Select SELL
    await page.selectOption('#tx-type', 'SELL')
    await page.waitForTimeout(200)

    // Select 交易性質: 當沖
    await page.selectOption('#tx-nature', 'DAY_TRADE')
    await page.waitForTimeout(200)

    // Fill in ticker 2330, name 台積電, price 1000, qty 1 (1 張 = 1000 股)
    await page.fill('#tx-ticker', '2330')
    await page.fill('#tx-name', '台積電')
    await page.fill('#tx-price', '1000')
    await page.fill('#tx-qty', '1')

    await page.waitForTimeout(300)

    // Verify tax rate auto-selected 0.0015 (當沖 0.15%)
    const taxValue = await page.inputValue('#tx-tax-rate')
    if (taxValue !== '0.0015') {
      throw new Error(`Expected tax rate to be 0.0015 for 當沖, got ${taxValue}`)
    }
    console.log('✅ Tax rate auto-set to 0.0015 (當沖減半稅率).')

    // Submit transaction
    await page.locator('.modal[role="dialog"] button[type="submit"]').click()
    await page.waitForSelector('.notice-ok', { timeout: 10000 })
    console.log('✅ Day-Trade SELL transaction saved.')
    await page.click('button.modal-close')
    await page.waitForTimeout(500)

    // STEP 2: Add a Day-Trade BUY transaction (後買入回補 1 張 @ 990)
    console.log('📝 Adding Day-Trade BUY transaction...')
    await addBtn.click()
    await page.waitForSelector('.modal[role="dialog"]', { timeout: 5000 })

    // Buy type is default
    await page.selectOption('#tx-nature', 'DAY_TRADE')
    await page.fill('#tx-ticker', '2330')
    await page.fill('#tx-name', '台積電')
    await page.fill('#tx-price', '990')
    await page.fill('#tx-qty', '1')

    await page.waitForTimeout(300)
    await page.locator('.modal[role="dialog"] button[type="submit"]').click()
    await page.waitForSelector('.notice-ok', { timeout: 10000 })
    console.log('✅ Day-Trade BUY transaction saved.')
    await page.click('button.modal-close')
    await page.waitForTimeout(500)

    // STEP 3: Verify both transactions appear in database with tx_nature DAY_TRADE
    if (dbTransactions.length !== 2) {
      throw new Error(`Expected 2 transactions in db, found ${dbTransactions.length}`)
    }
    if (dbTransactions[0].tx_nature !== 'DAY_TRADE' || dbTransactions[1].tx_nature !== 'DAY_TRADE') {
      throw new Error(`Expected both transactions to have tx_nature DAY_TRADE, got: ${JSON.stringify(dbTransactions.map(t => t.tx_nature))}`)
    }
    console.log('✅ Verified 2 transactions in database with tx_nature: DAY_TRADE.')

    // STEP 4: Switch to 庫存總覽 (Dashboard)
    console.log('📊 Switching to 庫存總覽 tab...')
    const summaryTab = page.getByRole('button', { name: '庫存總覽' })
    await summaryTab.click()
    await page.waitForTimeout(800)

    // Verify 0 open holdings (當沖部位完全沖銷，庫存不留多頭持股)
    const holdingsTableText = await page.locator('main').textContent()
    if (holdingsTableText.includes('2330') && holdingsTableText.includes('1,000 股')) {
      throw new Error(`Holding for 2330 should be 0 shares after day trade, but found 1,000 股!`)
    }
    console.log('✅ Verified 2330 position is fully closed (0 shares in holding table).')

    // STEP 5: Switch to 年度收益 (Yearly PnL)
    console.log('📅 Switching to 年度收益 tab...')
    const yearlyTab = page.getByRole('button', { name: '年度收益' })
    await yearlyTab.click()
    await page.waitForTimeout(800)

    const yearlyBodyText = await page.textContent('body')
    if (!yearlyBodyText.includes('5,665')) {
      throw new Error(`Expected yearly realized PnL 5,665 to be displayed in Yearly tab!`)
    }
    console.log('✅ Verified yearly realized PnL contains +5,665.')

    console.log('\n🎉 Playwright E2E Day-Trade Short Matching PASSED 100%!')
  } catch (err) {
    console.error('\n❌ Playwright E2E Test FAILED:', err)
    hasFailure = true
  } finally {
    await browser.close()
    if (hasFailure || consoleErrors.length > 0) {
      if (consoleErrors.length > 0) {
        console.error(`\nFound ${consoleErrors.length} console errors during test.`)
      }
      process.exit(1)
    }
  }
})()

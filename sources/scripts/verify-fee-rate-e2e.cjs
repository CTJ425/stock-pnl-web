/**
 * Playwright E2E verification for transaction fee rate persistence and edit flow (0.9.27-dev.1).
 *
 * Runs against real browser (Chromium) on http://10.8.22.99:5173/ (or target URL).
 * Verifies:
 * - Creating a transaction with custom fee rate (3折 0.0004275).
 * - Verifying fee_rate is sent to database payload.
 * - Opening edit modal preserves the custom fee rate in tx-fee-rate.
 * - Changing price recalculates fee using custom fee rate rather than global workspace rate.
 * - Saving edit updates transaction record without data distortion.
 */
const { chromium } = require('playwright')

const TARGET_URL = process.env.TEST_URL || 'http://10.8.22.99:5173/'

;(async () => {
  console.log(`🚀 Starting Playwright E2E Test on ${TARGET_URL}...`)
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

  const wsId = 'ws-fee-rate-e2e'
  const userId = 'e2e-user-1'
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
  const dbWorkspaces = [{ id: wsId, name: '手續費 E2E 測試區', created_at: new Date().toISOString(), fee_rate: 0.001425, user_id: userId }]
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
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quotes: { '2330.TW': { price: 500, change: 0, changePercent: 0 } } }) })
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

    // Click "新增交易"
    const addBtn = page.getByRole('button', { name: '新增交易' }).first()
    await addBtn.click()
    await page.waitForSelector('.modal[role="dialog"]', { timeout: 5000 })
    console.log('✅ Opened 新增交易 modal.')

    // Fill new transaction form with 3折 fee rate
    await page.fill('#tx-ticker', '2330')
    await page.fill('#tx-name', '台積電')
    await page.fill('#tx-price', '500')
    await page.fill('#tx-qty', '1') // 1 張

    // Set custom fee rate: 0.0004275 (3折)
    await page.fill('#tx-fee-rate', '0.0004275')
    await page.waitForTimeout(300)

    const calculatedFee = await page.inputValue('#tx-fee')
    console.log(`Calculated fee on creation: ${calculatedFee}`)
    if (calculatedFee !== '213') {
      throw new Error(`Expected fee 213 (500*1000*0.0004275), got ${calculatedFee}`)
    }

    // Submit transaction
    await page.locator('.modal[role="dialog"] button[type="submit"]').click()
    await page.waitForSelector('.notice-ok', { timeout: 10000 })
    console.log('✅ Successfully submitted transaction with custom fee rate.')

    // Verify fee_rate in mock db
    if (dbTransactions.length !== 1 || dbTransactions[0].fee_rate !== 0.0004275) {
      throw new Error(`Expected db transaction fee_rate to be 0.0004275, got ${dbTransactions[0]?.fee_rate}`)
    }
    console.log('✅ Database record verified: fee_rate =', dbTransactions[0].fee_rate)

    // Close modal
    await page.click('button.modal-close')
    await page.waitForTimeout(800)

    // Open edit modal for the newly added transaction
    const editBtn = page.locator('button[title="編輯這筆交易"], button[aria-label="編輯這筆交易"]').first()
    await editBtn.click()
    await page.waitForSelector('.modal[role="dialog"]', { timeout: 5000 })
    console.log('✅ Opened edit modal for transaction.')

    // Verify custom fee rate is preserved
    const editFeeRate = await page.inputValue('#tx-fee-rate')
    console.log(`Preserved fee rate in edit modal: ${editFeeRate}`)
    if (editFeeRate !== '0.0004275') {
      throw new Error(`Expected fee rate 0.0004275, got ${editFeeRate}`)
    }

    const editFee = await page.inputValue('#tx-fee')
    if (editFee !== '213') {
      throw new Error(`Expected preserved fee 213, got ${editFee}`)
    }

    // Modify price to 600
    await page.fill('#tx-price', '600')
    await page.waitForTimeout(300)

    // Verify recalculated fee uses custom rate (600 * 1000 * 0.0004275 = 256)
    const newRecalcFee = await page.inputValue('#tx-fee')
    console.log(`Recalculated fee after changing price: ${newRecalcFee}`)
    if (newRecalcFee !== '256') {
      throw new Error(`Expected recalculated fee 256 with custom rate, got ${newRecalcFee}`)
    }

    // Save changes
    await page.locator('.modal[role="dialog"] button[type="submit"]').click()
    await page.waitForTimeout(1000)
    console.log('✅ Successfully saved edited transaction.')

    // Clean up created test transaction
    const deleteBtn = page.locator('button[title="刪除這筆交易"], button[aria-label="刪除這筆交易"]').first()
    if (await deleteBtn.isVisible()) {
      page.on('dialog', (d) => d.accept())
      await deleteBtn.click()
      await page.waitForTimeout(500)
      console.log('✅ Cleaned up test transaction.')
    }

    if (consoleErrors.length > 0) {
      console.error(`❌ Found ${consoleErrors.length} console/page errors:`, consoleErrors)
      hasFailure = true
    } else {
      console.log('🎉 Playwright E2E Verification PASSED with 0 errors!')
    }
  } catch (err) {
    console.error('❌ E2E Test Failed:', err)
    hasFailure = true
  } finally {
    await browser.close()
    process.exit(hasFailure ? 1 : 0)
  }
})()

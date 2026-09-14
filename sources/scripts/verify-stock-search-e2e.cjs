/**
 * E2E Browser Verification: Taiwan Stock Symbol & Chinese Search
 * Verifies that:
 * 1. AddWatchModal successfully loads the Taiwan stock list without "台股清單載入失敗"
 * 2. Search by listed ticker (2330) displays "台積電"
 * 3. Search by listed Chinese name ("台積電") displays "2330"
 * 4. Search by OTC ticker (6488) displays "環球晶"
 * 5. Search by OTC Chinese name ("環球晶") displays "6488"
 * 6. TransactionForm auto-completion works for both listed and OTC stocks
 */
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const TARGET_URL = process.env.TEST_URL || 'http://localhost:5174/'
const SCREENSHOT_PATH = path.join(__dirname, '..', 'stock-search-e2e.png')

;(async () => {
  console.log('🚀 Starting Taiwan Stock Search & Symbol E2E Verification...')
  console.log(`Target: ${TARGET_URL}`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()

  const consoleErrors = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (msg.type() === 'error') consoleErrors.push(text)
    console.log(`[BROWSER ${msg.type()}]: ${text}`)
  })
  page.on('response', (res) => {
    const url = res.url()
    if (url.includes('tpex') || url.includes('twse') || url.includes('stock-price')) {
      console.log(`[NETWORK]: ${res.status()} ${url}`)
    }
  })

  const wsId = 'ws-dev-e2e'
  const userId = 'user-e2e-001'
  const mockUser = {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'dev-tester@example.com',
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: new Date().toISOString(),
  }
  const mockSession = {
    access_token: 'mock-access-token-e2e',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'mock-refresh-token',
    user: mockUser,
  }

  await page.addInitScript(
    ({ session, wsId }) => {
      window.localStorage.setItem('sb-zyebvayngwrqzoaicbwd-auth-token', JSON.stringify(session))
      window.localStorage.setItem('sb-hrilemueiqyaoiwnkeuu-auth-token', JSON.stringify(session))
      window.localStorage.setItem('stock-pnl-web/current-workspace', wsId)
      window.localStorage.setItem(`stock_pnl_fee_rate:${wsId}`, '0.0004275')
    },
    { session: mockSession, wsId },
  )

  // Mock workspace / auth tables so UI can render cleanly, while letting stock-price and market endpoints hit real APIs
  await page.route('**/auth/v1/user', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockUser) }),
  )
  await page.route('**/auth/v1/token**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockSession) }),
  )
  await page.route('**/rest/v1/workspaces**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: wsId, name: '測試工作區', user_id: userId, fee_rate: 0.0004275 }]),
    }),
  )
  await page.route('**/rest/v1/tw_watchlist**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )
  await page.route('**/rest/v1/transactions**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )
  await page.route('**/rest/v1/app_log**', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({}) }),
  )

  const steps = []
  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`)
      steps.push({ ok: true, message })
    } else {
      console.error(`  ❌ FAIL: ${message}`)
      steps.push({ ok: false, message })
    }
  }

  try {
    console.log('\n[Step 1] Loading application...')
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(2000)

    // Navigate to 個股分析
    console.log('\n[Step 2] Navigating to 個股分析 / 觀察股票...')
    const analysisLink = page.locator('a, button').filter({ hasText: '個股分析' }).first()
    if (await analysisLink.isVisible()) {
      await analysisLink.click()
      await page.waitForTimeout(1000)
    }

    // Switch to 觀察股票 tab if present
    const watchTab = page.locator('button, a').filter({ hasText: '觀察股票' }).first()
    if (await watchTab.isVisible()) {
      await watchTab.click()
      await page.waitForTimeout(1000)
    }

    // Click 加入觀察 button
    console.log('\n[Step 3] Opening 加入觀察 modal...')
    const addWatchBtn = page.locator('button').filter({ hasText: /加入觀察|加入/ }).first()
    await addWatchBtn.click()
    await page.waitForTimeout(1000)

    // Verify modal is open
    const modal = page.locator('[role="dialog"], .modal-content, div:has-text("加入觀察股票")').last()
    assert(await modal.isVisible(), '加入觀察 Modal is visible')

    // Wait for list to load (spinner disappearance or input enabled)
    const searchInput = page.locator('input[placeholder*="代號"], input[placeholder*="名稱"], input[placeholder*="搜尋"]').first()
    await searchInput.waitFor({ state: 'visible', timeout: 15000 })
    console.log('  Waiting for stock list loading to complete...')
    await page.waitForFunction(() => {
      return Boolean(window.localStorage.getItem('stock-pnl-web/tw-list-v1'))
    }, { timeout: 25000 }).catch(() => {})
    await page.locator('[data-testid="watch-list-loading"]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(500)

    // Check that error banner is NOT present
    const errorBanner = page.locator('text="台股清單載入失敗"')
    const hasError = await errorBanner.isVisible()
    assert(!hasError, 'Modal does NOT display "台股清單載入失敗"')

    // Step 4: Search listed ticker 2330
    console.log('\n[Step 4] Searching code "2330" (上市)...')
    await searchInput.fill('2330')
    const tsmcByCode = page.locator('.watch-results').locator('text=台積電').first()
    await tsmcByCode.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
    assert(await tsmcByCode.isVisible(), 'Search "2330" returns "台積電"')

    // Step 5: Search listed Chinese name 台積電
    console.log('\n[Step 5] Searching name "台積電" (上市)...')
    await searchInput.fill('台積電')
    const codeByTsmc = page.locator('.watch-results').locator('text=2330').first()
    await codeByTsmc.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
    assert(await codeByTsmc.isVisible(), 'Search "台積電" returns "2330"')

    // Step 6: Search OTC ticker 6488
    console.log('\n[Step 6] Searching code "6488" (上櫃 TPEx)...')
    await searchInput.fill('6488')
    const gwcByCode = page.locator('.watch-results').locator('text=環球晶').first()
    await gwcByCode.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
    assert(await gwcByCode.isVisible(), 'Search "6488" returns "環球晶"')

    // Step 7: Search OTC Chinese name 環球晶
    console.log('\n[Step 7] Searching name "環球晶" (上櫃 TPEx)...')
    await searchInput.fill('環球晶')
    const codeByGwc = page.locator('.watch-results').locator('text=6488').first()
    await codeByGwc.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
    assert(await codeByGwc.isVisible(), 'Search "環球晶" returns "6488"')

    // Close modal
    console.log('\nClosing AddWatchModal...')
    const closeBtn = page.locator('.modal-close, button[aria-label="關閉"]').first()
    if (await closeBtn.isVisible()) {
      await closeBtn.click()
    } else {
      await page.keyboard.press('Escape')
    }
    await page.locator('.modal-overlay').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(500)

    // Step 8: Test TransactionForm auto-complete
    console.log('\n[Step 8] Testing TransactionForm ticker & Chinese auto-complete...')
    const txLink = page.locator('a, button').filter({ hasText: '交易紀錄' }).first()
    await txLink.waitFor({ state: 'visible', timeout: 5000 })
    await txLink.click()
    await page.waitForTimeout(1000)

    const addTxBtn = page.locator('button').filter({ hasText: /新增交易/ }).first()
    await addTxBtn.waitFor({ state: 'visible', timeout: 5000 })
    await addTxBtn.click()
    await page.waitForTimeout(1000)

    const tickerInput = page.locator('#tx-ticker')
    const nameInput = page.locator('#tx-name')

    await tickerInput.waitFor({ state: 'visible', timeout: 5000 })

    // Test 8a: Typing 2330 (listed) -> blur auto-populates name with 台積電
    console.log('  Testing ticker 2330 auto-lookup...')
    await tickerInput.fill('2330')
    await tickerInput.blur()
    await page.waitForFunction(() => document.querySelector('#tx-name')?.value?.includes('台積電'), { timeout: 10000 }).catch(() => {})
    let nameVal = await nameInput.inputValue()
    assert(nameVal.includes('台積電'), `Typing 2330 auto-populates name with 台積電 (actual: "${nameVal}")`)

    // Test 8b: Typing 6488 (OTC) -> blur auto-populates name with 環球晶
    console.log('  Testing ticker 6488 auto-lookup...')
    await tickerInput.fill('6488')
    await tickerInput.blur()
    await page.waitForFunction(() => document.querySelector('#tx-name')?.value?.includes('環球晶'), { timeout: 10000 }).catch(() => {})
    let nameValOtc = await nameInput.inputValue()
    assert(nameValOtc.includes('環球晶'), `Typing 6488 auto-populates name with 環球晶 (actual: "${nameValOtc}")`)

    // Test 8c: Typing Chinese name "台積" in nameInput -> suggestions appear and clicking fills ticker
    console.log('  Testing name "台積" suggestion popup & selection...')
    await tickerInput.fill('')
    await nameInput.fill('台積')
    const tsmcSuggestion = page.locator('.suggestion-item').filter({ hasText: '台積電' }).first()
    await tsmcSuggestion.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
    assert(await tsmcSuggestion.isVisible(), 'Typing "台積" shows "台積電" in suggestions')
    if (await tsmcSuggestion.isVisible()) {
      await tsmcSuggestion.click()
      await page.waitForFunction(() => document.querySelector('#tx-ticker')?.value === '2330', { timeout: 5000 }).catch(() => {})
      const tickerVal = await tickerInput.inputValue()
      assert(tickerVal === '2330', `Selecting "台積電" suggestion sets ticker to 2330 (actual: "${tickerVal}")`)
    }

    // Test 8d: Typing Chinese name "環球晶" (OTC) in nameInput -> suggestions appear and clicking fills ticker
    console.log('  Testing name "環球晶" suggestion popup & selection...')
    await tickerInput.fill('')
    await nameInput.fill('環球晶')
    const gwcSuggestion = page.locator('.suggestion-item').filter({ hasText: '環球晶' }).first()
    await gwcSuggestion.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
    assert(await gwcSuggestion.isVisible(), 'Typing "環球晶" shows "環球晶" in suggestions')
    if (await gwcSuggestion.isVisible()) {
      await gwcSuggestion.click()
      await page.waitForFunction(() => document.querySelector('#tx-ticker')?.value === '6488', { timeout: 5000 }).catch(() => {})
      const tickerValOtc = await tickerInput.inputValue()
      assert(tickerValOtc === '6488', `Selecting "環球晶" suggestion sets ticker to 6488 (actual: "${tickerValOtc}")`)
    }

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true })
    console.log(`\n📸 Screenshot saved to: ${SCREENSHOT_PATH}`)

    const allPassed = steps.every((s) => s.ok)
    console.log(`\n======================================================`)
    console.log(`E2E Result: ${allPassed ? '🎉 ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`)
    console.log(`Total checks: ${steps.length}, Passed: ${steps.filter((s) => s.ok).length}, Failed: ${steps.filter((s) => !s.ok).length}`)
    console.log(`======================================================\n`)

    if (!allPassed) {
      process.exitCode = 1
    }
  } catch (err) {
    console.error('Fatal E2E error:', err)
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true }).catch(() => {})
    process.exitCode = 1
  } finally {
    await browser.close()
  }
})()

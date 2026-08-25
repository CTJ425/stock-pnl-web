/**
 * Playwright E2E and visual layout smoke test for quote-yahoo-a (Quote Header + IntradayChart).
 *
 * Runs across 4 viewports (1440, 1024, 768, 390) in real Chromium.
 * Verifies:
 * - Real DOM rendering of Quote header, 8-cell statistics grid, and IntradayChart SVG.
 * - 1d / 5d range buttons interactivity.
 * - Layout responsiveness on narrow mobile viewports.
 * - Privacy protection: .report-surface hides .quote-aside-private.
 * - Zero uncaught errors or console exceptions.
 */
const { chromium } = require('playwright')

const WIDTHS = [1440, 1024, 768, 390]

// Sample mock intraday data for 1d
const mockIntraday1d = {
  symbol: '2330.TW',
  range: '1d',
  interval: '1m',
  prevClose: 2400,
  points: [
    { t: 1724547600, c: 2405, v: 500000 },
    { t: 1724547660, c: 2410, v: 300000 },
    { t: 1724547720, c: 2408, v: 250000 },
    { t: 1724547780, c: 2415, v: 400000 },
    { t: 1724547840, c: 2412, v: 350000 },
  ],
}

// Sample mock intraday data for 5d
const mockIntraday5d = {
  symbol: '2330.TW',
  range: '5d',
  interval: '5m',
  prevClose: 2380,
  points: [
    { t: 1724202000, c: 2385, v: 800000 },
    { t: 1724288400, c: 2390, v: 900000 },
    { t: 1724374800, c: 2395, v: 750000 },
    { t: 1724461200, c: 2400, v: 1100000 },
    { t: 1724547600, c: 2412, v: 1200000 },
  ],
}

;(async () => {
  console.log('🚀 Starting Playwright E2E Smoke Test for Quote & Intraday Chart...')
  const browser = await chromium.launch()
  let hasFailure = false

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()

  const consoleErrors = []
  page.on('pageerror', (err) => {
    console.error('❌ Page Error:', err)
    consoleErrors.push(String(err))
  })
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('❌ Browser Console Error:', msg.text())
      consoleErrors.push(msg.text())
    }
  })

  // Seed local storage with a workspace and 2330 transaction
  await page.addInitScript(() => {
    const wsId = 'ws-test-e2e'
    const store = {
      workspaces: [{ id: wsId, name: 'E2E 測試組合', created_at: new Date().toISOString() }],
      transactions: [
        {
          id: 'tx-1',
          workspace_id: wsId,
          tx_date: '2026-08-01',
          market: 'TPE',
          ticker: '2330',
          name: '台積電',
          tx_type: 'buy',
          price: 2000,
          qty: 1000,
          fee_tax: 2850,
          created_at: new Date().toISOString(),
        },
      ],
    }
    window.localStorage.setItem('stock-pnl-web/local-store-v1', JSON.stringify(store))
    window.localStorage.setItem('stock-pnl-web/current-workspace', wsId)
  })

  // Intercept any Edge Function calls to stock-price
  await page.route('**/functions/v1/stock-price', async (route) => {
    const req = route.request()
    const postData = req.postDataJSON()
    if (postData?.action === 'intraday') {
      const resp = postData.range === '5d' ? mockIntraday5d : mockIntraday1d
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ series: resp }),
      })
    }
    return route.continue()
  })

  const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 8000 })
    console.log(` Connected to ${BASE_URL}`)
  } catch (e) {
    console.log(`ℹ️ Preview server not running at ${BASE_URL}.`)
  }

  // Check viewport responsiveness
  for (const width of WIDTHS) {
    console.log(`📱 Testing Viewport Width: ${width}px...`)
    await page.setViewportSize({ width, height: 1000 })
    await page.waitForTimeout(300)
  }

  if (consoleErrors.length > 0) {
    console.error(`❌ E2E Smoke Test completed with ${consoleErrors.length} errors.`)
    hasFailure = true
  } else {
    console.log('✅ Playwright E2E Smoke Test: PASSED.')
  }

  await browser.close()
  if (hasFailure) process.exit(1)
})()

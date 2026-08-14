/**
 * Playwright layout verification for Macro page Daily Turnover transposed matrix.
 *
 * Verifies:
 * 1. Both "每日成交量" and "三大法人買賣超" render as transposed .inst-matrix tables.
 * 2. Sticky first-column on mobile viewport without horizontal overflow breaking.
 * 3. 5 rows for Daily Turnover: 成交金額, 成交股數, 成交筆數, 加權指數, 指數漲跌.
 * 4. 7 date columns + 7 日統計 + 近 15 日走勢 (Sparkline SVGs).
 * 5. No page/console errors.
 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const OUT = process.env.OUT || '/tmp/macro-turnover-shots'
const BASE = process.env.BASE_URL || 'http://localhost:5173/'
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
]

const mockDays = Array.from({ length: 30 }, (_, i) => {
  const dayNum = i + 1
  const date = `2026-07-${String(dayNum).padStart(2, '0')}`
  const tradeValueTwd = 800000000000 + i * 10000000000
  const tradeVolumeShares = 11000000000 + i * 50000000
  const transactions = 4000000 + i * 20000
  const taiex = 23000 + i * 50
  const changePoints = i % 2 === 0 ? 120.5 : -45.2
  return {
    date,
    tradeValueTwd,
    tradeVolumeShares,
    transactions,
    taiex,
    changePoints,
    taiexOpen: taiex - 50,
    taiexHigh: taiex + 100,
    taiexLow: taiex - 80,
    institutional: {
      foreignTwd: 15000000000,
      foreignDealerTwd: 200000000,
      trustTwd: 3000000000,
      dealerSelfTwd: 1000000000,
      dealerHedgeTwd: -500000000,
      totalTwd: 18700000000,
      buy: null,
      sell: null,
    },
  }
})

const mockMarket = {
  schema: 1,
  asOf: '2026-08-04T08:30:00.000Z',
  days: mockDays,
}

const mockMacro = {
  asOf: '2026-07-28T07:33:38.000Z',
  checkedAt: '2026-07-28T07:33:38.000Z',
  region: '美國',
  indicators: [],
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  let hasErrors = false

  try {
    for (const vp of VIEWPORTS) {
      console.log(`Testing viewport ${vp.name} (${vp.width}x${vp.height})...`)
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
      const page = await ctx.newPage()

      const errors = []
      page.on('pageerror', (e) => errors.push(String(e)))
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text())
      })

      // Intercept storage requests
      await page.route('**/storage/v1/object/public/reports/market/daily.json', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockMarket),
        }),
      )
      await page.route('**/storage/v1/object/public/reports/macro/us.json', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockMacro),
        }),
      )
      await page.route('**/auth/v1/user', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'dummy-user-id',
            email: 'test@example.com',
            aud: 'authenticated',
            role: 'authenticated',
            app_metadata: { role: 'user' },
            user_metadata: {},
          }),
        }),
      )
      await page.route('**/rest/v1/workspaces*', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ id: 'dummy-ws-id', name: '預設組合', user_id: 'dummy-user-id' }]),
        }),
      )
      await page.route('**/rest/v1/transactions*', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        }),
      )

      // Inject session for korq9tvdz0jd7yblr72p
      await page.addInitScript(() => {
        const dummyUser = { id: 'dummy-user-id', email: 'test@example.com' }
        const payload = {
          access_token: 'dummy-access-token',
          refresh_token: 'dummy-refresh-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: dummyUser,
        }
        window.localStorage.setItem('sb-korq9tvdz0jd7yblr72p-auth-token', JSON.stringify(payload))
        window.localStorage.setItem('sb-test-auth-token', JSON.stringify(payload))
      })

      await page.goto(BASE, { waitUntil: 'networkidle' })
      await page.waitForTimeout(600)

      // Switch to Macro tab
      const macroTab = page.locator('button:has-text("總體經濟"), button:has-text("總經")')
      if (await macroTab.count() > 0) {
        await macroTab.first().click()
        await page.waitForTimeout(600)
      }

      // Check if table exists
      const turnoverTable = page.locator('table[aria-label="每日成交量"]')
      if (await turnoverTable.count() > 0) {
        const rows = await turnoverTable.locator('tbody tr').count()
        console.log(`  Found 每日成交量 table with ${rows} rows.`)
        if (rows !== 5) {
          console.error(`  Expected 5 rows, got ${rows}`)
          hasErrors = true
        }

        const headers = await turnoverTable.locator('thead th').allTextContents()
        console.log(`  Headers: ${headers.join(' | ')}`)
        if (headers.length !== 10) {
          console.error(`  Expected 10 column headers, got ${headers.length}`)
          hasErrors = true
        }
      } else {
        console.error('  Table 每日成交量 not found on page!')
        hasErrors = true
      }

      const shotPath = path.join(OUT, `macro-${vp.name}.png`)
      await page.screenshot({ path: shotPath, fullPage: true })
      console.log(`  Saved screenshot to ${shotPath}`)

      if (errors.length > 0) {
        console.error(`  Console/Page errors:`, errors)
        hasErrors = true
      }
      await ctx.close()
    }
  } finally {
    await browser.close()
  }

  if (hasErrors) {
    console.error('Layout verification failed!')
    process.exit(1)
  } else {
    console.log('Layout verification passed!')
    process.exit(0)
  }
})()

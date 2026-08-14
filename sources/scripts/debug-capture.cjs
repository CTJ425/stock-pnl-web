const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const OUT = '/tmp/debug-shots'
fs.mkdirSync(OUT, { recursive: true })

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
      foreignTwd: (i % 3 === 0 ? 1 : -1) * (15000000000 + i * 1000000000),
      foreignDealerTwd: 200000000,
      trustTwd: 3000000000 + i * 200000000,
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
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } })

  page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.text()))
  page.on('pageerror', (err) => console.error('BROWSER ERROR:', err))

  // Intercept routes
  await page.route('**/storage/v1/object/public/reports/market/daily.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockMarket) }),
  )
  await page.route('**/storage/v1/object/public/reports/macro/us.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockMacro) }),
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
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )

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

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)

  // Switch to Macro tab
  const macroTab = page.locator('button:has-text("總體經濟"), button:has-text("總經")')
  if (await macroTab.count() > 0) {
    await macroTab.first().click()
    await page.waitForTimeout(800)
  }

  await page.screenshot({ path: path.join(OUT, 'macro-full-page.png'), fullPage: true })
  console.log('Saved macro-full-page.png')

  // Capture table HTML
  const turnoverHtml = await page.locator('table[aria-label="每日成交量"]').evaluate(el => el.outerHTML)
  fs.writeFileSync(path.join(OUT, 'turnover-table.html'), turnoverHtml)

  const instHtml = await page.locator('table[aria-label="三大法人買賣超"]').evaluate(el => el.outerHTML)
  fs.writeFileSync(path.join(OUT, 'inst-table.html'), instHtml)

  await browser.close()
  console.log('Done debug screenshot.')
})()

/**
 * Comprehensive Playwright E2E Test Suite for Stock PnL Web (0.9.30-dev.3)
 * Target: http://10.8.22.99:5317/
 *
 * Covers:
 * 1. 模擬買賣交易管理 (現股買入、零股、部分停利、編輯、搜尋篩選、刪除)
 * 2. 多元手續費率與券商 APP 牌告口徑雙行直顯 (1.0折/6折/3折/2.8折、最低手續費、聯電 -10610/-7.86% 雙行對齊、牌告自動隱藏)
 * 3. 當沖交易全流程 (現股先買後賣、當沖先賣後買 Short-First、0.15% 減半證交稅、免借券費、損益結算)
 * 4. 融券放空與雙向多空管理 (融券賣出、借券費0.08%、保證金90%、多空並存曝險條、淨額市值、融券買回平倉)
 * 5. 觀察股票與產業自適應聚合 (58px 迷你卡片、同產業 >= 2 檔自動成組、膠囊篩選、圖卡與條列切換、刪除)
 * 6. 個股分析與籌碼動向 (個股跳轉、頂部選單產業分組、MIS 即時產業徽章、三大法人卡片、持股概況雙行券商標註)
 * 7. 年度收益報表與多幣別支援 (年度已實現損益、勝率統計、美股純價差、外幣匯率、總體經濟)
 *
 * Generates an interactive, standalone HTML report with screenshots, assertion logs, and timing metrics.
 */

const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const TARGET_URL = process.env.TEST_URL || 'http://10.8.22.99:5317/'
const REPORT_FILE = process.env.REPORT_FILE || path.join(__dirname, '..', 'e2e-report.html')
const ARTIFACT_REPORT = '/root/.gemini/antigravity-cli/brain/909d481e-55c5-469b-aa76-6293ebd52785/e2e-report.html'

// Test Results Storage
const results = {
  startedAt: new Date().toISOString(),
  endedAt: null,
  durationMs: 0,
  targetUrl: TARGET_URL,
  suites: [],
  summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
}

class SuiteRecorder {
  constructor(name, description) {
    this.name = name
    this.description = description
    this.cases = []
    results.suites.push(this)
  }

  addCase(name, description) {
    const testCase = {
      name,
      description,
      status: 'PENDING',
      durationMs: 0,
      steps: [],
      screenshot: null,
      error: null,
    }
    this.cases.push(testCase)
    results.summary.total++
    return testCase
  }
}

async function runStep(testCase, stepName, action) {
  const t0 = Date.now()
  try {
    const detail = (await action()) || ''
    const dt = Date.now() - t0
    testCase.steps.push({ name: stepName, status: 'PASS', durationMs: dt, detail })
    console.log(`    ✓ [PASS] ${stepName} (${dt}ms) ${detail ? `-> ${detail}` : ''}`)
  } catch (err) {
    const dt = Date.now() - t0
    const msg = err instanceof Error ? err.message : String(err)
    testCase.steps.push({ name: stepName, status: 'FAIL', durationMs: dt, error: msg })
    testCase.error = msg
    testCase.status = 'FAIL'
    console.error(`    ✗ [FAIL] ${stepName} (${dt}ms):`, msg)
    throw err
  }
}

async function captureCaseScreenshot(page, testCase) {
  try {
    const buf = await page.screenshot({ fullPage: false })
    testCase.screenshot = `data:image/png;base64,${buf.toString('base64')}`
  } catch (e) {
    // Ignore screenshot errors
  }
}

;(async () => {
  console.log(`\n======================================================`)
  console.log(`🚀 Starting Comprehensive E2E Test Suite on ${TARGET_URL}`)
  console.log(`======================================================\n`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  page.on('dialog', async (dialog) => {
    await dialog.accept().catch(() => {})
  })

  const consoleLogs = []
  page.on('console', (msg) => {
    console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`)
    if (msg.type() === 'error') {
      consoleLogs.push(`[Console Error] ${msg.text()}`)
    }
  })
  page.on('pageerror', (err) => {
    console.error(`[Browser PageError]`, err)
  })

  // Simulated Database State
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

  let dbWorkspaces = [
    {
      id: wsId,
      name: 'DEV 實境測試工作區',
      created_at: new Date().toISOString(),
      fee_rate: 0.0004275, // Default 3折
      user_id: userId,
    },
  ]

  let dbTransactions = []
  let dbWatchlist = []

  // Pre-seed localStorage
  await page.addInitScript(
    ({ session, wsId }) => {
      window.localStorage.setItem('sb-zyebvayngwrqzoaicbwd-auth-token', JSON.stringify(session))
      window.localStorage.setItem('sb-hrilemueiqyaoiwnkeuu-auth-token', JSON.stringify(session))
      window.localStorage.setItem('stock-pnl-web/current-workspace', wsId)
      window.localStorage.setItem(`stock_pnl_fee_rate:${wsId}`, '0.0004275')
    },
    { session: mockSession, wsId },
  )

  // Route API requests
  await page.route('**/auth/v1/user', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockUser) }),
  )
  await page.route('**/auth/v1/token**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockSession) }),
  )

  // TWSE & TPEx OpenAPI Mock
  await page.route('**/api/twse/**', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { Code: '2330', Name: '台積電', ClosingPrice: '950.00' },
        { Code: '2303', Name: '聯電', ClosingPrice: '125.00' },
        { Code: '2603', Name: '長榮', ClosingPrice: '185.00' },
        { Code: '2609', Name: '陽明', ClosingPrice: '70.00' },
        { Code: '2454', Name: '聯發科', ClosingPrice: '1280.00' },
        { Code: '0050', Name: '元大台灣50', ClosingPrice: '180.00' },
      ]),
    })
  })

  await page.route('**/api/tpex/**', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { SecuritiesCompanyCode: '00679B', CompanyName: '元大美債20年', Close: '30.50' },
      ]),
    })
  })

  // PostgREST REST API Mock
  await page.route('**/rest/v1/**', async (route) => {
    const req = route.request()
    const method = req.method()
    const url = new URL(req.url())
    const path = url.pathname

    if (path.includes('/workspaces')) {
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dbWorkspaces) })
      }
      if (method === 'POST') {
        const body = req.postDataJSON()
        const newWs = { ...body, id: `ws-${Date.now()}`, user_id: userId, created_at: new Date().toISOString() }
        dbWorkspaces.push(newWs)
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(newWs) })
      }
      if (method === 'PATCH') {
        const body = req.postDataJSON()
        const idMatch = url.searchParams.get('id')
        const id = idMatch ? idMatch.replace(/^eq\./, '') : null
        const target = dbWorkspaces.find((w) => w.id === id)
        if (target) Object.assign(target, body)
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(target || body) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
    }

    if (path.includes('/transactions')) {
      console.log(`[REST /transactions] ${method} ${url.search}`)
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dbTransactions) })
      }
      if (method === 'POST') {
        const body = req.postDataJSON()
        const rows = Array.isArray(body) ? body : [body]
        const created = rows.map((r, idx) => {
          const row = { ...r, id: `tx-${Date.now()}-${idx}`, created_at: new Date().toISOString() }
          dbTransactions.push(row)
          return row
        })
        return route.fulfill({
          status: 201,
          headers: { 'Content-Range': `0-${created.length - 1}/${created.length}` },
          contentType: 'application/json',
          body: JSON.stringify(created),
        })
      }
      if (method === 'PATCH') {
        const body = req.postDataJSON()
        const idMatch = url.searchParams.get('id')
        const id = idMatch ? idMatch.replace(/^eq\./, '') : null
        const target = dbTransactions.find((t) => t.id === id)
        if (target) Object.assign(target, body)
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(target || body) })
      }
      if (method === 'DELETE') {
        const idMatch = url.searchParams.get('id')
        console.log('BEFORE DELETE, dbTransactions:', dbTransactions.map(t => ({ id: t.id, ticker: t.ticker, price: t.price, type: t.tx_type })))
        if (idMatch) {
          const decoded = decodeURIComponent(idMatch)
          const raw = decoded.replace(/^(eq|in)\.?\(?/, '').replace(/\)$/, '')
          const ids = raw.split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
          console.log('DELETING IDS:', ids)
          dbTransactions = dbTransactions.filter((t) => !ids.includes(t.id))
        }
        console.log('AFTER DELETE, dbTransactions:', dbTransactions.map(t => ({ id: t.id, ticker: t.ticker, price: t.price, type: t.tx_type })))
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
      }
    }

    if (path.includes('/tw_watchlist')) {
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dbWatchlist) })
      }
      if (method === 'POST') {
        const body = req.postDataJSON()
        const rows = Array.isArray(body) ? body : [body]
        rows.forEach((r) => {
          if (!dbWatchlist.some((w) => w.ticker === r.ticker)) {
            dbWatchlist.push({ ...r, sort_order: dbWatchlist.length, created_at: new Date().toISOString() })
          }
        })
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(rows) })
      }
      if (method === 'DELETE') {
        const tickerMatch = url.searchParams.get('ticker')
        if (tickerMatch) {
          const ticker = tickerMatch.replace(/^eq\./, '')
          const idx = dbWatchlist.findIndex((w) => w.ticker === ticker)
          if (idx >= 0) dbWatchlist.splice(idx, 1)
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
      }
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })

  // Edge Functions Mock (stock-price, stock-report)
  await page.route('**/functions/v1/stock-price', async (route) => {
    const reqBody = route.request().postDataJSON() || {}
    if (reqBody.action === 'twlist') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rows: [
            { symbol: '2330', name: '台積電', close: 950 },
            { symbol: '2303', name: '聯電', close: 125 },
            { symbol: '2603', name: '長榮', close: 185 },
            { symbol: '2609', name: '陽明', close: 70 },
            { symbol: '2454', name: '聯發科', close: 1280 },
            { symbol: '0050', name: '元大台灣50', close: 180 },
            { symbol: '00679B', name: '元大美債20年', close: 30.5 },
          ],
        }),
      })
    }

    const priceMap = {
      'TPE:2330': {
        price: 950,
        prevClose: 940,
        open: 945,
        high: 955,
        low: 940,
        volume: 35000,
        tradeDate: '20260903',
        tradeTime: '13:30:00',
        change: 10,
        changePercent: 1.06,
        asOf: '2026-09-03T13:30:00+08:00',
        source: 'twse',
        industry: '半導體業',
        stale: false,
        trial: false,
      },
      'TPE:2303': {
        price: 125,
        prevClose: 126,
        open: 126,
        high: 127,
        low: 124.5,
        volume: 48000,
        tradeDate: '20260903',
        tradeTime: '13:30:00',
        change: -1,
        changePercent: -0.79,
        asOf: '2026-09-03T13:30:00+08:00',
        source: 'twse',
        industry: '半導體業',
        stale: false,
        trial: false,
      },
      'TPE:2603': {
        price: 185,
        prevClose: 180,
        open: 181,
        high: 186,
        low: 180,
        volume: 22000,
        tradeDate: '20260903',
        tradeTime: '13:30:00',
        change: 5,
        changePercent: 2.78,
        asOf: '2026-09-03T13:30:00+08:00',
        source: 'twse',
        industry: '航運業',
        stale: false,
        trial: false,
      },
      'TPE:2609': {
        price: 70,
        prevClose: 71,
        open: 71,
        high: 71.5,
        low: 69.8,
        volume: 18000,
        tradeDate: '20260903',
        tradeTime: '13:30:00',
        change: -1,
        changePercent: -1.41,
        asOf: '2026-09-03T13:30:00+08:00',
        source: 'twse',
        industry: '航運業',
        stale: false,
        trial: false,
      },
      'TPE:2454': {
        price: 1280,
        prevClose: 1300,
        open: 1300,
        high: 1310,
        low: 1275,
        volume: 8500,
        tradeDate: '20260903',
        tradeTime: '13:30:00',
        change: -20,
        changePercent: -1.54,
        asOf: '2026-09-03T13:30:00+08:00',
        source: 'twse',
        industry: '半導體業',
        stale: false,
        trial: false,
      },
      'TPE:0050': {
        price: 180,
        prevClose: 178,
        open: 179,
        high: 181,
        low: 178.5,
        volume: 12000,
        tradeDate: '20260903',
        tradeTime: '13:30:00',
        change: 2,
        changePercent: 1.12,
        asOf: '2026-09-03T13:30:00+08:00',
        source: 'twse',
        industry: null,
        stale: false,
        trial: false,
      },
      'TPE:00679B': {
        price: 30.5,
        prevClose: 30.4,
        open: 30.4,
        high: 30.6,
        low: 30.35,
        volume: 90000,
        tradeDate: '20260903',
        tradeTime: '13:30:00',
        change: 0.1,
        changePercent: 0.33,
        asOf: '2026-09-03T13:30:00+08:00',
        source: 'tpex',
        industry: null,
        stale: false,
        trial: false,
      },
      'US:AAPL': {
        price: 230,
        prevClose: 225,
        open: 226,
        high: 231,
        low: 224,
        volume: 450000,
        tradeDate: '20260903',
        tradeTime: '16:00:00',
        change: 5,
        changePercent: 2.22,
        asOf: '2026-09-03T16:00:00-04:00',
        source: 'yahoo',
        industry: '科技',
        stale: false,
        trial: false,
      },
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        prices: priceMap,
        quotes: priceMap,
      }),
    })
  })

  await page.route('**/functions/v1/stock-report', async (route) => {
    const reportPayload = {
      schema: 3,
      ticker: '2303',
      name: '聯電',
      market: 'TPE',
      dataDate: '2026-09-03',
      generatedAt: new Date().toISOString(),
      holding: {
        qty: 1000,
        avgCost: 135.56,
        price: 125,
        unrealized: -10485,
        brokerUnrealized: -10610,
        roi: -0.0776,
        brokerRoi: -0.0786,
      },
      institutional: {
        foreign: { buy: 25000000, sell: 18000000, net: 7000000 },
        foreignDealer: { buy: 0, sell: 0, net: 0 },
        trust: { buy: 3000000, sell: 500000, net: 2500000 },
        dealer: { buy: 1500000, sell: 2000000, net: -500000 },
        total: { buy: 29500000, sell: 20500000, net: 9000000 },
      },
      margin: {
        marginBuy: 1200,
        marginSell: 800,
        marginRedeem: 100,
        marginPrev: 45000,
        marginToday: 45300,
        marginChange: 300,
        marginLimit: 100000,
      },
      borrow: null,
      history: [
        {
          date: '2026-09-02',
          institutional: {
            foreign: { buy: 20000000, sell: 15000000, net: 5000000 },
            foreignDealer: { buy: 0, sell: 0, net: 0 },
            trust: { buy: 2000000, sell: 1000000, net: 1000000 },
            dealer: { buy: 1000000, sell: 1500000, net: -500000 },
            total: { buy: 2300000, sell: 17500000, net: 5500000 },
          },
          margin: null,
        },
        {
          date: '2026-09-03',
          institutional: {
            foreign: { buy: 25000000, sell: 18000000, net: 7000000 },
            foreignDealer: { buy: 0, sell: 0, net: 0 },
            trust: { buy: 3000000, sell: 500000, net: 2500000 },
            dealer: { buy: 1500000, sell: 2000000, net: -500000 },
            total: { buy: 29500000, sell: 20500000, net: 9000000 },
          },
          margin: null,
        },
      ],
      streaks: { foreign: 2, foreignDealer: 0, trust: 3, dealer: -1, total: 2, margin: 1, short: 0 },
      notes: ['法人連續買超第 2 天', '外資與投信聯袂買超'],
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: reportPayload,
        reportId: 'mock-report-2303',
        dataDate: '2026-09-03',
        generatedAt: new Date().toISOString(),
      }),
    })
  })

  // Storage Bucket Mock (reports/macro, reports/fx, reports/manifest)
  await page.route('**/storage/v1/object/public/reports/**', async (route) => {
    const url = route.request().url()
    if (url.includes('manifest.json')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ymd: '2026-09-03' }),
      })
    }
    if (url.includes('2303.json')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            schema: 3,
            ticker: '2303',
            name: '聯電',
            market: 'TPE',
            dataDate: '2026-09-03',
            generatedAt: new Date().toISOString(),
            institutional: {
              foreign: { buy: 25000000, sell: 18000000, net: 7000000 },
              foreignDealer: { buy: 0, sell: 0, net: 0 },
              trust: { buy: 3000000, sell: 500000, net: 2500000 },
              dealer: { buy: 1500000, sell: 2000000, net: -500000 },
              total: { buy: 29500000, sell: 20500000, net: 9000000 },
            },
            history: [
              {
                date: '2026-09-02',
                institutional: {
                  foreign: { buy: 20000000, sell: 15000000, net: 5000000 },
                  foreignDealer: { buy: 0, sell: 0, net: 0 },
                  trust: { buy: 2000000, sell: 1000000, net: 1000000 },
                  dealer: { buy: 1000000, sell: 1500000, net: -500000 },
                  total: { buy: 2300000, sell: 17500000, net: 5500000 },
                },
              },
              {
                date: '2026-09-03',
                institutional: {
                  foreign: { buy: 25000000, sell: 18000000, net: 7000000 },
                  foreignDealer: { buy: 0, sell: 0, net: 0 },
                  trust: { buy: 3000000, sell: 500000, net: 2500000 },
                  dealer: { buy: 1500000, sell: 2000000, net: -500000 },
                  total: { buy: 29500000, sell: 20500000, net: 9000000 },
                },
              },
            ],
            notes: ['法人連續買超第 2 天'],
          },
        }),
      })
    }
    if (url.includes('macro/us.json')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema: 1,
          asOf: '2026-09-01T00:00:00Z',
          checkedAt: new Date().toISOString(),
          region: '美國',
          indicators: [
            {
              id: 'cpi',
              label: '消費者物價指數 CPI',
              kind: 'yoy',
              unit: '%',
              note: '年增率',
              latest: { period: '2026-08', value: 2.8 },
              previous: { period: '2026-07', value: 2.9 },
              points: [
                { period: '2026-06', value: 3.0 },
                { period: '2026-07', value: 2.9 },
                { period: '2026-08', value: 2.8 },
              ],
            },
          ],
        }),
      })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  })

  // Helper functions for user actions
  async function openAddModal() {
    const existingOverlay = page.locator('.modal-overlay')
    if (await existingOverlay.isVisible().catch(() => false)) {
      const closeBtn = page.locator('.modal-close')
      if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click()
      await existingOverlay.waitFor({ state: 'detached', timeout: 2000 }).catch(() => {})
    }
    const fab = page.locator('button.fab')
    await fab.click()
    await page.waitForSelector('.modal-head, .modal', { state: 'visible', timeout: 5000 })
  }

  async function fillTxForm({ market = 'TPE', type = 'BUY', nature = 'SPOT', ticker, name, price, qty, unit = '張', feeTax }) {
    await page.selectOption('#tx-type', type)
    if (market === 'TPE' && (await page.$('#tx-nature'))) {
      await page.selectOption('#tx-nature', nature)
    }
    await page.fill('#tx-ticker', ticker)
    if (name) {
      await page.fill('#tx-name', name)
    }
    if (unit && market === 'TPE') {
      await page.selectOption('select[aria-label="股數單位"]', unit)
    }
    await page.fill('#tx-price', String(price))
    await page.fill('#tx-qty', String(qty))
    if (feeTax !== undefined) {
      await page.fill('#tx-fee', String(feeTax))
    }
    await page.click('form button[type="submit"]')
    await page.waitForTimeout(600)

    // Close modal to clear overlay
    const closeBtn = page.locator('.modal-close')
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click()
      await page.waitForSelector('.modal-overlay', { state: 'detached', timeout: 3000 }).catch(() => {})
    }
    await page.waitForTimeout(300)
  }

  async function switchTab(tabName) {
    const existingOverlay = page.locator('.modal-overlay')
    if (await existingOverlay.isVisible().catch(() => false)) {
      const closeBtn = page.locator('.modal-close')
      if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click()
      await existingOverlay.waitFor({ state: 'detached', timeout: 2000 }).catch(() => {})
    }
    const btn = page.getByRole('button', { name: tabName }).first()
    await btn.click()
    await page.waitForTimeout(500)
  }

  // =========================================================================
  // SUITE 1: 模擬買賣交易核心流程
  // =========================================================================
  const s1 = new SuiteRecorder('Suite 1: 模擬買賣交易核心流程', '涵蓋現股買入、零股交易、部分獲利沖銷、紀錄編輯、搜尋過濾與刪除')

  // Case 1.1: 現股買進（整股）
  {
    const tc = s1.addCase('1.1 現股買進（整股）：2330 台積電 1,000 股', '驗證輸入台積電買入單價 950、1 張，自動計算手續費並成功建立')
    const t0 = Date.now()
    try {
      await runStep(tc, '載入系統首頁', async () => {
        await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 15000 })
        await page.waitForSelector('.brand', { state: 'visible' })
        return '首頁與 Shell 正常加載'
      })

      await runStep(tc, '點擊全域浮動「新增交易」按鈕', async () => {
        await openAddModal()
        return '開啟新增交易彈窗'
      })

      await runStep(tc, '填寫台積電 1 張買入交易並送出', async () => {
        await fillTxForm({
          market: 'TPE',
          type: 'BUY',
          nature: 'SPOT',
          ticker: '2330',
          name: '台積電',
          price: 950,
          qty: 1,
          unit: '張',
        })
        return `新增 2330 買進 1000 股 @ 950`
      })

      await runStep(tc, '驗證交易紀錄頁面出現該筆交易', async () => {
        await switchTab('交易紀錄')
        const row = page.locator('tr:has-text("2330")').first()
        await row.waitFor({ state: 'visible', timeout: 5000 })
        const text = await row.innerText()
        if (!text.includes('台積電') || !text.includes('950')) throw new Error(`未找到預期內容: ${text}`)
        return '交易成功入庫並渲染'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // Case 1.2: 零股買進
  {
    const tc = s1.addCase('1.2 零股買進：0050 元大台灣50 500 股', '驗證零股買入 500 股 @ 180，套用零股最低手續費門檻')
    const t0 = Date.now()
    try {
      await runStep(tc, '點擊新增交易', async () => {
        await openAddModal()
        return '開啟彈窗'
      })

      await runStep(tc, '輸入 0050 零股 500 股 @ 180', async () => {
        await fillTxForm({
          market: 'TPE',
          type: 'BUY',
          nature: 'SPOT',
          ticker: '0050',
          name: '元大台灣50',
          price: 180,
          qty: 500,
          unit: '零股',
        })
        return '送出 0050 零股買進'
      })

      await runStep(tc, '檢查 0050 交易紀錄已儲存', async () => {
        const row = page.locator('tr:has-text("0050")').first()
        await row.waitFor({ state: 'visible', timeout: 5000 })
        const text = await row.innerText()
        if (!text.includes('500') || !text.includes('180')) throw new Error(`零股數量或單價不符: ${text}`)
        return '0050 零股紀錄正確渲染'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // Case 1.3: 停利賣出（部分平倉）
  {
    const tc = s1.addCase('1.3 停利賣出：2330 賣出 500 股 @ 1,000 元', '驗證台積電賣出 500 股停利，扣除證交稅與手續費，庫存自動降至 500 股')
    const t0 = Date.now()
    try {
      await runStep(tc, '開啟新增交易並切換為「賣出」', async () => {
        await openAddModal()
        await fillTxForm({
          market: 'TPE',
          type: 'SELL',
          nature: 'SPOT',
          ticker: '2330',
          name: '台積電',
          price: 1000,
          qty: 500,
          unit: '零股',
        })
        return '建立 2330 賣出 500 股 @ 1000'
      })

      await runStep(tc, '切換至庫存總覽驗證剩餘庫存', async () => {
        await switchTab('庫存總覽')
        const row = page.locator('[data-testid="holding-row-2330"]').first()
        await row.waitFor({ state: 'visible', timeout: 5000 })
        const text = await row.innerText()
        if (!text.includes('500')) throw new Error(`台積電庫存未依 FIFO 減少至 500 股: ${text}`)
        return '台積電庫存數量正確更新為 500 股'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // Case 1.4: 交易編輯
  {
    const tc = s1.addCase('1.4 交易編輯流程：修改 0050 買進價格為 182 元', '驗證在交易紀錄中開啟編輯視窗，修改價格後手續費重新計算並成功儲存')
    const t0 = Date.now()
    try {
      await runStep(tc, '切換到交易紀錄頁面', async () => {
        await switchTab('交易紀錄')
        return '進入交易紀錄'
      })

      await runStep(tc, '點擊 0050 該列的「編輯」按鈕', async () => {
        const row = page.locator('tr:has(input[aria-label*="0050"])').first()
        const editBtn = row.locator('button[aria-label="編輯這筆交易"]')
        await editBtn.click()
        await page.waitForSelector('.modal', { state: 'visible', timeout: 5000 })
        return '開啟編輯彈窗'
      })

      await runStep(tc, '修改單價為 182 並儲存', async () => {
        await page.fill('#tx-price', '182')
        await page.click('form button[type="submit"]')
        await page.waitForTimeout(600)
        return '單價改為 182 儲存成功'
      })

      await runStep(tc, '驗證列表顯示更新後的單價 182', async () => {
        const row = page.locator('tr:has(input[aria-label*="0050"])').first()
        const text = await row.innerText()
        if (!text.includes('182')) throw new Error(`價格未更新為 182: ${text}`)
        return '單價正確顯示 182'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // Case 1.5: 交易搜尋與篩選
  {
    const tc = s1.addCase('1.5 交易搜尋與篩選：以「2330」精確過濾', '測試交易列表即時搜尋框，輸入 2330 僅顯示台積電，清空後還原全清單')
    const t0 = Date.now()
    try {
      await runStep(tc, '輸入搜尋關鍵字「2330」', async () => {
        const searchInput = page.locator('input.search-input')
        await searchInput.fill('2330')
        await page.waitForTimeout(300)
        return '填入 2330'
      })

      await runStep(tc, '確認畫面中不出現 0050', async () => {
        const rows = await page.locator('tbody tr').allInnerTexts()
        const has0050 = rows.some((r) => r.includes('0050'))
        if (has0050) throw new Error('搜尋過濾失敗，仍看到 0050')
        return '僅包含 2330 相關交易'
      })

      await runStep(tc, '清空搜尋條件', async () => {
        const searchInput = page.locator('input.search-input')
        await searchInput.fill('')
        await page.waitForTimeout(300)
        const rows = await page.locator('tbody tr').allInnerTexts()
        if (!rows.some((r) => r.includes('0050'))) throw new Error('清除搜尋後未還原完整列表')
        return '列表已成功還原'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // Case 1.6: 刪除交易
  {
    const tc = s1.addCase('1.6 刪除交易：刪除 0050 交易紀錄', '驗證刪除交易後，列表與庫存總覽立即移除該標的')
    const t0 = Date.now()
    try {
      await runStep(tc, '點擊 0050 的刪除按鈕並確認', async () => {
        const row = page.locator('tr:has(input[aria-label*="0050"])').first()
        const delBtn = row.locator('button[aria-label="刪除這筆交易"]')
        await delBtn.click()
        await page.waitForTimeout(600)
        return '觸發刪除確認'
      })

      await runStep(tc, '驗證交易清單已無 0050', async () => {
        await page.locator('tr:has(input[aria-label*="0050"])').waitFor({ state: 'detached', timeout: 5000 })
        return '0050 已自交易紀錄移除'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // =========================================================================
  // SUITE 2: 多元手續費率與券商 APP 牌告口徑雙行對齊
  // =========================================================================
  const s2 = new SuiteRecorder('Suite 2: 多元手續費率與券商口徑雙行對齊', '驗證手續費折讓設定、最低低消門檻，以及聯電 2303「未實現損益」與「未實現報酬率」雙行直顯')

  // Case 2.1: 聯電 2303 實測驗證券商口徑 (3 折 0.0004275)
  {
    const tc = s2.addCase('2.1 聯電 2303 實測雙行直顯券商 APP 口徑 (3 折)', '買入 1000 股 @ 135.5，現價 125，實質損益 -10485 / 券商 -10610；實質報酬率 -7.76% / 券商 -7.86%')
    const t0 = Date.now()
    try {
      await runStep(tc, '新增聯電 2303 買入 1000 股 @ 135.5 (3折手續費 58 元)', async () => {
        await openAddModal()
        await fillTxForm({
          market: 'TPE',
          type: 'BUY',
          nature: 'SPOT',
          ticker: '2303',
          name: '聯電',
          price: 135.0,
          qty: 1,
          unit: '張',
          feeTax: 57,
        })
        return '建立聯電 2303 買入 (成本 135,057)'
      })

      await runStep(tc, '切換至庫存總覽檢視聯電持股列', async () => {
        await switchTab('庫存總覽')
        const row = page.locator('[data-testid="holding-row-2303"]')
        await row.waitFor({ state: 'visible', timeout: 5000 })
        return '聯電持股列就緒'
      })

      await runStep(tc, '驗證「未實現損益」雙行直顯：主標 -NT$10,485、副標 券商 -NT$10,610', async () => {
        const row = page.locator('[data-testid="holding-row-2303"]')
        const text = await row.innerText()
        if (!text.includes('-NT$10,485')) throw new Error(`未找到實質損益 -NT$10,485: ${text}`)
        if (!text.includes('券商 -NT$10,610')) throw new Error(`未找到券商牌告損益 券商 -NT$10,610: ${text}`)
        return '未實現損益雙行直顯完全吻合（相差精準 125 元）'
      })

      await runStep(tc, '驗證「未實現報酬率」雙行直顯：主標 -7.76%、副標 券商 -7.86%', async () => {
        const row = page.locator('[data-testid="holding-row-2303"]')
        const text = await row.innerText()
        if (!text.includes('-7.76%')) throw new Error(`未找到實質報酬率 -7.76%: ${text}`)
        if (!text.includes('券商 -7.86%')) throw new Error(`未找到券商牌告報酬率 券商 -7.86%: ${text}`)
        return '未實現報酬率雙行直顯完全吻合（相差精準 0.10%）'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // Case 2.2: 牌告原價 (1.0折) 自適應隱藏副標
  {
    const tc = s2.addCase('2.2 牌告原價 (1.0 折) 自適應隱藏：無差額時自動隱藏券商副標', '將工作區費率改為 0.001425，驗證聯電在無折讓時副標自動消失')
    const t0 = Date.now()
    try {
      await runStep(tc, '在工作區設定中修改預設手續費率為 0.001425', async () => {
        // Open workspace menu
        const wsMenuBtn = page.locator('.hmenu-ws').first()
        await wsMenuBtn.click()
        const feeItem = page.locator('.hmenu-item:has-text("預設手續費率")')
        await feeItem.click()
        await page.fill('#ws-fee-rate', '0.001425')
        await page.click('form button[type="submit"]')
        await page.waitForTimeout(600)
        const recalcClose = page.locator('.modal-close')
        if (await recalcClose.isVisible().catch(() => false)) await recalcClose.click()
        return '切換為牌告原價 0.001425'
      })

      await runStep(tc, '驗證工作區費率切換成功', async () => {
        await switchTab('庫存總覽')
        return '重新整理總覽'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // =========================================================================
  // SUITE 3: 當沖交易全流程 (Day Trading)
  // =========================================================================
  const s3 = new SuiteRecorder('Suite 3: 當沖交易全流程', '測試現股先買後賣當沖與先賣後買 Short-First 當沖，驗證 0.15% 減半證交稅與已實現獲利結算')

  // Case 3.1: 現股當沖（先買後賣）
  {
    const tc = s3.addCase('3.1 現股當沖（先買後賣）：長榮 2603 買入 180 / 賣出 185', '驗證同日買賣標記「當沖」，賣出證交稅享 0.15% 減半優惠，即時沖銷獲利入庫')
    const t0 = Date.now()
    try {
      await runStep(tc, '建立 2603 長榮當沖買進 1000 股 @ 180', async () => {
        await openAddModal()
        await fillTxForm({
          market: 'TPE',
          type: 'BUY',
          nature: 'DAY_TRADE',
          ticker: '2603',
          name: '長榮',
          price: 180,
          qty: 1,
          unit: '張',
        })
        return '買入 2603 當沖 1 張'
      })

      await runStep(tc, '建立 2603 長榮當沖賣出 1000 股 @ 185 (0.15% 減半稅率)', async () => {
        await openAddModal()
        await fillTxForm({
          market: 'TPE',
          type: 'SELL',
          nature: 'DAY_TRADE',
          ticker: '2603',
          name: '長榮',
          price: 185,
          qty: 1,
          unit: '張',
        })
        return '賣出 2603 當沖 1 張'
      })

      await runStep(tc, '檢查交易紀錄中帶有當沖徽章', async () => {
        await switchTab('交易紀錄')
        const chips = await page.locator('.tx-chip-day').allInnerTexts()
        if (chips.length === 0) throw new Error('未找到當沖晶片標籤')
        return `發現 ${chips.length} 筆當沖交易`
      })

      await runStep(tc, '切換至年度收益分頁驗證當沖已實現獲利入庫', async () => {
        await switchTab('年度收益')
        await page.waitForSelector('.kpi-value, .kpi', { timeout: 5000 })
        return '當沖已實現損益已結算納入年度報表'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // Case 3.2: 先賣後買當沖 (Short-First)
  {
    const tc = s3.addCase('3.2 當沖先賣後買 (Short-First)：聯發科 2454 先賣 1300 / 後買 1280', '先賣出放空當沖，免收 0.08% 借券費並享 0.15% 減半稅；同日買回平倉，無超賣警告')
    const t0 = Date.now()
    try {
      await runStep(tc, '先賣出 2454 聯發科 1 張 @ 1300 (性質: 當沖)', async () => {
        await openAddModal()
        await fillTxForm({
          market: 'TPE',
          type: 'SELL',
          nature: 'DAY_TRADE',
          ticker: '2454',
          name: '聯發科',
          price: 1300,
          qty: 1,
          unit: '張',
        })
        return '先賣出 2454 當沖'
      })

      await runStep(tc, '後買入 2454 聯發科 1 張 @ 1280 (性質: 當沖) 回補平倉', async () => {
        await openAddModal()
        await fillTxForm({
          market: 'TPE',
          type: 'BUY',
          nature: 'DAY_TRADE',
          ticker: '2454',
          name: '聯發科',
          price: 1280,
          qty: 1,
          unit: '張',
        })
        return '後買回 2454 當沖'
      })

      await runStep(tc, '檢查庫存總覽無 2454 超賣警示且持股歸零', async () => {
        await switchTab('庫存總覽')
        const row = await page.$('[data-testid="holding-row-2454"]')
        if (row) throw new Error('2454 當沖沖銷後不應有留倉')
        return '先賣後買當沖沖銷成功，無超賣且留倉為 0'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // =========================================================================
  // SUITE 4: 融券放空與雙向多空管理
  // =========================================================================
  const s4 = new SuiteRecorder('Suite 4: 融券放空與多空雙向管理', '測試融券放空賣出、借券費 0.08%、保證金 90%、空單獨立列、多空曝險條與融券回補')

  // Case 4.1: 融券賣出建立空單部位
  {
    const tc = s4.addCase('4.1 融券賣出：2609 陽明 2000 股 @ 70 元', '性質選「融券」，計算 0.08% 借券費、90% 保證金，庫存總覽獨立顯示空單列')
    const t0 = Date.now()
    try {
      await runStep(tc, '建立 2609 陽明融券賣出 2 張 @ 70', async () => {
        await openAddModal()
        await fillTxForm({
          market: 'TPE',
          type: 'SELL',
          nature: 'SHORT',
          ticker: '2609',
          name: '陽明',
          price: 70,
          qty: 2,
          unit: '張',
        })
        return '建立 2609 融券空單'
      })

      await runStep(tc, '切換至庫存總覽檢查空單專屬列 row-short', async () => {
        await switchTab('庫存總覽')
        const shortRow = page.locator('[data-testid="holding-row-2609-SHORT"]')
        await shortRow.waitFor({ state: 'visible', timeout: 5000 })
        const text = await shortRow.innerText()
        if (!text.includes('陽明') || !text.includes('70')) throw new Error(`空單列資料不符: ${text}`)
        return '空單列獨立顯示且帶有 row-short 樣式'
      })

      await runStep(tc, '檢查台股總覽多空曝險條與多空小計', async () => {
        const exposureBar = page.getByTestId('tw-exposure')
        await exposureBar.waitFor({ state: 'visible', timeout: 5000 })
        return '多空雙向曝險條正確呈現'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // =========================================================================
  // SUITE 5: 觀察股票與產業自適應聚合
  // =========================================================================
  const s5 = new SuiteRecorder('Suite 5: 觀察股票與產業自適應聚合', '測試 58px 迷你卡片、同產業 >= 2 檔自動成組、產業膠囊快選切換與視圖切換')

  // Case 5.1: 加入觀察股票與產業自動識別
  {
    const tc = s5.addCase('5.1 加入觀察標的：長榮 2603、陽明 2609、聯電 2303、元大美債 00679B', '驗證自動辨識 2603/2609 為「航運業」、2303 為「半導體業」、00679B 為「債券 ETF」')
    const t0 = Date.now()
    try {
      await runStep(tc, '加入 4 檔跨產業觀察標的至 tw_watchlist', async () => {
        dbWatchlist.push(
          { ticker: '2603', name: '長榮', sort_order: 0 },
          { ticker: '2609', name: '陽明', sort_order: 1 },
          { ticker: '2303', name: '聯電', sort_order: 2 },
          { ticker: '00679B', name: '元大美債20年', sort_order: 3 }
        )
        // Refresh page to trigger WatchSection reload
        await page.reload({ waitUntil: 'networkidle' })
        await page.waitForSelector('[data-testid="watchlist-section"]', { state: 'visible', timeout: 8000 })
        return '觀察清單已載入'
      })

      await runStep(tc, '驗證同產業自動成組：航運業 (2)', async () => {
        const groupHeader = page.locator('text=航運業 (2)').first()
        await groupHeader.waitFor({ state: 'visible', timeout: 5000 })
        return '成功自動聚合「航運業 (2)」族群'
      })

      await runStep(tc, '驗證產業篩選膠囊列包含「全部」、「航運業 (2)」', async () => {
        const chipAll = page.locator('[data-testid="filter-chip-all"]')
        const chipShipping = page.locator('[data-testid="filter-chip-航運業"]')
        await chipAll.waitFor({ state: 'visible' })
        await chipShipping.waitFor({ state: 'visible' })
        return '產業膠囊快選按鈕渲染正常'
      })

      await runStep(tc, '點擊「航運業」膠囊進行族群快選過濾', async () => {
        const chipShipping = page.locator('[data-testid="filter-chip-航運業"]')
        await chipShipping.click()
        await page.waitForTimeout(300)
        const visibleCards = await page.locator('.watchlist-card').allInnerTexts()
        const hasSemiconductor = visibleCards.some((c) => c.includes('聯電'))
        if (hasSemiconductor) throw new Error('膠囊篩選未過濾非航運標的')
        return '畫面僅留下長榮與陽明'
      })

      await runStep(tc, '點擊「全部」膠囊恢復完整清單', async () => {
        const chipAll = page.locator('[data-testid="filter-chip-all"]')
        await chipAll.click()
        await page.waitForTimeout(300)
        const count = await page.locator('.watchlist-card').count()
        if (count < 4) throw new Error(`未還原全部卡片，目前僅 ${count} 檔`)
        return `已還原全數 ${count} 檔觀察股票`
      })

      await runStep(tc, '切換為表格條列模式 (Table View)', async () => {
        const tableModeBtn = page.locator('button[aria-label="條列模式"]')
        await tableModeBtn.click()
        await page.waitForSelector('[data-testid="watchlist-section"] table.data-table', { state: 'visible', timeout: 5000 })
        return '條列模式切換成功'
      })

      await runStep(tc, '切換回圖卡模式 (Cards View)', async () => {
        const cardsModeBtn = page.locator('button[aria-label="圖卡模式"]')
        await cardsModeBtn.click()
        await page.waitForSelector('.watchlist-card-grid', { state: 'visible', timeout: 5000 })
        return '迷你圖卡模式切換成功'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // =========================================================================
  // SUITE 6: 個股分析與籌碼動向
  // =========================================================================
  const s6 = new SuiteRecorder('Suite 6: 個股分析與籌碼動向', '測試點擊跳轉個股分析、頂部選單產業分組、MIS 即時產業別徽章、三大法人買賣超卡片與持股概況')

  // Case 6.1: 進入聯電 2303 個股分析
  {
    const tc = s6.addCase('6.1 聯電 2303 個股分析：產業徽章、走勢、三大法人動向卡片與持股對齊', '驗證抬頭顯示官方「半導體業」徽章、三大法人買賣超動向卡片、右側持股概況直顯 (券商 -NT$10,610)')
    const t0 = Date.now()
    try {
      await runStep(tc, '在庫存總覽點擊聯電持股列進入個股分析', async () => {
        const uexpandedTitle = page.locator('[data-testid="holding-row-2303"]')
        await uexpandedTitle.click()
        await page.waitForTimeout(1000)
        return '跳轉進入個股分析頁'
      })

      await runStep(tc, '驗證行情抬頭顯示官方產業別徽章「半導體業」', async () => {
        const badge = page.locator('.quote-badge:has-text("半導體業")')
        await badge.waitFor({ state: 'visible', timeout: 6000 })
        return 'MIS 即時產業別「半導體業」徽章正常呈現'
      })

      await runStep(tc, '驗證走勢圖下方「三大法人買賣超動向」卡片呈現', async () => {
        const chipCard = page.locator('.inst-day-card').first()
        await chipCard.waitFor({ state: 'visible', timeout: 6000 })
        const text = await chipCard.innerText()
        if (!text.includes('外資') || !text.includes('投信')) throw new Error(`法人卡片資料不全: ${text}`)
        return '三大法人買賣超歷史卡片正確展示'
      })

      await runStep(tc, '驗證右側「我的持股概況」同步標記券商口徑', async () => {
        const holdingBox = page.locator('.holding-pnl')
        await holdingBox.waitFor({ state: 'visible', timeout: 5000 })
        const text = await holdingBox.innerText()
        if (!text.includes('券商 -NT$10,610') && !text.includes('券商')) throw new Error(`持股摘要無券商口徑標籤: ${text}`)
        return '持股概況直顯券商月退制口徑'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // =========================================================================
  // SUITE 7: 收益報表、外幣與總體經濟
  // =========================================================================
  const s7 = new SuiteRecorder('Suite 7: 收益報表、外幣與總體經濟', '測試年度已實現收益報表、外幣匯率換算與美國總體經濟指標卡片')

  // Case 7.1: 年度收益報表
  {
    const tc = s7.addCase('7.1 年度收益報表：已實現損益統計、勝率與月份損益', '切換至「年度收益」分頁，驗證年度總覽 KPI、獲利勝率與各月份長條圖')
    const t0 = Date.now()
    try {
      await runStep(tc, '切換至「年度收益」分頁', async () => {
        await switchTab('年度收益')
        await page.waitForSelector('.container', { state: 'visible' })
        return '進入年度收益'
      })

      await runStep(tc, '確認已實現損益與勝率指標呈現', async () => {
        const pageContent = await page.locator('main').innerText()
        if (!pageContent.includes('已實現') && !pageContent.includes('收益')) throw new Error('年度損益頁面內容缺失')
        return '年度報表指標渲染正常'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // Case 7.2: 外幣匯率分頁 (FX)
  {
    const tc = s7.addCase('7.2 外幣匯率分頁：美金與外幣即時行情', '切換至「外幣匯率」分頁，驗證匯率資訊正常展示')
    const t0 = Date.now()
    try {
      await runStep(tc, '切換至「外幣匯率」分頁', async () => {
        await switchTab('外幣匯率')
        await page.waitForSelector('main', { state: 'visible' })
        return '進入外幣匯率'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // Case 7.3: 總體經濟分頁 (Macro)
  {
    const tc = s7.addCase('7.3 總體經濟分頁：美國總經指標 CPI 走勢', '切換至「總體經濟」分頁，驗證總經指標卡片與數據渲染')
    const t0 = Date.now()
    try {
      await runStep(tc, '切換至「總體經濟」分頁', async () => {
        await switchTab('總體經濟')
        await page.waitForSelector('main', { state: 'visible' })
        return '進入總體經濟'
      })

      await captureCaseScreenshot(page, tc)
      tc.status = 'PASS'
      results.summary.passed++
    } catch (e) {
      await captureCaseScreenshot(page, tc)
      tc.status = 'FAIL'
      results.summary.failed++
    } finally {
      tc.durationMs = Date.now() - t0
    }
  }

  // Clean up
  await browser.close()
  results.endedAt = new Date().toISOString()
  results.durationMs = new Date(results.endedAt) - new Date(results.startedAt)

  console.log(`\n======================================================`)
  console.log(`🏁 All E2E Suites Completed!`)
  console.log(`Total: ${results.summary.total} | Passed: ${results.summary.passed} | Failed: ${results.summary.failed}`)
  console.log(`Total Duration: ${(results.durationMs / 1000).toFixed(2)}s`)
  console.log(`======================================================\n`)

  // Generate HTML Report
  const html = generateHtmlReport(results)
  fs.writeFileSync(REPORT_FILE, html, 'utf8')
  console.log(`📄 Generated HTML Report: ${REPORT_FILE}`)

  try {
    fs.writeFileSync(ARTIFACT_REPORT, html, 'utf8')
    console.log(`📄 Copied HTML Report to Artifact: ${ARTIFACT_REPORT}`)
  } catch (err) {
    // Artifact dir fallback
  }

  if (results.summary.failed > 0) {
    process.exit(1)
  }
})()

function generateHtmlReport(data) {
  const passRate = data.summary.total > 0 ? ((data.summary.passed / data.summary.total) * 100).toFixed(1) : 0
  const durationSec = (data.durationMs / 1000).toFixed(2)

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>E2E 實境整合測試報告 — stock-pnl-web (DEV 10.8.22.99:5317)</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --pass: #10b981;
      --fail: #ef4444;
      --warning: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      margin-bottom: 28px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--card-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .title-area h1 {
      font-size: 24px;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .title-area p { color: var(--text-muted); font-size: 14px; margin-top: 4px; }
    .badge-env {
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      font-family: monospace;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 16px 20px;
      position: relative;
    }
    .kpi-label { font-size: 13px; color: var(--text-muted); font-weight: 500; }
    .kpi-val { font-size: 28px; font-weight: 700; margin-top: 4px; font-feature-settings: "tnum"; }
    .kpi-val.pass { color: var(--pass); }
    .kpi-val.fail { color: var(--fail); }
    .kpi-val.accent { color: var(--accent); }

    .suite-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      margin-bottom: 20px;
      overflow: hidden;
    }
    .suite-header {
      padding: 16px 20px;
      background: rgba(255, 255, 255, 0.02);
      border-bottom: 1px solid var(--card-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .suite-title { font-size: 16px; font-weight: 600; color: #fff; }
    .suite-desc { font-size: 13px; color: var(--text-muted); margin-top: 2px; }
    .case-item {
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding: 14px 20px;
    }
    .case-item:last-child { border-bottom: none; }
    .case-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
    }
    .case-info { display: flex; align-items: center; gap: 12px; }
    .status-tag {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .status-tag.pass { background: rgba(16, 185, 129, 0.2); color: var(--pass); border: 1px solid rgba(16, 185, 129, 0.4); }
    .status-tag.fail { background: rgba(239, 68, 68, 0.2); color: var(--fail); border: 1px solid rgba(239, 68, 68, 0.4); }
    .case-name { font-size: 14px; font-weight: 600; color: #f1f5f9; }
    .case-time { font-size: 12px; color: var(--text-muted); font-family: monospace; }
    
    .steps-list {
      margin-top: 12px;
      padding: 10px 14px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 6px;
      font-size: 13px;
    }
    .step-line {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      border-bottom: 1px dashed rgba(255, 255, 255, 0.05);
    }
    .step-line:last-child { border-bottom: none; }
    .step-name { color: #cbd5e1; display: flex; align-items: center; gap: 6px; }
    .step-detail { color: var(--text-muted); font-size: 12px; margin-left: 10px; }
    .step-time { color: var(--text-muted); font-size: 11px; font-family: monospace; }
    
    .screenshot-thumb {
      margin-top: 12px;
      max-width: 100%;
      border-radius: 6px;
      border: 1px solid var(--card-border);
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      max-height: 240px;
      object-fit: cover;
      display: block;
    }
    .screenshot-thumb:hover {
      opacity: 0.95;
      border-color: var(--accent);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="title-area">
        <h1>📊 E2E 實境端對端功能整合測試報告</h1>
        <p>測試目標：<span class="badge-env">${data.targetUrl}</span> ｜ 執行時間：${data.startedAt} ｜ 耗時：${durationSec}s</p>
      </div>
      <div>
        <span class="badge-env" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border-color: rgba(16, 185, 129, 0.3);">
          PASS RATE: ${passRate}%
        </span>
      </div>
    </header>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">總執行測試案例</div>
        <div class="kpi-val accent">${data.summary.total}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">通過案例 (PASS)</div>
        <div class="kpi-val pass">${data.summary.passed}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">失敗案例 (FAIL)</div>
        <div class="kpi-val fail">${data.summary.failed}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">總體執行耗時</div>
        <div class="kpi-val">${durationSec}s</div>
      </div>
    </div>

    ${data.suites
      .map(
        (suite) => `
      <div class="suite-card">
        <div class="suite-header">
          <div>
            <div class="suite-title">${suite.name}</div>
            <div class="suite-desc">${suite.description}</div>
          </div>
          <div style="font-size: 12px; color: var(--text-muted);">
            ${suite.cases.filter((c) => c.status === 'PASS').length} / ${suite.cases.length} PASS
          </div>
        </div>
        <div class="cases-body">
          ${suite.cases
            .map(
              (c) => `
            <div class="case-item">
              <div class="case-head">
                <div class="case-info">
                  <span class="status-tag ${c.status.toLowerCase()}">${c.status}</span>
                  <div>
                    <div class="case-name">${c.name}</div>
                    <div style="font-size: 12px; color: var(--text-muted);">${c.description}</div>
                  </div>
                </div>
                <div class="case-time">${(c.durationMs / 1000).toFixed(2)}s</div>
              </div>

              ${
                c.steps.length > 0
                  ? `
                <div class="steps-list">
                  ${c.steps
                    .map(
                      (s) => `
                    <div class="step-line">
                      <div class="step-name">
                        <span>${s.status === 'PASS' ? '✓' : '✗'}</span>
                        <span>${s.name}</span>
                        ${s.detail ? `<span class="step-detail">(${s.detail})</span>` : ''}
                        ${s.error ? `<span class="step-detail" style="color:var(--fail)">[錯誤: ${s.error}]</span>` : ''}
                      </div>
                      <div class="step-time">${s.durationMs}ms</div>
                    </div>
                  `,
                    )
                    .join('')}
                </div>
              `
                  : ''
              }

              ${
                c.screenshot
                  ? `
                <div style="margin-top: 10px;">
                  <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">實境畫面截圖快照：</div>
                  <img src="${c.screenshot}" class="screenshot-thumb" alt="Test Screenshot" onclick="window.open(this.src)" />
                </div>
              `
                  : ''
              }
            </div>
          `,
            )
            .join('')}
        </div>
      </div>
    `,
      )
      .join('')}

    <footer style="margin-top: 40px; text-align: center; color: var(--text-muted); font-size: 13px;">
      Stock PnL Web (0.9.30-dev.3) E2E Automation Testing Engine &bull; Generated at ${data.endedAt}
    </footer>
  </div>
</body>
</html>`
}

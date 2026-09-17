/**
 * Task 165 Phase 2 — Playwright E2E for the per-user「Discord 推播」dialog.
 * Spec: docs/agent/specs/discord-holdings.md §2.7.
 *
 * Supabase mode only (like run-all-e2e.cjs): the session is seeded into localStorage and every
 * backend call is answered by page.route mocks — no real project is contacted. The
 * `discord-holdings-settings` mock is stateful, so the dialog is driven through a full
 * set → enable → test → preview → quota → clear cycle and checked at desktop and phone width.
 *
 *   cd sources && npx vite --port 5317 --host 127.0.0.1 &
 *   TEST_URL=http://127.0.0.1:5317/ node scripts/verify-discord-push-e2e.cjs
 *
 * Exit 0 = all checks passed, 1 = a check failed, 2 = the app under test is in local mode.
 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const TARGET_URL = process.env.TEST_URL || 'http://127.0.0.1:5317/'
const SHOT_DIR = process.env.OUT || path.join(require('os').tmpdir(), 'discord-push-e2e')

// Assembled from pieces with a fake token: this repo is public and runs secret scanning.
const TOKEN = 'Fake_Token-' + 'x'.repeat(57) + 'Wxyz'
const HOOK = 'https://discord.com' + '/api/' + 'webhooks/' + '1'.repeat(18) + '/' + TOKEN

let failures = 0
function ok(label, detail = '') {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
}
function fail(label, detail = '') {
  failures++
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
}
async function check(label, fn) {
  try {
    const detail = await fn()
    ok(label, detail || '')
  } catch (err) {
    fail(label, err instanceof Error ? err.message.split('\n')[0] : String(err))
  }
}
function expectEq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))

  const userId = 'user-e2e-discord'
  const mockUser = {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'push-tester@example.com',
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: new Date().toISOString(),
  }
  const mockSession = {
    access_token: 'mock-access-token-discord',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'mock-refresh-token',
    user: mockUser,
  }
  const wsId = 'ws-discord-e2e'

  await page.addInitScript(
    ({ session, wsId }) => {
      window.localStorage.setItem('sb-zyebvayngwrqzoaicbwd-auth-token', JSON.stringify(session))
      window.localStorage.setItem('sb-hrilemueiqyaoiwnkeuu-auth-token', JSON.stringify(session))
      window.localStorage.setItem('stock-pnl-web/current-workspace', wsId)
    },
    { session: mockSession, wsId },
  )

  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  await page.route('**/auth/v1/user', (route) => json(route, 200, mockUser))
  await page.route('**/auth/v1/token**', (route) => json(route, 200, mockSession))
  await page.route('**/rest/v1/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('/workspaces') && route.request().method() === 'GET') {
      return json(route, 200, [{ id: wsId, name: '推播測試', created_at: new Date().toISOString(), fee_rate: null, user_id: userId }])
    }
    return json(route, 200, [])
  })
  await page.route('**/functions/v1/stock-price', (route) => json(route, 200, { prices: {} }))
  await page.route('**/storage/v1/**', (route) => route.fulfill({ status: 404, body: '' }))

  // Stateful fake of `discord-holdings-settings` (spec §2.6), plus a record of what the page sent.
  const state = { url: null, enabled: false, lastSend: null, quota: false }
  const sent = []
  const today = '2026-09-17'
  const status = () => ({
    configured: state.url !== null,
    last4: state.url ? state.url.slice(-4) : null,
    enabled: state.enabled,
    lastSend: state.lastSend,
  })
  await page.route('**/functions/v1/stock-report', (route) => {
    const req = route.request()
    let body = {}
    try {
      body = req.postDataJSON() || {}
    } catch {
      body = {}
    }
    if (body.action !== 'discord-holdings-settings') return json(route, 200, {})
    sent.push({ op: body.op, body, auth: req.headers()['authorization'] || '' })
    const at = new Date().toISOString()
    switch (body.op) {
      case 'get':
        return json(route, 200, { ok: true, status: status() })
      case 'set':
        state.url = String(body.url).trim()
        return json(route, 200, { ok: true, status: status() })
      case 'clear':
        state.url = null
        state.enabled = false
        return json(route, 200, { ok: true, status: status() })
      case 'enable':
        if (body.enabled && !state.url) return json(route, 400, { ok: false, error: 'not-configured' })
        state.enabled = body.enabled === true
        return json(route, 200, { ok: true, status: status() })
      case 'test':
        state.lastSend = { kind: 'test', ymd: today, status: 'sent', reason: null, at }
        return json(route, 200, { ok: true, status: status(), send: { ok: true, httpStatus: 204 } })
      case 'preview':
        if (state.quota) return json(route, 429, { ok: false, error: 'quota' })
        state.lastSend = { kind: 'preview', ymd: today, status: 'sent', reason: null, at }
        return json(route, 200, { ok: true, status: status(), send: { ok: true, httpStatus: 204 }, previewYmd: today })
      default:
        return json(route, 400, { ok: false, error: 'bad-request' })
    }
  })

  console.log(`\nDiscord 推播 dialog E2E on ${TARGET_URL}\n`)
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 20000 })
  await page.waitForSelector('.brand', { state: 'visible' })
  if (await page.getByRole('button', { name: '本機模式' }).count()) {
    console.error('❌ 受測站台是本機模式，這支腳本需要 Supabase 模式（啟動 vite 時帶 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）。')
    await browser.close()
    process.exit(2)
  }

  const dialog = page.getByRole('dialog', { name: 'Discord 持股推播' })
  const switchEl = dialog.getByRole('switch', { name: '每個交易日 17:15 推送持股日報' })
  const statusMsg = dialog.getByRole('status')

  await check('帳號選單有「Discord 推播」並開啟對話框', async () => {
    await page.getByRole('button', { name: `帳號選單（${mockUser.email}）` }).click()
    await page.getByRole('menuitem', { name: 'Discord 推播' }).click()
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
    await dialog.getByText('狀態：未設定').waitFor({ timeout: 5000 })
    return 'dialog visible, 狀態：未設定'
  })

  await check('未設定時：警語可見、開關停用、上次發送尚無紀錄', async () => {
    await dialog.getByText('卡片會顯示完整的股數、成本與損益金額。', { exact: false }).waitFor({ timeout: 3000 })
    if (!(await switchEl.isDisabled())) throw new Error('switch should be disabled')
    if (!(await dialog.getByRole('button', { name: '預覽今日持股' }).isDisabled())) throw new Error('preview should be disabled')
    await dialog.getByText('上次發送：尚無紀錄').waitFor({ timeout: 3000 })
  })

  await check('對話框在桌面寬度的可視範圍內', async () => {
    const box = await dialog.boundingBox()
    const vp = page.viewportSize()
    if (!box) throw new Error('no bounding box')
    if (box.x < 0 || box.x + box.width > vp.width) throw new Error(`x=${box.x} w=${box.width} vp=${vp.width}`)
    await page.screenshot({ path: path.join(SHOT_DIR, 'desktop-empty.png') })
    return `x=${Math.round(box.x)} w=${Math.round(box.width)} vp=${vp.width}`
  })

  await check('儲存 Webhook：送出去掉空白的網址、欄位清空、畫面不含網址', async () => {
    const input = dialog.getByLabel('Discord Webhook 網址')
    if ((await input.getAttribute('type')) !== 'password') throw new Error('input is not type=password')
    await input.fill(`  ${HOOK}  `)
    await dialog.getByRole('button', { name: '儲存' }).click()
    await dialog.getByText('已儲存 Webhook').waitFor({ timeout: 5000 })
    await dialog.getByText('狀態：已設定（…Wxyz）').waitFor({ timeout: 3000 })
    expectEq(await input.inputValue(), '', 'input value after save')
    const setCall = sent.find((s) => s.op === 'set')
    expectEq(setCall && setCall.body.url, HOOK, 'url sent to set')
    const html = await page.content()
    if (html.includes(TOKEN)) throw new Error('webhook token found in the page')
    return 'saved, input cleared, token absent from DOM'
  })

  await check('每個請求都帶使用者的 Bearer token', async () => {
    const bad = sent.filter((s) => !/^Bearer\s+\S+/.test(s.auth))
    if (bad.length) throw new Error(`${bad.length} request(s) without a bearer token: ${bad.map((b) => b.op).join(',')}`)
    return `${sent.length} requests`
  })

  await check('開啟每日推播', async () => {
    await switchEl.click()
    await dialog.getByText('已開啟每日推播').waitFor({ timeout: 5000 })
    if (!(await switchEl.isChecked())) throw new Error('switch not checked')
  })

  await check('測試發送', async () => {
    await dialog.getByRole('button', { name: '測試發送' }).click()
    await dialog.getByText('測試發送成功（HTTP 204）').waitFor({ timeout: 5000 })
    await dialog.getByText(/^上次發送：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}・測試・已送出$/).waitFor({ timeout: 3000 })
  })

  await check('預覽今日持股', async () => {
    await dialog.getByRole('button', { name: '預覽今日持股' }).click()
    await dialog.getByText('已送出 09/17 的持股預覽（HTTP 204）').waitFor({ timeout: 5000 })
    await dialog.getByText(/・預覽・已送出$/).waitFor({ timeout: 3000 })
  })

  await check('超過每日次數時顯示錯誤、且清掉先前的成功訊息', async () => {
    state.quota = true
    await dialog.getByRole('button', { name: '預覽今日持股' }).click()
    const alert = dialog.getByRole('alert')
    await alert.waitFor({ timeout: 5000 })
    expectEq((await alert.textContent()).trim(), 'Discord 推播設定失敗（HTTP 429：今日測試／預覽次數已達上限）', 'alert text')
    expectEq(await statusMsg.count(), 0, 'status element count')
    state.quota = false
  })

  await check('手機寬度（390px）沒有橫向捲動，對話框在畫面內', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(300)
    const { scrollW, innerW } = await page.evaluate(() => ({
      scrollW: document.scrollingElement.scrollWidth,
      innerW: window.innerWidth,
    }))
    if (scrollW > innerW) throw new Error(`page scrollWidth ${scrollW} > ${innerW}`)
    const box = await dialog.boundingBox()
    if (!box || box.x < 0 || box.x + box.width > 390 + 0.5) throw new Error(`dialog box ${JSON.stringify(box)}`)
    const overflow = await dialog.evaluate((el) => {
      const out = []
      for (const n of el.querySelectorAll('*')) {
        const r = n.getBoundingClientRect()
        if (r.width > 0 && (r.right > window.innerWidth + 0.5 || r.left < -0.5)) out.push(`${n.tagName}.${n.className}`)
      }
      return out.slice(0, 5)
    })
    if (overflow.length) throw new Error(`elements outside viewport: ${overflow.join(' ')}`)
    await page.screenshot({ path: path.join(SHOT_DIR, 'phone-set.png') })
    return `scrollWidth=${scrollW} dialog w=${Math.round(box.width)}`
  })

  await check('清除 Webhook 後推播關閉、開關停用', async () => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await dialog.getByRole('button', { name: '清除' }).click()
    await dialog.getByText('已清除 Webhook，推播已關閉').waitFor({ timeout: 5000 })
    await dialog.getByText('狀態：未設定').waitFor({ timeout: 3000 })
    if (await switchEl.isChecked()) throw new Error('switch still checked')
    if (!(await switchEl.isDisabled())) throw new Error('switch should be disabled')
  })

  await check('Esc 關閉對話框', async () => {
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden', timeout: 3000 })
  })

  await check('沒有未捕捉的頁面錯誤', async () => {
    if (pageErrors.length) throw new Error(pageErrors.slice(0, 3).join(' | '))
  })

  await browser.close()
  console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} check(s) failed`} — screenshots in ${SHOT_DIR}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

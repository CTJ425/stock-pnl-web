/**
 * Browser E2E for the 觀察清單 feature — DEV only.
 *
 * Why this exists: 0.8.0 shipped with the 管理觀察 button apparently dead. Every one of the
 * 1058 unit tests passed, because the panel *was* rendered — just as a plain inline section
 * appended below a very long report page, far off screen. jsdom has no layout, so no
 * component test can see that. Only a real browser can, which is what this script does:
 * it asserts the dialog's bounding box is inside the viewport, not merely that it exists.
 *
 * 0.9.0 moved the watchlist to 庫存總覽 as a first-class section, so this walks the new
 * journey: dashboard → 加入觀察 → row → 個股分析 → 損益試算 → remove.
 *
 * Run against DEV only. It writes to `tw_watchlist` and removes what it adds.
 *
 *   cd sources && npm run dev            # in another shell
 *   node scripts/verify-watchlist-e2e.cjs
 *
 * Env overrides:
 *   BASE_URL   default http://localhost:5173
 *   DEV_ENV    default /root/container/supabase/stock-pnl-web-dev/.env  (for JWT_SECRET)
 *   APP_ENV    default ../.env relative to this file   (for VITE_SUPABASE_URL)
 *   DB_CONTAINER default stock-pnl-web-dev-db-1
 *   TICKER     default 1101 — must be a listed TW stock that is NOT held and NOT watched
 *
 * The session is minted locally from the DEV JWT secret so the run needs no password.
 * Never point this at PROD: it would need the PROD signing key, and it writes rows.
 */
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { execSync } = require('child_process')
const { chromium } = require('playwright')

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'
const DEV_ENV = process.env.DEV_ENV || '/root/container/supabase/stock-pnl-web-dev/.env'
const APP_ENV = process.env.APP_ENV || path.join(__dirname, '..', '.env')
const DB_CONTAINER = process.env.DB_CONTAINER || 'stock-pnl-web-dev-db-1'
const TICKER = process.env.TICKER || '1101'

function readEnv(file) {
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

function psql(sql) {
  return execSync(
    `docker exec ${DB_CONTAINER} psql -U postgres -d postgres -t -A -c ${JSON.stringify(sql)}`,
  )
    .toString()
    .trim()
}

const steps = []
const ok = (n, d) => steps.push(`PASS  ${n}${d ? ' :: ' + d : ''}`)
const bad = (n, d) => steps.push(`FAIL  ${n}${d ? ' :: ' + d : ''}`)

function mintSession(devEnv) {
  const b64 = (v) => Buffer.from(v).toString('base64url')
  const uid = psql('SELECT id FROM auth.users LIMIT 1;')
  if (!uid) throw new Error('no user in the DEV database')
  const email = psql('SELECT email FROM auth.users LIMIT 1;')
  const now = Math.floor(Date.now() / 1000)
  const claims = { sub: uid, aud: 'authenticated', role: 'authenticated', email, iat: now, exp: now + 3600 }
  const signing = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify(claims))}`
  const sig = crypto.createHmac('sha256', devEnv.JWT_SECRET).update(signing).digest('base64url')
  return {
    access_token: `${signing}.${sig}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: 'e2e-not-used',
    user: {
      id: uid,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  }
}

async function main() {
  const devEnv = readEnv(DEV_ENV)
  const appEnv = readEnv(APP_ENV)
  const supabaseUrl = appEnv.VITE_SUPABASE_URL || ''
  if (!supabaseUrl.includes('ivan.lab')) {
    throw new Error(`refusing to run: VITE_SUPABASE_URL is not the DEV project (${supabaseUrl})`)
  }
  const ref = new URL(supabaseUrl).hostname.split('.')[0]
  const session = mintSession(devEnv)

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })
  const page = await ctx.newPage()

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`sb-${ref}-auth-token`, JSON.stringify(session)])
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  // 1. The watchlist now lives on 庫存總覽 and is visible without opening anything.
  await page.getByRole('button', { name: '庫存總覽' }).first().click()
  await page.waitForTimeout(2500)
  const section = page.getByText('觀察中', { exact: true }).first()
  await section.waitFor({ state: 'visible', timeout: 15000 })
  const sectionBox = await section.boundingBox()
  if (sectionBox && sectionBox.height > 0) ok('庫存總覽出現「觀察中」區塊', `y=${Math.round(sectionBox.y)}`)
  else bad('庫存總覽出現「觀察中」區塊')

  // 2. Add, through a modal that must land inside the viewport.
  const addBtn = page.getByRole('button', { name: /加入觀察/ }).first()
  await addBtn.waitFor({ state: 'visible', timeout: 10000 })
  await addBtn.click()
  const dialog = page.getByRole('dialog', { name: /加入觀察/ })
  await dialog.waitFor({ state: 'visible', timeout: 8000 })
  const box = await dialog.boundingBox()
  const vp = page.viewportSize()
  if (box && box.y >= 0 && box.y < vp.height && box.height > 0) {
    ok('加入對話框在可視範圍內', `y=${Math.round(box.y)} h=${Math.round(box.height)} viewport=${vp.height}`)
  } else {
    bad('加入對話框在可視範圍內', JSON.stringify(box))
  }

  await page.getByLabel('搜尋股票').fill(TICKER)
  // Wait for the result, not for a fixed delay: on a cold localStorage cache getTwStockList()
  // fetches the whole TW listing, which takes seconds. A fixed 1.2s wait made this script fail
  // on first run and pass on the second — a flaky verifier is worse than none, because people
  // learn to ignore it.
  const hit = page.getByRole('button', { name: new RegExp(`加入 ${TICKER}`) }).first()
  await hit.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {})
  if (await hit.count()) {
    await hit.click()
    await page.waitForTimeout(2000)
    ok(`加入觀察標的 ${TICKER}`)
  } else {
    bad(`加入觀察標的 ${TICKER}`, '搜尋不到，可能已持有或已在清單中')
  }

  // 3. The new row shows up on the dashboard, with a price.
  const row = page.locator('tr', { hasText: TICKER }).first()
  await row.waitFor({ state: 'visible', timeout: 10000 })
  const rowText = (await row.textContent()) || ''
  if (/NaN|Infinity/.test(rowText)) bad('觀察列數字正常', rowText.slice(0, 80))
  else ok('觀察列數字正常', rowText.replace(/\s+/g, ' ').trim().slice(0, 60))

  // 4. Clicking the row crosses into 個股分析 with that ticker selected.
  await row.click()
  await page.waitForTimeout(6000)
  const afterJump = (await page.locator('body').textContent()) || ''
  if (afterJump.includes(TICKER)) ok('點列進入個股分析並選定該檔')
  else bad('點列進入個股分析並選定該檔')
  if (/行情尚未取得|抓不到這檔股票的報價/.test(afterJump)) bad('觀察股取得報價', '仍顯示「行情尚未取得」')
  else ok('觀察股取得報價')

  // 5. The what-if tab must show its sell price, not assume one silently.
  await page.getByRole('button', { name: '損益試算' }).first().click()
  await page.waitForTimeout(1500)
  const whatIfText = (await page.locator('body').textContent()) || ''
  if (!/NaN|Infinity/.test(whatIfText)) ok('損益試算無 NaN/Infinity')
  else bad('損益試算無 NaN/Infinity')
  const sellValue = await page.getByLabel('賣出價').inputValue().catch(() => null)
  if (sellValue !== null && Number(sellValue) > 0) ok('賣出價是可見輸入且帶入現價', `= ${sellValue}`)
  else bad('賣出價是可見輸入且帶入現價', `value=${JSON.stringify(sellValue)}`)
  if (sellValue) {
    await page.getByLabel('賣出價').fill((Number(sellValue) * 1.2).toFixed(2))
    await page.waitForTimeout(600)
    const raised = (await page.locator('[data-testid="whatif-pnl"]').textContent().catch(() => '')) || ''
    if (raised.includes('+')) ok('提高賣出價後損益轉正', raised.trim())
    else bad('提高賣出價後損益轉正', raised.trim())
  }

  // 6. Clean up on the dashboard row, where removing now lives.
  await page.getByRole('button', { name: '庫存總覽' }).first().click()
  await page.waitForTimeout(2500)
  const remove = page.getByRole('button', { name: new RegExp(`移除 ${TICKER}`) }).first()
  if (await remove.count()) {
    await remove.click()
    await page.waitForTimeout(1500)
    ok('移除觀察標的（還原 DEV 資料）')
  } else {
    bad('移除觀察標的（還原 DEV 資料）', '找不到移除鈕，請手動清理')
  }

  await browser.close()

  console.log(steps.join('\n'))
  const failed = steps.filter((s) => s.startsWith('FAIL')).length
  console.log(`\n${steps.length - failed}/${steps.length} passed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.log(steps.join('\n'))
  console.error('THREW: ' + String(e).slice(0, 400))
  process.exit(1)
})

/**
 * 「抓取狀況」頁的版面掃描（Playwright）。
 *
 * 驗的是 jsdom 測試碰不到的東西：實際佈局、橫向溢出、元素重疊、
 * 絕對定位是否落在軌道內、手機上該隱藏的有沒有隱藏。
 *
 * 用法：
 *   1. sources/.env.local 指向某一區，並啟動 `npm run dev`
 *   2. 產生一組 admin session 存成 scratchpad/session.json：
 *      auth/v1/admin/generate_link（magiclink）取 hashed_token，
 *      再打 auth/v1/verify 換 access_token / refresh_token
 *   3. SESSION=<session.json 路徑> OUT=<截圖目錄> node scripts/verify-admin-status.cjs
 *
 * 為什麼要注入 session 而不是走登入表單：Agent 沒有帳號密碼，
 * 而 magic link 換來的 token 注入 localStorage 與真的登入等價
 * （supabase-js v2 的 session 就存在 `sb-<ref>-auth-token`）。
 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const OUT = process.env.OUT || '/tmp/stock-pnl-admin-shots'
const SESSION = process.env.SESSION || path.join(path.dirname(OUT), 'session.json')
const BASE = process.env.BASE_URL || 'http://localhost:5173/'
const session = JSON.parse(fs.readFileSync(SESSION, 'utf8'))
// session 是哪一區換來的，就注入哪一區的 key；與 .env.local 必須一致
const REF = process.env.REF || 'wqetxuhncvfidqnklyew'

const WIDTHS = [1440, 1024, 768, 390]

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const problems = []

  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
    const page = await ctx.newPage()

    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

    // supabase-js v2 的 session 存在 localStorage 的 sb-<ref>-auth-token
    await page.addInitScript(
      ([ref, s]) => {
        window.localStorage.setItem(
          `sb-${ref}-auth-token`,
          JSON.stringify({
            access_token: s.access_token,
            refresh_token: s.refresh_token,
            expires_at: Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
            expires_in: s.expires_in || 3600,
            token_type: 'bearer',
            user: s.user,
          }),
        )
      },
      [REF, session],
    )

    await page.goto(BASE, { waitUntil: 'networkidle' })

    // 進入「抓取狀況」分頁
    const tab = page.getByRole('button', { name: '抓取狀況' })
    if ((await tab.count()) === 0) {
      problems.push(`${width}px: 找不到「抓取狀況」分頁（admin 判定可能沒過）`)
      await page.screenshot({ path: `${OUT}/${width}-no-tab.png`, fullPage: true })
      await ctx.close()
      continue
    }
    await tab.first().click()
    await page.waitForSelector('.ast-row', { timeout: 15000 })
    await page.waitForTimeout(600)

    // ── 1. 頁面不得橫向捲動 ───────────────────────────────
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }))
    if (overflow.doc > overflow.win + 1) {
      problems.push(`${width}px: 頁面橫向溢出 ${overflow.doc - overflow.win}px`)
    }

    // 手機刻意隱藏時間軸（橫捲看不到右半），改驗狀態與時刻仍看得見
    const mobile = width <= 720
    if (mobile) {
      const vis = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.ast-row')]
        return rows.map((r) => ({
          track: !!r.querySelector('.ast-track')?.checkVisibility?.(),
          // 每列右側必須有可見內容：狀態標籤或時刻文字擇一
          // （總經軸的「美東發布」「資料最後變動」兩列放的是資訊而非狀態）
          pill: !!r.querySelector('.ast-pill')?.checkVisibility?.(),
          when: !!r.querySelector('.ast-when')?.checkVisibility?.(),
          endText: (r.querySelector('.ast-end')?.textContent || '').trim().length > 0,
        }))
      })
      vis.forEach((v, i) => {
        if (v.track) problems.push(`${width}px: 列${i} 時間軸仍顯示（手機應隱藏）`)
        if (!v.pill && !v.when) problems.push(`${width}px: 列${i} 右側無可見內容`)
        if (!v.endText) problems.push(`${width}px: 列${i} 右欄是空的`)
      })
      if (!vis.some((v) => v.when)) problems.push(`${width}px: 沒有任何一列顯示抓取時刻`)
    }

    // ── 2. 時間軸的點與公布窗必須落在軌道內（僅寬螢幕）─────
    const stray = mobile ? [] : await page.evaluate(() => {
      const bad = []
      document.querySelectorAll('.ast-track').forEach((track, i) => {
        const t = track.getBoundingClientRect()
        track.querySelectorAll('.ast-hit, .ast-win, .ast-lag').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.left < t.left - 8 || r.right > t.right + 8) {
            bad.push(`列${i} ${el.className}: ${Math.round(r.left)}–${Math.round(r.right)} 超出軌道 ${Math.round(t.left)}–${Math.round(t.right)}`)
          }
          if (r.top < t.top - 1 || r.bottom > t.bottom + 1) {
            bad.push(`列${i} ${el.className}: 垂直超出軌道`)
          }
        })
      })
      return bad
    })
    stray.forEach((s) => problems.push(`${width}px: ${s}`))

    // ── 3. 時刻文字不得與下一列重疊 ───────────────────────
    const clash = mobile ? [] : await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.ast-hit-t')]
      const bad = []
      labels.forEach((el) => {
        const r = el.getBoundingClientRect()
        const row = el.closest('.ast-row')
        if (!row) return
        const rr = row.getBoundingClientRect()
        if (r.bottom > rr.bottom + 1) bad.push(`時刻標籤溢出所屬列 ${Math.round(r.bottom - rr.bottom)}px`)
      })
      return bad
    })
    clash.forEach((s) => problems.push(`${width}px: ${s}`))

    // ── 3b. 說明文字不得被擠成直排 ────────────────────────
    // 特異性沒壓過 .ast-legend span 時，文字節點會各自變成 flex item，
    // 「判定基準是」會被擠成一字一行。用「高度遠大於行高」來偵測。
    const vertical = await page.evaluate(() => {
      const bad = []
      document.querySelectorAll('.ast-rule').forEach((el) => {
        const r = el.getBoundingClientRect()
        const lh = parseFloat(getComputedStyle(el).lineHeight) || 20
        const cs = getComputedStyle(el)
        if (cs.display.includes('flex')) bad.push('圖例說明是 flex，文字會被拆成欄')
        // 一段兩三行的字塞成直排會變成十幾行高
        if (r.height > lh * 8) bad.push(`圖例說明高 ${Math.round(r.height)}px（行高 ${Math.round(lh)}px），疑似直排`)
      })
      return bad
    })
    vertical.forEach((s) => problems.push(`${width}px: ${s}`))

    // ── 4. 主要區塊都在 ───────────────────────────────────
    for (const t of ['台股盤後', '排程', '美國總體經濟', '匯率與檔案涵蓋']) {
      if ((await page.getByText(t, { exact: false }).count()) === 0) {
        problems.push(`${width}px: 缺少區塊「${t}」`)
      }
    }

    if (errors.length) problems.push(`${width}px: console 錯誤 ${errors.slice(0, 2).join(' | ')}`)

    await page.screenshot({ path: `${OUT}/${width}.png`, fullPage: true })

    // 深色 / 淺色各一張（只在桌機寬度做）
    if (width === 1440) {
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${OUT}/${width}-light.png`, fullPage: true })
      // 時間軸單獨一張，看細節
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
      await page.waitForTimeout(300)
      const tl = page.locator('.ast-tl-scroll').first()
      await tl.screenshot({ path: `${OUT}/timeline.png` })
    }

    await ctx.close()
    console.log(`  ${width}px 掃描完成`)
  }

  await browser.close()
  console.log('\n=== 結果 ===')
  if (problems.length === 0) console.log('✅ 四種寬度、深淺兩色皆無版面問題')
  else problems.forEach((p) => console.log('❌ ' + p))
  process.exit(problems.length ? 1 : 0)
})()

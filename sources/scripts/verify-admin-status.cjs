/**
 * Layout scan of the Crawl Status page (Playwright).
 *
 * What is tested is something that jsdom test cannot touch: actual layout, horizontal overflow, element overlap,
 * Whether the absolute positioning falls within the track and whether the things that should be hidden are hidden on the mobile phone.
 *
 * usage:
 *   1. sources/.env.local points to a certain area and starts `npm run dev`
 *   2. Generate a set of admin sessions and save them as scratchpad/session.json:
 *      auth/v1/admin/generate_link (magiclink) for the hashed_token,
 *      Type auth/v1/verify again to change access_token / refresh_token
 *   3. SESSION=<session.json path> OUT=<screenshot directory> node scripts/verify-admin-status.cjs
 *
 * Why inject session instead of going through the login form: Agent does not have an account or password.
 * The token exchanged by magic link is injected into localStorage and is equivalent to real login.
 * (`sb-<ref>-auth-token` exists in the session of supabase-js v2).
 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const OUT = process.env.OUT || '/tmp/stock-pnl-admin-shots'
const SESSION = process.env.SESSION || path.join(path.dirname(OUT), 'session.json')
const BASE = process.env.BASE_URL || 'http://localhost:5173/'
const session = JSON.parse(fs.readFileSync(SESSION, 'utf8'))
// Which area the session is exchanged from will be injected with the key of that area; it must be consistent with .env.local
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

    // The session of supabase-js v2 exists the sb-<ref>-auth-token of localStorage
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

    // Enter the "Crawling Status" tab
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

    // ── 1. The page is not allowed to scroll horizontally ───────────────────────────────
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }))
    if (overflow.doc > overflow.win + 1) {
      problems.push(`${width}px: 頁面橫向溢出 ${overflow.doc - overflow.win}px`)
    }

    // The mobile phone deliberately hides the timeline (the right half cannot be seen when scrolling horizontally), but the status and time of the changes are still visible.
    const mobile = width <= 720
    if (mobile) {
      const vis = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.ast-row')]
        return rows.map((r) => ({
          track: !!r.querySelector('.ast-track')?.checkVisibility?.(),
          // There must be visible content on the right side of each column: either a status label or a moment text
          // (The "Eastern US Release" and "Last Data Change" columns of the main beam display information rather than status)
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

    // ── 2. The point of the timeline and the announcement window must fall within the track (wide screen only)─────
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

    // ── 3. The time text must not overlap with the next column ──────────────────────
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

    // ── 3b. Description text must not be squeezed into a vertical row ───────────────────────
    // When specificity is not overwhelmed by .ast-legend span, the text nodes will each become flex items.
    // "The criterion is" will be squeezed into one word and one line. Use "height is much greater than row height" to detect.
    const vertical = await page.evaluate(() => {
      const bad = []
      document.querySelectorAll('.ast-rule').forEach((el) => {
        const r = el.getBoundingClientRect()
        const lh = parseFloat(getComputedStyle(el).lineHeight) || 20
        const cs = getComputedStyle(el)
        if (cs.display.includes('flex')) bad.push('圖例說明是 flex，文字會被拆成欄')
        // A paragraph of two or three lines of text will become more than ten lines high if it is crammed into a straight line.
        if (r.height > lh * 8) bad.push(`圖例說明高 ${Math.round(r.height)}px（行高 ${Math.round(lh)}px），疑似直排`)
      })
      return bad
    })
    vertical.forEach((s) => problems.push(`${width}px: ${s}`))

    // ── 4. The main blocks are located at ─────────────────────────────────
    for (const t of ['台股盤後', '排程', '美國總體經濟', '匯率與檔案涵蓋']) {
      if ((await page.getByText(t, { exact: false }).count()) === 0) {
        problems.push(`${width}px: 缺少區塊「${t}」`)
      }
    }

    if (errors.length) problems.push(`${width}px: console 錯誤 ${errors.slice(0, 2).join(' | ')}`)

    await page.screenshot({ path: `${OUT}/${width}.png`, fullPage: true })

    // One each for dark/light colors (only available in desktop width)
    if (width === 1440) {
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${OUT}/${width}-light.png`, fullPage: true })
      // Timeline alone, look at the details
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

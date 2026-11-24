# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: **Release 0.10.43** — Fix TWSE MIS limit-up/limit-down locked quotes (`0.0000` market orders) + `.quote-limit-badge` CSS, `IntradayChart` `1d` limit lines, and ETF tick size in `priceLimits`.
- Status: ✅ `main` = `dev` = 0.10.43; Edge `stock-price` deployed to DEV & PROD (`ezbr_sha256` `14b5ca2a6d60…`, `verify_jwt: true`).
- Timestamp: 2026-11-24 10:03:00 Asia/Taipei

---

## 📅 Log: 2026-11-24 10:03:00 Asia/Taipei (release 0.10.43, limit-up quote parsing & display fixes)
- **Ask**: 「目前此codebase如果該股票漲停，在顯示上就會有點問題…目前看到漲停的 跌幅都沒有資料，導致限價跟未時間損益都不對」 → 「好，直接幫我進行調整，其中需用到 /modern-web-guidance /egm 等相關skill進行 spec 、reviwer，且直接和我說結果與相關驗證」 → 「版本號碼進行調整，然後先幫我commit&push到dev去」 → 「幫我直接合併到main 然後直接上線」。
- **Spec & EGM Review**: Created `docs/agent/specs/limit-up-quote-and-display.md` after two parallel EGM Goldfish passes (`egm-codebase-details`, `egm-design`, `egm-zoom-out`). Captured live TWSE MIS payload for locked limit-up `2330` (`z: "-"`, `b: "0.0000_2230.0000_..."`, `a: "-"`, `u: "2230.0000"`, `y: "2030.0000"`, `trade: { z: "2230.0000" }`).
- **Done**:
  - `sources/supabase/functions/stock-price/misParse.ts`: added `parseBook()` (skipping empty tokens and `'-'`) and updated `pickPrice()` precedence: `row.z` → BUG-045/EP-01 time guards → `!trial && volume !== 0 && row.trade?.z` → `bid.firstPositive` (skips `"0.0000"` market orders) → `!trial` lock inference (100% market-order bid → `row.u`; no-bid + market-ask or `ask[0] === w` → `row.w`) → `row.y`. Preserved `price_cache` schema (no DDL migration per YAGNI).
  - `sources/src/styles/stock-detail.css`: fixed `.quote-limit-badge` (`padding: 3px 6px`, `margin-bottom: 4px`, `line-height: 1.2`, `white-space: nowrap`, `text-box: trim-both cap alphabetic` per `modern-web-guidance` `precise-text-alignment`).
  - `sources/src/components/StockDetail/whatIf.ts`, `QuoteTab.tsx`, `IntradayChart.tsx`: unified `tickSizeFor(price, ticker?)` for `00*` ETFs, suppressed `漲停`/`跌停` badge during `quote.trial`, and restricted `IntradayChart` `limits` lines to `market === 'TPE' && range === '1d'`.
  - Synced 5 version files to `0.10.43-dev.1` and added unit tests in `misParse.test.ts`, `whatIf.test.ts`, `QuoteTab.test.tsx`, `IntradayChart.test.tsx`.
- **Verified**: `npm test` 3,257 passed / 7 skipped (194+1 files), `npm run build`, `npm run typecheck:edge`, EGM post-impl audit (`VERDICT: PASS`). DEV Edge `stock-price` deployed (`accmczhrqsilzrtyhyxa`, v17, `ACTIVE`, `verify_jwt: true`, `ezbr_sha256` `14b5ca2a6d60f1d633ca9e5560e92180929f79278c4de483758e6eeacc49243a`).

## 📅 Log: 2026-11-17 12:55:00 Asia/Taipei (release 0.10.42, modern-web-guidance frontend review & modernization)
- **Ask**: 「請使用 modern-web-guidance 幫我review此專案的HTML或是前端等相關功能有沒有可以改善的部分?」 → 「都依照你的建議進行調整，且自己進行過smoke、E2E驗證後沒問題，就直接幫我commit & push 到 main」.
- **Done**:
  - **Dark/Light theme & FOUC** (`dark-mode`, `dark-mode-toggle`): `<meta name="color-scheme" content="light dark" />` + inline synchronous theme bootstrap script in `sources/index.html`; `color-scheme` CSS rules on `:root` (`tokens.css`); `@supports not (scrollbar-color: auto)` guard around legacy `::-webkit-scrollbar` (`chrome.css`); cross-tab `storage` event listener in `UserMenu.tsx`; `applyTheme` sets `light dark` when `pref === 'system'`.
  - **Typography & Layout** (`visually-stable-font-fallbacks`, `accessibility`): `font-size-adjust: from-font` on `body`; `clip-path: inset(50%)` on `.sr-only`; `.skip-link` in `AppShell.tsx` targeting `<h1 id="main-content" tabIndex={-1}>` without mutating `window.location.hash`; `.stmt-pct { display: inline-block }` in `dashboard.css` preventing 390px horizontal overflow when `.stmt-fig-hero` wraps.
  - **Modal & Menu** (`dialog`, `prevent-page-scroll-under-modal-dialog`, `menu`): `Modal.tsx` sets `inert` on `#root` while open, checks `e.defaultPrevented` on `Escape`, and `.modal-overlay` sets `overscroll-behavior: contain`; `HeaderMenu.tsx` implements `ArrowDown`/`ArrowUp`/`Home`/`End` keyboard navigation across `[role^="menuitem"]` items and stops `Escape` propagation; `.hmenu-sep` adds `role="separator"`.
  - **Forms & Search** (`forms`, `autofill-sign-in-form`, `autofill-sign-up-form`): `AuthPage.tsx` and `PasswordField.tsx` add `name`, `spellCheck={false}`, `autoCapitalize="none"`, `autoCorrect="off"`, `aria-describedby` links, and explicit `type="button"` on mode switchers; `TransactionForm.tsx` adds `role="listbox"` / `role="option"` on suggestion dropdowns and `aria-describedby` on fee/tax hints; search wrappers in `TransactionsPage.tsx`, `YearlyPage.tsx`, and `AddWatchModal.tsx` add `role="search"` and disable spellcheck/autocorrect.
  - **ES2023 JS APIs** (`js/copying-array-methods`, `js/error-cause`): replaced shallow-copy `.sort()` / `.reverse()` / `.reverse().find()` with `.toSorted()`, `.toReversed()`, and `.findLast()` across 9 frontend components + `sync-github-releases.cjs` (keeping `timeline.ts` `MapIterator` spread), and added `{ cause: err }` to `appLog.ts` and `reportsBucket.ts`.
- **Verified**: `npm test` 3,246 passed / 7 skipped (including new tests in `Modal.test.tsx` and `AppShell.a11y.test.tsx`), `npm run build`, `npm run typecheck:edge`, `legacy-scan`, and Playwright Chromium E2E across `AuthPage` and native mode at 1280px and 390px (light/dark, zero console/page errors, zero overflow).

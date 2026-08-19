# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.7.26 release recording — ForeignTopSection 鉅額星號與筆數下拉選單
- Status: **✅ RECORDED**
- Timestamp: 2026-08-19 09:54:30 Asia/Taipei

---

## 📅 Log: 2026-08-19 09:54:30 Asia/Taipei (0.7.26 release: ForeignTopSection 鉅額星號、筆數下拉、說明文字)

- **Release**: Version 0.7.26 official release, finalized.
- **Feature**: 外資買賣超 TOP 50 (總體經濟 > 台股) 區塊三項更新：(1) 鉅額標示改為名稱後綴星號（例 `長榮*`），不再出現「鉅額」標籤；(2) 表格上方新增「* 代表鉅額」說明文字（`hint` 樣式）放在 `.table-scroll` 外；(3) 新增筆數下拉選單（10 / 30 / 50，預設 10）同時套用買超賣超兩分頁。
- **Changes**:
  - `sources/src/components/Macro/ForeignTopSection.tsx` — 三個變更點：
    - 鉅額標示：移除 `block === true` 時渲染的 `<span className="chip">鉅額</span>`，改為在名稱後接 `*`（以 ternary operator 在 JSX 內拼接）。
    - 說明文字：新增 `<div className="hint">* 代表鉅額</div>` 置於 `.table-scroll` 之外。
    - 筆數下拉：新增 `select` 元素（`aria-label="顯示筆數"`），與現有 `rowCount` 狀態繫結，同時套用兩分頁；`.slice(0, rowCount)` 渲染既有列，資料不足時不補空列。
  - 未動：買超/賣超分頁邏輯、`資料更新於` 時間戳、空狀態、欄位標題、`fmtLots()` 格式。
- **Testing**: `sources/src/components/Macro/ForeignTopSection.test.tsx` 改寫 5 項失敗測試 + 新增 4 項案例，共 10 通過：
  - (新) 「鉅額改以名稱後綴星號標示，不再出現鉅額標籤」— 斷言星號在名稱後、無 chip 元素。
  - (新) 「表格上方說明星號代表鉅額」— 斷言 `* 代表鉅額` 文字存在、有 `hint` 樣式。
  - (新) 「預設只顯示 10 筆，可用下拉選單切換 30 / 50」— 初始 10 列，選擇 30 → 30 列，選擇 50 → 50 列（以 50 筆 fixture 驗證邊界）。
  - (新) 「資料少於選定筆數時只顯示既有列，不補空列」— fixture 15 筆時選擇 30，僅顯示 15 列。
  - (改) 既有買超/賣超分頁測試改以 `台積電*` 斷言，確保星號出現。
- **Verification**: `npx vitest run src/components/Macro/ForeignTopSection.test.tsx` — 10 passed, 0 failed (改動前 5 failed). `npx vitest run` (full suite) — 68 files, 1011 tests passed, 0 failed. `npx tsc --noEmit` — 0 errors. `npx oxlint src` — 0 errors (only pre-existing react/only-export-components warnings). `npm run build` — built ok.
- **Routing**: Lane 1. 主 session 寫失敗測試 → `route:builder` 實作 → 主 session 覆核 diff 並把說明文字移出 `.table-scroll`。Reviewer 未派遣，理由：純展示層變更，測試改動前失敗、改動後通過，不涉持久化、授權、對外介面契約、無聲計算或控制流。

---

## 📅 Log: 2026-08-19 09:39:50 Asia/Taipei (0.7.25 release: Fix computeLedger() stock name overwrite)

- **Release**: Version 0.7.25 official release, finalized.
- **Fix**: `computeLedger()` now guards name assignments to prevent placeholder values (ticker-only) from overwriting known Chinese names.
- **Changes**:
  - `sources/src/utils/pnlEngine.ts` — Two guards added: `if (tx.name && tx.name !== tx.ticker)` before updating `ledger.positions[key].name` (line ~212) and `ledger.yearly[year].tickers[key].name` (line ~236).
  - Initialization logic preserved: `name: tx.name || tx.ticker` ensures all transactions have a name; if all trades carry only ticker, name remains ticker as expected.
  - Real case: 0050 bought as "元大台灣50"; a subsequent trade with only ticker "0050" no longer overwrites the Chinese name.
- **Testing**: New describe block "股票名稱：代號佔位名不得覆蓋已知名稱" with 3 test cases: (1) placeholder-only transaction does not overwrite existing Chinese name (0050 case), (2) placeholder followed by real name gets upgraded (upgrade path), (3) all-ticker scenario maintains ticker as name. All three failed before fix, pass after.
- **Verification**: `npx vitest run src/utils/pnlEngine.test.ts` — 17 passed, 0 failed. `npx vitest run` (full suite) — 68 files, 1008 tests passed, 0 failed. `npx tsc --noEmit` — 0 errors. `npx oxlint src` — 0 errors (no new violations). `npm run build` — built ok.
- **Review**: Lane 2, reviewer dispatched. Verdict: PASS with one RISK — upgrade path had no test coverage. RISK closed before commit by adding test case (2); nothing outstanding.

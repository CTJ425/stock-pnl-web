# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Task 96 — Redesign Daily Turnover table on Macro page into transposed matrix style
- Status: **✅ Transposed matrix table created; 5 metric rows; Sparklines & streaks; 997 tests pass; Playwright layout verified; on dev branch**
- Timestamp: 2026-08-14 09:30:00 Asia/Taipei

---

## 📅 Log: 2026-08-14 09:30:00 Asia/Taipei (Task 96: Redesign Daily Turnover table on Macro page into transposed matrix style)

Redesigned the "每日成交量" (Daily Turnover) table in `TwMarketSection.tsx` from the legacy vertical 31-day table into a transposed matrix (`.data-table.inst-matrix`), fully matching the UI style of "三大法人買賣超".

**Core changes:**
1. Direction & Columns: Aligned left-to-right (oldest → newest, 7 trading days), with column headers: `項目 | 7 days | 7 日統計 | 近 15 日走勢`.
2. 5 Metric Rows: 成交金額 (with 7-day avg & volume streak), 成交股數 (7-day avg), 成交筆數 (7-day avg), 加權指數 (7-day avg close & taiex streak), 指數漲跌 (7-day net cumulative change, heatStyle background & red/green styling).
3. Visual & RWD: Shared `.inst-matrix` styling with sticky frozen first column on mobile viewport and responsive horizontal scrolling.
4. Testing (TDD): Updated `TwMarketSection.test.tsx` (19 passed), `MacroPage.test.tsx` + `App.smoke.test.tsx` (35 passed), total suite 63 test files / 997 tests 100% passed.
5. E2E: Created `sources/scripts/verify-macro-turnover.cjs` testing desktop (1280px), tablet (768px), and mobile (390px) viewports with screenshots verified.

No database or Edge Function change. Committed to `dev` only; `main` untouched.

## 📅 Log: 2026-08-12 20:33:25 Asia/Taipei (Task 95: Measure the per-dispatch context delta from existing transcripts)

Task is now complete. Analysis tool `.claude/hooks/dispatch_delta.py` (220 lines, new) joins main-transcript `Agent` tool_use calls to subagent transcripts via `toolUseId` in `<session>/subagents/agent-*.meta.json`, measures cost side (dispatch prompt + report chars, i.e. context footprint) against benefit side (tool_result payloads main avoided pulling in), reports net per dispatch. Sample: all 42 dispatches across 11 sessions, project history.


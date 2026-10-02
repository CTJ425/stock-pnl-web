# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 190 items 5–6 — rebate choice open at 不打折; dashboard marks a workspace whose discount was never set.
- Status: 🔄 uncommitted on `dev` (no version bump yet); 0.10.23 is the last release (`main` = `dev` before this change).
- Timestamp: 2026-10-02 17:00:32 Asia/Taipei

---
## 📅 Log: 2026-10-02 17:00:32 Asia/Taipei (Task 190 item 6 — 「手續費折扣未設定」 on the dashboard)
- **Ask** (/impeccable): a new workspace has no prompt to set the discount; trades typed at 3 折, figures on 不打折, 批次重算 out of step.
- **Done**: user picked only the dashboard marker. `DashboardPage.tsx` stamp + basis text while unset (no stored rate, `fee_rate` or history); `WorkspaceFeeSettings.submit` stores 不打折 as the base when saved unset; `dashboard.css` shares the `.stmt-preview` stamp; DESIGN.md fee-settings line.
- **Verified**: vitest 2,837 pass / 7 skipped; build; lint; detector clean; Playwright local mode 1440 + 390 light/dark, saving clears the stamp. New save test fails without the change.
- **Seen, not fixed**: at 390px a 7-digit hero figure pushes `.stmt-pct` past the viewport (scrollWidth 426, same with a rate set — pre-existing).
---
## 📅 Log: 2026-10-02 16:45:27 Asia/Taipei (Task 190 item 5 — rebate choice open at the list price)
- **Ask**: drop the grey-out on 折扣怎麼退給你, let the user pick every option; 玉山 / 元大 presets unchanged.
- **Done**: `WorkspaceFeeSettings.tsx` — removed `disabled={noDiscount}`; the rebate auto-default effect now also skips while the four fields match a preset (`onPreset`), so a saved 玉山 at 不打折 stays 月退 and a 元大 moved to a discount stays 日退 (both failed without the guard). Test 'no discount disables…' replaced; 3 preset tests added.
- **Verified**: vitest 2,835 pass / 7 skipped; build; lint exit 0. Not looked at in a browser.
- **Engine at 不打折**: 玉山 preset adds `monthlyRebateCostUplift` = list fee − recorded fee per lot = 0 when fees were recorded at 0.1425% with the same min fee; sell basis list = net. Only the label reads 「牌告 0.1425% 計成本與預扣」.
---

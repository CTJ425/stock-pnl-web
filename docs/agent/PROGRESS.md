# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 167 — remove AI UI, move 新增交易 into the header (uncommitted)
- Status: 🔄 working tree on `dev`; `main` and `dev` at 0.9.67
- Timestamp: 2026-09-24 01:55:00 Asia/Taipei

---

## 📅 Log: 2026-09-24 01:55:00 Asia/Taipei (Task 167, uncommitted on `dev`)
- Task 167 items 1–2 done in the working tree on `dev`, **not committed, no version bump yet**.
- AI removed from the frontend: StockDetail「AI 分析」tab, admin「AI 設定」panel, and `aiClient` / `aiSettings` / `aiPrompts` / `aiChatStore` / `aiChat` / `aiPayload` / `AiTab` / `AiConnectionSection` / `PromptsSection` with their tests. Unused `.ai-*` CSS dropped; `.ai-form` / `.ai-form-group` / `.ai-input` / `.ai-actions` kept (Discord settings use them). Backend untouched: `ai-proxy` Edge Function and the AI tables in `schema.sql` are still deployed.
- 「新增交易」moved from the fixed `.fab` into `.app-header` (`.header-add`); icon-only at ≤ 720 px. Reverts 0.9.47. Mobile `.container` bottom padding no longer reserves the 56+24 px FAB space.
- **Verify**: `npx vitest run` 2,473 passed / 7 skipped / 0 failed; `npm run build`, `npm run lint`, `npm run typecheck:edge` exit 0. **Layout not verified in a browser**: Playwright chromium on this host fails to start (`libatk-1.0.so.0` missing; needs `sudo npx playwright install-deps chromium`).

---

## 📅 Log: 2026-09-23 10:40:00 Asia/Taipei (BUG-085, 0.9.67)
- Fixed BUG-085: watchlist industry group flipped between 半導體業 and 其他 for 8150 (南茂), because `price_cache` did not store `industry`. See `FIXED_BUG.md` BUG-085 and `docs/agent/specs/BUG-085.md`.
- Released 0.9.67: `main` and `dev` both at 8ee2065. DEV and PROD: DDL applied, `stock-price` redeployed and verified.

---

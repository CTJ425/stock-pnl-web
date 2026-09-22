# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.9.63 — Task 166 全專案稽核修補第 1 批（AI 限管理員、密碼規則、CSV、夜間批次、移除 R2）
- Status: ✅ **0.9.63 on `dev` and `main`**；DEV／PROD 皆已套用 DDL 與 Edge 部署
- Timestamp: 2026-09-22 21:44:30 Asia/Taipei

---

## 📅 Log: 2026-09-22 21:44:30 Asia/Taipei (Task 166 batch 1, 0.9.63)

**使用者要求：對整個專案做最詳細的元件／流程／項目拆解稽核，再依建議全部改善。** 稽核報告列出 139 項發現（2 項 P1、25 項 P2、112 項 P3），分 5 批修補，本次為第 1 批（Lane 2：spec + 先寫失敗測試 + builder + reviewer）。

- 使用者決策：保留公開註冊但要求信箱驗證與 8 碼密碼；AI 只開放管理員；R2 完全移除；每批 DEV 驗證後直接上 PROD。
- 規格：`docs/agent/specs/166-audit-remediation.md`（含 5 批的範圍與第 1、2 批的完整契約）。
- 程式：`ai-proxy/handler.ts`／`index.ts`、`StockDetail/StockDetailPage.tsx`、`utils/csv.ts`、`Transactions/CsvImportModal.tsx`／`TransactionsPage.tsx`、`AppShell.tsx`、`Auth/AuthPage.tsx`、`stock-report/index.ts`、`backup-transactions/index.ts`（刪 `r2.ts`）、`services/adminBackups.ts`、`Admin/BackupsSection.tsx`、`Admin/ManualRunSection.tsx`、`supabase/schema.sql`、`supabase/config.toml`。
- 測試：新增 `CsvImportModal.test.tsx`（重複列不匯入的接線）、csv 防注入與民國年案例、`ai-proxy` 非管理員 403 案例、`StockDetailPage` 非管理員看不到 AI 分頁；移除 3 個 R2 斷言。
- Reviewer：R2 移除 PASS；CSV PASS（RISK：缺元件測試 → 已補）；夜間批次 FAIL（manifest 條件未計入預算略過、chips 早期拋錯不留紀錄）→ 已修正並重驗。
- **Verify**：`npm test` 2,574 通過／7 略過／0 失敗；`npm run build`、`npm run typecheck:edge` exit 0。
- **Deploy**：DEV 與 PROD 皆套用 `batch_run_log.skipped_for_budget`、`get_ai_settings()` 管理員判斷、移除 `backup_run_log` r2 欄位；部署 `ai-proxy`、`stock-report`（`--no-verify-jwt`）、`backup-transactions`（`--no-verify-jwt`）；Auth 設定 `mailer_autoconfirm=false`、`password_min_length=8`。

---

## 📅 Log: 2026-09-22 14:04:13 Asia/Taipei (0.9.62 → `main`, remove self-export)

**User request: remove the「匯出我的紀錄」item from every account's menu without changing anything else.** Lane 0 (surgical, content already in context).

- `sources/src/components/AppShell.tsx`: removed the menu button, the `exportMyRecords` function, and the now-unused `Download` icon import, `buildSelfExport` / `downloadBlob` imports, and the `show` binding in that component. Other menu items unchanged.
- Deleted `sources/src/services/selfExport.ts` and `selfExport.test.ts` (no remaining callers; 6 tests removed).
- `sources/src/components/Admin/BackupsSection.tsx`: removed the header comment lines and the admin UI sentence that pointed users to the removed self-export.
- Version 0.9.61 → 0.9.62 (`version.ts`, `package.json`, lock, README badge, CHANGELOG).
- **Verify**: `npx vitest run` 150 files (149 passed, 1 skipped) / 2,587 tests: 2,580 passed, 7 skipped, 0 failed; `npm run build`, `npm run lint` exit 0.
- **Deploy**: frontend only, via Cloudflare Pages on push to `main`. No Edge Function, schema, or cron change.

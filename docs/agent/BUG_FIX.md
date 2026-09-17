# Active Bug Fixes & Accepted Risks (BUG_FIX.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-09-17 13:51:06 Asia/Taipei

---

## 🐛 Open / Active Issues & Accepted Risks

### RISK-017 — Discord holdings settings ops are check-then-act, not atomic
- **Where**: `sources/supabase/functions/stock-report/holdingsRun.ts` (`runHoldingsSettingsOp`: quota check before `finish`; `enable` reads the webhook before `setEnabled`)
- **Risk**: two concurrent `test`/`preview` calls from one user (two tabs) can both pass the 10-per-day check; an `enable` racing a `clear` can leave `enabled = true` with `webhook_url = null`, so the panel shows 已開啟 while 未設定.
- **Why accepted**: the quota overrun is a few extra messages to the user's own webhook; the daily run filters `webhook_url is not null`, so the inconsistent row never sends. Found by the step-2c review, 2026-09-17.
- **Status**: ACCEPTED (Task 165 Phase 2)

---

### RISK-016 — Discord holdings run fetches every held ticker at once
- **Where**: `sources/supabase/functions/stock-report/holdingsRun.ts` (`Promise.all` over a user's keys), `holdingQuotes.ts` (`createQuoteCache`, `makeChartFetch`)
- **Risk**: a user with many distinct tickers sends a burst of simultaneous Yahoo chart requests (TW tickers up to two symbols each); Yahoo may rate-limit the burst.
- **Mitigation in place**: 429 and 5xx get one retry after 500 ms; a failed ticker shows `--` and is left out of the totals, and the footer counts it.
- **Why accepted**: holdings per user are small today. Revisit with a concurrency cap if the send log shows rows with many missing quotes. Found by the step-2c review, 2026-09-17.
- **Status**: ACCEPTED (Task 165 Phase 2)

---

### RISK-015 — A Discord holdings run killed mid-user leaves that user `claimed` for the day
- **Where**: `sources/supabase/functions/stock-report/holdingsRun.ts` (`runHoldingsDaily`), `sources/supabase/schema.sql` §14 (`user_discord_send_log_once`)
- **Risk**: the budget is checked only before a user starts. If the Edge invocation is killed while a user is in flight, their `daily` row stays `claimed`, the partial unique index blocks any rerun that day, and they miss the card. Users not started before the budget ran out (`leftOver`) are not retried either.
- **Mitigation in place**: `HOLDINGS_RUN_BUDGET_MS` lowered from 110 s to 80 s, so one worst-case user (≈33 s quotes + ≈30 s `postDiscordWebhook`) still ends before the 150 s limit.
- **Why accepted**: few enabled users today; a stale-claim reclaim or a second cron pass is future work if `leftOver` or stuck `claimed` rows appear. Found by the step-2c review, 2026-09-17.
- **Status**: ACCEPTED (Task 165 Phase 2)

---

### RISK-014 — Discord summary: a delivered message can leave its log row stuck in `claimed`
- **Where**: `sources/supabase/functions/stock-report/discordRun.ts` (`runDiscordSummary`: post → `finishSend`), `sources/supabase/functions/stock-report/index.ts` (`finishDiscordSend`), `sources/supabase/schema.sql` (index `discord_send_log_once`)
- **Failure scenario**: if the Discord post succeeds and the following `finishSend` update fails (transient DB error), the row stays `claimed`. The partial unique index then blocks any retry for that day and edition, and the admin console shows 處理中 for a message that was actually delivered. Separately, `runDiscordSummary` awaits `deps.log` without a catch; the real `logEvent` never rejects (`_shared/log.ts`), so this only matters if that contract changes.
- **Found**: 2026-09-17, Task 165 review.
- **Decision**: accepted — a stuck claim prevents a duplicate post, which is the worse failure in a shared channel. If it ever happens, fix the one row by hand (set `status` to `sent`).
- **Status**: OPEN (accepted)

---

### RISK-013 — `openai-compatible` 的金鑰仍會下發到每個登入者的瀏覽器
- **Where**: `sources/supabase/schema.sql`（`get_ai_settings()`）、`sources/src/services/aiClient.ts`（`OpenAiCompatibleProviderImpl`）
- **Failure scenario**: 0.9.51 把 `google` 的金鑰移到 `ai-proxy` 伺服器端，但 `openai-compatible` 維持瀏覽器直連，因此 `get_ai_settings()` 對該供應商照常回傳 `ai_api_key`。本機 Ollama 通常免金鑰，目前無實際影響；一旦管理員把 Base URL 改指向需要金鑰的雲端端點，該金鑰就會被每一個登入帳號讀到。
- **Found**: 2026-09-14, Task 161 範圍決策。
- **Decision**: 使用者 2026-09-14 決定只保護 google。Supabase Edge Function 連不到本機 localhost，全部代理化會讓本機 Ollama 無法使用。後台警語已改為依供應商如實顯示，不再一律寫「金鑰會下發」。
- **Status**: OPEN（已接受；改用需要金鑰的雲端 openai-compatible 端點前必須重新評估）

---

### RISK-011 — `backup-transactions` 的 R2 整合點只靠人工閱讀，沒有自動化測試
- **Where**: `sources/supabase/functions/backup-transactions/index.ts:130-148`、`:173-187`
- **Failure scenario**: `syncToR2` 本身有單元測試涵蓋五種結果，但「把結果寫進 `r2_status` / `r2_error` 兩欄」這四行沒有任何測試。若有人改動 `backupAccount` 並漏掉指派，R2 的狀態會永遠是 `null`，而所有測試仍然全綠——異地備份失敗會變成看不見。
- **Found**: 2026-09-14, Task 144-4 reviewer 第一輪。
- **Decision**: 不修。`backupAccount` 未匯出，且相依於模組層的 Deno client；要測就得重構這段金流鄰近的程式碼，代價高於效益。Reviewer 已逐行閱讀確認接線正確。
- **Status**: OPEN（已接受；日後變更 `backupAccount` 時必須人工複查這兩欄的指派）

---

### RISK-012 — `scripts/backup-download.cjs` 的 `--dest` 不設路徑邊界
- **Where**: `sources/scripts/backup-download.cjs`
- **Failure scenario**: `--dest=../../..` 之類的值會把備份檔寫到預期以外的目錄。
- **Found**: 2026-09-14, Task 144-4 reviewer 第二輪。
- **Decision**: 不加沙箱。執行這支腳本的人本來就持有 service role key，對他設權限邊界是假安全。改為以 `path.resolve()` 正規化，並在寫入任何檔案前印出絕對路徑，以可見性取代邊界。
- **Status**: OPEN（已接受，設計如此）

---

### BUG-084 — Stale per-workspace 最低手續費 in localStorage still drives estimates, with no UI to see or change it
- **Where**: `sources/src/utils/settings.ts` (`getMinFee`), `sources/src/utils/holdingRows.ts:80-81,119-121`
- **Root Cause Analysis**:
  1. From `046abd9` (2026-07-18) until `39a20e2` (0.9.24-dev.1, 2026-08-31) the transaction form persisted the typed 最低手續費 into `localStorage` (`stock-pnl-web/min-fee-whole|odd/<workspaceId>`) on every change.
  2. `39a20e2` removed that write-back, but nothing clears the old keys and `getMinFee` still reads them first. No UI shows or edits a workspace minimum fee (the AppShell fee dialog only handles the rate).
  3. A browser that typed a minimum fee in that window keeps using it for unrealized P&L and break-even on small positions and odd lots; another device, and the server-side Discord holdings card (Task 165 Phase 2), use the defaults 20 / 1.
- **Impact**: at most the gap between the stale and the default minimum fee per row, only where the estimated sell fee equals the minimum.
- **Status**: OPEN — found 2026-09-17 while checking docs/agent/specs/discord-holdings.md; accepted for Task 165 Phase 2 pending a user decision (clear the legacy keys, or persist minimum fees to `workspaces`).

---

### BUG-079 — 保本賣出價 and 淨收 read the same fee rate differently
- **Where**: `sources/src/utils/holdingRows.ts`, `sources/src/utils/fees.ts`, `sources/src/utils/pnlEngine.ts`
- **Root Cause Analysis**:
  1. `estimateUnrealized` (`pnlEngine.ts:861-865`) calculates unrealized P&L (and therefore `netMktVal = cost + unrealized`) using the fee rate recorded on individual lots (`lot.feeRate` from `holding.openLots`, which defaults to historical statutory rate ~0.001425 or inferred discount).
  2. In contrast, `breakEvenPrice` (`fees.ts:184-194`) receives the current workspace-level `feeRate` and does not consult `openLots`. It computes candidate breakeven via `cost / (qty * (1 - feeRate - taxRate))` and checks `isBreakEven(p)` using `feeRate`.
  3. When a user mistakenly enters `0.6` as a workspace fee rate (intended as 6 折 / 60% of statutory fee, see Task 159 D2), `breakEvenPrice` interprets it as a literal 60% fee rate (denominator `1 - 0.6 - 0.003 = 0.397`), making breakeven price ~2.52× cost basis. Meanwhile, `estimateUnrealized` for existing positions continues evaluating against `lot.feeRate` (~0.000855 or 0.001425), deducting only ~0.39% for fees+tax.
- **Status**: OPEN (Root cause identified; UI input formatting addressed in Task 159 D2, calculation alignment tracked for future remediation)

---

### RISK-010 — 台股清單來源被上游截斷但仍非空時，兩端都會視為完整
- **Where**: `sources/supabase/functions/stock-price/twList.ts`、`sources/src/services/twMarketData.ts`
- **Failure scenario**: BUG-075 與 BUG-076 的完整性檢查判斷的是「此來源有沒有給出結構有效的列」，不是「給的列數對不對」。若 TWSE 或 TPEx 上游改動導致回傳 20 筆而非約 2000 筆，兩端都會判定完整並快取 30 分鐘。
- **Decision**: 不修。目前兩個 OpenAPI 端點都不分頁，沒有證據顯示會發生截斷；要防這種情況必須設一個筆數下限門檻，而該門檻會在上市櫃家數變動時誤判，代價高於效益。
- **Status**: OPEN（已知風險，理論性）

---

### RISK-009 — 加入觀察的「還有 N 筆」計數包含已加入、不可點的項目
- **Where**: `sources/src/components/StockDetail/AddWatchModal.tsx`
- **Failure scenario**: BUG-074 之後已加入的項目不再被濾掉，因此 `matches.length` 會把它們算進去。查詢範圍很廣且總筆數超過 `RESULT_CAP`（50）時，「還有 N 筆，請輸入更完整的關鍵字」的 N 會包含使用者本來就不能加入的列。
- **Decision**: 不修。那些確實是符合條件的列，計數本身沒有錯，只是其中部分不可點；影響輕微，不值得為此增加程式碼。
- **Status**: OPEN（已接受，不修）

---

### AUDIT-10 — CSV 匯入把「以點為千分位」的數字少算 1000 倍且不報錯
- **Where**: `sources/src/utils/csv.ts` (`parseNumber`)
- **Failure scenario**: 交易單價為 `"2.500"`（特定來源可能代表 2500）解析為 `2.5`，通過 `price > 0` 驗證，少算 1000 倍。
- **Decision**: 使用者於 2026-09-04 決定**不改程式**，記為可接受風險。「2.500」在台股與美股都可能是合法的 2.5 元，加規則拒絕它會擋掉正常匯入；多組點號（如「1.234.567」）已是 `NaN` 會報錯。
- **Status**: OPEN（已接受，不修）

---

### RISK-006 — 7 個 `action` 名稱指向模組私有函式，而非公開進入點
- **Where**: `sources/src/services/aiChatStore.ts:48`、`priceProxy.ts:121,188,206`、`twMarketData.ts:49,58,135`
- **What**: Spec 146 要求 `logClient` 的 `action` 使用「所在的 exported 函式名稱」。實際落在 `safeSession`、`writePriceCache`、`fetchFromEdge`、`fetchTwFallback`、`readCache`、`writeCache`、`fetchViaEdge` 這 7 個模組私有函式。
- **Decision**: 本次不改。這些名稱在專案內唯一且可 grep，直接指出快取讀取/寫入或 Edge 失敗點。日後若需按公開操作統計，再引入獨立 `operation` 欄位。
- **Status**: OPEN（低嚴重度，已確認）

---

### RISK-007 — `syncWorkspaceFees` 的 catch 位於迴圈內
- **Where**: `sources/src/services/feeSettings.ts:19-24`，呼叫端 `sources/src/context/WorkspaceContext.tsx:97`
- **What**: catch 在 workspace 清單的 `for` 迴圈內。若多個 workspace 同時失敗，每次登入各寫一列 `app_log`。受 workspace 數量限制，且每次登入才觸發一輪，5 分鐘去重機制會吸收同次登入內的重複訊息。
- **Decision**: 本次不改。改動迴圈結構代價高於筆數影響。
- **Status**: OPEN（低嚴重度，已確認）

---

### RISK-005 — chips 逐檔上傳失敗既不計入 `generated` 也不計入 `failed`
- **Where**: `sources/supabase/functions/stock-report/index.ts`（chips 逐檔迴圈）
- **What**: `uploadJson` 內建 `try/catch`，失敗回傳 `false` 不拋例外。Storage 上傳失敗的標的未計入 `generated` 也不計入 `failed`。
- **Decision**: 隔 5 分鐘下一次 cron 會自我修復；改動回傳約定影響面大，維持現狀。
- **Status**: OPEN（低嚴重度，已確認）

---

### RISK-004 — `addTransactions` silently drops `tx_nature` on pre-migration database
- **Where**: `sources/src/services/dataProvider.ts`
- **What**: 當資料庫缺少 `tx_nature` 欄位時，重試會省略該欄並回傳成功。目前兩環境皆已於 0.9.28 補齊欄位（無現行衝擊）。
- **Decision**: Accepted risk。若日後重新建立專案，需留心檢查 DDL 是否含此欄位。
- **Status**: OPEN (low severity, accepted)

---

### RISK-003 — Historical chip report files keep permanent "回補中" note
- **Where**: `sources/supabase/functions/stock-report/index.ts`
- **What**: 過去 6 天的回補檔案內嵌「歷史資料回補中…」備註且不再重寫。目前前端僅讀取最新 manifest.ymd，無現行衝擊。
- **Status**: OPEN (low severity, accepted)

---

### RISK-002 — Night batch cost scaling with watched stock count
- **Condition**: 觀察名單擴增時 batch 執行時間可能上升。目前監控 baseline 為 ~10.1 秒/次。
- **Trigger**: 使用者數或觀察名單顯著成長時再行評估。
- **Status**: OPEN (monitored)

---

### RISK — `breakEvenPrice` returns 0 for zero-cost holdings when `minFee` is undefined
- **Where**: `sources/src/utils/fees.ts:89-92`
- **Condition**: `cost === 0` AND `minFee === undefined`（非 TWD 持股可能觸發）。回傳 0 作為 sentinel。
- **Severity**: Low. Row 依然正常渲染。
- **Status**: OPEN (low severity)

---

### BUG-042 & BUG-043 — `dataProvider.ts` 重試與未知 id 處理
- **BUG-042**: `listWorkspaces` 退回重試吞掉第一次錯誤訊息（Accepted risk：專案生產代碼不留 console.error）。
- **BUG-043**: `LocalProvider.setWorkspaceFeeRate` 對未知 id 靜默成功（Accepted risk：與現有 renameWorkspace 一致）。
- **Status**: ACCEPTED RISK

---

## 🔒 Operational Security Notes

### Supabase Tokens & Secrets Rotation Checklist
- **Notice**: 歷史對話中曾數次出現貼入之 Personal Access Token 或 DEV `CRON_SECRET`（詳細歷程見 `FIXED_BUG.md`）。
- **Action for User**: 建議定期於 Supabase 控制台（Settings → Access Tokens）撤銷過期或已使用之 Token。
- **Standard Working Method**: 終端機登入請使用 `! supabase login` 互動提示字元輸入，避免 Token 進入對話紀錄。

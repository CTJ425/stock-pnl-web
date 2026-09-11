# Active Bug Fixes & Accepted Risks (BUG_FIX.md)

- Agent: Antigravity
- Status: ACTIVE
- Timestamp: 2026-09-07 11:35:00 Asia/Taipei

---

## 🐛 Open / Active Issues & Accepted Risks

### BUG-079 — 保本賣出價 and 淨收 read the same fee rate differently (suspected)
- **Where**: `sources/src/utils/holdingRows.ts`, `sources/src/utils/fees.ts`
- **Failure scenario**: With a workspace fee rate of 0.6 (a user typing 6 折 as a decimal, see Task 159 D2), 保本賣出價 becomes 2.52 × the average cost (鴻海 avg NT$182.16 → NT$458.83, i.e. cost / (1 − 0.6 − 0.003)), while 淨收 deducts only ~0.39% (台積電 market value NT$3,675,000 → 淨收 NT$3,660,834, i.e. 0.001425 × 0.6 + 0.003). The two paths use a different fee source or interpretation. With a normal rate the gap may be small. Not yet read in code.
- **Found**: 2026-09-11, desktop UX audit (local mode, seeded data, 0.9.44).
- **Decision**: Investigate as Lane 2 (money code) before any fix. Not part of the Task 158/159 UI batches.
- **Status**: OPEN (suspected, needs code reading)

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

### Supabase Redirect URLs allow-list does not contain app origin
- **Where**: Supabase Dashboard → Auth Settings → Redirect URLs
- **What**: 註冊驗證信連結轉導若未包含前端正式網址，會落回 API root。
- **Action**: 當前端部署站點確定後，至 Supabase Console 加入允許清單。
- **Status**: OPEN (configuration required)

---

## 🔒 Operational Security Notes

### Supabase Tokens & Secrets Rotation Checklist
- **Notice**: 歷史對話中曾數次出現貼入之 Personal Access Token 或 DEV `CRON_SECRET`（詳細歷程見 `FIXED_BUG.md`）。
- **Action for User**: 建議定期於 Supabase 控制台（Settings → Access Tokens）撤銷過期或已使用之 Token。
- **Standard Working Method**: 終端機登入請使用 `! supabase login` 互動提示字元輸入，避免 Token 進入對話紀錄。

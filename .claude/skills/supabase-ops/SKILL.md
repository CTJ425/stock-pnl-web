---
name: supabase-ops
description: stock-pnl-web 的 Supabase 實務陷阱與操作注意事項。動到 Supabase 時使用——部署 Edge Functions、稽核兩區程式碼是否同步、執行 db query / cron、link 專案、排查 manifest.json 日期。
---

# Supabase 實務陷阱（都是實際踩過的）

搭配 `CLAUDE.md` §13.1 分支流程與 §13.2 操作規則一起看，
§13.2 的禁令（預設不主動部署、正式區只在 `main` 且經明確指示才動）永遠優先。

**指令要在 `sources/` 底下執行。** Edge Functions 在 `sources/supabase/functions/`，
不是 repo root。在 root 執行會出現 `entrypoint path does not exist`。

**部署 `stock-report` 一定要帶 `--no-verify-jwt`。**
兩區的 `stock-report` 都是 `verify_jwt=false`，因為 pg_cron 是帶 `CRON_SECRET` 呼叫、不帶 JWT。
被重設成 `true` 的話盤後批次會全數 401。
（`stock-price` 是 `verify_jwt=true`，用預設即可。）

**稽核要用 `functions download` 逐檔比對，不要看版本號推論。**

```bash
supabase functions download <slug> --project-ref <ref>   # 抓線上實際跑的程式碼
diff <下載的檔> sources/supabase/functions/<slug>/<檔>
```

曾遇到版本號較新的那支反而是舊程式碼（測試區 `stock-price` v2 落後 137 行、
`misParse.ts` 根本沒部署上去）。

**比對基準要對應分支**（§13 對照表）：正式區比 `main`、測試區比 `dev`。
拿錯基準會誤判「已同步」—— 這個錯犯過一次。

**`db query --linked` 認的是「當下的工作目錄」，不是你以為的那個專案。**
2026-07-27 實際踩到：`functions download` 把 cwd 留在 scratchpad，
之後一次「改測試區 cron」的 `db query --linked` 在那個沒有 link 設定的目錄下執行，
CLI 退回全域設定，**寫進了正式區**。`cron.schedule` 照樣回傳成功，
緊接著的覆驗查詢也在同一個（錯的）資料庫，所以驗起來完全正確 —— 錯得無聲無息。

**對策：任何會寫入的 `db query`，把「專案身分欄位」放進同一次查詢裡。**
挑一個兩區必然不同的值，例如：

```sql
SELECT (SELECT count(*) FROM batch_run_log) AS 身分檢查,  -- 正式區 2 / 測試區 0
       jobid, schedule, (regexp_match(command, 'url\s*:=\s*''([^'']*)'''))[1] AS url
FROM cron.job;
```

分兩次查（先驗身分、再寫入）擋不住這種錯 —— cwd 可能在兩次之間被別的指令改掉。
另外每次執行 `db query` 前先 `cd` 到 `sources/`，不要依賴上一個指令留下的 cwd。

**`supabase link` 有全域副作用，不是 per-directory。** 在別的目錄重新 link 會把前一份清掉。
要查另一個專案時優先用支援 `--project-ref` 的指令（`functions list/deploy/download`、`secrets list`）；
只有 `db query --linked` 沒有 `--project-ref`，非用不可時才 link。

**Agent 拿不到 `CRON_SECRET` 明文**（`secrets list` 只回雜湊），
所以手動觸發 `generate-all` 一定要請使用者自己執行。

**`manifest.json` 日期落後時先確認星期。** cron 是 `1-5`，週末本來就不跑，
週末看到日期停在週五是正確的，不是故障。

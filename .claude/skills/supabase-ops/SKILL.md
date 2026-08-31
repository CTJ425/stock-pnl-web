---
name: supabase-ops
description: Supabase practical pitfalls and operating precautions of stock-pnl-web. Used when moving to Supabase - deploy Edge Functions, check whether the code in the two areas is synchronized, execute db query / cron, link projects, and check the manifest.json date.
---

# Supabase practical traps (all of which have been actually stepped on)

Read together with `CLAUDE.md` § Branches & envs (branch process and operation rules).
The prohibitions there (default is no active deployment, formal area can only be moved in `main` and with explicit instructions) always take precedence.

**Instructions must be executed under `sources/`. ** Edge Functions in `sources/supabase/functions/`,
Not repo root. When executed as root, `entrypoint path does not exist` will appear.

**When deploying `stock-report`, you must bring `--no-verify-jwt`. **
`stock-report` in both areas is `verify_jwt=false`, because pg_cron is called with `CRON_SECRET` and without JWT.
If reset to `true`, the after-hours batch will be all 401.
(`stock-price` is `verify_jwt=true`, just use the default.)

**For auditing, use `functions download` to compare file by file, and do not infer from the version number. **

```bash
supabase functions download <slug> --project-ref <ref> # Capture the actual running code on the line
diff <downloaded file> sources/supabase/functions/<slug>/<file>
```

I have encountered that the one with a newer version number is the old code (the test area `stock-price` v2 is 137 lines behind,
`misParse.ts` is not deployed at all).

**But `functions download` cannot authenticate in this environment** —— it returns
`Access token not provided. Supply an access token by running supabase login or setting SUPABASE_ACCESS_TOKEN`,
while `projects list` / `functions list` / `functions deploy` all work fine: they take a different auth path.
Observed 2026-08-05 on both `--project-ref` values. Do not read this as "the audit was done".

**Fallback audit: compare `ezbr_sha256` from `functions list`.** It is the hash of the deployed bundle, so:

```bash
supabase functions list --project-ref <ref>   # read ezbr_sha256, not just version
```

- A **changed** sha right after your deploy proves new code actually landed (a bumped version number alone only proves
  that *something* was uploaded —— that is the trap above).
- The **same** sha in both environments proves both run the same bundle. On 2026-08-05 that was how the 0.6.36 build
  was caught still running in both areas after 0.6.37 shipped (`00ce1004…` in both, becoming `733891b768b2…` after
  deploying).
- Its limit: a hash says *whether* the bundle differs, never *what* is inside it. It is only evidence when you deploy
  from a working tree you know is clean and at a known commit —— record that commit alongside the sha.

**A `git push` does not deploy an Edge Function.** Pushing to `main` only updates the repository, so a fix that lives in
`sources/supabase/functions/` looks shipped while the server still runs the old code. `quoteWindow.ts` is the sharp
case: the browser imports the Edge copy across directories, so one file change is **two** deploy targets, and only one
of them travels with git. After any commit that touches `sources/supabase/functions/`, check `functions list` before
calling it released.

**The comparison benchmark should correspond to the branch** (§13 comparison table): the official area is compared to `main`, and the test area is compared to `dev`.
Taking the wrong benchmark will misjudge "synchronized" - I made this mistake once.

**`db query --linked` recognizes the "current working directory", not the project you think. **
2026-07-27 Actual step: `functions download` leaves cwd in scratchpad,
The next `db query --linked` of "changing the test area cron" is executed in the directory without link setting.
The CLI returns to the global settings and **writes into the official zone**. `cron.schedule` still returns successfully,
The subsequent validation query is also in the same (wrong) database, so it checks exactly right - silently wrong.

**Solution: For any `db query` that will write, put the "project identity field" into the same query. **
Pick a value that must be different between the two areas, for example:

```sql
SELECT (SELECT count(*) FROM batch_run_log) AS identity check, -- official area 2 / test area 0
       jobid, schedule, (regexp_match(command, 'url\s*:=\s*''([^'']*)'''))[1] AS url
FROM cron.job;
```

Checking twice (identity first, then writing) will not prevent this error - cwd may have been modified by other instructions between the two times.
In addition, `cd` to `sources/` before executing `db query` each time, and do not rely on the cwd left by the previous command.

**`supabase link` has global side effects, not per-directory. ** Re-linking in another directory will clear the previous one.
When checking another project, use the commands that support `--project-ref` (`functions list/deploy`, `secrets list`;
`download` takes the flag too but fails on auth here, see above);
Only `db query --linked` does not have `--project-ref`, link only if it is absolutely necessary.

**Agent cannot get `CRON_SECRET` plaintext** (`secrets list` only returns hash),
Therefore, to manually trigger `generate-all`, the user must execute it himself.

**`manifest.json` If the date lags behind, first confirm the day of the week. ** cron is `1-5`, and it doesn’t run on weekends.
Seeing the date stop on Friday over the weekend is correct and not a glitch.

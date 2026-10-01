# GitHub Support request — purge pre-rewrite objects

Written 2026-10-01 after rewriting the history of `CTJ425/stock-pnl-web` to remove a credential.

**Why this file exists.** A force-push makes old commits unreachable, but GitHub keeps them
served by direct SHA until it garbage-collects. Verified right after the rewrite: the two commits
that carried the secret still answered `HTTP 200`, and so did the raw file at the old commit.
**Only GitHub Support can force the purge.** Until they do, the rewrite is incomplete.

Send this from the account that owns the repository, at <https://support.github.com/request>
(category: *Account or repository* → *Something else*).

---

## Message to send

> **Subject:** Purge unreachable objects after history rewrite — CTJ425/stock-pnl-web
>
> Hello,
>
> I rewrote the history of my public repository `CTJ425/stock-pnl-web` to remove a credential that
> had been committed by mistake, and force-pushed the rewritten `main` and `dev` plus all 179 tags.
> A fresh clone no longer contains the value.
>
> However, the pre-rewrite commits are still served by direct SHA. For example these still return
> HTTP 200, and the second one still shows the credential in the file content:
>
> - `https://github.com/CTJ425/stock-pnl-web/commit/81cf71a`
> - `https://raw.githubusercontent.com/CTJ425/stock-pnl-web/81cf71a/scratchpad/bootstrap-dev.sh`
>
> Could you please garbage-collect the unreachable objects on this repository so those old commits
> stop being accessible? The repository has no forks and no open pull requests.
>
> Thank you.

---

## Before sending — check these yourself

1. **Forks.** If anyone forked the repo, the objects live in the fork network and GitHub cannot
   remove them from forks they do not own. Check `https://github.com/CTJ425/stock-pnl-web/forks`
   and say so in the ticket if there are any.
2. **Open PRs.** A pull request ref (`refs/pull/N/head`) keeps its commits reachable. Close or
   delete any that point at the old history.
3. **Caches outside GitHub.** Anyone who cloned before 2026-10-01, and any mirror or CI cache,
   still holds the old history. The rewrite cannot reach those.

## After they confirm

Re-run these; both should stop returning 200:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://github.com/CTJ425/stock-pnl-web/commit/81cf71a
curl -s -o /dev/null -w "%{http_code}\n" https://raw.githubusercontent.com/CTJ425/stock-pnl-web/81cf71a/scratchpad/bootstrap-dev.sh
```

Then tick item 7 in `TASK.md` and delete this file.

## What the rewrite already achieved

- 696 commits and 179 tags preserved; only the credential string changed, to
  `***REMOVED-CRON-SECRET***`, in the 2 commits that carried it.
- A fresh `git clone --mirror` from GitHub contains **0** occurrences of the value.
- The credential belonged to the retired self-hosted deployment `*.ivan.lab`, which the user
  confirmed on 2026-10-01 no longer exists. Cloud DEV and PROD use different secrets (verified by
  sha256 comparison), both set 2026-09-01.
- A full pre-rewrite mirror backup is at `/home/ivan/stock-pnl-web-backup-20261001-102622.git`.
  **It still contains the credential** — delete it once you are satisfied with the rewrite.

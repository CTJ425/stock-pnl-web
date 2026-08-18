---
name: ship
description: Test, version bump, commit, deploy to dev, verify, then main
---
1. Run the full test suite from `sources/` (`npm test`); stop and report if anything fails.
   Testing SoT: `docs/UnitTests/README.md` · skill `testing`. UI layout: skill `verify`.
2. Run `npx tsc --noEmit` (under `sources/`) to catch missing imports before deploy.
3. Bump the version per **`versioning`** skill and write a Traditional Chinese changelog entry.
4. Commit and push to **`dev` first** (see CLAUDE.md § Branches & envs).
5. Deploy/verify on DEV; curl changed endpoints when Edge-related.
6. **Finalize the CHANGELOG entry BEFORE pushing `main`.** `.github/workflows/release.yml` runs
   `sync-github-releases.cjs --all` **without `--force`**, so it only *creates* missing Releases and
   silently **skips ones that already exist**. A section still saying "pending" / "not deployed" when
   `main` is pushed becomes the permanent public Release body, fixable only by hand:
   `node scripts/sync-github-releases.cjs --version <x.y.z> --force`. This happened to 0.7.22.
7. Only after DEV is good and the user authorizes: merge/release to **main** and smoke again (pushing
   to `main` automatically deploys Pages and triggers the Release sync above).
8. **A `main` push deploys Pages only — never an Edge Function.** If the change touches
   `sources/supabase/functions/`, deploy it separately (skill `supabase-ops`) or the fix is not live.
9. Report a short summary in Traditional Chinese.

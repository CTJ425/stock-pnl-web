---
name: ship
description: Test, version bump, commit, deploy to dev, verify, then main
---
1. Run the full test suite from `sources/` (`npm test`); stop and report if anything fails.
   Testing SoT: `docs/UnitTests/README.md` · skill `testing`. UI layout: skill `verify`.
2. Run `npx tsc --noEmit` (under `sources/`) to catch missing imports before deploy.
3. Bump the version per **`versioning`** skill and write a Traditional Chinese changelog entry.
4. Commit and push to **`dev` first** (see CLAUDE.md §13).
5. Deploy/verify on DEV; curl changed endpoints when Edge-related.
6. Only after DEV is good and the user authorizes: merge/release to **main** and smoke again.
7. Report a short summary in Traditional Chinese.

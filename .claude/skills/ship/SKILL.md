---
name: ship
description: Test, version bump, commit, deploy to dev, verify, then main
---
1. Run the full test suite; stop and report if anything fails.
2. Run `npx tsc --noEmit` to catch missing imports before deploy.
3. Bump the patch version and write a Traditional Chinese changelog entry.
4. Commit and push.
5. Deploy to dev, then curl the changed endpoint and confirm HTTP 200 with non-empty data.
6. Only after dev verification passes, deploy to main and repeat the smoke check.
7. Report a short summary in Traditional Chinese.

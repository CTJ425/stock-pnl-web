---
name: versioning
description: The version number determination rule of stock-pnl-web. Use it when you want to determine the next version number, increment dev.N on the dev branch, merge dev into main for final version, or write a docs/agent/CHANGELOG.md version record.
---

# Version number specification details

Prerequisite (stated in `CLAUDE.md` § Versioning): the version number does not have the `v` prefix.
Keep these synchronized:

- `sources/src/version.ts` → `APP_VERSION` (UI badge)
- `sources/package.json` → `version` (with `package-lock.json`)
- `README.md` → version badge line only
- `docs/agent/CHANGELOG.md` → version history

**`dev` and `main` must never disagree on the version string after a sync.** After every release merge, fast-forward so both tips carry the **same** finalized `x.x.x`.

---

## Official version (`main` branch / release commit)

Format: **`x.x.x`** (semver, no suffix).

- Bump patch from the previous official version (`0.3.6` → `0.3.7`), unless the change is large enough for minor/major.
- The release commit (or the commit that finalizes the merge into `main`) is the **only** place that may drop `-dev.N`.
- `docs/agent/CHANGELOG.md` title for that version is the official number (no “under development”).

---

## Development versions (`dev` and feature work)

Format: **`x.x.x-dev.N`** (dot between `dev` and `N`, not a second hyphen).

| Piece | Meaning |
| ---- | ---- |
| `x.x.x` | The **next** official version this line of work will become when released |
| `N` | Sequential change count on that target, starting at **1** |

Examples: target `0.6.48` → first change `0.6.48-dev.1`, second `0.6.48-dev.2`.

### When to put `-dev`

- **Any non-release work on `dev`** (features, fixes, docs that ship with a version bump): use `x.x.x-dev.N`.
- After an official `x.x.x` is on both branches, the **next** edit that needs a version bump starts at **`(x.x.x + patch)-dev.1`**, not a bare `x.x.x` on `dev`.
- Do **not** leave `dev` showing a bare official number while unfinished work is in progress.

### When to remove `-dev`

- **Only on the official release commit** that merges to `main` (or the finalization commit on that path): strip `-dev.N` → `x.x.x`, finalize CHANGELOG, then `git push origin main:dev` so both branches match.

---

## merge into main (release checklist)

1. Confirm the target official number (e.g. work was `0.6.48-dev.3` → release **`0.6.48`**).
2. Set `version.ts` / `package.json` / lock / README badge to **`0.6.48`** (no `-dev`).
3. Finalize `docs/agent/CHANGELOG.md` under that official heading.
4. Merge to `main`, push (Pages deploys).
5. **Sync branches**: `git push origin main:dev` (or merge main→dev) so **dev and main show the same `0.6.48`**.
6. Next feature on `dev`: first versioned change → **`0.6.49-dev.1`**.

Purpose: official and pre-release numbers stay aligned; there is never a gap where main is `0.3.6` while dev already claims `0.3.8` without a release, and dev does not sit on a bare release number mid-work.

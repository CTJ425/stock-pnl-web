---
name: versioning
description: The version number determination rule of stock-pnl-web. Use it when you want to determine the next version number, increment dev.N on the dev branch, merge dev into main for final version, or write a README version record.
---

# Version number specification details

Prerequisite (`CLAUDE.md` §12 has been stated and will not be repeated here): the version number does not have the `v` prefix,
Three places must be synchronized - `sources/src/version.ts`, `sources/package.json` (together with `package-lock.json`), `README.md`.

## Official version (`main` branch)

The format is **`x.x.x`** (standard semver, without any suffix).

- Increment patches** sequentially according to the previous official version number** (for example: `0.3.6` → `0.3.7`).
- **Unless it is a major version change** (destructive changes, architectural reconstruction, functional mileage code), enter minor or major (for example: `0.3.7` → `0.4.0` → `1.0.0`).
- The "version record" of `README.md` is titled and finalized with the official version number.

## Test versions (`dev` and other development branches)

The format is **`x.x.x-dev.x`** (note: there is a **dot** `.` between `dev` and the serial number, not a hyphen):

- `x.x.x` = The official version number that this batch of dev work will become after being merged into `main` (determined according to the previous section).
- The last `.x` = the **number of changes** of the official version number during the dev period, starting from `1`, each meaningful change +1.
- Example: Target `0.3.7`, second change → `0.3.7-dev.2`.

The `README.md` version record is titled "Future official version number (under development)" during the dev period, and each change is listed in sections with `dev.1 / dev.2...` underneath.

## merge into main

Remove the `-dev.<N>` suffix to get the official version number (`0.3.7-dev.2` → `0.3.7`), and finalize the version record of this version.
Purpose: To always match the official and beta version numbers, so that there will no longer be a gap where the official version stops at `0.3.6`, but the test version jumps to `0.3.8`.

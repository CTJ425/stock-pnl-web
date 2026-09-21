# Spec — Slim the admin Discord console, and one spacing rhythm (Task 165, step 2g)

- Agent: Claude
- Status: APPROVED (user, 2026-09-21)
- Timestamp: 2026-09-21 Asia/Taipei
- Follows: `discord-account-schedule.md` (step 2f), `discord-user-self-service.md` §Revision 1

## 1. Goal

Two independent problems the user reported after step 2f shipped.

1. **The send schedule is in two places.** The admin console still edits the two `pg_cron`
   jobs, but every account now owns its own times. The admin screen is the only one a user
   cannot reach, so it reads as the authority while the account page is the one that acts.
   The admin console keeps the **global 經濟快報 webhook** and the **read-only per-account
   status list**, and loses the schedule editor.
2. **The self-service panel has three vertical rhythms.** Measured at 1440px against the real
   stylesheet: `ai-form-group` → `ai-actions` is **0px** while its neighbours are 12px and
   14px, so the URL box and the button row touch. One rhythm replaces all three.

## 2. Decisions

| # | Decision |
| - | -------- |
| D1 | **The admin console renders no schedule control.** `ScheduleSection` and `GlobalScheduleBlock` are deleted from `DiscordSection.tsx`. |
| D2 | **The Edge op and its client stay.** `discord_schedule_set`, the `discord-accounts` `set-schedule` op and `saveDiscordSchedule()` are untouched — same call as §R7 of the self-service spec: removing them means deleting a batch of passing tests for no user-visible gain. The global times are now changed by SQL, which is correct for a value that has moved twice in a year. |
| D3 | **The read-only per-account list stays** (`DiscordAccountsSection.tsx`, unchanged). It reports state, it does not set it. |
| D4 | **`跟隨全域（HH:MM）` becomes `預設（HH:MM）`.** With D1 there is no "全域" screen to point at, so the word names something the user cannot find. The resolved time keeps being shown — that part always worked. |
| D5 | **One spacing scale in `.dsc-block`: `var(--sp-04)` (12px), owned by the parent.** Children carry no vertical margin. Block separation goes to `var(--sp-06)` (24px) so a block boundary does not measure the same as a row inside one. |
| D6 | **Every CSS rule is scoped to `.dsc-block`.** `.hint` appears 109 times across 25 files and has **no base rule** in `index.css`, so it renders as a default `<p>`: 14px body text with 14px collapsed margins. Giving `.hint` a global rule would restyle the whole app. Only `.dsc-block .hint` is touched, and only its margin. Text size and colour do not change. |
| D7 | **The three time drop-downs align on one left edge.** `.dsc-schedule-row > span` is fixed at 112px; today the three labels have three widths and the selects step raggedly. |

## 3. Files

Production — builder may touch nothing else:

- `sources/src/components/Admin/DiscordSection.tsx`
- `sources/src/components/Settings/DiscordMySettings.tsx`
- `sources/src/index.css`

Tests are already written and are **not** builder's to edit (see §6).

## 4. `DiscordSection.tsx`

Delete, in this order:

1. `ScheduleSection` (the component), `GlobalScheduleBlock` (the component), and `scheduleOptions`
   (the helper only they use).
2. The `<GlobalScheduleBlock />` element at the end of the returned fragment. If that leaves the
   component returning a single `<section>`, drop the now-pointless `<>…</>` wrapper.
3. The whole `from '../../services/discordAccounts'` import — `getDiscordAccounts`,
   `saveDiscordSchedule`, `DiscordAccountsSnapshot`, `ScheduleView`. The file must no longer
   import that module at all.
4. From the `discordSchedule` import, whichever of `DEFAULT_DISCORD_SCHEDULE` / `SCHEDULE_OPTIONS`
   is left unused. Remove the import line entirely if both are.
5. Any `useState` / `useEffect` / `useCallback` import that becomes unused.

Nothing else in the file changes: the global webhook block, its preview buttons, the recent-send
table and every string in them stay exactly as they are.

## 5. `DiscordMySettings.tsx`

One function, `timeOptions`. Change only the inherit option's label:

- `跟隨全域（${globalTime}）` → `預設（${globalTime}）`
- `跟隨全域（尚未設定）` → `預設（尚未設定）`

The option's `value` stays `''`, the ordering stays, and `handleMarketTimeChange` /
`handleHoldingsTimeChange` are not touched. No other copy on the page changes — in particular
`全域頻道：已設定 …` stays, because that line does name a real channel.

## 6. `index.css`

Replace the existing `.dsc-block`, `.dsc-block:first-of-type`, `.dsc-block-title`,
`.dsc-toggle-row` and `.dsc-schedule-row` rules with:

```css
.dsc-block {
  display: flex;
  flex-direction: column;
  /* One rhythm for every child. The children carry no vertical margin of their own:
     `.ai-form-group` and `.ai-actions` never had one (they rely on `.ai-form`'s gap, and
     this panel is not an `.ai-form`), which is why the URL box and the button row touched. */
  gap: var(--sp-04);
  margin-top: var(--sp-06);
  padding-top: var(--sp-06);
  border-top: 1px solid var(--border);
}

.dsc-block:first-of-type {
  margin-top: var(--sp-04);
  padding-top: 0;
  border-top: none;
}

/* Scoped on purpose: `.hint` has no base rule in this file and is used app-wide, so it renders
   as a default <p> with 14px collapsed margins. Only the margin is removed, only in here. */
.dsc-block .hint {
  margin: 0;
}

.dsc-block-title {
  margin: 0;
  font-size: var(--type-body-01);
  font-weight: 600;
}

.dsc-toggle-row {
  display: flex;
  align-items: center;
  gap: var(--sp-03);
}

.dsc-schedule-row {
  display: flex;
  align-items: center;
  gap: var(--sp-04);
  flex-wrap: wrap;
}

/* The three labels (快報發送時間 / 完整版發送時間 / 發送時間) have three widths, so without a
   fixed column the selects start at three different x positions. */
.dsc-schedule-row > span {
  flex: 0 0 112px;
}
```

`.dsc-schedule-field` and `.dsc-schedule-field select` are unchanged.

## 7. Test charter

| Case | Expected | Layer / file |
| ---- | ---- | ---- |
| admin console renders no schedule heading, no 儲存排程 button, no time `<select>` | absent | `DiscordSection.test.tsx` (written) |
| admin global webhook block, previews and recent-send table | unchanged, still pass | `DiscordSection.test.tsx` (existing 22) |
| inherit option reads `預設（17:30）` / `預設（21:30）`, and no option text contains 全域 | pass | `DiscordMySettings.test.tsx` (written) |
| inherit option with a null global time reads `預設（尚未設定）` | pass | same |
| every other self-service behaviour | unchanged | same |

## 8. Verify

From `sources/`:

```
npx vitest run src/components/Admin/DiscordSection.test.tsx src/components/Settings/DiscordMySettings.test.tsx
npx vitest run
npm run build
npm run lint
```

`npm run build` is the type gate — `npx tsc --noEmit` does not type-check test files in this repo.

## 9. Out of scope

- Any Edge Function, schema, cron or `discord-my-settings` payload change. The wire shape,
  including `globalSchedule`, is unchanged.
- Giving `.hint` a base rule, or any restyle outside `.dsc-block`.
- Showing per-account times in the admin read-only list.
- Text size, colour, or wording anywhere except D4's two labels.

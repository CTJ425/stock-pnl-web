# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Carbon 精修四項（圖層階層、字級 ramp、間距節奏、UI Shell 頁首）
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-09 10:07:59 Asia/Taipei

---

## 📅 Log: 2026-09-09 10:07:59 Asia/Taipei (Task 148, 0.9.36, branch `feat/carbon-design`)

**Four refinement levers applied on top of the Carbon conversion, from a Diagram Design proposal.**

- **Approach**: A layer-stack diagram (`docs/design/carbon-layer-stack.html`) named the one thing that needed a picture — Carbon's surface hierarchy was collapsed into a single layer — and three levers that only needed a table. All four were then implemented.
- **Changed**: layer contexts so a field steps above its card or modal and a card inside a card steps up too; 20 font sizes collapsed to the 6 on the Carbon ramp; 216 spacing values snapped to the Carbon scale; page width 1180 → 1312; data-table rows at the Carbon md height of 40px; the workspace header action rebuilt as a 48px borderless UI Shell action.
- **Verified**: `npm run build` exit 0. `npm test` exit 0 — 103 files, 1732 tests passed. The transactions table was measured at 1440 and 1024 and overflows at neither width, which was the standing risk of raising every 11px and 13px value onto the ramp.
- **Not done on purpose**: no version bump, no merge. `dev` and `main` are untouched.

---

## 📅 Log: 2026-09-09 09:36:25 Asia/Taipei (Task 147, 0.9.36, branch `feat/carbon-design`)

**The whole UI moves from the glassmorphism design system to IBM Carbon Design.**

- **Approach**: The stylesheet already routed every color through a token layer, so the conversion is a token rewrite plus a component-geometry rewrite in `sources/src/index.css`. No component file needed a class change. Carbon tokens are added under a `--cds-*` prefix, and every historic token name stays as an alias on top of them.
- **Changed**: Carbon Gray 100 (dark) and Carbon White (light) palettes; IBM Plex Sans and IBM Plex Mono; square corners; the Carbon spacing scale; Carbon tabs, buttons, text inputs, data tables, modals, inline notifications, overflow menus, content switchers and tags; a 2px `$focus` ring inside every control; Carbon motion curves; and the Carbon data-visualization palette in `chartColors.ts`.
- **Verified**: `npm run build` exit 0. `npm test` exit 0 — 103 files, 1732 tests passed. Playwright screenshots on both themes show the dashboard, the transactions table, the transaction modal and the yearly report.
- **Not done on purpose**: no version bump, no merge. The work sits on `feat/carbon-design`; `dev` and `main` are untouched.

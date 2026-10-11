# VELTRIX Wallet — Architecture

VELTRIX is a single-framework app: a **React + TypeScript** UI (bundled with Vite) hosted by a small **native Android shell written in Java** against platform APIs only. All simulator logic lives in a framework-free TypeScript domain layer.

```
┌──────────────────────────── Android (Java, no AndroidX) ────────────────────────────┐
│ MainActivity      WebView host · edge-to-edge · insets/IME · system bars · back     │
│ AssetServer       serves assets/www on https://appassets.androidplatform.net        │
│ WebAppBridge      window.VeltrixNative: atomic storage, haptics, theme, share, ...  │
│ CardWidgetProvider static demo-card widget (snapshot pushed by the app)             │
└───────────────────────────────▲─────────────────────────────────────────────────────┘
                                │ JS bridge (no money logic crosses it)
┌───────────────────────────────┴──────────────── app/src ────────────────────────────┐
│ screens/   flows & screens            ui/   tokens, components, charts, card art    │
│ state/     store · persistence · navigation/sheets/toasts · live-rate fetcher       │
│ platform/  bridge wrapper with browser fallbacks                                    │
│ domain/    money · ledger · ops (payments, entities, planning) · fx · markets ·     │
│            analytics · query · csv · schema · presets      ← pure, fully unit-tested │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Why this stack

The brief preferred Kotlin + Compose, then Flutter, then React Native. All three need Gradle plus Maven/Google artifacts; in the build environment those hosts were blocked and there was no emulator to run a Compose UI. The reliable option was the Android SDK's own tools (aapt2, javac, d8, apksigner, fetched from public AOSP mirrors on GitHub) with a WebView shell, and a web UI that can be tested end-to-end in headless Chromium. A conventional Gradle project is included for Android Studio users and is built in CI.

## Domain layer (`app/src/domain`)

Pure functions, no React, no I/O. Every operation has the shape

```ts
op(state: AppState, input, ctx: { now: Date; id: (prefix) => string }) → { ok: true; state } | { ok: false; error }
```

so it is deterministic in tests (fixed clock and ids), atomic (a new state object or nothing), and easy to replay.

### Money

- Amounts are **integer minor units** (`number`, always `Number.isSafeInteger`, capped at 9×10¹⁴) with an explicit `CurrencyCode`. Each currency's ISO 4217 exponent drives parsing, storage and display (JPY 0, others 2).
- Parsing (`parseAmount`) is strict and locale-tolerant (`1.234,56`, `1,234.56`) and rejects negative, over-precise, oversized and non-numeric input. The custom keypad uses a pure reducer that can never produce an invalid string.
- Percentages (fees) use `BigInt`; rates, prices and quantities use `big.js` with explicit half-up rounding. Floating point is only used for chart geometry.

### Ledger

- `txnEffects(txn)` is the **only** definition of how an entry moves money:
  - `out` −(amount + fee)
  - `in` +(amount − fee)
  - `internal` source −(amount + fee), destination +(converted amount or amount)
  - Only entries with `applied: true` count.
- `postTxn` applies effects and records balance-before/after snapshots. `verifyLedger` recomputes every balance from scratch; property tests assert it never drifts.
- Opening balances are ledger entries (`adjustment/opening`), and so is every manual edit (`adjustment/manual`). Credit accounts hold a balance ≤ 0 (the amount owed) within `[−limit, 0]`.
- **Reversals instead of rewriting history:** sends, purchases and fees reverse to a refund; receipts to an adjustment-out; transfers and exchanges reverse with the accounts swapped (exchanges at the implied rate, so both sides net to zero). The original entry is marked `reversed`.
- **Safe deletion:** only entries that never moved money (pending, canceled or untracked) or a reversed pair whose effects net to zero on every account can be deleted; anything else returns `reverse_first`.
- **"Balance tracking off"** records simulated activity as `untracked` without applying it; manual adjustments and trades always apply.
- **Idempotency:** confirm buttons pass an operation key; processed keys are remembered (`meta.processedOps`), so double taps, re-renders or replays never post twice. Scheduled rules use `rule:<id>:<date>` keys, so restarts can't duplicate occurrences.

### Payments, cards, credit, planning

- `payments.ts`: send (optional instant fee, pending outcome), receive, requests (outgoing accept/cancel, incoming pay/decline), manual adjustments, same-currency transfers (credit payments capped at the amount owed), exchanges (rate recorded with source and timestamp, optional fee in the source currency), card purchases (frozen cards declined, monthly limits enforced), reversal, deletion and descriptive edits only (note, category, tags).
- `entities.ts`: accounts (opening entry; archive only when empty, unlinked and never the main wallet), credit edits (any one of used / available / utilization drives the others; a change of used credit is posted as a visible adjustment), card CRUD/ordering/default (four display digits only — card objects have no number or CVV fields), contacts with unique usernames.
- `planning.ts`: savings goals (moves money with real transfers and tracks `saved`), budgets (net of refunds), recurring and scheduled simulations with catch-up (max 12 occurrences, then skip ahead), bill reminders (one per due date) and notification housekeeping.

### FX and markets

- `fx.ts` keeps **rates separate from accounting**: bundled `DEMO_RATES` (kind `demo`), cross rates via USD with 10 significant digits, strict parsing of the optional live payload, and a staleness/disclosure model (`demo`, `live`, `cached`, `stale`). Exchanges store the rate, its source and its publish time on the ledger entry.
- `markets.ts`: a deterministic **demo price engine** — a per-symbol seeded Ornstein–Uhlenbeck random walk in log space (daily closes) with a Brownian-bridge intraday path, plus a tiny 3-second jitter so prices tick. It produces history for 1D–5Y, candles and day/52-week ranges. It is not market data, and the UI always says so. Trading settles USD-quoted instruments against the investment account: quantity is rounded down to the asset's precision, cost is rounded to cents, average cost includes buy fees, and realized P&L is net proceeds minus cost basis. Portfolio history is reconstructed from ledger effects and order history.

### Analytics, search, export, schema

- `analytics.ts` counts only completed income and spending (sends, purchases, fees, minus refunds). Transfers, exchanges, trades, adjustments and reversed pairs are excluded, so moving money never looks like spending. Comparisons are like-for-like (month-to-date vs last month to date, and so on).
- `query.ts`: free-text search across names, notes, tags, accounts, cards, amounts and SIM references; filters; four sort orders by displayed amount or time; monthly grouping; per-currency totals.
- `csv.ts`: every row starts with `SIMULATED`; text cells are protected against spreadsheet formula injection.
- `schema.ts` validates everything read from storage or a file (types, ranges, references, duplicates; at most 50,000 entries), migrates older versions, merges settings over defaults, and **recomputes balances from the ledger** if stored balances drifted.
- `presets.ts` builds the five starting points by running the **real operations** against a deterministic RNG, then back-solves opening balances so history never dips below zero and the main wallet lands exactly on the chosen starting balance (any correction is a visible "Starting balance set" entry).

## State layer (`app/src/state`)

- `store.ts` is the single source of truth (exposed through `useSyncExternalStore`). `run(op)` executes an operation with a fresh context; on success the whole new state is committed in one assignment, and on failure nothing changes. Saves are debounced (300 ms) and flushed when the app goes to the background. Startup and resume run due schedules and bill reminders idempotently.
- `persistence.ts` reads and validates the save; if it is unreadable it restores the last good copy (and keeps the unreadable file for export), or shows a recovery screen. Writes go through the bridge (Android, `AtomicFile`) or `localStorage` (browser preview). Failed writes are surfaced to the user.
- `ui.ts` holds ephemeral UI state: per-tab navigation stacks (tabs keep their place), bottom sheets, the confirm dialog, toasts and back handling (dialog → sheet → in-screen interceptor such as a flow step → pop → Home → let Android background the app).

## UI layer

- **Design tokens** live only in `ui/theme.css` (dark and light palettes, six accents, chart colours). TypeScript references them as `var(--…)` through `ui/tokens.ts`. Card "materials" (product finishes of the fictional cards) are centralized in `ui/cardStyles.ts`.
- Components: primitives, keypad, sheets/dialogs/toasts, an SVG **demo card renderer** (ID-1 ratio 1.586, chip, patterns, sheen, original network marks, permanent DEMO CARD label, frozen state), hand-written SVG charts (area/line with crosshair, bars, donut, candles, sparklines) and a QR renderer limited to ASCII demo payloads.
- Motion: CSS only, durations from tokens; "reduced" or "off" (and the OS reduce-motion setting) shorten or remove animations. Nothing waits on an animation.
- Hidden tab screens stay mounted (`visibility: hidden`) so scroll positions and filters survive tab switches; timers pause when a screen isn't visible.

## Android shell (`android/`)

- **Loading:** the WebView loads `https://appassets.androidplatform.net/index.html`. `AssetServer` maps the path to `assets/www/…` with correct MIME types; path traversal is rejected. Any other host is blocked (403) except `open.er-api.com` for the opt-in indicative rates. Navigation away from the app origin is refused.
- **Hardening:** file and content access are off, mixed content is never allowed, there is no zoom and no multiple windows, Safe Browsing lookups are off (only local content), algorithmic darkening is off, WebView debugging is off, console messages are never forwarded to logcat, and permission and geolocation requests are denied. A strict CSP is injected into the production `index.html`.
- **Edge-to-edge:** `setDecorFitsSystemWindows(false)` (API 30+) or layout flags (older); transparent bars with light/dark icons that follow the in-app theme (persisted, so the next launch starts in the right colours). On API 24–25 the navigation bar stays opaque because those versions can't draw dark icons. Insets are passed to the page in dp as CSS variables.
- **Keyboard:** when the IME is visible, the WebView's bottom margin equals the keyboard height (an `adjustResize` equivalent for edge-to-edge), so focused fields stay visible.
- **Back:** `OnBackInvokedCallback` (API 33+) or `onBackPressed` asks the page (`__veltrixBack()`); if the page doesn't consume it, the task moves to the background.
- **Storage:** `AtomicFile` per key in app-private storage. Backup and device transfer are excluded (`allowBackup=false` plus data-extraction rules).
- **Files:** export uses the Storage Access Framework (`ACTION_CREATE_DOCUMENT`); import uses the WebView file chooser.
- **App lock:** `KeyguardManager.createConfirmDeviceCredentialIntent` (PIN, pattern or biometrics, as configured on the device).
- **Widget:** `CardWidgetProvider` renders the default demo card into a bitmap (gradient, DEMO CARD pill, masked balance unless the user opts in, display digits, frozen state). `updatePeriodMillis=0` and the receiver isn't exported; the app pushes a snapshot when the card or balance changes. No background work.
- **Themes and splash:** light theme in `values/`, dark in `values-night/` (so the WebView's `prefers-color-scheme` follows the system), API 31 splash attributes, and an adaptive icon with a monochrome layer plus legacy PNGs.

## Build pipeline

`tools/build-apk.sh`:

1. Vite build.
2. Copy the bundle to `assets/www`.
3. Inject the package name into the manifest.
4. `aapt2 compile` and `aapt2 link` (min 24, target 35, assets).
5. `javac` to Java 8 bytecode against `android.jar` 35.
6. `d8 --release --min-api 24`.
7. Add `classes.dex`, then `zipalign -p 4`.
8. `apksigner` (v2 + v3).
9. Verify: signature, alignment, badging, stored `resources.arsc` and dex header.
10. Copy the APK to `release/` with a SHA-256.

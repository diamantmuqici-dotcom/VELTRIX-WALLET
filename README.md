# VELTRIX Wallet

**Your Money. Your Universe.** A premium, offline-first wallet app for Android and Windows.

> VELTRIX runs entirely on your device. It doesn't connect to banks, card networks, brokers or payment providers, never asks for credentials, and can't send or receive real money.

<p align="center">
  <img src="docs/screenshots/03-home-dark.png" width="200" alt="Home (dark)" />
  <img src="docs/screenshots/10-card-studio.png" width="200" alt="Card studio" />
  <img src="docs/screenshots/06-send-review.png" width="200" alt="Send review" />
  <img src="docs/screenshots/14-asset.png" width="200" alt="Markets asset detail" />
</p>
<p align="center">
  <img src="docs/screenshots/18-home-light.png" width="200" alt="Home (light)" />
  <img src="docs/screenshots/16-activity.png" width="200" alt="Activity ledger" />
  <img src="docs/screenshots/12-exchange.png" width="200" alt="FX converter" />
  <img src="docs/screenshots/15-portfolio.png" width="200" alt="Portfolio" />
</p>

## Download

**[⬇ Get it from the latest release](https://github.com/diamantmuqici-dotcom/VELTRIX-WALLET/releases/latest)**: direct downloads, no account or build needed.

| | |
|---|---|
| **Android APK** | [VELTRIX-Wallet-v1.0.0.apk](https://github.com/diamantmuqici-dotcom/VELTRIX-WALLET/releases/download/v1.0.0/VELTRIX-Wallet-v1.0.0.apk) (≈ 439 KB) · [SHA-256](https://github.com/diamantmuqici-dotcom/VELTRIX-WALLET/releases/download/v1.0.0/VELTRIX-Wallet-v1.0.0.apk.sha256) |
| **Windows .exe** | [VELTRIX-Wallet-v1.0.0-win-x64.exe](https://github.com/diamantmuqici-dotcom/VELTRIX-WALLET/releases/download/v1.0.0/VELTRIX-Wallet-v1.0.0-win-x64.exe) (≈ 1.4 MB) · [SHA-256](https://github.com/diamantmuqici-dotcom/VELTRIX-WALLET/releases/download/v1.0.0/VELTRIX-Wallet-v1.0.0-win-x64.exe.sha256) |
| App ID / version | `com.veltrix.wallet` · 1.0.0 (versionCode 1) |
| Android | 7.0+ (API 24), target API 35 · needs an up-to-date Android System WebView (Chrome 87+) |
| Windows | 10/11 x64 · needs Microsoft Edge or Google Chrome · no installer, single file, nothing to uninstall |
| Signature | APK Signature Scheme v2 + v3, public **development** key ([details](android/keystore/README.md)). The .exe is **unsigned** — see [desktop/README.md](desktop/README.md). |

On a phone, open the APK link, then open the downloaded file and allow installing from that source (or run `adb install VELTRIX-Wallet-v1.0.0.apk` from a computer). On Windows, double-click the `.exe`. SmartScreen warns on first run because it is unsigned (**More info → Run anyway**). The whole UI is inside the file, served from `127.0.0.1` and opened in an Edge/Chrome app window. Step-by-step instructions are in the [release notes](docs/releases/v1.0.0.md). The same files are also committed in [`release/`](release/).

Both artifacts were built and **verified** in this repository's environment. The APK statically (signature, zip alignment, manifest, resources, dex); the .exe statically (PE32+ x64, GUI subsystem, embedded bundle) *and* functionally — the same source compiled for the host passed 27 HTTP/security checks and the full 19-test end-to-end suite. Neither has been launched on real Windows or a real phone here; see [Environment limitations](#environment-limitations).

## What's inside

- **Home** — wordmark, avatar, greeting, notifications, settings; a big balance card (show/hide, display currency, add/remove/edit funds, history), eight working quick actions, renamable/hideable account tiles and configurable sections (recent activity, monthly income/spend, category donut, 30-day trend, upcoming bills, goals, favourite contacts and currencies, card activity, mini watchlist).
- **Send · Request · Receive** — recipient (saved, search or new contact) → keypad amount (presets, fee preview, available balance, validation) → note (presets, 140-grapheme limit, emoji) → review → result with reference and details. Requests can be marked accepted or canceled; incoming requests paid or declined. The receive screen shows a QR code, a copyable wallet ID, shareable text and manual entry of incoming payments.
- **Card studio** — 10 materials (Obsidian, Glacier, Emerald, Royal, Aurora, Carbon, Pearl, Neon, Midnight Blue, Custom), patterns, accents, original network marks, debit/credit/prepaid, limits, per-card history, freeze/unfreeze, rename, reorder, set default, delete, phone presentation mode and a home-screen widget. Cards show only four display digits and never have a full card number or CVV.
- **Accounts** — main wallet, checking, savings, virtual card, FX balances, investment cash and a credit line you set up yourself, whose limit / used / available / utilization are validated and derived from each other; monthly summaries and history per account.
- **Ledger** — 11 entry types with balance before/after; search, filters (type, status, category, account, card, date, amount), four sort orders, monthly grouping, totals in/out/net, details, complete/cancel pending, reverse/refund and safe deletion.
- **Wallet tab** — an original, PayPal-inspired hub: currency balances, requests, contacts, payment activity, refunds, note history with search and notification preferences.
- **FX converter** — USD, EUR, GBP, CHF, JPY, CAD, AUD, ALL, TRY (+7 more), swap, rate and timestamp, favourite pairs, history, optional fee; bundled offline rates, optional **indicative** live rates (ExchangeRate-API, opt-in). Conversions update FX accounts with a full calculation breakdown.
- **Markets** — FX pairs, indices, stocks, gold/silver and crypto with app-generated prices (not market data); search, watchlist, line/candle charts (1D–5Y), buy/sell with fees, review & confirm, positions with average cost, realized/unrealized P&L and order history.
- **Analytics** — income, spending, net, averages, largest entries, category/account/card breakdowns, daily/weekly/monthly trends, like-for-like previous-period comparison and custom ranges — computed from the local ledger only, with empty states.
- **Extras** — setup wizard with five starting presets (from an empty wallet to a fully stocked one), savings goals, budgets, subscriptions and scheduled transfers, bill reminders, global search, a decimal-exact calculator, CSV export, validated backup/restore, app lock (device credential), full reset, light/dark/system themes with themed system bars, six accents and adjustable motion.

## Safety & privacy by design

- Integer minor-unit money with explicit currencies; transfers conserve value except fees; no currency mixing without a recorded conversion rate.
- Every balance change is a ledger entry. Manual edits are visible adjustments; deletions are only allowed for entries that never moved money (or reversed pairs that net to zero).
- Data stays on the device (app-private files, written atomically). Android backup and device transfer are disabled.
- The only permission is `INTERNET`, used solely for the optional indicative FX-rate download. Payments, transfers and trades never touch the network. No background services, no system notifications, no analytics or trackers.
- Built-in prices and rates are never presented as live; downloaded rates are marked indicative and carry attribution.

## Build it yourself

Prerequisites: **Node 18+** (developed with Node 22), git, bash, python3, zip. No Android Studio, Gradle or Maven access is required for the reference build.

```bash
# 1) Web app (the UI that ships inside the APK)
cd app
npm ci
npm run dev          # live preview on http://localhost:5173
npm run typecheck    # TypeScript strict mode
npm test             # unit + property tests (Vitest + fast-check)
npm run build        # production bundle → app/dist

# 2) Android APK (reference build: aapt2 + javac + d8 + zipalign + apksigner)
cd ..
tools/setup-toolchain.sh   # fetches JDK 17 + Android API 35 build tools from public AOSP mirrors on GitHub
tools/build-apk.sh         # tests → bundle → compile → dex → align → sign → verify → release/

# 3) Windows .exe (Zig cross-compiles it on Linux — no Windows host, no installer toolchain)
cd ..
tools/setup-exe-toolchain.sh   # ziglang + Pillow from PyPI
tools/build-exe.sh             # tests → bundle → embed → cross-compile → icon → verify → release/

# 4) End-to-end UI tests against the production bundle
cd tools/ui-test && npm ci && npm test          # or: npm run test:shots (refreshes docs/screenshots)
```

**Android Studio / Gradle:** `android/` is also a standard Gradle project (AGP 8.7.3, Gradle 8.10.2 wrapper, JDK 17). Build the web bundle first (`cd app && npm ci && npm run build`), then open `android/` in Android Studio or run `./gradlew assembleDebug`. Gradle could not be executed in the environment this was developed in (Maven/Google repositories are blocked there); the GitHub Actions workflow runs it on every push, and the [first run](https://github.com/diamantmuqici-dotcom/VELTRIX-WALLET/actions/runs/38177537425) built the debug APK successfully.

To sign with your own key: `VELTRIX_KEYSTORE=… VELTRIX_KEY_ALIAS=… VELTRIX_STORE_PASS=… VELTRIX_KEY_PASS=… tools/build-apk.sh`.

**Publishing a release:** pushing a version tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml), which attaches the APK, the `.exe` and their checksums to a GitHub Release. Bump the version first (`git grep -n 1.0.0` lists every place it appears, including `VERSION_CODE` in `tools/build-apk.sh`), rebuild with the two scripts above, commit `release/` (optionally with notes in `docs/releases/vX.Y.Z.md`), then run `git tag vX.Y.Z && git push origin vX.Y.Z`. The workflow publishes the committed files exactly as they are. It refuses to publish if they are missing at the tag or don't match their `.sha256`. A tag like `v1.1.0-beta.1` becomes a pre-release.

**Why not Electron?** Electron would need its ~100 MB runtime downloaded from GitHub's release CDN, which is unreachable from a locked-down build sandbox, and it would add a second browser engine to audit. The Zig launcher instead compiles the UI *into* the executable (1.4 MB total) and draws it with the Edge/Chrome the machine already has. See [desktop/README.md](desktop/README.md).

## Project structure

```
app/                     React + TypeScript UI and domain logic (Vite)
  src/domain/            pure, framework-free core: money, ledger, ops, FX, markets, analytics, presets, schema
  src/state/             single store (useSyncExternalStore), persistence, navigation/sheets/toasts, live-rate fetcher
  src/ui/                design tokens (theme.css), component styles, charts, card renderer, primitives
  src/screens/           every screen and flow
  tests/                 Vitest unit + fast-check property tests
android/                 native Android shell (Java, platform APIs only — no AndroidX)
  app/src/main/java/…    MainActivity (WebView host), WebAppBridge, AssetServer, CardWidgetProvider
  app/src/main/res/      themes (light/dark, splash), adaptive icon, widget, backup rules
  keystore/              public development signing key
desktop/                 Windows desktop shell (Zig): embeds app/dist, serves it on 127.0.0.1, opens an app window
tools/
  setup-toolchain.sh     fetch the minimal Android toolchain
  build-apk.sh           Gradle-free build + verification
  setup-exe-toolchain.sh fetch ziglang + Pillow
  build-exe.sh           cross-compile + verify the Windows .exe
  gen-win-assets.py      app/dist → the @embedFile table compiled into the .exe
  render-win-icon.py     Android launcher PNGs → multi-resolution .ico
  ui-test/               Puppeteer end-to-end tests (own package.json)
  icons/                 renders legacy PNG icons + widget preview from SVG
release/                 the verified APK, the Windows .exe and their SHA-256s
docs/                    architecture, testing, screenshots, release notes (docs/releases/)
.github/workflows/
  ci.yml                 unit tests, reference APK build, Windows .exe build, UI tests, Gradle build
  release.yml            on a vX.Y.Z tag: publish release/ as a GitHub Release (APK, .exe, checksums)
```

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| react, react-dom | 19.1.9 | UI |
| lucide-react | 0.577.0 | icons (ISC) |
| big.js | 7.0.1 | decimal maths for rates, prices and quantities |
| qrcode-generator | 2.0.4 | QR codes |
| @fontsource-variable/inter | 5.3.0 | bundled Inter typeface (OFL), Latin + Latin Extended |
| vite · @vitejs/plugin-react | 6.3.7 · 4.7.0 | build / dev server |
| typescript | 5.8.3 | strict type checking |
| vitest · fast-check | 3.2.7 · 4.10.2 | unit and property-based tests |
| puppeteer-core · @sparticuz/chromium | 25.13.0 · 153.0.0 | end-to-end UI tests (tools/ui-test) |
| @resvg/resvg-js | 2.6.2 | icon rendering (tools/icons) |

The Android shell uses only Android platform APIs (no third-party Java libraries). Toolchain: OpenJDK 17.0.2, android.jar API 35, aapt2 2.19, D8 8.6.2, apksigner 0.9.

The desktop launcher is a single Zig file with **no third-party dependencies** — only the Zig standard library. Toolchain: Zig 0.14.1 (`ziglang` from PyPI), Pillow for the `.ico`.

## Test results

Latest run (2026-10-11):

- **Unit & property tests:** 114 / 114 passed across 10 files: money parsing and formatting, payments, credit, cards, contacts, FX, markets and portfolio maths, presets, analytics, search and filters, CSV, backup/schema validation, planning, calculator. Property tests run random sequences of up to 40 operations through the ledger (300 runs) and check that balances always equal the sum of ledger effects, asset accounts never go negative, credit stays within its limit and transfers conserve value.
- **End-to-end UI tests:** 19 / 19 passed against the production bundle with its CSP: setup wizard, send/refund/request/receive, balance edits, card studio, exchange, markets, ledger search/sort, CSV and backup round-trip, persistence and corruption recovery, back navigation, theming, the native-bridge contract, a 20,000-entry history (validate ≈ 0.1 s, apply ≈ 0.4 s, Activity ≈ 0.5 s), accessibility smoke checks and zero console errors or CSP violations.
- **APK verification:** apksigner verify (v2 + v3), `zipalign -c -p 4`, `aapt2 dump badging` (package, SDK levels, single permission, launcher activity, widget), uncompressed `resources.arsc`, dex header check.
- **Windows .exe verification:** static PE checks (PE32+ x64, GUI subsystem so no console window appears, the embedded bundle present verbatim) plus **27 functional checks** run against the same source compiled for the host: every asset served byte-identically to `app/dist`, correct MIME types, hashed assets immutable-cached while `index.html` is not, `nosniff`, SPA route fallback, 404/400/405 handling, path-traversal and null-byte rejection, a single loopback-only listener (asserted from the kernel's view of the process's own sockets) and single-instance deferral.
- **End-to-end suite against the launcher:** all **19 / 19** UI tests re-run against the bundle *as served by the launcher* (`node run.mjs --base-url=…`), with zero console errors or CSP violations — so the bytes compiled into the `.exe` are the bytes that pass the full flow suite, not merely a copy of `app/dist` on disk.
- **CI on a clean GitHub runner** ([run](https://github.com/diamantmuqici-dotcom/VELTRIX-WALLET/actions/runs/38177537425)): unit tests, the toolchain APK build from scratch, the end-to-end UI tests and the Gradle build all passed.

Details: [docs/TESTING.md](docs/TESTING.md) · Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Environment limitations

This project was built in a sandbox with no Android emulator (no KVM) and with Google Maven, Maven Central and Gradle download hosts blocked. Consequences:

1. **The APK has not been launched on a device or emulator here.** It is verified statically, and the web layer it hosts passes the end-to-end tests in Chromium, including a contract test of the JavaScript bridge against a mock with the same interface as `WebAppBridge.java`. On-device behaviour (WebView rendering, insets/keyboard, back gesture, file pickers, share sheet, app lock, widget) still needs a manual pass — see the checklist in [docs/TESTING.md](docs/TESTING.md).
2. **Framework choice.** Kotlin + Jetpack Compose (and Flutter or React Native) need Gradle and Maven artifacts that could not be downloaded here, so the app uses a native Java shell with a React UI in a WebView, built with the Android SDK's own tools. This is the one framework in the repository; there are no parallel half-built implementations.
3. **The Gradle build was not executed locally** (Maven blocked). It runs in CI, where it [passes](https://github.com/diamantmuqici-dotcom/VELTRIX-WALLET/actions/runs/38177537425); the resulting artifact could not be downloaded into this sandbox for inspection.
4. **Live indicative FX rates could not be fetched from this sandbox** (outbound host blocked). The parsing, validation, staleness and disclosure logic is unit-tested with sample payloads; the app falls back to its bundled rates.
5. **The `.exe` has never been executed on Windows.** No Windows host or emulator was available, and GitHub's release CDN — which is where an Electron runtime would have to come from — is blocked here, so the launcher is cross-compiled with Zig and verified two ways: statically as a PE image, and functionally by compiling the *same source file* for the host and driving it over HTTP (27 checks) and through the full 19-test end-to-end suite. What is untested is Windows-specific and small: the `MessageBoxW` error dialog, browser discovery under real `Program Files` paths, `--app` window framing, and SmartScreen's reaction to an unsigned binary. See the checklist in [docs/TESTING.md](docs/TESTING.md).
6. **The `.exe` is unsigned.** There is no code-signing certificate here, so SmartScreen will warn on first run. Details and options: [desktop/README.md](desktop/README.md).
7. **No Google/Apple Wallet provisioning** — VELTRIX cards aren't issued by a bank or card network, so they can't be added to Google or Apple Wallet. The home-screen widget and in-app presentation mode are the alternatives.

## Trademarks

VELTRIX uses only original designs. Card network marks are original VELTRIX designs; no bank, card network or payment-provider branding is reproduced. Company and index names in Markets are used for illustration only; their prices are generated by the app, not market data.

# Testing VELTRIX Wallet

There are three automated layers plus a manual on-device checklist.

| Layer | Command | Where |
|---|---|---|
| Type safety | `npm run typecheck` | `app/` (TypeScript strict, no unused code) |
| Unit + property tests | `npm test` | `app/tests/*.test.ts` (Vitest + fast-check) |
| End-to-end UI tests | `npm test` (`npm run test:shots` also refreshes `docs/screenshots`) | `tools/ui-test/` (Puppeteer, production bundle) |
| APK verification | `tools/build-apk.sh` | apksigner, zipalign, aapt2, dexdump |

CI (`.github/workflows/ci.yml`) runs all of them plus the Gradle build.

## Unit & property tests — 114 passing

| File | Tests | Covers |
|---|---:|---|
| `money.test.ts` | 16 | strict amount parsing (locale separators, precision, negatives, overflow), keypad reducer, fees (rounding, min/max, BigInt exactness), currency conversion across precisions, formatting (true minus sign, symbols, hidden amounts), percent change |
| `payments.test.ts` | 24 | send (fees, validation, grapheme-counted emoji notes, idempotent double taps), pending complete/cancel, balance tracking off, receive, outgoing/incoming requests, manual adjustments, credit bounds, transfers (conservation, currency mismatch, overdraft, credit payments capped at owed), exchange (rate, fee in source currency, optional fee, JPY, bad rates), card purchases (frozen, limits, credit), reversal of every entry type back to the original balances, safe deletion, descriptive edits |
| `properties.test.ts` | 7 | random sequences of up to 40 mixed operations (send, receive, transfer, exchange, purchase, adjust, reverse, delete, complete, cancel, trades, tracking toggles) × 300 runs: balances always equal the sum of ledger effects, asset accounts never go negative, credit stays within its limit, positions stay positive; same-currency transfers conserve the total; internal effects match amount + fee; parse/format round-trips; keypad output always parses; conversion is monotonic and round-trips within one minor unit |
| `entities.test.ts` | 12 | account create/validate/update/reorder/archive rules, credit figures and edits from used/available/utilization, card CRUD, freeze, reorder, default reassignment, rejection of full card numbers and mismatched account types, absence of PAN/CVV fields, contacts with unique usernames |
| `fx.test.ts` | 6 | demo rates for all required currencies, cross rates, display conversion, strict live-payload parsing, demo/stale/cached/live disclosure, rate formatting |
| `markets.test.ts` | 9 | deterministic positive demo prices, continuity, history and candles for every range, quote precision, buy with fee and average cost, sell with realized P&L, invalid trades, idempotent orders, portfolio valuation and history |
| `presets.test.ts` | 16 | all presets across currencies (USD, EUR, JPY, ALL, GBP, TRY, CHF): consistent ledger, snapshots equal a full replay, no negative history, credit within limit, valid cards, nothing in the future, schema round-trip; exact starting balances; realistic sample activity; investor portfolio; reproducibility; empty sandbox; username derivation |
| `data.test.ts` | 11 | analytics exclusions (transfers, exchanges, reversed pairs), previous-period comparison, trends and empty states, account monthly summaries, ledger search/filters/sorts/grouping/totals, CSV marking and formula-injection protection, backup round-trip, rejection of corrupt files, drift repair, defaults for older files |
| `calculator.test.ts` | 6 | decimal-exact arithmetic (0.1 + 0.2 = 0.3), operator chaining, percent/sign/backspace, 10-decimal rounding, divide-by-zero and overflow errors, input caps |
| `planning.test.ts` | 7 | next-occurrence maths, due-rule catch-up and idempotency across restarts and replays, skipped runs with reminders, subscription monthly equivalents, goals via real transfers, budgets net of refunds, bill payment, rollover and one reminder per due date |

## End-to-end UI tests — 19 passing

`tools/ui-test/run.mjs` serves `app/dist` (the bundle inside the APK, with its production CSP) and drives it in a 390×844 mobile Chromium. Each test starts from a clean browser profile and asserts on visible results.

1. Setup wizard: Minimal preset, custom name, EUR, light theme, €1,234.56 starting balance, Emerald card → Home shows exactly €1,234.56 in light mode.
2. Send: recipient → keypad → note preset → review (SIMULATED banner) → result → Home balance drops by exactly 25.00; newest ledger entry is the payment.
3. Refund: send then reverse from the details → balance restored, status "Simulation reversed".
4. Request: create → mark accepted → balance +12.00.
5. Receive: demo QR renders; simulated incoming payment → +40.00.
6. Manual edit: set balance to exactly 5,000.00, add 250.50 → both visible as ledger adjustments.
7. Card studio: create a Neon card, freeze → purchase declined, unfreeze → purchase recorded, delete with confirmation; card art labelled "Not a real payment card".
8. Exchange: 100 USD at the 0.86 demo rate → €86.00 with breakdown and "Demo rates (bundled sample)" disclosure.
9. Markets: buy NVDA, position shown, sell all, realized P&L and portfolio.
10. Activity: search only shows matches, the type filter works, largest-first sort is descending.
11. CSV export (every row `SIMULATED`) and a full backup → change data → restore → balance equals the backup.
12. Persistence across reloads; corrupt save → automatic restore of the last good copy; both copies corrupt → recovery screen → start fresh.
13. Back navigation: closes sheets, pops screens, tab roots return to Home.
14. Appearance: light theme, violet accent and motion off applied to `<html>`.
15. Native bridge contract with a mock `VeltrixNative`:
    - state is saved through the bridge, never to localStorage;
    - system bars are themed;
    - the widget payload says DEMO and masks the balance;
    - insets become CSS variables;
    - `__veltrixBack()` returns `false` at the Home root and `true` with a sheet open or inside a flow;
    - the keypad triggers haptics.
16. 20,000-entry history via backup restore: validation ≈ 0.1 s, apply ≈ 0.4 s, Activity ≈ 0.5 s, list paginated, state persisted through the bridge (> 5 MB).
17. Accessibility smoke: every visible control on the five main tabs has an accessible name.
18. Analytics, Wallet and Goals render local data; a goal contribution works; the calculator computes 0.1 + 0.2 = 0.3.
19. No console errors or CSP violations in any of the flows above.

The suite found and fixed real bugs during development:
- The setup wizard left a stale Android back handler behind.
- Load and save warnings were never shown to the user.
- Sample data had too few grocery trips.
- A CSS class collision shrank the empty keypad amount.
- Presentation mode's close button popped two screens.
- The converter's fee toggle only affected the preview, not the actual conversion.
- The restore dialog showed counts without thousands separators.

## APK verification (each build)

- `apksigner verify --verbose --print-certs`: v2 and v3 signatures valid (v1 is unnecessary at minSdk 24).
- `zipalign -c -p 4` passes; `resources.arsc` is stored uncompressed (required for targetSdk ≥ 30).
- `aapt2 dump badging`:
  - package `com.veltrix.wallet`, versionCode 1, versionName 1.0.0;
  - minSdk 24, targetSdk 35;
  - one permission (`INTERNET`), label "VELTRIX Wallet";
  - launchable `com.veltrix.wallet.MainActivity`, provides an app widget.
- The manifest dump confirms:
  - `allowBackup=false`, data-extraction rules, `usesCleartextTraffic=false`, `enableOnBackInvokedCallback=true`;
  - the widget receiver is not exported.
- `dexdump` header: a valid dex 037 file.

## Windows .exe verification (each build)

`tools/build-exe.sh` verifies the launcher two ways, because a PE image built on
Linux cannot simply be executed here.

**Static, on the Windows image itself:**

- PE32+ (`0x20b`), machine `0x8664` (x64), and **subsystem 2 (GUI)** — subsystem 3
  would pop a console window next to the app.
- The embedded bundle is present *verbatim*: `app/dist/index.html` is found
  byte-for-byte inside the image, as are the launcher's own strings.

**Functional, on the same source file compiled for the host** (27 checks over
HTTP):

- `GET /` returns `index.html` with the same SHA-256 as `app/dist/index.html`.
- Every asset (JS, CSS, woff2, SVG) returns 200 with the right `Content-Type` and
  the right byte count.
- Hashed `/assets/*` are `max-age=31536000, immutable`; `index.html` is
  `no-cache`; every response carries `X-Content-Type-Options: nosniff`.
- `HEAD /` returns 200 with an empty body; `POST /` returns 405.
- An extension-less unknown path falls back to `index.html` (SPA reload); an
  unknown path *with* an extension 404s.
- `../` traversal and an embedded NUL are rejected with 400.
- The launcher binds the fixed default port (43921), so the origin — and the
  wallet's `localStorage` — is stable across launches.
- **Loopback-only**, asserted from the kernel's view of the process's own sockets
  (`ss -ltnp` filtered by PID): exactly one listener, on `127.0.0.1`. This is
  *not* checked by probing another interface address — inside a container a
  port-forwarder often listens on the external address for every port in use and
  proxies to loopback, so such a probe reports the forwarder's answer, not the
  launcher's binding. That mistake was made once and is the reason for the
  comment.
- **Single-instance:** a second launcher on the default port recognises the first
  via `GET /__veltrix/ping`, reports the conflict and exits (1) instead of
  double-binding; the first keeps serving. A second launcher given an explicit
  occupied `--port` fails loudly with that port named. The probe runs under
  `timeout`, because a launcher that wrongly re-binds would otherwise block in
  `accept()` forever and hang the build rather than fail it.

**End-to-end, against the launcher:** the whole 19-test suite is re-run with
`node run.mjs --base-url=http://127.0.0.1:43921/`, so the flows are driven
against the bundle *as the launcher serves it*, on a different origin from the
built-in static server. All 19 pass with zero console errors or CSP violations.

What none of this covers is the launcher's Windows-only branches — see the
checklist below.

## Manual Windows checklist

No Windows host was available when this was built.

- [ ] Double-click `release/VELTRIX-Wallet-v1.0.0-win-x64.exe`: SmartScreen warns (unsigned — expected); "More info → Run anyway" starts it.
- [ ] The Explorer/taskbar icon is the VELTRIX mark, not a generic executable icon.
- [ ] No console window appears at any point.
- [ ] An app-mode window opens (no address bar, no tabs) at roughly 420×880, and the setup wizard runs.
- [ ] Close the window: the process exits (`Get-Process` shows nothing left) and port 43921 is released.
- [ ] Relaunch: data persisted — same origin, same `--user-data-dir` profile.
- [ ] Launch a second time while the first is open: a second window appears on the same server; no second process holds the port.
- [ ] On a machine with only Chrome (no Edge), and with neither installed: the first works, the second shows the explanatory dialog and exits.
- [ ] The user's own browser profile is untouched (bookmarks, logins, open tabs).
- [ ] Airplane mode: everything works with labelled demo rates.

## Manual on-device checklist

No emulator was available when this was built, so run this pass on a real device (Android 7.0+; ideally one each of API 24–28, 29–32 and 33+).

- [ ] Install `release/VELTRIX-Wallet-v1.0.0.apk`; the launcher shows "VELTRIX Wallet" with the adaptive icon (and a monochrome icon on Android 13+ themed icons).
- [ ] Cold start: splash in the system theme, then the setup wizard; no white flash in dark mode.
- [ ] Finish setup; restart the app: data persists and the theme is correct from the first frame.
- [ ] Status and navigation bars are transparent with readable icons in light and dark (on API 24–25 the navigation bar is black by design).
- [ ] Content is not hidden behind the status bar, display cutout or gesture/navigation bar.
- [ ] Keyboard: open "New fictional recipient" and the search fields; the focused field stays visible and the footer button sits above the keyboard.
- [ ] System back: closes sheets and dialogs, steps back in Send/Request, pops screens, returns to Home, then backgrounds the app (predictive back gesture on Android 14+).
- [ ] Rotate or resize (split screen): no crash, state kept.
- [ ] Settings → Appearance → System: toggling the system dark mode updates the app live.
- [ ] Data & backup → Export CSV / Save backup open the system "Save" dialog; files contain `SIMULATED` rows and the backup JSON. Restore from backup opens the file picker and restores.
- [ ] Share (Receive → Share demo details; result screen → Share) opens the share sheet with simulation-labelled text.
- [ ] Privacy & security → App lock (with a device screen lock set): the lock appears on launch and after 30 s in the background, and unlocking uses the device PIN, pattern or biometrics.
- [ ] Home-screen widget: add "VELTRIX demo card"; it shows the default card with DEMO CARD and a masked balance; freezing the card or changing the default card updates it; tapping opens the app.
- [ ] Airplane mode: everything works with demo rates; enabling live indicative rates shows an offline or error message and keeps demo rates labelled.
- [ ] With internet and live rates enabled: rates switch to "Indicative" with provider attribution and publish time.
- [ ] Large font (Settings → Display → Font size max): layout remains usable.
- [ ] TalkBack: main controls are announced with meaningful names.

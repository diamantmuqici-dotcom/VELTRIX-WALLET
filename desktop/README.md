# VELTRIX Wallet — Windows desktop shell

A single 1.4 MB `VELTRIX-Wallet-v…-win-x64.exe`. The production web bundle is
**compiled into the executable**; running it serves that bundle from
`127.0.0.1:43921` and opens it in an Edge/Chrome *app-mode* window (no address
bar, no tabs — it looks and behaves like a native app).

```
desktop/
  src/main.zig     the whole launcher (~430 lines, Zig std only, no dependencies)
  build/           generated, git-ignored: assets.zig, www/, veltrix.ico, app.res
```

## Build

```bash
tools/setup-exe-toolchain.sh   # ziglang 0.14.1 + Pillow from PyPI
tools/build-exe.sh             # → release/VELTRIX-Wallet-v1.0.0-win-x64.exe
```

`build-exe.sh` runs the unit tests, builds `app/dist` with Vite, turns every
file in it into an `@embedFile` entry (`tools/gen-win-assets.py`), renders a
multi-resolution `.ico` from the Android launcher PNGs
(`tools/render-win-icon.py`), cross-compiles with
`zig build-exe -target x86_64-windows --subsystem windows`, then verifies the
result.

## Why this shape rather than Electron

- **Nothing to download.** Electron's runtime lives on GitHub's release CDN
  (`objects.githubusercontent.com`), which a locked-down build sandbox blocks.
  Zig is on PyPI and cross-compiles to a PE image with no runtime fetch, so the
  build works offline apart from npm and PyPI.
- **Size.** 1.4 MB versus ~200 MB for an Electron installer, because there is no
  second browser engine: the machine's own Edge or Chrome draws the UI.
- **Attack surface.** One small Zig file with no third-party dependencies,
  instead of a Chromium fork plus a Node runtime.

The trade-off is that the app needs a Chromium-based browser present. Edge ships
with Windows 10/11, so in practice it is always there; if it is not, the launcher
says so in a dialog rather than failing silently.

## How it works

1. Bind `127.0.0.1:43921`.
2. If the port is held, `GET /__veltrix/ping`. If another VELTRIX answers, open a
   second window onto it and exit — one server, however many windows.
3. Otherwise serve the embedded bundle (one thread per connection,
   `Connection: close`) and launch
   `msedge.exe --app=http://127.0.0.1:43921/ --window-size=420,880 --user-data-dir=%LocalAppData%\VELTRIX Wallet\profile`.
4. Block until that window closes, then exit and close the socket.

**The port is fixed on purpose.** The wallet keeps its ledger in
`localStorage`, which the browser keys by origin. An ephemeral port would mean a
different origin on every launch and a wallet that appeared to forget everything.
A dedicated `--user-data-dir` keeps that profile — and therefore the simulated
data — out of the user's own browser profile.

Flags: `--serve-only`, `--print-url`, `--port <n>`, `--version`, `--help`.

## Security

- **Loopback only.** `bind()` is called with `127.0.0.1` explicitly, never
  `INADDR_ANY`. `build-exe.sh` asserts this from the kernel's view of the
  process's own sockets rather than by probing an interface, because inside a
  container a port-forwarder often listens on the external address for every
  port in use and would answer the probe on the server's behalf.
- **`SO_REUSEADDR`, deliberately not `SO_REUSEPORT`.** `net.Address.listen`'s
  `reuse_address` option sets *both*, and `SO_REUSEPORT` lets two live processes
  share one port — which silently defeats single-instance detection. The launcher
  therefore calls `socket`/`setsockopt`/`bind`/`listen` itself.
- **No filesystem access at request time.** Requests are matched against a
  compiled-in table, so a path cannot escape into one; `..` and NUL are rejected
  outright and anything unmatched that has a file extension 404s.
- **No new CSP surface.** The bundle's `default-src 'self'` is unchanged; served
  from `127.0.0.1` it is stricter than the WebView it replaces.
- **Nothing written to disk** except the browser's own profile directory.

## Unsigned — SmartScreen

There is no code-signing certificate in this repository, so the `.exe` is
unsigned and Windows SmartScreen will show *"Windows protected your PC"* on
first run. That is expected for any unsigned binary, not a defect. To resolve it:

- Sign it: `signtool sign /fd sha256 /tr <ts-url> /td sha256 /a VELTRIX-Wallet-….exe`
  with an OV/EV certificate (EV builds reputation immediately; OV takes weeks).
- Or have users choose **More info → Run anyway**.

Verify what you downloaded against
[`release/VELTRIX-Wallet-v1.0.0-win-x64.exe.sha256`](../release/VELTRIX-Wallet-v1.0.0-win-x64.exe.sha256):

```powershell
Get-FileHash VELTRIX-Wallet-v1.0.0-win-x64.exe -Algorithm SHA256
```

## What has and has not been verified

Verified in this repository (see the root README, *Test results*):

- PE image: PE32+, x64, GUI subsystem, embedded bundle present verbatim.
- 27 functional checks over HTTP against the same source compiled for the host.
- All 19 end-to-end UI tests, re-run against the bundle *as served by the
  launcher* — zero console errors or CSP violations.

**Not** verified, because no Windows host was available: the `MessageBoxW` error
dialog, browser discovery against real `Program Files` paths, `--app` window
framing, and SmartScreen's actual behaviour. These are all in the launcher's
Windows-only branches, not in the serving path that was tested.

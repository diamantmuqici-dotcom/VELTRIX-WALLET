#!/usr/bin/env bash
# Builds, signs-off and verifies the Windows desktop launcher (.exe) on Linux.
#
#   web bundle (Vite) → assets.zig (@embedFile) → zig build-exe -target x86_64-windows
#   → .ico PE resource → static PE verification → functional test of the same
#     source compiled for the host, probed over HTTP
#
# No Windows host and no downloaded runtime are needed: Zig cross-compiles the
# executable and the UI ships inside it. Requirements: Node 18+, python3,
# Pillow (for the icon) and ziglang — see tools/setup-exe-toolchain.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/desktop/build"
RELEASE_DIR="$ROOT/release"

VERSION_NAME="1.0.0"
EXE_NAME="VELTRIX-Wallet-v${VERSION_NAME}-win-x64.exe"
TEST_PORT="${VELTRIX_TEST_PORT:-43999}"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

# --- toolchain -------------------------------------------------------------

PY="${VELTRIX_PYTHON:-}"
if [ -z "$PY" ] && [ -x "$HOME/.cache/veltrix-zig/bin/python" ]; then
  PY="$HOME/.cache/veltrix-zig/bin/python"
fi
[ -n "$PY" ] || PY="$(command -v python3)"

# The ziglang wheel does not always install a console script, so ask the package
# where it put the compiler before falling back to PATH.
ZIG="${VELTRIX_ZIG:-}"
[ -n "$ZIG" ] || ZIG="$(find "$HOME/.cache/veltrix-zig" -maxdepth 5 -type f -name zig 2>/dev/null | head -1 || true)"
[ -n "$ZIG" ] || ZIG="$(command -v zig || true)"
[ -n "$ZIG" ] || ZIG="$("$PY" -c 'import os, ziglang; print(os.path.join(os.path.dirname(ziglang.__file__), "zig"))' 2>/dev/null || true)"
[ -n "$ZIG" ] && [ -x "$ZIG" ] || die "zig not found — run tools/setup-exe-toolchain.sh (or set VELTRIX_ZIG)"
"$ZIG" version >/dev/null 2>&1 || die "'$ZIG' is not a working zig"

step "0/7 Toolchain"
echo "  zig:    $("$ZIG" version) ($ZIG)"
echo "  python: $("$PY" -V 2>&1)"

# --- 1) web bundle ---------------------------------------------------------

step "1/7 Web bundle (type-check, tests, Vite production build)"
cd "$ROOT/app"
[ -d node_modules ] || npm ci --no-audit --no-fund
if [ "${SKIP_TESTS:-0}" != "1" ]; then npm test --silent; fi
npm run build --silent
cd "$ROOT"
[ -f "$ROOT/app/dist/index.html" ] || die "app/dist/index.html missing after build"

# --- 2) generate the embedded asset table ----------------------------------

step "2/7 Generate assets.zig from app/dist"
rm -rf "$OUT"
mkdir -p "$OUT"
cp "$ROOT/desktop/src/main.zig" "$OUT/main.zig"
"$PY" "$ROOT/tools/gen-win-assets.py" "$ROOT/app/dist" "$OUT"

# --- 3) Windows icon resource ---------------------------------------------

step "3/7 Windows icon resource"
RES_ARGS=()
if "$PY" -c "import PIL" 2>/dev/null; then
  "$PY" "$ROOT/tools/render-win-icon.py" \
    "$ROOT/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png" \
    "$OUT/veltrix.ico"
  printf '1 ICON "veltrix.ico"\n' > "$OUT/app.rc"
  ( cd "$OUT" && "$ZIG" rc app.rc app.res )
  RES_ARGS+=("$OUT/app.res")
  echo "  app.res: linked into the executable"
else
  echo "  skipped: Pillow not available (pip install pillow) — exe gets no custom icon"
fi

# --- 4) cross-compile ------------------------------------------------------

step "4/7 zig build-exe (x86_64-windows, ReleaseSafe, GUI subsystem)"
mkdir -p "$RELEASE_DIR"
"$ZIG" build-exe "$OUT/main.zig" "${RES_ARGS[@]}" \
  -target x86_64-windows -O ReleaseSafe --subsystem windows \
  --name veltrix \
  -femit-bin="$OUT/$EXE_NAME"
ls -l "$OUT/$EXE_NAME" | awk '{print "  "$5" B  "$9}'

# --- 5) static PE verification --------------------------------------------

step "5/7 Verify the PE image"
"$PY" - "$OUT/$EXE_NAME" "$ROOT/app/dist/index.html" <<'PY'
import struct, sys

exe, index_html = sys.argv[1], sys.argv[2]
d = open(exe, 'rb').read()

assert d[:2] == b'MZ', 'not a DOS/PE image'
pe = struct.unpack('<I', d[0x3c:0x40])[0]
assert d[pe:pe + 4] == b'PE\x00\x00', 'missing PE signature'

machine, nsections = struct.unpack('<HH', d[pe + 4:pe + 8])
opt = pe + 24
magic = struct.unpack('<H', d[opt:opt + 2])[0]
subsystem = struct.unpack('<H', d[opt + 68:opt + 70])[0]

assert machine == 0x8664, f'machine 0x{machine:04x} != 0x8664 (x64)'
assert magic == 0x20b, f'optional header magic 0x{magic:x} != 0x20b (PE32+)'
assert subsystem == 2, f'subsystem {subsystem} != 2 (GUI); a console window would pop up'

# The bundle is compiled in, so its bytes must be findable verbatim.
html = open(index_html, 'rb').read()
assert html in d, 'embedded web bundle (index.html) not found in the image'
assert b'X-Veltrix-Ping' in d, 'launcher strings missing'
assert b'--app=' in d, 'app-mode launch flag missing'
assert b'msedge.exe' in d and b'chrome.exe' in d, 'browser candidates missing'

print(f"PE: PE32+ x64, GUI subsystem, {nsections} sections, {len(d):,} B")
print(f"embedded bundle: index.html {len(html):,} B present verbatim")
PY

# --- 6) functional test: same source, host target, probed over HTTP --------

step "6/7 Functional test (host build of the same source, HTTP probe)"
"$ZIG" build-exe "$OUT/main.zig" -target native -O ReleaseSafe -femit-bin="$OUT/launcher-host"

PASS=0; FAIL=0; SERVER_PID=""
check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"
  else FAIL=$((FAIL + 1)); printf '  \033[31m✗\033[0m %s: expected %s, got %s\n' "$1" "$2" "$3"; fi
}
code() { curl -s -m 10 -o /dev/null -w '%{http_code}' "$@"; }
cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null; pkill -f 'launcher[-]host' 2>/dev/null || true; }
trap cleanup EXIT

# 6a) The default-port path — the one a real launch takes: fixed port, so the
#     origin (and the wallet's localStorage) is stable across runs.
"$OUT/launcher-host" --print-url >"$OUT/serve.log" 2>&1 &
SERVER_PID=$!

URL=""
for _ in $(seq 1 100); do
  URL="$(head -n1 "$OUT/serve.log" 2>/dev/null | tr -d '\r')"
  [ -n "$URL" ] && break
  [ -d "/proc/$SERVER_PID" ] || die "server exited early: $(cat "$OUT/serve.log")"
  sleep 0.1
done
[ -n "$URL" ] || die "server did not print its URL"
BASE="${URL%/}"
PORT="${URL##*:}"; PORT="${PORT%%/*}"
echo "  serving at $BASE"
check "binds the fixed default port" "43921" "$PORT"

check "GET / → 200" 200 "$(code "$BASE/")"
check "GET / body == app/dist/index.html" \
  "$(sha256sum "$ROOT/app/dist/index.html" | cut -d' ' -f1)" \
  "$(curl -s -m 10 "$BASE/" | sha256sum | cut -d' ' -f1)"

JS="$(basename "$(find "$ROOT/app/dist/assets" -name '*.js' | head -1)")"
CSS="$(basename "$(find "$ROOT/app/dist/assets" -name '*.css' | head -1)")"
WOFF="$(basename "$(find "$ROOT/app/dist/assets" -name '*.woff2' | head -1)")"
check "GET /assets/$JS → 200" 200 "$(code "$BASE/assets/$JS")"
check "GET /assets/$CSS → 200" 200 "$(code "$BASE/assets/$CSS")"
check "GET /assets/$WOFF → 200" "$(stat -c %s "$ROOT/app/dist/assets/$WOFF")" \
  "$(curl -s -m 10 "$BASE/assets/$WOFF" | wc -c)"
check "GET /favicon.svg → 200" 200 "$(code "$BASE/favicon.svg")"
check "hashed asset is immutable-cached" "public, max-age=31536000, immutable" \
  "$(curl -s -m 10 -I "$BASE/assets/$JS" | tr -d '\r' | sed -n 's/^Cache-Control: //p')"
check "index.html is not cached" "no-cache" \
  "$(curl -s -m 10 -I "$BASE/" | tr -d '\r' | sed -n 's/^Cache-Control: //p')"
check "nosniff on every response" "nosniff" \
  "$(curl -s -m 10 -I "$BASE/" | tr -d '\r' | sed -n 's/^X-Content-Type-Options: //p')"
check "js served as javascript" "text/javascript; charset=utf-8" \
  "$(curl -s -m 10 -I "$BASE/assets/$JS" | tr -d '\r' | sed -n 's/^Content-Type: //p')"
check "fonts served as woff2" "font/woff2" \
  "$(curl -s -m 10 -I "$BASE/assets/$WOFF" | tr -d '\r' | sed -n 's/^Content-Type: //p')"

check "HEAD / → 200 with empty body" "200 0" \
  "$(curl -s -m 10 -I "$BASE/" -o /dev/null -w '%{http_code} %{size_download}')"
check "SPA route falls back to index.html" 200 "$(code "$BASE/home/transfer/42")"
check "missing file 404s" 404 "$(code "$BASE/assets/does-not-exist.js")"
check "path traversal is rejected" 400 "$(code --path-as-is "$BASE/../../etc/passwd")"
check "null byte is rejected" 400 "$(code --path-as-is "$BASE/%00")"
check "POST is not allowed" 405 "$(code -X POST "$BASE/")"
check "ping reports the version" "1.0.0" "$(curl -s -m 10 "$BASE/__veltrix/ping")"

# Loopback-only. Assert this from the kernel's view of *our own* sockets rather
# than by probing the machine's other addresses: inside a container or sandbox a
# port-forwarder commonly listens on the external interface for every port that
# is in use and proxies it to loopback, which makes such a probe report the
# forwarder's answer rather than the launcher's binding.
if command -v ss >/dev/null 2>&1; then
  MINE="$(ss -ltnpH 2>/dev/null | grep "pid=$SERVER_PID," || true)"
  check "owns exactly one listener" "1" "$(printf '%s' "$MINE" | grep -c . || true)"
  check "that listener is loopback-only" "0" \
    "$(printf '%s\n' "$MINE" | awk 'NF {print $4}' | grep -vc '^127\.0\.0\.1:' || true)"
else
  echo "  · ss unavailable — socket-ownership check skipped"
fi

# 6b) Single-instance on the default port: the second launcher must recognise
#     the first via /__veltrix/ping and defer, not double-bind. `timeout`
#     matters — a launcher that wrongly re-binds would sit in accept() forever
#     and hang the build instead of failing it.
set +e
timeout 10 "$OUT/launcher-host" --serve-only >"$OUT/second.log" 2>&1
SECOND_RC=$?
set -e
check "second instance exits instead of double-binding" "1" "$SECOND_RC"
check "second instance names the conflict" "1" \
  "$(grep -c 'already listening on 127.0.0.1:43921' "$OUT/second.log" || true)"
check "first instance still serves after the probe" 200 "$(code "$BASE/")"

# 6c) Explicit --port: a free port binds, an occupied one fails loudly (no
#     ping deferral — the caller asked for that exact port).
"$OUT/launcher-host" --serve-only --port "$TEST_PORT" >"$OUT/alt.log" 2>&1 &
ALT_PID=$!
for _ in $(seq 1 50); do
  [ "$(code "http://127.0.0.1:$TEST_PORT/__veltrix/ping")" = "200" ] && break
  sleep 0.1
done
check "explicit --port binds and serves" 200 "$(code "http://127.0.0.1:$TEST_PORT/")"
set +e
timeout 10 "$OUT/launcher-host" --serve-only --port "$TEST_PORT" >"$OUT/alt2.log" 2>&1
ALT2_RC=$?
set -e
check "occupied --port fails loudly" "1" "$ALT2_RC"
check "occupied --port names the port" "1" \
  "$(grep -c "could not bind 127.0.0.1:$TEST_PORT" "$OUT/alt2.log" || true)"
kill "$ALT_PID" 2>/dev/null || true
wait "$ALT_PID" 2>/dev/null || true

cleanup
trap - EXIT

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || die "$FAIL functional check(s) failed"

# --- 7) publish -----------------------------------------------------------

step "7/7 Publish"
cp "$OUT/$EXE_NAME" "$RELEASE_DIR/$EXE_NAME"
( cd "$RELEASE_DIR" && sha256sum "$EXE_NAME" > "$EXE_NAME.sha256" )
ls -l "$RELEASE_DIR/$EXE_NAME"
cat "$RELEASE_DIR/$EXE_NAME.sha256"
printf '\n\033[1;32m✓ Built and verified %s\033[0m\n' "release/$EXE_NAME"
printf '  Unsigned: Windows SmartScreen will warn on first run (see desktop/README.md).\n'

#!/usr/bin/env bash
# Builds, signs and verifies the VELTRIX Wallet APK without Gradle:
#   web bundle (Vite) → aapt2 compile/link → javac → d8 → zipalign → apksigner → verify
# Requirements: Node 18+ and the toolchain from tools/setup-toolchain.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TC="${VELTRIX_TOOLCHAIN:-$HOME/.cache/veltrix-toolchain}"
JDK="${VELTRIX_JDK:-$TC/jdk17/linux-x86}"
SDK="${VELTRIX_SDK:-$TC/sdk}"
ANDROID_JAR="$SDK/35/public/android.jar"
BT="$SDK/tools/linux"
export LD_LIBRARY_PATH="$BT/lib64:${LD_LIBRARY_PATH:-}"

APP_ID="com.veltrix.wallet"
VERSION_CODE=1
VERSION_NAME="1.0.0"
MIN_SDK=24
TARGET_SDK=35
APK_NAME="VELTRIX-Wallet-v${VERSION_NAME}.apk"

KEYSTORE="${VELTRIX_KEYSTORE:-$ROOT/android/keystore/veltrix-dev.jks}"
KEY_ALIAS="${VELTRIX_KEY_ALIAS:-veltrix}"
STORE_PASS="${VELTRIX_STORE_PASS:-veltrix-dev}"
KEY_PASS="${VELTRIX_KEY_PASS:-veltrix-dev}"

SRC="$ROOT/android/app/src/main"
OUT="$ROOT/android/build-apk"
RELEASE_DIR="$ROOT/release"

step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
need() { [ -e "$1" ] || { echo "Missing $1 — run tools/setup-toolchain.sh first." >&2; exit 1; }; }

need "$ANDROID_JAR"; need "$BT/bin/aapt2"; need "$BT/bin/zipalign"; need "$BT/lib/d8.jar"; need "$BT/lib/apksigner.jar"; need "$JDK/bin/javac"
JAVA="$JDK/bin/java"

step "1/8 Web bundle (type-check, tests, Vite production build)"
cd "$ROOT/app"
[ -d node_modules ] || npm ci --no-audit --no-fund
if [ "${SKIP_TESTS:-0}" != "1" ]; then npm test --silent; fi
npm run build --silent
cd "$ROOT"

step "2/8 Prepare build directory"
rm -rf "$OUT"
mkdir -p "$OUT"/{compiled,gen,classes,dex,assets/www}
cp -R "$ROOT/app/dist/." "$OUT/assets/www/"
# The manifest stays Gradle/AGP-compatible (no package/uses-sdk); inject the package for aapt2.
python3 - "$SRC/AndroidManifest.xml" "$OUT/AndroidManifest.xml" "$APP_ID" <<'PY'
import sys, re
src, dst, pkg = sys.argv[1:4]
s = open(src, encoding='utf-8').read()
s = re.sub(r'<manifest\b', f'<manifest package="{pkg}"', s, count=1)
open(dst, 'w', encoding='utf-8').write(s)
PY

step "3/8 aapt2 compile + link (resources, manifest, assets)"
"$BT/bin/aapt2" compile --dir "$SRC/res" -o "$OUT/compiled/res.zip"
"$BT/bin/aapt2" link -o "$OUT/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$OUT/AndroidManifest.xml" \
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -A "$OUT/assets" \
  --java "$OUT/gen" \
  "$OUT/compiled/res.zip"

step "4/8 javac (Java 8 bytecode against android.jar API $TARGET_SDK)"
find "$SRC/java" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
"$JDK/bin/javac" -source 8 -target 8 -encoding UTF-8 -Xlint:-options -Xlint:deprecation -Xlint:unchecked \
  -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" -d "$OUT/classes" @"$OUT/sources.txt" \
  || { echo "javac failed" >&2; exit 1; }

step "5/8 d8 (dex, min API $MIN_SDK)"
find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
"$JAVA" -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --release --min-api "$MIN_SDK" --lib "$ANDROID_JAR" --output "$OUT/dex" @"$OUT/classes.txt"

step "6/8 Assemble + zipalign"
cp "$OUT/base.apk" "$OUT/unaligned.apk"
(cd "$OUT/dex" && zip -q -X "$OUT/unaligned.apk" classes.dex)
"$BT/bin/zipalign" -p -f 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"

step "7/8 Sign (APK Signature Scheme v1 + v2 + v3)"
"$JAVA" -jar "$BT/lib/apksigner.jar" sign \
  --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" --ks-pass "pass:$STORE_PASS" --key-pass "pass:$KEY_PASS" \
  --min-sdk-version "$MIN_SDK" --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$OUT/$APK_NAME" "$OUT/aligned.apk"

step "8/8 Verify"
"$JAVA" -jar "$BT/lib/apksigner.jar" verify --verbose --print-certs "$OUT/$APK_NAME" | grep -E "Verifies|Verified using|Signer #1 certificate (DN|SHA-256)|Number of signers" || true
"$JAVA" -jar "$BT/lib/apksigner.jar" verify "$OUT/$APK_NAME"
"$BT/bin/zipalign" -c -p 4 "$OUT/$APK_NAME" && echo "zipalign: OK (4-byte, page-aligned .so none)"
"$BT/bin/aapt2" dump badging "$OUT/$APK_NAME" | grep -E "^(package|sdkVersion|targetSdkVersion|application-label:|launchable-activity|uses-permission)" || true
python3 - "$OUT/$APK_NAME" <<'PY'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()
arsc = z.getinfo('resources.arsc')
assert arsc.compress_type == zipfile.ZIP_STORED, 'resources.arsc must be stored uncompressed (Android 11+)'
for required in ['AndroidManifest.xml', 'classes.dex', 'resources.arsc', 'assets/www/index.html']:
    assert required in names, f'missing {required}'
js = [n for n in names if n.startswith('assets/www/assets/') and n.endswith('.js')]
assert js, 'web bundle missing'
print(f"zip check: OK ({len(names)} entries, resources.arsc stored, web bundle {len(js)} js file(s))")
PY
"$BT/bin/dexdump" -f "$OUT/dex/classes.dex" | grep -E "^(magic|class_defs_size|method_ids_size)" | sed 's/^/dex: /'

mkdir -p "$RELEASE_DIR"
cp "$OUT/$APK_NAME" "$RELEASE_DIR/$APK_NAME"
(cd "$RELEASE_DIR" && sha256sum "$APK_NAME" > "$APK_NAME.sha256")
ls -l "$RELEASE_DIR/$APK_NAME"
cat "$RELEASE_DIR/$APK_NAME.sha256"
printf '\n\033[1;32m✓ Built and verified %s\033[0m\n' "release/$APK_NAME"

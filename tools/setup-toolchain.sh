#!/usr/bin/env bash
# Fetches the minimal Android build toolchain used by tools/build-apk.sh:
#   - JDK 17 (javac, keytool)            from AOSP prebuilts (jdk17, linux-x86)
#   - android.jar (API 35), aapt2, d8, zipalign, apksigner, dexdump
#                                         from AOSP prebuilts/sdk
# Only github.com is needed (sparse, blob-filtered clones of public AOSP mirrors).
# Nothing is installed system-wide; everything lands in $VELTRIX_TOOLCHAIN.
set -euo pipefail

TC="${VELTRIX_TOOLCHAIN:-$HOME/.cache/veltrix-toolchain}"
mkdir -p "$TC"

sdk_ok() { [ -f "$TC/sdk/35/public/android.jar" ] && [ -x "$TC/sdk/tools/linux/bin/aapt2" ] && [ -f "$TC/sdk/tools/linux/lib/d8.jar" ]; }
jdk_ok() { [ -x "$TC/jdk17/linux-x86/bin/javac" ]; }

if sdk_ok; then
  echo "✓ Android SDK pieces present in $TC/sdk"
else
  echo "→ Fetching Android SDK pieces (android.jar 35, build tools)…"
  rm -rf "$TC/sdk"
  git clone -q --depth 1 --filter=blob:none --no-checkout --single-branch --branch main \
    https://github.com/msft-mirror-aosp/platform.prebuilts.sdk.git "$TC/sdk"
  (
    cd "$TC/sdk"
    git sparse-checkout init --no-cone
    git sparse-checkout set --no-cone '/35/public/android.jar' '/tools/linux/bin/' '/tools/linux/lib/' \
      '/tools/linux/lib64/libc++.so' '/tools/linux/lib64/libc++.so.1'
    git checkout -q main
  )
  chmod +x "$TC/sdk/tools/linux/bin/"* || true
fi

if jdk_ok; then
  echo "✓ JDK 17 present in $TC/jdk17"
else
  echo "→ Fetching JDK 17…"
  rm -rf "$TC/jdk17"
  git clone -q --depth 1 --filter=blob:none --no-checkout --single-branch --branch android13-d1-release \
    https://github.com/msft-mirror-aosp/platform.prebuilts.jdk.jdk17.git "$TC/jdk17"
  (
    cd "$TC/jdk17"
    git sparse-checkout init --no-cone
    git sparse-checkout set --no-cone '/linux-x86/'
    git checkout -q android13-d1-release
  )
  chmod +x "$TC/jdk17/linux-x86/bin/"* || true
fi

export LD_LIBRARY_PATH="$TC/sdk/tools/linux/lib64:${LD_LIBRARY_PATH:-}"
echo
echo "Toolchain versions:"
"$TC/jdk17/linux-x86/bin/javac" -version 2>&1 | sed 's/^/  /'
"$TC/sdk/tools/linux/bin/aapt2" version 2>&1 | sed 's/^/  /'
"$TC/jdk17/linux-x86/bin/java" -cp "$TC/sdk/tools/linux/lib/d8.jar" com.android.tools.r8.D8 --version 2>&1 | head -1 | sed 's/^/  /'
"$TC/jdk17/linux-x86/bin/java" -jar "$TC/sdk/tools/linux/lib/apksigner.jar" --version 2>&1 | sed 's/^/  apksigner /'

#!/usr/bin/env bash
# Fetches the cross-compiler used by tools/build-exe.sh:
#   - ziglang (Zig, cross-compiles the launcher to a Windows PE32+ executable)
#   - Pillow  (renders the multi-resolution .ico)
#
# Both come from PyPI, so only pypi.org / files.pythonhosted.org are needed.
# Nothing is installed system-wide; everything lands in a venv under
# $VELTRIX_EXE_TOOLCHAIN. Unlike an Electron-based build this needs no
# downloaded browser runtime — the UI is compiled into the executable itself.
set -euo pipefail

TC="${VELTRIX_EXE_TOOLCHAIN:-$HOME/.cache/veltrix-zig}"

ZIG_OK() { [ -x "$TC/bin/python" ] && find "$TC" -maxdepth 5 -type f -name zig 2>/dev/null | grep -q . && "$TC/bin/python" -c 'import PIL' 2>/dev/null; }

if ZIG_OK; then
  echo "✓ Desktop cross-compiler present in $TC"
else
  echo "→ Installing ziglang + Pillow into $TC …"
  python3 -m venv "$TC"
  "$TC/bin/pip" install --quiet --upgrade pip
  "$TC/bin/pip" install --quiet "ziglang==0.14.1" pillow
fi

ZIG="$(find "$TC" -maxdepth 5 -type f -name zig 2>/dev/null | head -1)"
export VELTRIX_ZIG="$ZIG"
export VELTRIX_PYTHON="$TC/bin/python"

echo
echo "Toolchain versions:"
"$ZIG" version 2>&1 | sed 's/^/  zig /'
"$TC/bin/python" -c 'import PIL; print("  Pillow", PIL.__version__)'
echo
echo "Next: bash tools/build-exe.sh"
